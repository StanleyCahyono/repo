/**
 * Explore read models: the filterable resort list (card + facets per resort), the side-by-side comparison, and the
 * events calendar/list. Built on the shared bundle + summaries (resorts.ts) so every fact carries the same honesty
 * rules and provenance as the rest of the app. One batched load per page — never one query per resort.
 */
import 'server-only'
import { inArray } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { EventRow, HotelRow, OperatingScheduleRow } from '@/lib/db/rows'
import {
  learningSuitability,
  passLineFromVerdict,
  shortPlace,
  toResortCardData,
  EVENT_STATUS_LABEL,
  type CardLearning,
  type CardPassLine,
  type LearningLevel,
  type ResortCardData,
} from '@/components/resort/card-data'
import { computeDayBasket, LINE_KIND_LABEL, RENTAL_LABEL } from '@/lib/domain/costs'
import { formatMoney, formatMoneyRange, money } from '@/lib/domain/money'
import { ACCESS_STATUS_LABEL, evaluateAccess, latestRule, type AccessStatus, type AccessVerdict } from '@/lib/domain/passes'
import { addDays, formatLocalDate, hemisphereOf, isLocalDate, localTimeToInstant, nextSaturday, planningSeasonBounds, seasonIdForHemisphere, seasonIdsForDates, zoneAbbrev } from '@/lib/domain/time'
import { formatDistance, formatDuration, formatElevation } from '@/lib/domain/units'
import {
  COMPONENT_LABEL,
  PASS_FAMILIES,
  SCORING_MODE_LABEL,
  type ComponentKey,
  type ExpenseTier,
  type OperatingStatus,
  type PassFamilyId,
  type Provenance,
  type ScoreKind,
  type ScoringMode,
  type UnitPrefs,
} from '@/lib/domain/types'
import { REGION_GROUP_ORDER } from '@/components/explore/regions'
import { hasSouthernResorts, isLive, loadBundle, loadResortRows, seasonLabel, type Bundle, type DataCtx } from './core'
import { shownHotels, shownSchedules } from './shown'
import { hoursForDate } from './resort-detail'
import { buildSummaries, type ResortSummary } from './resorts'
import { ownedVerdicts, type EventView, eventView } from './views'

// ---------------------------------------------------------------------------
// Shared helpers

const EAST = new Set(['NY', 'PA', 'VT', 'NH', 'ME', 'MA', 'CT', 'RI', 'NJ', 'MD', 'WV', 'VA', 'MI', 'OH', 'ON', 'QC'])

/** Region groups by country outside North America: the Alps by country, then the other ski regions. */
const COUNTRY_GROUP: Record<string, string> = {
  AT: 'Austria',
  CH: 'Switzerland',
  FR: 'France',
  IT: 'Italy',
  DE: 'Germany',
  AD: 'Andorra & Spain',
  ES: 'Andorra & Spain',
  SE: 'Scandinavia',
  NO: 'Scandinavia',
  FI: 'Scandinavia',
  SI: 'Other Europe',
  PL: 'Other Europe',
  CZ: 'Other Europe',
  SK: 'Other Europe',
  BG: 'Other Europe',
  JP: 'Japan',
  KR: 'South Korea',
  AU: 'Australia & New Zealand',
  NZ: 'Australia & New Zealand',
  CL: 'South America',
  AR: 'South America',
}

/**
 * Grouping for the region filter and the map's views: "Northeast US", "Western US", "Eastern/Western Canada", the
 * Alps by country ("Austria", "Switzerland", "France", "Italy", "Germany"), "Andorra & Spain", "Scandinavia",
 * "Japan", "South Korea", "Australia & New Zealand" — else "International".
 */
export function regionGroup(country: string, stateProvince: string | null): string {
  if (country === 'US') return stateProvince && EAST.has(stateProvince) ? 'Northeast US' : 'Western US'
  if (country === 'CA') return stateProvince && EAST.has(stateProvince) ? 'Eastern Canada' : 'Western Canada'
  return COUNTRY_GROUP[country] ?? 'International'
}

const GROUP_ORDER: readonly string[] = REGION_GROUP_ORDER

const isFamily = (id: string): id is PassFamilyId => (PASS_FAMILIES as readonly string[]).includes(id)

// ---------------------------------------------------------------------------
// Explore list

/** Raw, comparable values the client filters and sorts on (the card holds the formatted versions). */
export interface ExploreFacets {
  id: string
  name: string
  region: string
  regionGroup: string
  isFavorite: boolean
  status: OperatingStatus
  /** A closure is confirmed for the selected date. */
  closedOnDate: boolean
  scoreKind: ScoreKind
  score: number | null
  driveMinutes: number | null
  travelMode: 'drive' | 'fly' | 'none'
  costTier: ExpenseTier | 'incomplete'
  costMinor: number | null
  fitRank: number
  fitScore: number | null
  fitLabel: string
  learning: LearningLevel
  families: { id: PassFamilyId }[]
  /** Exact products with a shown rule here (not 'not-included'), evaluated for the date. */
  products: { id: string; status: AccessStatus; canSki: boolean; headline: string }[]
  /** Best owned-pass answer: true = usable, false = not usable, null = unknown or no pass. */
  ownedCanSki: boolean | null
  night: boolean | null
  lessons: boolean | null
  rentals: boolean | null
  lodging: boolean | null
  eventsInWindow: number
  /** Lower-cased haystack for the search box. */
  search: string
}

