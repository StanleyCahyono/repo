/**
 * Explore filters: URL (de)serialisation, predicates, facet counts, active-filter chips, sorting and grouping.
 * Pure — shared by the client list and unit tests.
 *
 * Honesty: every predicate answers pass / fail / UNKNOWN. A resort whose value is unknown for an active filter is
 * hidden by default but counted ("7 more have unknown values"), and can be kept with `includeUnknown` — in which
 * case the card says which values are unknown. Unknown never counts as "offered", "open", "allowed" or 0.
 *
 * URL keys (all optional; defaults are omitted so links stay short):
 *   q        search text                      region   comma list of regions
 *   status   comma list of StatusFilter       noclosed 1 = hide confirmed closures on the date
 *   travel   d60 … d360 | fly                 score    55 | 70 | 85 (minimum conditions score)
 *   learn    good | ok                        pass     comma list of pass-family ids
 *   product  exact pass product id            usable   1 = only where that product (or my pass) works on the date
 *   cost     1–4 (maximum expense tier)       night / lessons / rentals / lodging   yes | no | unknown
 *   events   1 = events within 3 days         fav      1 = favourites only
 *   unknown  1 = keep resorts with unknown values for the active filters
 *   sort     fit (default) | score | drive | cost | name
 * `date`, `mode` and `view` belong to the page and pass through untouched.
 */
import type { ExploreFacets } from '@/lib/data/explore'
import { EXPENSE_TIERS, type ExpenseTier, type OperatingStatus } from '@/lib/domain/types'

export type SortKey = 'fit' | 'score' | 'drive' | 'cost' | 'name'
export type TriState = 'yes' | 'no' | 'unknown'
export type TravelFilter = 'd60' | 'd120' | 'd180' | 'd240' | 'd360' | 'fly'
/** 'open' covers open + partially open. */
export type StatusFilter = 'open' | 'not-yet-open' | 'temporarily-closed' | 'closed-for-season' | 'unknown'
export type FeatureKey = 'night' | 'lessons' | 'rentals' | 'lodging'

export interface ExploreFilters {
  q: string
  regions: string[]
  status: StatusFilter[]
  /** Hide resorts with a confirmed closure on the selected date. */
  hideClosed: boolean
  travel: TravelFilter | null
  /** Minimum conditions score (55 / 70 / 85). */
  minScore: number | null
  learning: 'good' | 'ok' | null
  families: string[]
  product: string | null
  /** Only where the chosen product (or, without one, my owned pass) can be used on the date. */
  usable: boolean
  /** Maximum expense tier index 1–4 ($ … $$$$). */
  maxTier: number | null
  night: TriState | null
  lessons: TriState | null
  rentals: TriState | null
  lodging: TriState | null
  events: boolean
  favorites: boolean
  includeUnknown: boolean
  sort: SortKey
}

export const DEFAULT_FILTERS: ExploreFilters = {
  q: '',
  regions: [],
  status: [],
  hideClosed: false,
  travel: null,
  minScore: null,
  learning: null,
  families: [],
  product: null,
  usable: false,
  maxTier: null,
  night: null,
  lessons: null,
  rentals: null,
  lodging: null,
  events: false,
  favorites: false,
  includeUnknown: false,
  sort: 'fit',
}

export const SORT_LABEL: Record<SortKey, string> = {
  fit: 'Best fit for you',
  score: 'Conditions score',
  drive: 'Drive time',
  cost: 'Day cost',
  name: 'Name',
}

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  open: 'Open or partially open',
  'not-yet-open': 'Not yet open',
  'temporarily-closed': 'Temporarily closed',
  'closed-for-season': 'Closed for season',
  unknown: 'Status unavailable',
}

export const TRAVEL_LABEL: Record<TravelFilter, string> = {
  d60: 'Drive ≤ 1 h',
  d120: 'Drive ≤ 2 h',
  d180: 'Drive ≤ 3 h',
  d240: 'Drive ≤ 4 h',
  d360: 'Drive ≤ 6 h',
  fly: 'Fly-in destinations',
}

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  night: 'Night skiing',
  lessons: 'Lessons',
  rentals: 'Rentals',
  lodging: 'On-mountain lodging',
}

