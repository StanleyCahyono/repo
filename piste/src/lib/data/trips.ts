/**
 * Trips: list and detail read models — items grouped by type and date, per-day pass access from the exact owned
 * products (planAccess consumes allotments in date order), the trip budget (original currencies, per-person vs
 * shared, missing items), checklist, origin-airport alternatives with drive estimates, and fit with the trip's
 * companions.
 */
import 'server-only'
import { asc, eq, inArray } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { AirportRow, TripItemRow, TripRow } from '@/lib/db/rows'
import type { DriveEstimate } from '@/lib/db/schema'
import { computeTripBudget, type TripBudget, type TripBudgetItemInput } from '@/lib/domain/costs'
import type { FitResult } from '@/lib/domain/fit'
import { planAccess, type AccessPlan } from '@/lib/domain/passes'
import type { MoneyRange } from '@/lib/domain/costs'
import { dateRange, daysBetween } from '@/lib/domain/time'
import type { AbilityLevel, Provenance } from '@/lib/domain/types'
import { isLive, loadBundle, type DataCtx } from './core'
import {
  basketVerdict,
  dayBasket,
  eventsOverlapping,
  expenseView,
  fitView,
  myPassView,
  travelView,
  type AirportOption,
  type EventView,
  type ExpenseView,
  type MyPassView,
  type TransferOption,
} from './views'

export interface TripBudgetSummary {
  currency: string
  /** Whole party; null unless every item is priced and converted. */
  total: MoneyRange | null
  /** Sum of the priced lines only — show beside `missingCount`, never as the trip total. */
  knownGroup: MoneyRange
  complete: boolean
  missingCount: number
  unconvertedCount: number
  expiredQuotes: number
}

export interface TripSummary {
  id: string
  name: string
  status: TripRow['status']
  startDate: string
  endDate: string
  days: number
  partySize: number
  originAirport: string | null
  companions: TripRow['companions']
  resorts: { id: string; name: string }[]
  itemCount: number
  bookedCount: number
  draftCount: number
  budget: TripBudgetSummary
  /** Days from home today to the start (negative once started). */
  daysUntil: number
  phase: 'upcoming' | 'in-progress' | 'past' | 'cancelled'
}

export interface TripsView {
  upcoming: TripSummary[]
  past: TripSummary[]
  cancelled: TripSummary[]
  demo: boolean
}

function budgetInputs(items: readonly TripItemRow[]): TripBudgetItemInput[] {
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
    // The stored rate is trusted only when the item records which currency it converts into.
    fxQuote: typeof i.details?.fxQuote === 'string' ? (i.details.fxQuote as string) : null,
    quoteExpiresAt: i.quoteExpiresAt,
  }))
}

function tripBudget(ctx: DataCtx, trip: TripRow, items: readonly TripItemRow[], rates: Parameters<typeof computeTripBudget>[0]['rates']): TripBudget {
  return computeTripBudget({
    items: budgetInputs(items),
    partySize: Math.max(1, trip.partySize),
    currency: ctx.prefs.currency,
    rates,
    now: ctx.now,
    today: ctx.today,
  })
}

function summarise(ctx: DataCtx, trip: TripRow, items: TripItemRow[], names: Map<string, string>, budget: TripBudget): TripSummary {
  const resortIds = [...new Set(items.filter((i) => i.type === 'resort-day' && i.refId).map((i) => i.refId!))]
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
    itemCount: items.length,
    bookedCount: items.filter((i) => i.status === 'booked').length,
    draftCount: items.filter((i) => i.status !== 'booked').length,
    budget: {
      currency: budget.currency,
      total: budget.total,
      knownGroup: budget.group,
      complete: budget.complete,
      missingCount: budget.missing.length,
      unconvertedCount: budget.unconverted.length,
      expiredQuotes: budget.expiredQuotes.length,
    },
    daysUntil: daysBetween(ctx.today, trip.startDate),
    phase,
  }
}

/** All trip summaries, upcoming first (used by Today's "next trip" too). */
export async function tripSummaries(ctx: DataCtx): Promise<TripSummary[]> {
  const { db } = ctx
  const live = isLive(ctx)
  const [trips, items, resorts, rates] = await Promise.all([
    db.select().from(s.trips).orderBy(asc(s.trips.startDate), asc(s.trips.id)),
    db.select().from(s.tripItems).orderBy(asc(s.tripItems.sortOrder), asc(s.tripItems.id)),
    db.select({ id: s.resorts.id, name: s.resorts.name }).from(s.resorts),
    db.select().from(s.fxRates),
  ])
  const names = new Map(resorts.map((r) => [r.id, r.name]))
  const byTrip = new Map<string, TripItemRow[]>()
  for (const i of items) byTrip.set(i.tripId, [...(byTrip.get(i.tripId) ?? []), i])
  return trips.map((t) => summarise(ctx, t, byTrip.get(t.id) ?? [], names, tripBudget(ctx, t, byTrip.get(t.id) ?? [], rates.filter((r) => !live || r.kind !== 'demo'))))
}