export interface ExploreRow {
  card: ResortCardData
  facets: ExploreFacets
}

export interface ProductOption {
  id: string
  name: string
  familyId: string
  familyName: string
  owned: boolean
  resortCount: number
}

export interface ExploreView {
  date: string
  dateLabel: string
  mode: ScoringMode
  modeLabel: string
  today: string
  isToday: boolean
  seasonId: string
  seasonLabel: string
  seasonBounds: { min: string; max: string }
  quickDates: { date: string; label: string }[]
  demo: boolean
  now: string
  units: UnitPrefs
  home: { name: string; lat: number; lon: number }
  rows: ExploreRow[]
  regionGroups: { group: string; regions: { name: string; count: number }[] }[]
  families: { id: PassFamilyId; name: string; count: number }[]
  products: ProductOption[]
  owned: { productId: string; name: string }[]
  /** Result-set context for the list header (preseason / sparse data notices). */
  counts: { total: number; statusUnknown: number; openNow: number; withScore: number; costComplete: number; withReport: number }
  /** No resort reports an open/partially-open status and none has a score for the date. */
  preseason: boolean
}

function productVerdicts(b: Bundle, resortId: string, date: string): ExploreFacets['products'] {
  const out: ExploreFacets['products'] = []
  const owned = new Map(b.pass.owned.filter((o) => o.ownership.holder === 'me').map((o) => [o.product.id, o]))
  for (const p of b.pass.products) {
    const productRules = b.pass.rules.filter((r) => r.productId === p.id)
    const rule = latestRule(productRules, p.id, resortId)
    if (!rule && p.resortId !== resortId) continue
    if (rule?.access === 'not-included') continue
    const v = evaluateAccess({
      product: p,
      rule,
      resortId,
      date,
      usage: owned.get(p.id)?.usage ?? [],
      poolRules: productRules,
      today: b.ctx.today,
      names: b.names,
      seasonOf: b.pass.seasonOf,
    })
    out.push({ id: p.id, status: v.status, canSki: v.canSki, headline: v.headline })
  }
  return out
}

