/**
 * Trips screen read models, layered on trips.ts (which is used unchanged):
 *
 * - `refineTripBudget`: a planned ski day is a container, not a cost line. Its lift access counts as accounted for
 *   when a lift-ticket item covers that day at that resort, or when an owned pass can be used that day (the plan
 *   consumes allotments in date order). Otherwise the day stays in `missing` with a reason that says what to add.
 *   Nothing else changes: unknown costs are never read as $0, totals stay null until every line is priced.
 * - `getTripsPage`: list rows with the refined budget glance, checklist progress and the resort picker used by the
 *   new-trip flow.
 * - `getTripPage`: the detail view — every date of the trip as a day (ski / travel / free), per-day pass access for
 *   owned products or a chosen "what if" product (unknown rules are never permission), conditions or weather
 *   potential when the date is inside the forecast horizon, catalog hotels and events for the trip's resorts,
 *   the skills checklist for the lesson planner, checklist templates and the flight-offers connector state.
 */
import 'server-only'
import { asc, eq, inArray } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { LessonRow, TripItemRow, TripRow } from '@/lib/db/rows'
import type { ResortLinks } from '@/lib/db/schema'
import { computeTripBudget, type MoneyRange, type TripBudget, type TripBudgetItemInput, type FxRateRecord } from '@/lib/domain/costs'
import { planAccess, type AccessPlan, type AccessVerdict } from '@/lib/domain/passes'
import { addDays, dateRange, daysBetween, seasonIdFor } from '@/lib/domain/time'
import type { AbilityLevel, PassFamilyId, Provenance, ScoringMode, UnitPrefs } from '@/lib/domain/types'
import { isLive, loadBundle, loadPassData, type Bundle, type DataCtx } from './core'
import { providerStatus } from './deps'
import { MAX_FORECAST_DAYS } from './forecast'
import { buildSummaries, type ResortSummary } from './resorts'
import { getTripDetail, type TripDetail, type TripSummary } from './trips'
import { eventView, openingView, travelView, type AirportOption, type EventView, type ExpenseView, type MyPassView, type OpeningView, type TransferOption } from './views'

// ---------------------------------------------------------------------------
// Budget refinement (pure)

export interface AccountedDay {
  id: TripBudget['missing'][number]['id']
  title: string
  date: string
  resortId: string
  by: 'lift-ticket' | 'pass'
  /** "Alta lift tickets, 3 days" / "Indy Base Pass". */
  detail: string
}

export interface RefinedBudget extends TripBudget {
  /** Ski days whose lift access is priced by a lift-ticket item or covered by an owned pass (not missing). */
  accounted: AccountedDay[]
  /** Priced lines by cost kind — the budget is only ever your estimates, quotes or actuals. */
  kinds: { estimate: number; quote: number; actual: number }
}

type ItemLike = Pick<TripItemRow, 'id' | 'type' | 'refId' | 'date' | 'endDate' | 'costMinor' | 'title'>

/** Does a lift-ticket item price this resort on this date? (single day, or date..endDate inclusive) */
export function liftTicketFor(items: readonly ItemLike[], resortId: string, date: string): ItemLike | null {
  return (
    items.find((i) => {
      if (i.type !== 'lift-ticket' || i.refId !== resortId || !i.date || i.costMinor == null) return false
      const end = i.endDate && i.endDate >= i.date ? i.endDate : i.date
      return date >= i.date && date <= end
    }) ?? null
  )
}

/**
 * Re-evaluate `missing` for planned ski days (see the module note). `passCover` answers "which owned pass can be
 * used on this resort day", or null.
 */
export function refineTripBudget(budget: TripBudget, items: readonly ItemLike[], passCover: (resortId: string, date: string) => string | null): RefinedBudget {
  const byId = new Map(items.map((i) => [i.id, i]))
  const accounted: AccountedDay[] = []
  const missing: TripBudget['missing'] = []
  for (const m of budget.missing) {
    const item = typeof m.id === 'number' ? byId.get(m.id) : undefined
    if (!item || item.type !== 'resort-day' || !item.refId || !item.date || item.costMinor != null) {
      missing.push(m)
      continue
    }
    const ticket = liftTicketFor(items, item.refId, item.date)
    if (ticket) {
      accounted.push({ id: m.id, title: m.title, date: item.date, resortId: item.refId, by: 'lift-ticket', detail: ticket.title })
      continue
    }
    const pass = passCover(item.refId, item.date)
    if (pass) {
      accounted.push({ id: m.id, title: m.title, date: item.date, resortId: item.refId, by: 'pass', detail: pass })
      continue
    }
    missing.push({ ...m, reason: 'Lift access not priced — add a lift ticket, or plan with a pass that covers this day' })
  }
  const complete = missing.length === 0 && budget.unconverted.length === 0
  const kinds = { estimate: 0, quote: 0, actual: 0 }
  for (const l of budget.lines) if (l.groupTotal && l.costKind) kinds[l.costKind] += 1
  return {
    ...budget,
    missing,
    complete,
    total: complete ? budget.group : null,
    perPersonTotal: complete ? budget.perPersonMax : null,
    accounted,
    kinds,
  }
}