export const TRI_LABEL: Record<TriState, string> = { yes: 'Offered', no: 'Not offered', unknown: 'Unknown' }

export const LEARNING_LABEL: Record<'good' | 'ok', string> = { good: 'Good for learning', ok: 'Learning possible or better' }

export const SCORE_OPTIONS = [
  { value: 55, label: 'Mixed or better', short: '55+' },
  { value: 70, label: 'Good or better', short: '70+' },
  { value: 85, label: 'Excellent', short: '85+' },
] as const

export const SORTS: SortKey[] = ['fit', 'score', 'drive', 'cost', 'name']
export const STATUSES: StatusFilter[] = ['open', 'not-yet-open', 'temporarily-closed', 'closed-for-season', 'unknown']
export const TRAVELS: TravelFilter[] = ['d60', 'd120', 'd180', 'd240', 'd360', 'fly']
export const FEATURES: FeatureKey[] = ['night', 'lessons', 'rentals', 'lodging']
const TRIS: TriState[] = ['yes', 'no', 'unknown']

/** Query keys owned by the filter model (others — date, mode, view — pass through untouched). */
export const FILTER_KEYS = [
  'q',
  'region',
  'status',
  'noclosed',
  'travel',
  'score',
  'learn',
  'pass',
  'product',
  'usable',
  'cost',
  'night',
  'lessons',
  'rentals',
  'lodging',
  'events',
  'fav',
  'unknown',
  'sort',
] as const

type ParamSource = URLSearchParams | { get(key: string): string | null } | Record<string, string | string[] | undefined>

function getter(src: ParamSource) {
  return (key: string): string | null => {
    if (typeof (src as URLSearchParams).get === 'function') return (src as URLSearchParams).get(key)
    const v = (src as Record<string, string | string[] | undefined>)[key]
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  }
}