function facetsFor(b: Bundle, sum: ResortSummary): ExploreFacets {
  const row = b.byId.get(sum.id)!.row
  const f = sum.features
  const learning = learningSuitability({
    beginnerPct: sum.beginner.beginnerPct,
    intermediatePct: sum.beginner.intermediatePct,
    advancedPct: sum.beginner.advancedPct,
    lessons: sum.beginner.lessons,
    beginnerArea: sum.beginner.beginnerArea,
    terrainVerification: sum.beginner.terrainProv?.verification ?? null,
  })
  const my = sum.myPass
  return {
    id: sum.id,
    name: sum.name,
    region: sum.region,
    regionGroup: regionGroup(sum.country, sum.stateProvince),
    isFavorite: sum.isFavorite,
    status: sum.status.status,
    closedOnDate: !!sum.closure,
    scoreKind: sum.closure ? 'closed' : (sum.score?.scoreKind ?? 'none'),
    score: sum.closure ? null : (sum.score?.score ?? null),
    driveMinutes: sum.travel.driveMinutes,
    travelMode: sum.travel.verdict.mode,
    costTier: sum.expense.tier,
    costMinor: sum.expense.total?.amountMinor ?? null,
    fitRank: sum.fit.rankValue,
    fitScore: sum.fit.score,
    fitLabel: sum.fit.label,
    learning: learning.level,
    families: sum.passes.filter((p) => isFamily(p.familyId)).map((p) => ({ id: p.familyId as PassFamilyId })),
    products: productVerdicts(b, sum.id, sum.date),
    ownedCanSki: my.status === 'covered' ? true : my.status === 'not-covered' ? false : null,
    night: f?.nightSkiing ?? null,
    lessons: f?.lessons ?? null,
    rentals: f?.rentals ?? null,
    lodging: f?.onMountainLodging ?? null,
    eventsInWindow: sum.eventsInWindow.length,
    search: [sum.name, sum.shortName, row.locality, sum.region, sum.stateProvince, shortPlace(sum.locality, sum.stateProvince, sum.country)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }
}

export function resolveExploreDate(input: string | null | undefined, today: string, seasonId: string, withSouthern = false): string {
  const b = seasonBoundsFor(seasonId, withSouthern)
  return input && isLocalDate(input) && input >= b.min && input <= b.max ? input : today
}

/**
 * Dates the planning season spans: 1 Jul → 30 Jun, extended to 31 Dec of the second year when the catalog has
 * Southern Hemisphere resorts (their 2026–27 winter is June–October 2027).
 */
function seasonBoundsFor(seasonId: string, withSouthern: boolean): { min: string; max: string } {
  const b = planningSeasonBounds(seasonId, withSouthern)
  return { min: b.from, max: b.to }
}

export async function getExploreView(ctx: DataCtx, opts: { date?: string | null; mode?: ScoringMode | null } = {}): Promise<ExploreView> {
  const seasonId = ctx.prefs.activeSeasonId
  const bounds = seasonBoundsFor(seasonId, await hasSouthernResorts(ctx.db))
  // Allow today even when it falls outside the active season window (preseason in live mode).
  const date = opts.date && isLocalDate(opts.date) && ((opts.date >= bounds.min && opts.date <= bounds.max) || opts.date === ctx.today) ? opts.date : ctx.today
  const mode = opts.mode ?? ctx.prefs.scoringMode
  const b = await loadBundle(ctx, { seasons: seasonIdsForDates([date]) })
  const summaries = await buildSummaries(b, { date, mode })
  const sl = seasonLabel(b.seasonId)
  const rows: ExploreRow[] = summaries.map((sum) => ({
    card: toResortCardData(sum, { units: ctx.prefs.units, now: ctx.now, seasonLabel: sl }),
    facets: facetsFor(b, sum),
  }))

  const groups = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const g = groups.get(r.facets.regionGroup) ?? new Map<string, number>()
    g.set(r.facets.region, (g.get(r.facets.region) ?? 0) + 1)
    groups.set(r.facets.regionGroup, g)
  }
  const regionGroups = [...groups.entries()]
    .sort(([a], [c]) => ((GROUP_ORDER.indexOf(a) + 99) % 99) - ((GROUP_ORDER.indexOf(c) + 99) % 99) || a.localeCompare(c))
    .map(([group, m]) => ({ group, regions: [...m.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name)) }))

  const famName = new Map(b.pass.families.map((f) => [f.id, f.name]))
  const families = PASS_FAMILIES.map((id) => ({
    id,
    name: famName.get(id) ?? id,
    count: rows.filter((r) => r.facets.families.some((f) => f.id === id)).length,
  })).filter((f) => f.count > 0)
  const ownedIds = new Set(b.pass.owned.filter((o) => o.ownership.holder === 'me').map((o) => o.product.id))
  const products: ProductOption[] = b.pass.products
    .map((p) => ({
      id: p.id,
      name: p.name,
      familyId: p.familyId,
      familyName: famName.get(p.familyId) ?? p.familyId,
      owned: ownedIds.has(p.id),
      resortCount: rows.filter((r) => r.facets.products.some((x) => x.id === p.id)).length,
    }))
    .filter((p) => p.resortCount > 0 || p.owned)
    .sort(
      (x, y) =>
        Number(y.owned) - Number(x.owned) ||
        PASS_FAMILIES.indexOf(x.familyId as PassFamilyId) - PASS_FAMILIES.indexOf(y.familyId as PassFamilyId) ||
        x.name.localeCompare(y.name),
    )

  const sat = nextSaturday(ctx.today)
  const quickDates = [
    { date: ctx.today, label: 'Today' },
    ...(sat !== ctx.today ? [{ date: sat, label: formatLocalDate(sat, 'ccc d') }] : []),
    { date: addDays(sat, 1), label: formatLocalDate(addDays(sat, 1), 'ccc d') },
  ]
  const counts = {
    total: rows.length,
    statusUnknown: rows.filter((r) => r.facets.status === 'unknown').length,
    openNow: rows.filter((r) => r.facets.status === 'open' || r.facets.status === 'partially-open').length,
    withScore: rows.filter((r) => r.facets.score !== null).length,
    costComplete: rows.filter((r) => r.facets.costTier !== 'incomplete').length,
    withReport: summaries.filter((x) => !!x.snow.report).length,
  }

  return {
    date,
    dateLabel: formatLocalDate(date, 'ccc d LLL yyyy'),
    mode,
    modeLabel: SCORING_MODE_LABEL[mode],
    today: ctx.today,
    isToday: date === ctx.today,
    seasonId: b.seasonId,
    seasonLabel: sl,
    seasonBounds: bounds,
    quickDates,
    demo: !isLive(ctx),
    now: ctx.now,
    units: ctx.prefs.units,
    home: { name: ctx.prefs.homeName, lat: ctx.prefs.homeLat, lon: ctx.prefs.homeLon },
    rows,
    regionGroups,
    families,
    products,
    owned: b.pass.owned.filter((o) => o.ownership.holder === 'me').map((o) => ({ productId: o.product.id, name: o.product.name })),
    counts,
    preseason: counts.openNow === 0 && counts.withScore === 0,
  }
}

// ---------------------------------------------------------------------------
// Compare

export interface CompareComponent {
  key: ComponentKey
  label: string
  value: number | null
  included: boolean
  /** Share of the included weight, in percent; null when excluded. */
  weightPct: number | null
  note: string | null
}

export interface CompareAccessRow {
  productId: string
  productName: string
  owned: boolean
  status: AccessStatus
  statusLabel: string
  canSki: boolean
  headline: string
  reservation: string | null
  reasons: string[]
  prov: Provenance | null
}

export interface CompareCostLine {
  key: string
  label: string
  /** Display-currency amount (or original when not convertible); null = unknown. */
  amount: string | null
  kindLabel: string | null
  source: string | null
  note: string | null
  required: boolean
}