export async function getTripsView(ctx: DataCtx): Promise<TripsView> {
  const all = await tripSummaries(ctx)
  return {
    upcoming: all.filter((t) => t.phase === 'upcoming' || t.phase === 'in-progress'),
    past: all.filter((t) => t.phase === 'past').reverse(),
    cancelled: all.filter((t) => t.phase === 'cancelled'),
    demo: !isLive(ctx),
  }
}

// ---------------------------------------------------------------------------
// Detail

export const ITEM_GROUPS: { key: string; label: string; types: readonly TripItemRow['type'][] }[] = [
  { key: 'resort', label: 'Ski days', types: ['resort-day', 'lift-ticket'] },
  { key: 'travel', label: 'Getting there', types: ['flight', 'drive', 'transfer', 'parking'] },
  { key: 'lodging', label: 'Stay', types: ['lodging'] },
  { key: 'learning', label: 'Lessons & rentals', types: ['lesson', 'rental'] },
  { key: 'food', label: 'Food & events', types: ['food', 'event'] },
  { key: 'other', label: 'Other', types: ['other'] },
]

export interface OriginAirportOption {
  iata: string
  name: string | null
  city: string | null
  selected: boolean
  /** Home → airport drive (sourced or clearly estimated). */
  driveFromHome: DriveEstimate | null
  parking: string | null
  officialUrl: string | null
  airlines: AirportRow['airlines']
  prov: Provenance | null
}

export interface TripDetail {
  trip: TripSummary & { notes: string | null; createdAt: string; updatedAt: string }
  items: TripItemRow[]
  groups: { key: string; label: string; items: TripItemRow[] }[]
  byDate: { date: string | null; items: TripItemRow[] }[]
  resortDays: { date: string; resortId: string; name: string; itemId: number }[]
  /** Per owned product: the exact access plan over the trip's resort days (allotments consumed in date order). */
  passPlans: { ownershipId: number; productId: string; productName: string; holder: string; plan: AccessPlan }[]
  /** Best owned-pass answer per resort day. */
  dayAccess: { date: string; resortId: string; access: MyPassView }[]
  budget: TripBudget
  checklist: (typeof s.tripChecklist.$inferSelect)[]
  originAirports: OriginAirportOption[]
  destinations: { resortId: string; name: string; driveMinutes: number | null; winterMinutes: number | null; driveIsEstimate: boolean; airports: AirportOption[]; transfers: TransferOption[] }[]
  /** Fit with the trip's companions (or the saved companion). */
  fit: { resortId: string; name: string; fit: FitResult }[]
  /** Per-person day baskets for the planned resort days (same assumptions everywhere). */
  dayBaskets: { date: string; resortId: string; expense: ExpenseView }[]
  events: EventView[]
  warnings: string[]
  demo: boolean
}