/** Same item → budget-input mapping as trips.ts (a stored rate is trusted only with the currency it converts into). */
export function budgetInputsOf(items: readonly TripItemRow[]): TripBudgetItemInput[] {
  return items.map((i) => ({
    id: i.id,
    type: i.type,
    title: i.title,
    date: i.date,
    status: i.status,
    costMinor: i.costMinor,
    costMaxMinor: i.costMaxMinor,
    currency: i.currency,
    costKind: i.costKind,
    costBasis: i.costBasis,
    fxRate: i.fxRate,
    fxDate: i.fxDate,
    fxQuote: typeof i.details?.fxQuote === 'string' ? (i.details.fxQuote as string) : null,
    quoteExpiresAt: i.quoteExpiresAt,
  }))
}

// ---------------------------------------------------------------------------
// Shared small views

export interface PickerResort {
  id: string
  name: string
  shortName: string
  region: string
  /** "Virgil, NY" / "Alta, UT" */
  place: string | null
  favorite: boolean
  /** One-way drive from home (curated estimate), when recorded. */
  driveMinutes: number | null
  /** Practical (or, failing that, closest) airports. */
  flyVia: string[]
}

export interface BudgetGlance {
  currency: string
  partySize: number
  /** Whole party; null unless complete. */
  total: MoneyRange | null
  /** Largest individual share; null unless complete. */
  perPerson: MoneyRange | null
  /** Sum of priced lines only. */
  known: MoneyRange
  knownPerPerson: MoneyRange
  complete: boolean
  missing: number
  unconverted: number
  expired: number
  kinds: RefinedBudget['kinds']
  /** Priced lines (0 = no costs entered yet). */
  lines: number
}

export function glanceOf(b: RefinedBudget): BudgetGlance {
  const pricedLines = b.lines.filter((l) => l.groupTotal).length
  return {
    currency: b.currency,
    partySize: b.partySize,
    // Nothing priced is "no costs yet", never a $0 total.
    total: pricedLines ? b.total : null,
    perPerson: pricedLines ? b.perPersonTotal : null,
    known: b.group,
    knownPerPerson: b.perPersonMax,
    complete: b.complete,
    missing: b.missing.length,
    unconverted: b.unconverted.length,
    expired: b.expiredQuotes.length,
    kinds: b.kinds,
    lines: pricedLines,
  }
}