export interface CompareColumn {
  id: string
  card: ResortCardData
  score: {
    kind: ScoreKind
    value: number | null
    descriptor: string | null
    confidence: string | null
    coverage: number | null
    caption: string
    modeLabel: string
    surface: string | null
    surfaceBasis: string | null
    components: CompareComponent[]
    explanation: string[]
    computedAt: string | null
    prov: Provenance | null
  }
  terrain: {
    beginnerPct: number | null
    intermediatePct: number | null
    advancedPct: number | null
    beginnerArea: string | null
    prov: Provenance | null
  }
  learning: CardLearning
  lessons: boolean | null
  rentals: boolean | null
  season: { openingLabel: string; openingText: string; closingText: string; announcedOn: string | null; lastChecked: string | null; prov: Provenance | null }
  hours: {
    timezone: string
    zoneAbbrev: string
    rows: { label: string; activity: string; text: string; nature: 'published' | 'live'; prov: Provenance | null }[]
    note: string | null
  }
  access: { rows: CompareAccessRow[]; note: string | null }
  cost: {
    lines: CompareCostLine[]
    tier: ExpenseTier | 'incomplete'
    label: string
    total: string | null
    totalMinor: number | null
    caveats: string[]
    missing: string[]
    dayType: string
    passNote: string | null
  }
  travel: {
    mode: 'drive' | 'fly' | 'none'
    drive: { minutes: number; text: string; winterText: string | null; estimate: boolean; basis: string | null; prov: Provenance | null } | null
    fly: { iata: string; name: string | null; role: string | null; transferText: string | null; prov: Provenance | null } | null
    verdict: string
  }
  lodging: { curated: number; byTier: { tier: string; count: number }[]; onMountain: boolean | null; skiInOutVerified: number }
  /** Catalog mountain facts (metres / counts as stored; formatted in the user's units). null = unknown. */
  mountain: {
    baseM: number | null
    summitM: number | null
    verticalM: number | null
    base: string | null
    summit: string | null
    vertical: string | null
    lifts: number | null
    trails: number | null
    pisteKm: number | null
    piste: string | null
    acres: number | null
    uphillPerHour: number | null
    prov: Provenance | null
  }
  events: { inWindow: { title: string; when: string; statusLabel: string }[]; upcoming: number; watching: number }
  fit: ResortCardData['fit']
  gaps: string[]
}

export interface CompareView {
  date: string
  dateLabel: string
  mode: ScoringMode
  modeLabel: string
  party: number
  rentalLabel: string
  /** Explicitly chosen product (else: the user's owned products). */
  product: { id: string; name: string } | null
  owned: { productId: string; name: string }[]
  products: ProductOption[]
  columns: CompareColumn[]
  /** Catalog resorts not in the comparison (favourites first), for "Add a resort". */
  candidates: { id: string; name: string; region: string; favorite: boolean }[]
  /** Requested ids that are not in the catalog. */
  missingIds: string[]
  /** Requested ids beyond the four-resort limit. */
  droppedIds: string[]
  /** Column id holding the best known value per row (only when ≥ 2 known values). */
  best: { score: string | null; cost: string | null; drive: string | null; beginner: string | null }
  demo: boolean
  seasonLabel: string
  seasonBounds: { min: string; max: string }
  today: string
  units: UnitPrefs
}

const ACTIVITY_LABEL: Record<string, string> = {
  lifts: 'Lifts',
  'night-skiing': 'Night skiing',
  'ticket-office': 'Ticket office',
  rentals: 'Rentals',
  lessons: 'Lessons',
  tubing: 'Tubing',
  other: 'Other',
}

function hoursText(h: { opens: string | null; closes: string | null; closed: boolean }): string {
  if (h.closed) return 'Closed'
  if (h.opens && h.closes) return `${h.opens}–${h.closes}`
  if (h.opens) return `from ${h.opens}`
  if (h.closes) return `until ${h.closes}`
  return 'Times not stated'
}

function bestOf(cols: CompareColumn[], pick: (c: CompareColumn) => number | null, dir: 'max' | 'min'): string | null {
  const known = cols.map((c) => ({ id: c.id, v: pick(c) })).filter((x): x is { id: string; v: number } => x.v !== null)
  if (known.length < 2) return null
  const sorted = known.sort((a, b) => (dir === 'max' ? b.v - a.v : a.v - b.v))
  return sorted[0].v === sorted[1].v ? null : sorted[0].id
}