const list = (v: string | null) => [
  ...new Set(
    (v ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  ),
]

export function parseFilters(src: ParamSource): ExploreFilters {
  const get = getter(src)
  const tri = (k: string): TriState | null => {
    const v = get(k)
    return v && (TRIS as string[]).includes(v) ? (v as TriState) : null
  }
  const score = Number(get('score'))
  const cost = Number(get('cost'))
  const travel = get('travel')
  const learn = get('learn')
  const sort = get('sort')
  const product = get('product')
  return {
    q: (get('q') ?? '').slice(0, 80),
    regions: list(get('region')).slice(0, 20),
    status: list(get('status')).filter((x): x is StatusFilter => (STATUSES as string[]).includes(x)),
    hideClosed: get('noclosed') === '1',
    travel: travel && (TRAVELS as string[]).includes(travel) ? (travel as TravelFilter) : null,
    minScore: [55, 70, 85].includes(score) ? score : null,
    learning: learn === 'good' || learn === 'ok' ? learn : null,
    families: list(get('pass')).slice(0, 5),
    product: product && /^[a-z0-9-]{1,100}$/.test(product) ? product : null,
    usable: get('usable') === '1',
    maxTier: cost >= 1 && cost <= 4 && Number.isInteger(cost) ? cost : null,
    night: tri('night'),
    lessons: tri('lessons'),
    rentals: tri('rentals'),
    lodging: tri('lodging'),
    events: get('events') === '1',
    favorites: get('fav') === '1',
    includeUnknown: get('unknown') === '1',
    sort: sort && (SORTS as string[]).includes(sort) ? (sort as SortKey) : 'fit',
  }
}

/** Write the filter model into `base` (other keys kept). Defaults are omitted so URLs stay short. */
export function filtersToParams(f: ExploreFilters, base?: URLSearchParams | string): URLSearchParams {
  const p = new URLSearchParams(base ?? '')
  for (const k of FILTER_KEYS) p.delete(k)
  const set = (k: string, v: string | null | false | undefined) => {
    if (v) p.set(k, v)
  }
  // Kept verbatim (not trimmed) so typing a space between words does not bounce the search box.
  set('q', f.q.trim() ? f.q : null)
  set('region', f.regions.join(','))
  set('status', f.status.join(','))
  set('noclosed', f.hideClosed ? '1' : null)
  set('travel', f.travel)
  set('score', f.minScore ? String(f.minScore) : null)
  set('learn', f.learning)
  set('pass', f.families.join(','))
  set('product', f.product)
  set('usable', f.usable ? '1' : null)
  set('cost', f.maxTier ? String(f.maxTier) : null)
  for (const k of FEATURES) set(k, f[k])
  set('events', f.events ? '1' : null)
  set('fav', f.favorites ? '1' : null)
  set('unknown', f.includeUnknown ? '1' : null)
  set('sort', f.sort !== 'fit' ? f.sort : null)
  return p
}

/** Number of active narrowing filters (search, sort and "include unknown" excluded). */
export function activeCount(f: ExploreFilters): number {
  return (
    (f.regions.length ? 1 : 0) +
    (f.status.length ? 1 : 0) +
    (f.hideClosed ? 1 : 0) +
    (f.travel ? 1 : 0) +
    (f.minScore ? 1 : 0) +
    (f.learning ? 1 : 0) +
    (f.families.length ? 1 : 0) +
    (f.product ? 1 : 0) +
    (f.usable ? 1 : 0) +
    (f.maxTier ? 1 : 0) +
    FEATURES.filter((k) => f[k]).length +
    (f.events ? 1 : 0) +
    (f.favorites ? 1 : 0)
  )
}

/** Reset every narrowing filter; keeps the search text and the sort. */
export function clearFilters(f: ExploreFilters): ExploreFilters {
  return { ...DEFAULT_FILTERS, q: f.q, sort: f.sort }
}

// ---------------------------------------------------------------------------
// Predicates

type Verdict = 'pass' | 'fail' | 'unknown'

interface Check {
  /** Short noun for "unknown <what>" notes. */
  what: string
  verdict: Verdict
}

export const tierIndex = (t: ExpenseTier) => (EXPENSE_TIERS as readonly string[]).indexOf(t) + 1

function triCheck(value: boolean | null, want: TriState | null, what: string): Check | null {
  if (!want) return null
  if (want === 'unknown') return { what, verdict: value === null ? 'pass' : 'fail' }
  if (value === null) return { what, verdict: 'unknown' }
  return { what, verdict: (want === 'yes') === value ? 'pass' : 'fail' }
}

/** The status bucket a resort falls into; a confirmed closure on the date overrides an "open" report. */
export function statusBucket(x: Pick<ExploreFacets, 'status' | 'closedOnDate'>): StatusFilter {
  if (x.status === 'open' || x.status === 'partially-open') return x.closedOnDate ? 'temporarily-closed' : 'open'
  return x.status as Exclude<OperatingStatus, 'open' | 'partially-open'>
}

export function checks(x: ExploreFacets, f: ExploreFilters): Check[] {
  const out: (Check | null)[] = []
  const q = f.q.trim().toLowerCase()
  if (q) out.push({ what: 'search', verdict: q.split(/\s+/).every((w) => x.search.includes(w)) ? 'pass' : 'fail' })
  if (f.regions.length) out.push({ what: 'region', verdict: f.regions.includes(x.region) ? 'pass' : 'fail' })
  if (f.status.length) out.push({ what: 'status', verdict: f.status.includes(statusBucket(x)) ? 'pass' : 'fail' })
  if (f.hideClosed) out.push({ what: 'closure', verdict: x.closedOnDate ? 'fail' : 'pass' })
  if (f.travel) {
    if (f.travel === 'fly') out.push({ what: 'travel', verdict: x.travelMode === 'fly' ? 'pass' : x.travelMode === 'none' ? 'unknown' : 'fail' })
    else {
      const max = Number(f.travel.slice(1))
      // A fly-in destination without a recorded drive route is not "within driving range": it fails rather than
      // being reported as unknown. Only a resort with no travel information at all is unknown.
      const v: Verdict = x.driveMinutes !== null ? (x.driveMinutes <= max ? 'pass' : 'fail') : x.travelMode === 'fly' ? 'fail' : 'unknown'
      out.push({ what: 'drive time', verdict: v })
    }
  }
  if (f.minScore) {
    // A confirmed closure is known (not unknown): it fails. Weather-potential/limited scores are not full scores.
    const v: Verdict =
      x.scoreKind === 'closed' ? 'fail' : x.scoreKind === 'conditions' && x.score !== null ? (x.score >= f.minScore ? 'pass' : 'fail') : 'unknown'
    out.push({ what: 'conditions score', verdict: v })
  }
  if (f.learning) {
    const ok = f.learning === 'good' ? x.learning === 'good' : x.learning === 'good' || x.learning === 'ok'
    out.push({ what: 'learning suitability', verdict: x.learning === 'unknown' ? 'unknown' : ok ? 'pass' : 'fail' })
  }
  if (f.families.length) {
    const hit = x.families.filter((fam) => f.families.includes(fam.id))
    out.push({ what: 'pass access', verdict: hit.some((h) => h.confirmed) ? 'pass' : hit.length ? 'unknown' : 'fail' })
  }
  if (f.product) {
    const p = x.products.find((y) => y.id === f.product)
    if (!p) out.push({ what: 'product', verdict: 'fail' })
    else if (f.usable) out.push({ what: 'pass use on the date', verdict: p.canSki ? 'pass' : p.status === 'unknown' ? 'unknown' : 'fail' })
    else out.push({ what: 'product access', verdict: p.status === 'not-included' ? 'fail' : p.status === 'unknown' ? 'unknown' : 'pass' })
  } else if (f.usable) {
    out.push({ what: 'pass use on the date', verdict: x.ownedCanSki === null ? 'unknown' : x.ownedCanSki ? 'pass' : 'fail' })
  }
  if (f.maxTier) out.push({ what: 'day cost', verdict: x.costTier === 'incomplete' ? 'unknown' : tierIndex(x.costTier) <= f.maxTier ? 'pass' : 'fail' })
  for (const k of FEATURES) out.push(triCheck(x[k], f[k], FEATURE_LABEL[k].toLowerCase()))
  if (f.events) out.push({ what: 'events', verdict: x.eventsInWindow > 0 ? 'pass' : 'fail' })
  if (f.favorites) out.push({ what: 'favourite', verdict: x.isFavorite ? 'pass' : 'fail' })
  return out.filter((c): c is Check => c !== null)
}

export interface FilterResult<T> {
  results: T[]
  /** Rows hidden only because an active filter's value is unknown for them. */
  hiddenUnknown: T[]
  /** For kept rows with unknown values (includeUnknown): which values are unknown. */
  unknownById: Map<string, string[]>
}

export function applyFilters<T extends { facets: ExploreFacets }>(rows: readonly T[], f: ExploreFilters): FilterResult<T> {
  const results: T[] = []
  const hiddenUnknown: T[] = []
  const unknownById = new Map<string, string[]>()
  for (const row of rows) {
    const cs = checks(row.facets, f)
    if (cs.some((c) => c.verdict === 'fail')) continue
    const unknown = cs.filter((c) => c.verdict === 'unknown').map((c) => c.what)
    if (!unknown.length) results.push(row)
    else if (f.includeUnknown) {
      results.push(row)
      unknownById.set(row.facets.id, unknown)
    } else hiddenUnknown.push(row)
  }
  return { results, hiddenUnknown, unknownById }
}

/** Which unknown values hide the most rows, e.g. [{ what: 'day cost', count: 12 }] (for the "hidden" note). */
export function unknownReasons<T extends { facets: ExploreFacets }>(rows: readonly T[], f: ExploreFilters): { what: string; count: number }[] {
  const tally = new Map<string, number>()
  for (const row of rows) {
    for (const c of checks(row.facets, f)) if (c.verdict === 'unknown') tally.set(c.what, (tally.get(c.what) ?? 0) + 1)
  }
  return [...tally.entries()].map(([what, count]) => ({ what, count })).sort((a, b) => b.count - a.count || a.what.localeCompare(b.what))
}

/**
 * Facet count: how many resorts the result would hold with `patch` applied to the current filters (same unknown
 * handling as the list). Used for the counts beside filter options.
 */
export function countWith<T extends { facets: ExploreFacets }>(rows: readonly T[], f: ExploreFilters, patch: Partial<ExploreFilters>): number {
  const next = { ...f, ...patch }
  let n = 0
  for (const row of rows) {
    const cs = checks(row.facets, next)
    if (cs.some((c) => c.verdict === 'fail')) continue
    if (!next.includeUnknown && cs.some((c) => c.verdict === 'unknown')) continue
    n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Active-filter chips

export interface ActiveChip {
  key: string
  /** Visible chip text, e.g. "Drive ≤ 2 h", "Lessons: not offered". */
  label: string
  /** The filters with only this chip removed. */
  clear: (f: ExploreFilters) => ExploreFilters
}

export function activeChips(f: ExploreFilters, names: { family: (id: string) => string; product: (id: string) => string; dateLabel: string }): ActiveChip[] {
  const chips: ActiveChip[] = []
  for (const r of f.regions) chips.push({ key: `region:${r}`, label: r, clear: (x) => ({ ...x, regions: x.regions.filter((y) => y !== r) }) })
  for (const s of f.status) chips.push({ key: `status:${s}`, label: STATUS_FILTER_LABEL[s], clear: (x) => ({ ...x, status: x.status.filter((y) => y !== s) }) })
  if (f.hideClosed) chips.push({ key: 'noclosed', label: `Not closed on ${names.dateLabel}`, clear: (x) => ({ ...x, hideClosed: false }) })
  if (f.travel) chips.push({ key: 'travel', label: TRAVEL_LABEL[f.travel], clear: (x) => ({ ...x, travel: null }) })
  if (f.minScore) chips.push({ key: 'score', label: `Score ${f.minScore}+`, clear: (x) => ({ ...x, minScore: null }) })
  if (f.learning) chips.push({ key: 'learn', label: LEARNING_LABEL[f.learning], clear: (x) => ({ ...x, learning: null }) })
  for (const fam of f.families)
    chips.push({ key: `pass:${fam}`, label: names.family(fam), clear: (x) => ({ ...x, families: x.families.filter((y) => y !== fam) }) })
  if (f.product) chips.push({ key: 'product', label: `Product: ${names.product(f.product)}`, clear: (x) => ({ ...x, product: null }) })
  if (f.usable) chips.push({ key: 'usable', label: `Pass usable ${names.dateLabel}`, clear: (x) => ({ ...x, usable: false }) })
  if (f.maxTier) chips.push({ key: 'cost', label: `Day cost ≤ ${EXPENSE_TIERS[f.maxTier - 1]}`, clear: (x) => ({ ...x, maxTier: null }) })
  for (const k of FEATURES) {
    const v = f[k]
    if (v) chips.push({ key: k, label: `${FEATURE_LABEL[k]}: ${TRI_LABEL[v].toLowerCase()}`, clear: (x) => ({ ...x, [k]: null }) })
  }
  if (f.events) chips.push({ key: 'events', label: 'Events near the date', clear: (x) => ({ ...x, events: false }) })
  if (f.favorites) chips.push({ key: 'fav', label: 'Favourites', clear: (x) => ({ ...x, favorites: false }) })
  if (f.includeUnknown) chips.push({ key: 'unknown', label: 'Including unknown values', clear: (x) => ({ ...x, includeUnknown: false }) })
  return chips
}

// ---------------------------------------------------------------------------
// Sorting and grouping

const byName = (a: ExploreFacets, b: ExploreFacets) => a.name.localeCompare(b.name)

function scoreRank(x: ExploreFacets): number {
  if (x.scoreKind === 'conditions' && x.score !== null) return 0
  if ((x.scoreKind === 'weather-potential' || x.scoreKind === 'limited') && x.score !== null) return 1
  if (x.scoreKind === 'closed') return 3
  return 2
}

export function sortRows<T extends { facets: ExploreFacets }>(rows: readonly T[], sort: SortKey): T[] {
  const out = [...rows]
  const nullLast = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b)
  out.sort((ra, rb) => {
    const a = ra.facets
    const b = rb.facets
    switch (sort) {
      case 'name':
        return byName(a, b)
      case 'score':
        return scoreRank(a) - scoreRank(b) || nullLast(b.score, a.score) || b.fitRank - a.fitRank || byName(a, b)
      case 'drive': {
        const g = (x: ExploreFacets) => (x.driveMinutes !== null ? 0 : x.travelMode === 'fly' ? 1 : 2)
        return g(a) - g(b) || nullLast(a.driveMinutes, b.driveMinutes) || byName(a, b)
      }
      case 'cost':
        return nullLast(a.costMinor, b.costMinor) || byName(a, b)
      case 'fit':
      default:
        return b.fitRank - a.fitRank || byName(a, b)
    }
  })
  return out
}

export interface RowGroup<T> {
  key: string
  label: string
  rows: T[]
}

function groupKey(x: ExploreFacets, sort: SortKey): { key: string; label: string; order: number } | null {
  switch (sort) {
    case 'fit': {
      const order = ['Great fit', 'Good fit', 'Mixed fit', 'Poor fit', 'Not enough information']
      const i = order.indexOf(x.fitLabel)
      return { key: x.fitLabel, label: x.fitLabel === 'Not enough information' ? 'Fit unknown — not enough information' : x.fitLabel, order: i === -1 ? 9 : i }
    }
    case 'score': {
      if (x.scoreKind === 'closed') return { key: 'closed', label: 'Closed on this date', order: 6 }
      if (x.scoreKind === 'conditions' && x.score !== null) {
        if (x.score >= 85) return { key: 'excellent', label: 'Excellent · 85+', order: 0 }
        if (x.score >= 70) return { key: 'good', label: 'Good · 70–84', order: 1 }
        if (x.score >= 55) return { key: 'mixed', label: 'Mixed · 55–69', order: 2 }
        return { key: 'challenging', label: 'Challenging · under 55', order: 3 }
      }
      if (x.score !== null) return { key: 'partial', label: 'Weather potential or limited data', order: 4 }
      return { key: 'none', label: 'No score for this date', order: 5 }
    }
    case 'drive': {
      const m = x.driveMinutes
      if (m === null)
        return x.travelMode === 'fly'
          ? { key: 'fly', label: 'Fly-in — no drive estimate', order: 7 }
          : { key: 'none', label: 'No travel information', order: 8 }
      const bands: [number, string][] = [
        [60, 'Under 1 h drive'],
        [120, '1–2 h drive'],
        [180, '2–3 h drive'],
        [240, '3–4 h drive'],
        [360, '4–6 h drive'],
      ]
      const i = bands.findIndex(([max]) => m <= max)
      return i === -1 ? { key: 'long', label: 'Over 6 h drive', order: 5 } : { key: `d${i}`, label: bands[i][1], order: i }
    }
    case 'cost':
      return x.costTier === 'incomplete'
        ? { key: 'incomplete', label: 'Incomplete estimate — prices missing', order: 9 }
        : { key: x.costTier, label: `${x.costTier} per person per day`, order: tierIndex(x.costTier) }
    default:
      return null
  }
}

/** Editorial groups for the current sort (name sort → a single ungrouped list). */
export function groupRows<T extends { facets: ExploreFacets }>(rows: readonly T[], sort: SortKey): RowGroup<T>[] {
  if (sort === 'name') return [{ key: 'all', label: '', rows: [...rows] }]
  const groups = new Map<string, RowGroup<T> & { order: number }>()
  for (const r of rows) {
    const g = groupKey(r.facets, sort)!
    const cur = groups.get(g.key) ?? { key: g.key, label: g.label, order: g.order, rows: [] }
    cur.rows.push(r)
    groups.set(g.key, cur)
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(({ key, label, rows: rs }) => ({ key, label, rows: rs }))
}