async function pickerResorts(ctx: DataCtx): Promise<PickerResort[]> {
  const { db } = ctx
  const [rows, favs, travel] = await Promise.all([
    db
      .select({ id: s.resorts.id, name: s.resorts.name, shortName: s.resorts.shortName, region: s.resorts.region, locality: s.resorts.locality, stateProvince: s.resorts.stateProvince, country: s.resorts.country, priority: s.resorts.priority })
      .from(s.resorts),
    db.select().from(s.favorites),
    db.select({ resortId: s.travelOptions.resortId, mode: s.travelOptions.mode, airportIata: s.travelOptions.airportIata, role: s.travelOptions.role, minutes: s.travelOptions.minutes }).from(s.travelOptions),
  ])
  const fav = new Set(favs.map((f) => f.resortId))
  return rows
    .map((r) => {
      const t = travel.filter((x) => x.resortId === r.id)
      const drive = t.find((x) => x.mode === 'drive-from-home')?.minutes ?? null
      const air = t.filter((x) => x.mode === 'airport' && x.airportIata)
      const practical = air.filter((x) => x.role !== 'closest')
      return {
        id: r.id,
        name: r.name,
        shortName: r.shortName,
        region: r.region,
        place: [r.locality, r.stateProvince ?? (r.country !== 'US' ? r.country : null)].filter(Boolean).join(', ') || null,
        favorite: fav.has(r.id),
        driveMinutes: drive,
        flyVia: [...new Set((practical.length ? practical : air).map((x) => x.airportIata!))],
        priority: r.priority,
      }
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (a.driveMinutes ?? 1e6) - (b.driveMinutes ?? 1e6) || b.priority - a.priority || a.name.localeCompare(b.name))
    .map(({ priority: _p, ...r }) => r)
}

/** For each owned product of mine: the plan over these resort days (allotments consumed in date order). */
function myPassCover(pass: Awaited<ReturnType<typeof loadPassData>>, visits: { resortId: string; date: string }[], today: string, names: Record<string, string>) {
  const covered = new Map<string, string>()
  for (const o of pass.owned.filter((x) => x.ownership.holder === 'me')) {
    const plan = planAccess(
      o.product,
      pass.rules.filter((r) => r.productId === o.product.id),
      visits,
      o.usage,
      { today, names },
    )
    for (const d of plan.days) if (d.verdict.canSki && !covered.has(`${d.resortId}|${d.date}`)) covered.set(`${d.resortId}|${d.date}`, o.product.name)
  }
  return (resortId: string, date: string) => covered.get(`${resortId}|${date}`) ?? null
}

// ---------------------------------------------------------------------------
// List

export interface TripRowView extends Omit<TripSummary, 'budget'> {
  glance: BudgetGlance
  checklist: { done: number; total: number }
  skiDays: number
  nights: number
  /** Trip notes, first line (for the list's editorial line). */
  lead: string | null
}

export interface TripsPage {
  upcoming: TripRowView[]
  past: TripRowView[]
  cancelled: TripRowView[]
  stats: {
    upcoming: number
    skiDays: number
    bookedItems: number
    openItems: number
    /** Known spend across upcoming trips (display currency); null when there are none. */
    known: MoneyRange | null
    incompleteTrips: number
  }
  picker: PickerResort[]
  home: string
  today: string
  currency: string
  templateCount: number
  demo: boolean
}

export async function getTripsPage(ctx: DataCtx): Promise<TripsPage> {
  const { db } = ctx
  const live = isLive(ctx)
  const [trips, items, resorts, rates, checklist, pass, picker, templates] = await Promise.all([
    db.select().from(s.trips).orderBy(asc(s.trips.startDate), asc(s.trips.id)),
    db.select().from(s.tripItems).orderBy(asc(s.tripItems.sortOrder), asc(s.tripItems.id)),
    db.select({ id: s.resorts.id, name: s.resorts.name, shortName: s.resorts.shortName }).from(s.resorts),
    db.select().from(s.fxRates),
    db.select({ tripId: s.tripChecklist.tripId, done: s.tripChecklist.done }).from(s.tripChecklist),
    loadPassData(db, ctx.prefs.activeSeasonId),
    pickerResorts(ctx),
    db.select({ id: s.checklistTemplates.id }).from(s.checklistTemplates),
  ])
  const fx: FxRateRecord[] = rates.filter((r) => !live || r.kind !== 'demo')
  const names = new Map(resorts.map((r) => [r.id, r.name]))
  const short = Object.fromEntries(resorts.map((r) => [r.id, r.shortName || r.name]))

  const rowsOf = trips.map((trip): TripRowView => {
    const mine = items.filter((i) => i.tripId === trip.id)
    const resortDays = mine.filter((i) => i.type === 'resort-day' && i.refId && i.date).sort((a, b) => a.date!.localeCompare(b.date!))
    const cover = myPassCover(pass, resortDays.map((d) => ({ resortId: d.refId!, date: d.date! })), ctx.today, short)
    const budget = refineTripBudget(
      computeTripBudget({ items: budgetInputsOf(mine), partySize: Math.max(1, trip.partySize), currency: ctx.prefs.currency, rates: fx, now: ctx.now, today: ctx.today }),
      mine,
      cover,
    )
    const list = checklist.filter((c) => c.tripId === trip.id)
    const resortIds = [...new Set(resortDays.map((d) => d.refId!))]
    const phase: TripSummary['phase'] =
      trip.status === 'cancelled' ? 'cancelled' : trip.endDate < ctx.today ? 'past' : trip.startDate <= ctx.today ? 'in-progress' : 'upcoming'
    return {
      id: trip.id,
      name: trip.name,
      status: trip.status,
      startDate: trip.startDate,
      endDate: trip.endDate,
      days: daysBetween(trip.startDate, trip.endDate) + 1,
      partySize: trip.partySize,
      originAirport: trip.originAirport,
      companions: trip.companions,
      resorts: resortIds.map((id) => ({ id, name: names.get(id) ?? id })),
      itemCount: mine.length,
      bookedCount: mine.filter((i) => i.status === 'booked').length,
      draftCount: mine.filter((i) => i.status !== 'booked').length,
      daysUntil: daysBetween(ctx.today, trip.startDate),
      phase,
      glance: glanceOf(budget),
      checklist: { done: list.filter((c) => c.done).length, total: list.length },
      skiDays: new Set(resortDays.map((d) => d.date)).size,
      nights: Math.max(0, daysBetween(trip.startDate, trip.endDate)),
      lead: trip.notes?.split('\n')[0]?.trim() || null,
    }
  })

  const upcoming = rowsOf.filter((t) => t.phase === 'upcoming' || t.phase === 'in-progress')
  const knownCurrency = ctx.prefs.currency.toUpperCase()
  const known = upcoming.length
    ? upcoming.reduce(
        (acc, t) => ({ min: { amountMinor: acc.min.amountMinor + t.glance.known.min.amountMinor, currency: knownCurrency }, max: { amountMinor: acc.max.amountMinor + t.glance.known.max.amountMinor, currency: knownCurrency } }),
        { min: { amountMinor: 0, currency: knownCurrency }, max: { amountMinor: 0, currency: knownCurrency } } as MoneyRange,
      )
    : null
  return {
    upcoming,
    past: rowsOf.filter((t) => t.phase === 'past').reverse(),
    cancelled: rowsOf.filter((t) => t.phase === 'cancelled'),
    stats: {
      upcoming: upcoming.length,
      skiDays: upcoming.reduce((n, t) => n + t.skiDays, 0),
      bookedItems: upcoming.reduce((n, t) => n + t.bookedCount, 0),
      openItems: upcoming.reduce((n, t) => n + t.draftCount, 0),
      known,
      incompleteTrips: upcoming.filter((t) => !t.glance.complete || !t.glance.lines).length,
    },
    picker,
    home: ctx.prefs.homeName,
    today: ctx.today,
    currency: knownCurrency,
    templateCount: templates.length,
    demo: !live,
  }
}

// ---------------------------------------------------------------------------
// Detail

export type ConditionsState = 'score' | 'closed' | 'no-score' | 'beyond-horizon' | 'past'

export interface DayConditions {
  state: ConditionsState
  /** Days from home today (negative when past). */
  leadDays: number
  summary: Pick<ResortSummary, 'score' | 'status' | 'closure' | 'weather' | 'snow' | 'opening' | 'officialAlerts'> | null
  /** Season opening/closing facts (date independent) — shown for dates beyond the forecast horizon. */
  opening: OpeningView | null
}

export interface DayResortView {
  itemId: number
  resortId: string
  name: string
  shortName: string
  timezone: string | null
  inCatalog: boolean
  /** Best answer across my owned products (plan order), from trips.ts. */
  access: MyPassView
  /** The chosen "what if" product's verdict for this day, when one is chosen. */
  chosen: AccessVerdict | null
  conditions: DayConditions
  /** Per-person day basket priced with the plan's verdict (reference, not in the trip total). */
  basket: ExpenseView | null
}

export interface TripDayView {
  date: string
  /** 1-based day of the trip. */
  n: number
  kind: 'ski' | 'travel' | 'free'
  resorts: DayResortView[]
  items: TripItemRow[]
  /** Lodging you sleep at that night (night k of n). */
  staying: { itemId: number; title: string; night: number; nights: number }[]
  /** Multi-day items that end on this date: return flights, check-outs, rental returns. */
  endings: { itemId: number; type: TripItemRow['type']; title: string; label: string }[]
  holidayName: string | null
}

export interface TripResortInfo {
  id: string
  name: string
  shortName: string
  lat: number
  lon: number
  timezone: string
  place: string | null
  links: ResortLinks
  lessons: boolean | null
  rentals: boolean | null
  prov: Provenance | null
  /** Drive from home (curated estimate unless sourced routing) with the explicit winter buffer. */
  drive: { minutes: number | null; km: number | null; basis: string | null; isEstimate: boolean; winterMinutes: number | null; prov: Provenance | null }
  /** Airports for this resort, most practical first (role: closest / practical / both), with airport → resort estimates. */
  airports: AirportOption[]
  transfers: TransferOption[]
}

export interface HotelOption {
  id: string
  resortId: string
  resortName: string
  name: string
  tier: 'budget' | 'comfortable' | 'premium' | null
  brand: string | null
  officialUrl: string | null
  distanceText: string | null
  skiInOut: 'verified-yes' | 'verified-no' | 'unknown'
  shuttle: string | null
  parking: string | null
  notes: string | null
  origin: 'catalog' | 'user'
  prov: Provenance | null
  savedItemId: number | null
}

export interface EventOption extends EventView {
  resortName: string | null
  /** during = overlaps the trip dates; undated = no announced date (never assumed); other = dated outside the trip. */
  when: 'during' | 'undated' | 'other'
  savedItemId: number | null
}

export type ItemConversion =
  | { converted: true; display: MoneyRange; from: string; to: string; rate: string; rateDate: string | null; source: 'your rate' | 'stored rate'; provider: string | null }
  | { converted: false; from: string; to: string }

export interface PassChoice {
  id: string
  name: string
  familyId: PassFamilyId
  familyName: string
  owned: boolean
}

export interface TripPage {
  detail: TripDetail
  trip: TripRow
  budget: RefinedBudget
  days: TripDayView[]
  /** Items without a date. */
  unscheduled: TripItemRow[]
  /** Items dated outside the trip. */
  outside: TripItemRow[]
  pass: {
    products: PassChoice[]
    chosen: PassChoice | null
    chosenPlan: AccessPlan | null
    ownsAny: boolean
  }
  resorts: TripResortInfo[]
  hotels: HotelOption[]
  events: EventOption[]
  skills: { id: number; label: string; category: string | null; status: string }[]
  lessons: LessonRow[]
  templates: { id: number; label: string; category: string | null; sortOrder: number }[]
  catalog: PickerResort[]
  /** Every airport on file (IATA, name, IANA zone) — itinerary timing and the flight editor. */
  airports: { iata: string; name: string; city: string | null; timezone: string | null; role: 'origin' | 'destination' | 'both' }[]
  home: { name: string; lat: number; lon: number }
  travelPrefs: { winterBufferPct: number; willingToFly: boolean; maxDriveHours: number | null; originAirports: string[] }
  flights: { state: 'live' | 'needs-credentials' | 'disabled' | 'demo'; testMode: boolean; notes: string[] }
  savedCompanion: { name: string | null; ability: AbilityLevel } | null
  ability: AbilityLevel
  units: UnitPrefs
  mode: ScoringMode
  currency: string
  /** Currencies with a stored rate into the display currency (latest date), for the item editor. */
  rates: { currency: string; rate: string; rateDate: string; provider: string }[]
  /** Per item: its price converted to the display currency (rate, date, source), or why it is not converted. */
  conversions: Record<string, ItemConversion>
  horizonEnd: string
  now: string
  today: string
  demo: boolean
}

const itemOrder = (a: TripItemRow, b: TripItemRow) => a.sortOrder - b.sortOrder || a.id - b.id

const TRAVEL_TYPES = new Set<TripItemRow['type']>(['flight', 'drive', 'transfer'])
const ENDING_LABEL: Partial<Record<TripItemRow['type'], string>> = {
  flight: 'Return flight',
  drive: 'Drive home',
  transfer: 'Return',
  lodging: 'Check out',
  rental: 'Rental ends',
}

function dayKind(items: readonly TripItemRow[], resorts: readonly DayResortView[], endings: TripDayView['endings']): TripDayView['kind'] {
  if (resorts.length) return 'ski'
  if (items.some((i) => TRAVEL_TYPES.has(i.type)) || endings.some((e) => TRAVEL_TYPES.has(e.type))) return 'travel'
  return 'free'
}

export async function getTripPage(ctx: DataCtx, id: string, opts: { pass?: string | null } = {}): Promise<TripPage | null> {
  const detail = await getTripDetail(ctx, id)
  if (!detail) return null
  const { db, today, now, prefs } = ctx
  const live = isLive(ctx)
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, id))
  if (!trip) return null

  const resortIds = [...new Set(detail.items.filter((i) => ['resort-day', 'lift-ticket', 'lesson', 'rental', 'parking', 'food', 'event', 'transfer', 'drive'].includes(i.type) && i.refId).map((i) => i.refId!))]
  const tripDates = dateRange(trip.startDate, trip.endDate)
  const skiDates = [...new Set(detail.resortDays.map((d) => d.date))].sort()
  const bundleIds = [...new Set([...detail.resortDays.map((d) => d.resortId), ...resortIds])]
  const b: Bundle | null = bundleIds.length ? await loadBundle(ctx, { ids: bundleIds, seasons: [...new Set(skiDates.map(seasonIdFor))] }) : null
  const catalogIds = b ? b.resorts.map((r) => r.row.id) : []

  const [hotelRows, skillRows, lessonRows, templateRows, catalog, airportRows] = await Promise.all([
    catalogIds.length ? db.select().from(s.hotels).where(inArray(s.hotels.resortId, catalogIds)) : Promise.resolve([]),
    db.select().from(s.skillChecklist).orderBy(asc(s.skillChecklist.sortOrder), asc(s.skillChecklist.id)),
    db.select().from(s.lessons).where(eq(s.lessons.tripId, id)),
    db.select().from(s.checklistTemplates).orderBy(asc(s.checklistTemplates.sortOrder), asc(s.checklistTemplates.id)),
    pickerResorts(ctx),
    db.select({ iata: s.airports.iata, name: s.airports.name, city: s.airports.city, timezone: s.airports.timezone, role: s.airports.role }).from(s.airports),
  ])

  // Pass coverage for the budget refinement (the detail's own plans, holder 'me').
  const coverByKey = new Map<string, string>()
  for (const p of detail.passPlans.filter((x) => x.holder === 'me')) {
    for (const d of p.plan.days) {
      const key = `${d.resortId}|${d.date}`
      if (d.verdict.canSki && !coverByKey.has(key)) coverByKey.set(key, p.productName)
    }
  }
  const budget = refineTripBudget(detail.budget, detail.items, (r, d) => coverByKey.get(`${r}|${d}`) ?? null)

  // "What if" product: any product of the active season (owned or not). Unknown rules stay unknown.
  const passData = b?.pass ?? (await loadPassData(db, prefs.activeSeasonId))
  const families = new Map(passData.families.map((f) => [f.id, f.name]))
  const ownedIds = new Set(passData.owned.filter((o) => o.ownership.holder === 'me').map((o) => o.product.id))
  const products: PassChoice[] = passData.products
    .map((p) => ({ id: p.id, name: p.name, familyId: p.familyId as PassFamilyId, familyName: families.get(p.familyId) ?? p.familyId, owned: ownedIds.has(p.id) }))
    .sort((a, c) => Number(c.owned) - Number(a.owned) || a.familyName.localeCompare(c.familyName) || a.name.localeCompare(c.name))
  const chosen = opts.pass ? (products.find((p) => p.id === opts.pass) ?? null) : null
  let chosenPlan: AccessPlan | null = null
  if (chosen) {
    const product = passData.products.find((p) => p.id === chosen.id)!
    const owned = passData.owned.find((o) => o.product.id === chosen.id && o.ownership.holder === 'me')
    chosenPlan = planAccess(
      product,
      passData.rules.filter((r) => r.productId === chosen.id),
      detail.resortDays.map((d) => ({ resortId: d.resortId, date: d.date })),
      owned?.usage ?? [],
      { today, names: b?.names ?? {} },
    )
  }

  // Conditions: summaries for ski dates inside [today − 7, horizon end]; beyond that only season facts.
  const horizonEnd = addDays(today, MAX_FORECAST_DAYS - 1)
  const summaryDates = skiDates.filter((d) => d >= addDays(today, -7) && d <= horizonEnd)
  const summaries = new Map<string, ResortSummary>()
  if (b) {
    const mode = prefs.scoringMode
    const perDate = await Promise.all(summaryDates.map((date) => buildSummaries(b, { date, mode })))
    perDate.forEach((list, k) => list.forEach((sum) => summaries.set(`${sum.id}|${summaryDates[k]}`, sum)))
  }
  const basketByKey = new Map(detail.dayBaskets.map((x) => [`${x.resortId}|${x.date}`, x.expense]))
  const accessByIndex = detail.dayAccess

  const dayResorts = detail.resortDays.map((d, idx): DayResortView => {
    const rec = b?.byId.get(d.resortId)
    const lead = daysBetween(today, d.date)
    const sum = summaries.get(`${d.resortId}|${d.date}`) ?? null
    const opening = rec && b ? openingView(b.seasons.get(`${d.resortId}|${b.seasonId}`), b.seasonId, today) : null
    let state: ConditionsState
    if (!rec) state = 'no-score'
    else if (d.date > horizonEnd) state = 'beyond-horizon'
    else if (d.date < addDays(today, -7)) state = 'past'
    else if (sum?.closure) state = 'closed'
    else if (sum?.score && sum.score.score !== null) state = 'score'
    else state = d.date < today ? 'past' : 'no-score'
    const verdict = chosenPlan?.days.find((x) => x.index === idx)?.verdict ?? null
    return {
      itemId: d.itemId,
      resortId: d.resortId,
      name: d.name,
      shortName: rec?.row.shortName || d.name,
      timezone: rec?.row.timezone ?? null,
      inCatalog: !!rec,
      access: accessByIndex[idx]?.access ?? { status: 'no-pass', productName: null, headline: 'No pass recorded', verdicts: [] },
      chosen: verdict,
      conditions: {
        state,
        leadDays: lead,
        summary: sum ? { score: sum.score, status: sum.status, closure: sum.closure, weather: sum.weather, snow: sum.snow, opening: sum.opening, officialAlerts: sum.officialAlerts } : null,
        opening,
      },
      basket: basketByKey.get(`${d.resortId}|${d.date}`) ?? null,
    }
  })

  const inRange = (d: string | null) => !!d && d >= trip.startDate && d <= trip.endDate
  const lodging = detail.items.filter((i) => i.type === 'lodging' && i.date)
  const days: TripDayView[] = tripDates.map((date, k) => {
    const items = detail.items.filter((i) => i.date === date).sort(itemOrder)
    const resorts = dayResorts.filter((r) => detail.resortDays.find((x) => x.itemId === r.itemId)?.date === date)
    const staying = lodging
      .filter((l) => {
        const out = l.endDate && l.endDate > l.date! ? l.endDate : addDays(l.date!, 1)
        return date >= l.date! && date < out
      })
      .map((l) => {
        const out = l.endDate && l.endDate > l.date! ? l.endDate : addDays(l.date!, 1)
        return { itemId: l.id, title: l.title, night: daysBetween(l.date!, date) + 1, nights: daysBetween(l.date!, out) }
      })
    const holidayName = resorts.map((r) => r.basket?.holidayName).find((h) => !!h) ?? null
    const endings = detail.items
      .filter((i) => i.date && i.endDate === date && i.endDate > i.date && ENDING_LABEL[i.type])
      .sort(itemOrder)
      .map((i) => ({ itemId: i.id, type: i.type, title: i.title, label: ENDING_LABEL[i.type]! }))
    return { date, n: k + 1, kind: dayKind(items, resorts, endings), resorts, items, staying, endings, holidayName }
  })

  const savedHotel = new Map(detail.items.filter((i) => i.type === 'lodging' && i.refId).map((i) => [i.refId!, i.id]))
  const names = new Map((b?.resorts ?? []).map((r) => [r.row.id, r.row.name]))
  const hotels: HotelOption[] = hotelRows
    .filter((h) => h.origin === 'catalog' || h.origin === 'user')
    .map((h) => ({
      id: h.id,
      resortId: h.resortId,
      resortName: names.get(h.resortId) ?? h.resortId,
      name: h.name,
      tier: h.tier,
      brand: h.brand,
      officialUrl: h.officialUrl,
      distanceText: h.distanceText,
      skiInOut: h.skiInOut,
      shuttle: h.shuttle,
      parking: h.parking,
      notes: h.notes,
      origin: h.origin,
      prov: h.prov,
      savedItemId: savedHotel.get(h.id) ?? null,
    }))
    .sort((a, c) => (TIER_ORDER[a.tier ?? ''] ?? 9) - (TIER_ORDER[c.tier ?? ''] ?? 9) || a.name.localeCompare(c.name))

  const savedEvent = new Map(detail.items.filter((i) => i.type === 'event' && i.refId).map((i) => [i.refId!, i.id]))
  const events: EventOption[] = (b?.events ?? [])
    .filter((e) => e.resortId && catalogIds.includes(e.resortId))
    .map((row) => {
      const e = eventView(row)
      const when: EventOption['when'] = !e.startDate ? 'undated' : e.startDate <= trip.endDate && (e.endDate ?? e.startDate) >= trip.startDate ? 'during' : 'other'
      return { ...e, resortName: e.resortId ? (names.get(e.resortId) ?? null) : null, when, savedItemId: savedEvent.get(e.id) ?? null }
    })
    .sort((a, c) => WHEN_ORDER[a.when] - WHEN_ORDER[c.when] || (a.startLocal ?? '9999').localeCompare(c.startLocal ?? '9999') || a.title.localeCompare(c.title))

  const resorts: TripResortInfo[] = (b?.resorts ?? []).map(({ row: r }) => ({
    id: r.id,
    name: r.name,
    shortName: r.shortName || r.name,
    lat: r.lat,
    lon: r.lon,
    timezone: r.timezone,
    place: [r.locality, r.stateProvince].filter(Boolean).join(', ') || null,
    links: r.links,
    lessons: r.features?.lessons ?? null,
    rentals: r.features?.rentals ?? null,
    prov: r.locationProv,
    ...(() => {
      const t = travelView(b!, r.id)
      return {
        drive: { minutes: t.driveMinutes, km: t.km, basis: t.basis, isEstimate: t.isEstimate, winterMinutes: t.winterMinutes, prov: t.prov },
        airports: t.airports,
        transfers: t.transfers,
      }
    })(),
  }))

  const duffel = providerStatus().find((c) => c.id === 'duffel')
  const display = prefs.currency.toUpperCase()
  const latest = new Map<string, { currency: string; rate: string; rateDate: string; provider: string }>()
  const fxRows = b ? b.fx : (await db.select().from(s.fxRates)).filter((r) => !live || r.kind !== 'demo')
  for (const r of fxRows) {
    const base = r.base.toUpperCase()
    const quote = r.quote.toUpperCase()
    // Rates are stored "1 base = rate quote"; the editor offers "1 X = ? display" when a direct record exists.
    if (quote === display && base !== display) {
      const prev = latest.get(base)
      if (!prev || r.rateDate > prev.rateDate) latest.set(base, { currency: base, rate: r.rate, rateDate: r.rateDate, provider: r.provider })
    }
  }

  const conversions: Record<string, ItemConversion> = {}
  for (const l of budget.lines) {
    if (typeof l.id !== 'number') continue
    if (l.fx && l.display) {
      conversions[String(l.id)] = {
        converted: true,
        display: l.display,
        from: l.fx.from,
        to: l.fx.to,
        rate: l.fx.rate,
        rateDate: l.fx.rateDate,
        source: l.fxSource === 'item' ? 'your rate' : 'stored rate',
        provider: l.fxSource === 'item' ? null : l.fx.provider,
      }
    } else if (l.original && !l.display) {
      conversions[String(l.id)] = { converted: false, from: l.original.min.currency, to: budget.currency }
    }
  }

  return {
    detail,
    trip,
    budget,
    days,
    unscheduled: detail.items.filter((i) => !i.date).sort(itemOrder),
    outside: detail.items.filter((i) => i.date && !inRange(i.date)).sort((a, c) => a.date!.localeCompare(c.date!) || itemOrder(a, c)),
    pass: { products, chosen, chosenPlan, ownsAny: ownedIds.size > 0 },
    resorts,
    hotels,
    events,
    skills: skillRows.map((k) => ({ id: k.id, label: k.label, category: k.category, status: k.status })),
    lessons: lessonRows,
    templates: templateRows.map((t) => ({ id: t.id, label: t.label, category: t.category, sortOrder: t.sortOrder })),
    catalog,
    airports: airportRows.sort((a, c) => a.iata.localeCompare(c.iata)),
    home: { name: prefs.homeName, lat: prefs.homeLat, lon: prefs.homeLon },
    travelPrefs: { winterBufferPct: prefs.travel.winterBufferPct, willingToFly: prefs.travel.willingToFly, maxDriveHours: prefs.travel.maxDriveHours, originAirports: prefs.travel.originAirports },
    flights: {
      state: !live ? 'demo' : duffel?.state === 'live' ? 'live' : duffel?.state === 'disabled' ? 'disabled' : 'needs-credentials',
      testMode: !!duffel?.testMode,
      notes: duffel?.notes ?? [],
    },
    savedCompanion: prefs.companionAbility ? { name: prefs.companionName, ability: prefs.companionAbility } : null,
    ability: prefs.ability,
    units: prefs.units,
    mode: prefs.scoringMode,
    currency: display,
    rates: [...latest.values()].sort((a, c) => a.currency.localeCompare(c.currency)),
    conversions,
    horizonEnd,
    now,
    today,
    demo: !live,
  }
}

const TIER_ORDER: Record<string, number> = { budget: 0, comfortable: 1, premium: 2 }
const WHEN_ORDER: Record<EventOption['when'], number> = { during: 0, undated: 1, other: 2 }

/** Trip ids are slugs with a random suffix; validate before querying. */
export function isTripId(id: string): boolean {
  return /^[a-z0-9-]{1,120}$/.test(id)
}