export async function getCompareView(
  ctx: DataCtx,
  opts: { ids: readonly string[]; date?: string | null; mode?: ScoringMode | null; party?: number | null; productId?: string | null },
): Promise<CompareView> {
  const seasonId = ctx.prefs.activeSeasonId
  const bounds = seasonBoundsFor(seasonId, await hasSouthernResorts(ctx.db))
  const date = opts.date && isLocalDate(opts.date) && ((opts.date >= bounds.min && opts.date <= bounds.max) || opts.date === ctx.today) ? opts.date : ctx.today
  const mode = opts.mode ?? ctx.prefs.scoringMode
  const party = Math.min(12, Math.max(1, Math.round(opts.party ?? 1)))
  const unique = [...new Set(opts.ids.filter((x) => /^[a-z0-9-]{1,80}$/.test(x)))]
  const wanted = unique.slice(0, 4)
  const b = await loadBundle(ctx, { ids: wanted.length ? wanted : ['__none__'], seasons: seasonIdsForDates([date]) })
  const sl = seasonLabel(b.seasonId)
  const famName = new Map(b.pass.families.map((f) => [f.id, f.name]))
  const [summaries, schedules, hotelRows, allResorts, favRows] = await Promise.all([
    buildSummaries(b, { date, mode }),
    wanted.length
      ? ctx.db.select().from(s.operatingSchedules).where(inArray(s.operatingSchedules.resortId, wanted))
      : Promise.resolve([] as OperatingScheduleRow[]),
    wanted.length ? ctx.db.select().from(s.hotels).where(inArray(s.hotels.resortId, wanted)) : Promise.resolve([] as HotelRow[]),
    loadResortRows(ctx, null),
    ctx.db.select({ resortId: s.favorites.resortId }).from(s.favorites),
  ])
  const byId = new Map(summaries.map((x) => [x.id, x]))
  const product = opts.productId ? (b.pass.products.find((p) => p.id === opts.productId) ?? null) : null
  const mine = b.pass.owned.filter((o) => o.ownership.holder === 'me')
  const p = ctx.prefs

  const columns: CompareColumn[] = wanted
    .filter((id) => byId.has(id))
    .map((id) => {
      const sum = byId.get(id)!
      const card = toResortCardData(sum, { units: p.units, now: ctx.now, seasonLabel: sl })

      // Score and components
      const sc = sum.score
      const included = (sc?.components ?? []).filter((c) => c.included)
      const totalW = included.reduce((a, c) => a + c.weight, 0)
      const components: CompareComponent[] = (sc?.components ?? []).map((c) => ({
        key: c.key,
        label: COMPONENT_LABEL[c.key],
        value: c.value === null ? null : Math.round(c.value),
        included: c.included,
        weightPct: c.included && totalW > 0 ? Math.round((c.weight / totalW) * 100) : null,
        note: c.note ?? null,
      }))

      // Pass access: the chosen product, else every owned product.
      const verdicts: { v: AccessVerdict; owned: boolean; prov: Provenance | null }[] = product
        ? (() => {
            const productRules = b.pass.rules.filter((r) => r.productId === product.id)
            const rule = latestRule(productRules, product.id, id)
            const ownedPass = mine.find((o) => o.product.id === product.id)
            return [
              {
                v: evaluateAccess({
                  product,
                  rule,
                  resortId: id,
                  date,
                  usage: ownedPass?.usage ?? [],
                  poolRules: productRules,
                  today: ctx.today,
                  names: b.names,
                  seasonOf: b.pass.seasonOf,
                }),
                owned: !!ownedPass,
                prov: (rule?.prov as Provenance | null | undefined) ?? null,
              },
            ]
          })()
        : ownedVerdicts(b, id, date).map(({ owned, verdict }) => ({
            v: verdict,
            owned: true,
            prov:
              (latestRule(
                b.pass.rules.filter((r) => r.productId === owned.product.id),
                owned.product.id,
                id,
              )?.prov as Provenance | null | undefined) ?? null,
          }))
      const accessRows: CompareAccessRow[] = verdicts.map(({ v, owned, prov }) => ({
        productId: v.productId,
        productName: v.productName,
        owned,
        status: v.status,
        statusLabel: ACCESS_STATUS_LABEL[v.status],
        canSki: v.canSki,
        headline: v.headline,
        reservation:
          v.reservationRequired === true
            ? 'Reservation required'
            : v.reservationRequired === false
              ? 'No reservation needed'
              : v.canSki
                ? 'Reservation requirement not recorded'
                : null,
        reasons: v.reasons.slice(0, 3),
        prov,
      }))

      // Cost basket: same assumptions for every column (party size, rental option, lunch, currency, pass).
      const basketPass = verdicts.map((x) => x.v).sort((a, c) => Number(c.canSki) - Number(a.canSki))[0] ?? null
      const lunch =
        p.budget.lunchEstimateMinor != null && Number.isInteger(p.budget.lunchEstimateMinor) ? money(p.budget.lunchEstimateMinor, p.budget.currency) : null
      const row = b.byId.get(id)?.row
      const hemisphere = hemisphereOf(row?.lat)
      const basket = computeDayBasket(
        { resortId: id, date, prices: b.prices.get(id) ?? [], pass: basketPass, country: row ? row.country : null, hemisphere },
        { currency: p.currency, rentalOption: p.gear.rentalOption, lunch, partySize: party },
        { now: ctx.now, today: ctx.today, rates: b.fx },
      )
      const lines: CompareCostLine[] = basket.lines.map((l) => ({
        key: l.key,
        label: l.label,
        amount: l.display ? formatMoneyRange(l.display, l.displayMax) : l.amount ? `${formatMoneyRange(l.amount, l.amountMax)} (not converted)` : null,
        kindLabel: l.kind ? LINE_KIND_LABEL[l.kind] : null,
        source: l.source,
        note: l.note,
        required: l.required,
      }))

      // Hours for the date (published vs live), in the resort's zone.
      const mySchedules = shownSchedules(schedules.filter((x) => x.resortId === id))
      const forDate = hoursForDate(mySchedules, date, hemisphere)
      const dateSeason = seasonIdForHemisphere(date, hemisphere)
      const otherSeason = mySchedules.some((x) => x.seasonId && x.seasonId !== dateSeason)
      const hoursNote = forDate.length
        ? 'Published hours do not mean every lift is running.'
        : otherSeason
          ? `${seasonLabel(dateSeason)} hours not published yet — earlier seasons' schedules are on the resort page`
          : 'Hours for this date are not recorded'

      // Travel
      const t = sum.travel
      const practical = t.airports.find((a) => a.role !== 'closest') ?? t.airports[0] ?? null

      // Lodging (curated catalog hotels; never prices without a sourced quote)
      const hotels = shownHotels(hotelRows.filter((h) => h.resortId === id))
      const tiers = ['budget', 'comfortable', 'premium'] as const
      const byTier = [
        ...tiers.map((tier) => ({ tier, count: hotels.filter((h) => h.tier === tier).length })),
        { tier: 'unrated', count: hotels.filter((h) => !h.tier).length },
      ].filter((x) => x.count > 0)

      // Events at the resort
      const evs = b.events.filter((e) => e.resortId === id).map(eventView)
      const whenOf = (e: EventView) =>
        e.startDate
          ? `${formatLocalDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` – ${formatLocalDate(e.endDate)}` : ''}`
          : 'Dates not announced'

      const opening = sum.opening
      return {
        id,
        card,
        score: {
          kind: card.score.kind,
          value: card.score.value,
          descriptor: card.score.descriptor,
          confidence: sc?.confidence ?? null,
          coverage: sc?.coverage ?? null,
          caption: card.score.caption,
          modeLabel: card.score.modeLabel,
          surface: sum.closure ? null : (sc?.surface.text ?? null),
          surfaceBasis: sc ? sc.surface.basis : null,
          components,
          explanation: sum.closure ? [sum.closure.reason] : (sc?.explanation ?? []).slice(0, 3),
          computedAt: sc?.computedAt ?? null,
          prov: sc?.prov ?? null,
        },
        terrain: {
          beginnerPct: sum.beginner.beginnerPct,
          intermediatePct: sum.beginner.intermediatePct,
          advancedPct: sum.beginner.advancedPct,
          beginnerArea: sum.beginner.beginnerArea,
          prov: sum.beginner.terrainProv,
        },
        learning: card.learning,
        lessons: sum.beginner.lessons,
        rentals: sum.beginner.rentals,
        season: {
          openingLabel: opening.label,
          openingText: card.opening.text,
          closingText:
            opening.closing.label === 'closed'
              ? `Closed ${formatLocalDate(opening.closing.date!)}`
              : opening.closing.label === 'announced'
                ? opening.closing.date
                  ? `Closing ${formatLocalDate(opening.closing.date)} (announced)`
                  : (opening.closing.text ?? 'Closing announced')
                : 'Closing not announced',
          announcedOn: opening.announcedOn,
          lastChecked: opening.lastCheckedAt,
          prov: opening.prov,
        },
        hours: {
          timezone: sum.timezone,
          zoneAbbrev: zoneAbbrev(localTimeToInstant(date, '12:00', sum.timezone), sum.timezone),
          rows: forDate.map((h) => ({
            label: h.label,
            activity: ACTIVITY_LABEL[h.activity] ?? h.activity,
            text: hoursText(h),
            nature: h.nature,
            prov: h.prov,
          })),
          note: hoursNote,
        },
        access: {
          // Unknown access (no usable rule recorded) is not shown as a row.
          rows: accessRows.filter((a) => a.status !== 'unknown'),
          note: accessRows.some((a) => a.status !== 'unknown')
            ? null
            : product || mine.length
              ? 'No access recorded for this product here'
              : 'No pass recorded — choose a product above to check exact access.',
        },
        cost: {
          lines,
          tier: basket.tier.tier,
          label: basket.label,
          total: basket.total ? formatMoneyRange(basket.total, basket.totalMax) : null,
          totalMinor: basket.total?.amountMinor ?? null,
          caveats: basket.caveats,
          missing: basket.missing.map((m) => m.message),
          dayType: basket.holidayName
            ? `Holiday (${basket.holidayName})`
            : basket.dayType === 'weekend'
              ? 'Weekend'
              : basket.dayType === 'weekday'
                ? 'Weekday'
                : String(basket.dayType),
          passNote: basketPass
            ? basketPass.canSki
              ? `Lift access covered by ${basketPass.productName}`
              : `${basketPass.productName}: ${ACCESS_STATUS_LABEL[basketPass.status]} — ticket priced`
            : null,
        },
        travel: {
          mode: t.verdict.mode,
          drive:
            t.driveMinutes !== null
              ? {
                  minutes: t.driveMinutes,
                  text: `${t.isEstimate ? '≈ ' : ''}${formatDuration(t.driveMinutes)}`,
                  winterText: t.winterMinutes !== null ? `${formatDuration(t.winterMinutes)} with ${t.winterBufferPct}% winter buffer` : null,
                  estimate: t.isEstimate,
                  basis: t.basis,
                  prov: t.prov,
                }
              : null,
          fly: practical
            ? {
                iata: practical.iata,
                name: practical.name,
                role: practical.role,
                transferText: practical.minutes != null ? `${formatDuration(practical.minutes)} transfer` : 'Transfer time not recorded',
                prov: practical.prov,
              }
            : null,
          verdict: t.verdict.note,
        },
        lodging: {
          curated: hotels.length,
          byTier,
          onMountain: sum.features?.onMountainLodging ?? null,
          skiInOutVerified: hotels.filter((h) => h.skiInOut === 'verified-yes').length,
        },
        events: {
          inWindow: sum.eventsInWindow.map((e) => ({ title: e.title, when: whenOf(e), statusLabel: EVENT_STATUS_LABEL[e.status] ?? e.status })),
          upcoming: evs.filter((e) => e.startDate && (e.endDate ?? e.startDate) >= ctx.today).length,
          watching: evs.filter((e) => !e.startDate).length,
        },
        mountain: (() => {
          const tr = row?.terrain ?? null
          const baseM = row?.baseElevationM ?? null
          const summitM = row?.summitElevationM ?? null
          const verticalM = row?.verticalM ?? (baseM !== null && summitM !== null ? summitM - baseM : null)
          const prov = (row?.elevationProv as Provenance | null | undefined) ?? tr?.prov ?? null
          return {
            baseM,
            summitM,
            verticalM,
            base: formatElevation(baseM, p.units),
            summit: formatElevation(summitM, p.units),
            vertical: formatElevation(verticalM, p.units),
            lifts: tr?.lifts ?? null,
            trails: tr?.trails ?? null,
            pisteKm: tr?.pisteKm ?? null,
            piste: formatDistance(tr?.pisteKm ?? null, p.units),
            acres: tr?.skiableAcres ?? null,
            uphillPerHour: tr?.liftCapacityPerHour ?? null,
            prov,
          }
        })(),
        fit: card.fit,
        gaps: sum.dataGaps,
      }
    })

  const ownedIds = new Set(mine.map((o) => o.product.id))
  const products: ProductOption[] = b.pass.products
    .map((x) => ({
      id: x.id,
      name: x.name,
      familyId: x.familyId,
      familyName: famName.get(x.familyId) ?? x.familyId,
      owned: ownedIds.has(x.id),
      resortCount: 0,
    }))
    .sort((x, y) => Number(y.owned) - Number(x.owned) || x.familyName.localeCompare(y.familyName) || x.name.localeCompare(y.name))

  return {
    date,
    dateLabel: formatLocalDate(date, 'ccc d LLL yyyy'),
    mode,
    modeLabel: SCORING_MODE_LABEL[mode],
    party,
    rentalLabel: RENTAL_LABEL[p.gear.rentalOption],
    product: product ? { id: product.id, name: product.name } : null,
    owned: mine.map((o) => ({ productId: o.product.id, name: o.product.name })),
    products,
    columns,
    candidates: (() => {
      const favs = new Set(favRows.map((f) => f.resortId))
      return allResorts
        .filter((r) => !byId.has(r.id))
        .map((r) => ({ id: r.id, name: r.name, region: r.region, favorite: favs.has(r.id) }))
        .sort((x, y) => Number(y.favorite) - Number(x.favorite) || x.name.localeCompare(y.name))
    })(),
    missingIds: wanted.filter((id) => !byId.has(id)),
    droppedIds: unique.slice(4),
    best: {
      score: bestOf(columns, (c) => (c.score.kind === 'conditions' ? c.score.value : null), 'max'),
      cost: bestOf(columns, (c) => c.cost.totalMinor, 'min'),
      drive: bestOf(columns, (c) => c.travel.drive?.minutes ?? null, 'min'),
      beginner: bestOf(columns, (c) => c.terrain.beginnerPct, 'max'),
    },
    demo: !isLive(ctx),
    seasonLabel: sl,
    seasonBounds: bounds,
    today: ctx.today,
    units: p.units,
  }
}