export async function getTripDetail(ctx: DataCtx, id: string): Promise<TripDetail | null> {
  const { db } = ctx
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, id))
  if (!trip) return null
  const [items, checklist] = await Promise.all([
    db.select().from(s.tripItems).where(eq(s.tripItems.tripId, id)).orderBy(asc(s.tripItems.date), asc(s.tripItems.sortOrder), asc(s.tripItems.id)),
    db.select().from(s.tripChecklist).where(eq(s.tripChecklist.tripId, id)).orderBy(asc(s.tripChecklist.sortOrder), asc(s.tripChecklist.id)),
  ])
  const resortIds = [...new Set(items.filter((i) => (i.type === 'resort-day' || i.type === 'lift-ticket') && i.refId).map((i) => i.refId!))]
  const b = await loadBundle(ctx, { ids: resortIds.length ? resortIds : ['__none__'] })
  const names = new Map(b.resorts.map((r) => [r.row.id, r.row.name]))
  const budget = tripBudget(ctx, trip, items, b.fx)
  const summary = summarise(ctx, trip, items, names, budget)
  const warnings: string[] = []

  const resortDays = items
    .filter((i) => i.type === 'resort-day' && i.refId && i.date)
    .map((i) => ({ date: i.date!, resortId: i.refId!, name: names.get(i.refId!) ?? i.refId!, itemId: i.id }))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.itemId - y.itemId))
  const unknownResorts = resortDays.filter((d) => !b.byId.has(d.resortId))
  if (unknownResorts.length) warnings.push(`${unknownResorts.length} resort day(s) refer to a resort that is no longer in the catalog`)
  if (resortDays.some((d) => d.date < trip.startDate || d.date > trip.endDate)) warnings.push('Some resort days fall outside the trip dates')

  const passPlans = b.pass.owned.map((o) => ({
    ownershipId: o.ownership.id,
    productId: o.product.id,
    productName: o.product.name,
    holder: o.ownership.holder,
    plan: planAccess(
      o.product,
      b.pass.rules.filter((r) => r.productId === o.product.id),
      resortDays.map((d) => ({ resortId: d.resortId, date: d.date })),
      o.usage,
      { today: ctx.today, names: b.names },
    ),
  }))
  // Best answer per day for me, walking plans so earlier trip days consume allotments.
  const mine = passPlans.filter((p) => p.holder === 'me')
  const planVerdicts = resortDays.map((_, idx) => mine.map((p) => p.plan.days.find((x) => x.index === idx)!.verdict))
  const dayAccess = resortDays.map((d, idx) => ({
    date: d.date,
    resortId: d.resortId,
    access: myPassView(planVerdicts[idx]),
  }))

  const companion = trip.companions.find((c) => c.ability)
  const comp: { name?: string | null; ability: AbilityLevel | null } | null = companion
    ? { name: companion.name, ability: companion.ability }
    : ctx.prefs.companionAbility
      ? { name: ctx.prefs.companionName, ability: ctx.prefs.companionAbility }
      : null
  // Per-day baskets priced with the PLAN's verdict for that day: a day the plan leaves uncovered (allotment used
  // up by earlier trip days, blackout…) is priced with a lift ticket, never as pass-covered.
  const baskets = new Map(
    resortDays
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => b.byId.has(d.resortId))
      .map(({ d, idx }) => [idx, dayBasket(b, d.resortId, d.date, basketVerdict(planVerdicts[idx]))] as const),
  )
  const dayBaskets = [...baskets].map(([idx, basket]) => ({ date: resortDays[idx].date, resortId: resortDays[idx].resortId, expense: expenseView(basket) }))
  const fit = b.resorts.map(({ row }) => {
    // Same basis as the resort summaries: the first planned day's basket, with my pass as the plan applies it.
    const firstIdx = resortDays.findIndex((d) => d.resortId === row.id)
    const basket = firstIdx >= 0 ? (baskets.get(firstIdx) ?? null) : null
    return { resortId: row.id, name: row.name, fit: fitView(b, row, travelView(b, row.id), basket, comp) }
  })

  const airportRows = ctx.prefs.travel.originAirports.length
    ? await db.select().from(s.airports).where(inArray(s.airports.iata, ctx.prefs.travel.originAirports))
    : []
  const byIata = new Map(airportRows.map((a) => [a.iata, a]))
  const originCodes = [...new Set([...(trip.originAirport ? [trip.originAirport] : []), ...ctx.prefs.travel.originAirports])]
  const originAirports: OriginAirportOption[] = originCodes.map((iata) => {
    const a = byIata.get(iata) ?? b.airports.get(iata)
    return {
      iata,
      name: a?.name ?? null,
      city: a?.city ?? null,
      selected: trip.originAirport === iata,
      driveFromHome: a?.driveFromHome ?? null,
      parking: a?.parking ?? null,
      officialUrl: a?.officialUrl ?? null,
      airlines: a?.airlines ?? [],
      prov: a?.prov ?? null,
    }
  })

  const destinations = b.resorts.map(({ row }) => {
    const t = travelView(b, row.id)
    return { resortId: row.id, name: row.name, driveMinutes: t.driveMinutes, winterMinutes: t.winterMinutes, driveIsEstimate: t.isEstimate, airports: t.airports, transfers: t.transfers }
  })

  const groups = ITEM_GROUPS.map((g) => ({ key: g.key, label: g.label, items: items.filter((i) => g.types.includes(i.type)) })).filter((g) => g.items.length)
  const dates = [...new Set(items.map((i) => i.date))].sort((x, y) => (x === null ? 1 : y === null ? -1 : x < y ? -1 : x > y ? 1 : 0))
  const byDate = dates.map((date) => ({ date, items: items.filter((i) => i.date === date) }))
  if (!budget.complete) warnings.push(`Budget incomplete: ${budget.missing.length} item(s) without a cost, ${budget.unconverted.length} not converted`)
  if (budget.expiredQuotes.length) warnings.push(`${budget.expiredQuotes.length} quote(s) expired — re-check the price`)
  const tripDates = dateRange(trip.startDate, trip.endDate)

  return {
    trip: { ...summary, notes: trip.notes, createdAt: trip.createdAt, updatedAt: trip.updatedAt },
    items,
    groups,
    byDate,
    resortDays,
    passPlans,
    dayAccess,
    budget,
    checklist,
    originAirports,
    destinations,
    fit,
    dayBaskets,
    events: tripDates.length ? eventsOverlapping(b.events, new Set(resortIds), tripDates[0], tripDates[tripDates.length - 1]) : [],
    warnings,
    demo: !isLive(ctx),
  }
}