/** Compare-scenario pass line for a card (chosen product first, else owned). */
export function compareCardPass(col: CompareColumn): CardPassLine | null {
  const r = col.access.rows[0]
  return r
    ? passLineFromVerdict({ productName: r.productName, status: r.status, canSki: r.canSki, headline: r.headline })
    : null
}

// ---------------------------------------------------------------------------
// Events

export const EVENT_CATEGORY_LABEL: Record<string, string> = {
  festival: 'Festival',
  competition: 'Competition',
  music: 'Live music',
  'live-music': 'Live music',
  'night-ski': 'Night-ski event',
  opening: 'Opening celebration',
  food: 'Food & drink',
  apres: 'Après',
  race: 'Race',
  family: 'Family',
  other: 'Other',
}

export interface EventItem {
  id: string
  title: string
  category: string
  categoryLabel: string
  resort: { id: string; name: string; shortName: string; region: string } | null
  venue: string | null
  status: EventRow['status']
  statusLabel: string
  /** Has an announced (or tentative) start date — never invented. */
  dated: boolean
  startDate: string | null
  endDate: string | null
  /** "Sat 10 – Sun 11 Oct 2026" / "Dates not announced yet". */
  whenLabel: string
  /** Wall-clock times when stated, e.g. "19:00–23:00 EST". */
  timeLabel: string | null
  timezone: string
  /** "$25" / "Free" / null = price not published. */
  price: string | null
  priceKind: 'free' | 'paid' | 'unknown'
  ageRestriction: string | null
  bookingRequired: boolean | null
  officialUrl: string | null
  ticketUrl: string | null
  lastVerifiedAt: string | null
  lastEdition: string | null
  /** Venue listed as the resort itself → 'on-site'; otherwise the distance is not recorded. */
  distance: 'on-site' | 'unknown'
  prov: Provenance | null
  /** ICS download (dated events only). */
  icsUrl: string | null
}

export interface TripOption {
  id: string
  name: string
  startDate: string
  endDate: string
  status: string
  label: string
}

export interface EventsView {
  events: EventItem[]
  resorts: { id: string; name: string }[]
  categories: { id: string; label: string }[]
  trips: TripOption[]
  today: string
  seasonLabel: string
  seasonBounds: { min: string; max: string }
  demo: boolean
  now: string
  lastVerifiedAt: string | null
}

function whenLabel(e: EventView): string {
  if (!e.startDate) return 'Dates not announced yet'
  const start = e.startDate
  const end = e.endDate ?? start
  if (start === end) return formatLocalDate(start, 'ccc d LLL yyyy')
  if (start.slice(0, 7) === end.slice(0, 7)) return `${formatLocalDate(start, 'ccc d')} – ${formatLocalDate(end, 'ccc d LLL yyyy')}`
  return `${formatLocalDate(start, 'ccc d LLL')} – ${formatLocalDate(end, 'ccc d LLL yyyy')}`
}

function timeLabel(e: EventView): string | null {
  const t1 = e.startLocal && e.startLocal.length > 10 ? e.startLocal.slice(11, 16) : null
  const t2 = e.endLocal && e.endLocal.length > 10 ? e.endLocal.slice(11, 16) : null
  if (!t1 && !t2) return null
  const abbrev = e.startDate ? zoneAbbrev(localTimeToInstant(e.startDate, t1 ?? '12:00', e.timezone), e.timezone) : ''
  return `${t1 ?? '?'}${t2 ? `–${t2}` : ''}${abbrev ? ` ${abbrev}` : ''}`
}

export async function getEventsView(ctx: DataCtx): Promise<EventsView> {
  const b = await loadBundle(ctx)
  const trips = await ctx.db.select().from(s.trips)
  const names = new Map(b.resorts.map((r) => [r.row.id, r.row]))
  const events: EventItem[] = b.events
    .map((row) => {
      const e = eventView(row)
      const r = e.resortId ? names.get(e.resortId) : undefined
      const venue = (e.venue ?? '').toLowerCase()
      const onSite = !!r && !!venue && (venue.includes(r.name.toLowerCase()) || venue.includes(r.shortName.toLowerCase()))
      return {
        id: e.id,
        title: e.title,
        category: e.category,
        categoryLabel: EVENT_CATEGORY_LABEL[e.category] ?? e.category.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        resort: r ? { id: r.id, name: r.name, shortName: r.shortName, region: r.region } : null,
        venue: e.venue,
        status: e.status,
        statusLabel: EVENT_STATUS_LABEL[e.status] ?? e.status,
        dated: !!e.startDate,
        startDate: e.startDate,
        endDate: e.endDate,
        whenLabel: whenLabel(e),
        timeLabel: timeLabel(e),
        timezone: e.timezone,
        price: e.price ? (e.price.amountMinor === 0 ? 'Free' : formatMoney(e.price)) : null,
        priceKind: (e.price ? (e.price.amountMinor === 0 ? 'free' : 'paid') : 'unknown') as EventItem['priceKind'],
        ageRestriction: e.ageRestriction,
        bookingRequired: e.bookingRequired,
        officialUrl: e.officialUrl,
        ticketUrl: e.ticketUrl,
        lastVerifiedAt: e.lastVerifiedAt ?? e.prov?.fetchedAt ?? null,
        lastEdition: e.lastEdition,
        distance: onSite ? ('on-site' as const) : ('unknown' as const),
        prov: e.prov,
        icsUrl: e.startDate ? `/api/export/ics?event=${encodeURIComponent(e.id)}` : null,
      }
    })
    .sort((x, y) => (x.startDate ?? '9999').localeCompare(y.startDate ?? '9999') || x.title.localeCompare(y.title))

  const cats = [...new Set(events.map((e) => e.category))].sort()
  const resorts = [...new Map(events.filter((e) => e.resort).map((e) => [e.resort!.id, { id: e.resort!.id, name: e.resort!.name }])).values()].sort((x, y) =>
    x.name.localeCompare(y.name),
  )
  const verified = events
    .map((e) => e.lastVerifiedAt)
    .filter((x): x is string => !!x)
    .sort()
  const sl = seasonLabel(b.seasonId)
  return {
    events,
    resorts,
    categories: cats.map((id) => ({ id, label: EVENT_CATEGORY_LABEL[id] ?? id })),
    trips: trips
      .filter((t) => t.status !== 'cancelled' && t.endDate >= ctx.today)
      .sort((x, y) => x.startDate.localeCompare(y.startDate) || x.name.localeCompare(y.name))
      .map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        status: t.status,
        label: `${formatLocalDate(t.startDate, 'd LLL')}${t.endDate !== t.startDate ? ` – ${formatLocalDate(t.endDate, 'd LLL yyyy')}` : ` ${t.startDate.slice(0, 4)}`}`,
      })),
    today: ctx.today,
    seasonLabel: sl,
    seasonBounds: seasonBoundsFor(b.seasonId, b.resorts.some((r) => hemisphereOf(r.row.lat) === 'south')),
    demo: !isLive(ctx),
    now: ctx.now,
    lastVerifiedAt: verified[verified.length - 1] ?? null,
  }
}
