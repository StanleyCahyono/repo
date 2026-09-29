/**
 * Sources & Sync read model: connector state, refresh health per job (and per resort where jobs work per resort),
 * per-resort coverage of every important fact, recent fetch/parser failures, link checks, manual corrections and
 * scheduler health.
 *
 * Honesty rules
 * - "Last successful update" uses the jobs module's own rule (`successTargets`, through deps.ts), batched: only
 *   ok/partial runs that actually fetched something count, a failed run never advances it, and a resort counts
 *   only when its own item succeeded. The scan walks runs newest-first exactly like `lastSuccess`.
 * - A disabled, unconfigured or on-demand connector never looks live, and in demo mode nothing does: demo data
 *   is simulated and never refreshed.
 * - Weather is model output: "live" coverage means "refreshed recently", never "observed".
 */
import 'server-only'
import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import type {
  EventRow,
  HotelRow,
  OperatingScheduleRow,
  OperationalReportRow,
  PassAccessRuleRow,
  PriceSnapshotRow,
  RefreshRunRow,
  ResortRow,
  SourceRecordRow,
  TravelOptionRow,
} from '@/lib/db/rows'
import { isExpired } from '@/lib/domain/costs'
import { latestRules } from '@/lib/domain/passes'
import { addHours, hoursBetween, seasonIdFor } from '@/lib/domain/time'
import type { AppMode, Provenance } from '@/lib/domain/types'
import { currentReports, loadBundle, seasonLabel, verificationLabel, type Bundle, type Correction, type DataCtx } from './core'
import {
  collectLinks,
  DEFAULT_CADENCES,
  EXTERNAL_JOBS,
  HEARTBEAT_KEY,
  JOB_NAMES,
  providerStatus,
  reportOrigin,
  successTargets,
  type Cadences,
  type ConnectorStatus,
  type JobName,
} from './deps'
import { statusView } from './views'

// ---------------------------------------------------------------------------
// Shapes

export interface RunView {
  id: number
  job: string
  target: string | null
  trigger: RefreshRunRow['trigger']
  status: RefreshRunRow['status']
  startedAt: string
  finishedAt: string | null
  attempts: number
  itemsWritten: number
  error: string | null
  notes: string[]
  items: { ok: number; failed: number; skipped: number }
}

/** How a run went for one scope (the job as a whole, or one resort). */
export type AttemptOutcome = 'ok' | 'partial' | 'failed' | 'nothing-fetched' | 'running'

export type RefreshState = 'ok' | 'partial' | 'failing' | 'stale' | 'nothing-fetched' | 'never-succeeded' | 'never-run' | 'running' | 'demo'

export interface RefreshHealth {
  state: RefreshState
  stateLabel: string
  /** Last successful update (jobs' success rule); null = never. A failed or empty run never advances it. */
  lastSuccessAt: string | null
  /** Latest run that actually ran (skipped cooldown/overlap rows are not attempts). */
  lastAttempt: RunView | null
  lastAttemptOutcome: AttemptOutcome | null
}

export interface JobView extends RefreshHealth {
  job: JobName
  title: string
  /** Calls external sources (weather, alerts, reports, links, FX). */
  external: boolean
  cadence: { minutes: number | null; text: string }
  /** Per-resort health where the job works per resort (weather) or per adapter (reports). */
  targets: (RefreshHealth & { resortId: string; name: string })[]
}

export type ConnectorHealth = 'ok' | 'stale' | 'failing' | 'never-succeeded' | 'not-configured' | 'disabled' | 'on-demand' | 'demo'

export interface FetchView {
  at: string
  ok: boolean
  httpStatus: number | null
  error: string | null
  url: string
}

export interface ConnectorView extends ConnectorStatus {
  health: ConnectorHealth
  healthLabel: string
  /** Job that refreshes this connector; null = runs on demand only. */
  job: JobName | null
  /**
   * Last successful update of the job for this connector's scope (successTargets rule: the job as a whole, or the
   * adapter's resort). Weather has two providers under one job, so their own evidence is `lastFetchOkAt`.
   */
  jobLastSuccessAt: string | null
  /** Newest successful fetch this adapter logged (source records). */
  lastFetchOkAt: string | null
  /** Newest fetch this adapter logged, successful or not. */
  lastFetch: FetchView | null
  lastAttempt: RunView | null
}

export type CoverageState = 'live' | 'official' | 'manual' | 'derived' | 'researched' | 'reference' | 'stale' | 'failing' | 'missing' | 'demo'

export const COVERAGE_FIELDS = [
  'location',
  'elevation',
  'terrain',
  'features',
  'opening',
  'hours',
  'liftPrices',
  'rentalPrices',
  'drive',
  'airports',
  'hotels',
  'events',
  'report',
  'weather',
  'status',
  'passes',
] as const
export type CoverageField = (typeof COVERAGE_FIELDS)[number]

export const COVERAGE_FIELD_LABEL: Record<CoverageField, string> = {
  location: 'Location',
  elevation: 'Elevation',
  terrain: 'Terrain',
  features: 'Lessons, rentals & features',
  opening: 'Opening dates',
  hours: 'Hours',
  liftPrices: 'Lift prices',
  rentalPrices: 'Rental prices',
  drive: 'Drive from home',
  airports: 'Airports',
  hotels: 'Hotels',
  events: 'Events',
  report: 'Snow report',
  weather: 'Weather (model)',
  status: 'Operating status',
  passes: 'Pass access',
}

export const COVERAGE_STATE_LABEL: Record<CoverageState, string> = {
  live: 'Live',
  official: 'Official source',
  manual: 'Confirmed by you',
  derived: 'Piste estimate',
  researched: 'Researched — confirm at source',
  reference: 'Reference data — confirm at source',
  stale: 'Stale',
  failing: 'Refresh failing',
  missing: 'Missing',
  demo: 'Demo data',
}

export interface CoverageCell {
  field: CoverageField
  state: CoverageState
  label: string
  /** What is on file, counts, ages — plain language. */
  detail: string | null
  /** Most relevant time: fetched / published / checked on / last success. */
  at: string | null
  sourceUrl: string | null
  /** Research-grade or unsourced: "confirm at source". */
  confirmAtSource: boolean
}

export interface CoverageRow {
  resortId: string
  name: string
  shortName: string
  region: string
  isFavorite: boolean
  hasReportAdapter: boolean
  /** Aligned with COVERAGE_FIELDS. */
  cells: CoverageCell[]
  counts: Partial<Record<CoverageState, number>>
}

export interface SourceFailureView {
  id: number
  adapter: string
  resortId: string | null
  resortName: string | null
  url: string
  fetchedAt: string
  httpStatus: number | null
  /** 'parser' = the page/feed changed shape or could not be read; 'fetch' = network/HTTP failure. */
  kind: 'parser' | 'fetch'
  error: string | null
  parserErrors: string[]
}

export interface LinksView {
  /** Links Piste shows (the set the link checker walks). */
  total: number
  checked: number
  ok: number
  broken: number
  /** Checked but the result is unknown (e.g. blocked by the site). */
  unknown: number
  unchecked: number
  /** Last checked more than 7 days ago. */
  stale: number
  lastCheckedAt: string | null
  brokenLinks: { url: string; resortIds: string[]; httpStatus: number | null; error: string | null; checkedAt: string; finalUrl: string | null }[]
}

export interface CorrectionView extends Correction {
  resortId: string
  resortName: string
}

export interface SchedulerView {
  /** false in demo mode: nothing refreshes demo data. */
  applicable: boolean
  heartbeat: string | null
  ageMinutes: number | null
  mode: string | null
  startedAt: string | null
  stoppedAt: string | null
  staleAfterMinutes: number
  stale: boolean
  /** A worker whose heartbeat is fresh and that has not stopped since. */
  running: boolean
  cadences: Cadences
  /** 'worker' = the cadences the running worker reported; 'default' = built-in defaults (cron decides for `npm run refresh`). */
  cadenceSource: 'worker' | 'default'
  note: string | null
}

export interface SourcesView {
  now: string
  mode: AppMode
  demo: boolean
  season: { id: string; label: string }
  connectors: ConnectorView[]
  jobs: JobView[]
  scheduler: SchedulerView
  coverage: {
    fields: { key: CoverageField; label: string }[]
    rows: CoverageRow[]
    /** Resort count per state, per field. */
    byField: Record<CoverageField, Partial<Record<CoverageState, number>>>
  }
  failures: { windowDays: number; items: SourceFailureView[]; byAdapter: { adapter: string; parser: number; fetch: number; lastAt: string }[] }
  links: LinksView
  corrections: CorrectionView[]
  notes: string[]
}

// ---------------------------------------------------------------------------
// Run history (batched, successTargets semantics)

const RUN_PAGE = 300
const FAILURE_WINDOW_DAYS = 14
const REPORT_LIVE_HOURS = 24
const WEATHER_LIVE_HOURS = 12
const LINK_STALE_DAYS = 7

export const JOB_LABEL: Record<JobName, string> = {
  weather: 'Weather forecasts',
  'nws-alerts': 'Official weather alerts',
  reports: 'Official snow reports',
  status: 'Operating status (from season dates)',
  assessments: 'Conditions scores',
  alerts: 'In-app alerts',
  links: 'Link checks',
  fx: 'Exchange rates',
  prune: 'Retention clean-up',
}

function runView(r: RefreshRunRow): RunView {
  const items = r.details?.items ?? []
  return {
    id: r.id,
    job: r.job,
    target: r.target,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    attempts: r.attempts,
    itemsWritten: r.itemsWritten,
    error: r.error,
    notes: r.details?.notes ?? [],
    items: { ok: items.filter((i) => !i.skipped && i.ok).length, failed: items.filter((i) => !i.skipped && !i.ok).length, skipped: items.filter((i) => i.skipped).length },
  }
}

/** How run `r` went for `target` (null = the job as a whole); null when the run did not attempt that scope. */
function outcomeFor(r: RefreshRunRow, target: string | null, external: boolean): AttemptOutcome | null {
  const all = r.details?.items ?? []
  const counted = all.filter((i) => !i.skipped)
  if (target === null) {
    if (r.target !== null) return null
    if (r.status === 'running') return 'running'
    if (r.status === 'error') return 'failed'
    if (external && !counted.some((i) => i.ok) && r.details) return 'nothing-fetched'
    return r.status === 'partial' ? 'partial' : 'ok'
  }
  if (r.target !== null && r.target !== target) return null
  if (r.status === 'running') return r.target === target ? 'running' : null
  const own = counted.filter((i) => i.target === target)
  if (r.target === target) {
    if (!own.length) return r.status === 'error' ? 'failed' : external && r.details ? 'nothing-fetched' : 'ok'
  } else {
    // A global run: it attempted this resort only if it has a (non-skipped) item for it — or it failed outright.
    if (!own.length) return r.status === 'error' && !all.length ? 'failed' : null
  }
  const ok = own.filter((i) => i.ok).length
  return ok === own.length ? 'ok' : ok === 0 ? 'failed' : 'partial'
}

export interface ScopeHistory {
  lastSuccessAt: string | null
  lastAttempt: RunView | null
  outcome: AttemptOutcome | null
}

export interface RunHistory {
  /** null = the job as a whole (global runs); otherwise per target. */
  scopes: Map<string | null, ScopeHistory>
  /** The job has ever had a (non-skipped) global run. Reports, for example, only ever run per resort. */
  hasGlobalRuns: boolean
}

/**
 * Last success and last attempt for the job as a whole (null) and for each target, in one newest-first pass over
 * the job's run history (paged; stops once every scope is resolved). Last success uses `successTargets`, the same
 * rule and order as the jobs module's `lastSuccess`.
 */
export async function scanRunHistory(db: Db, job: JobName, targets: readonly string[]): Promise<RunHistory> {
  const external = (EXTERNAL_JOBS as readonly string[]).includes(job)
  const t = s.refreshRuns
  // A job that never ran globally has no job-wide scope to resolve; without this check the scan would walk the
  // whole history looking for one.
  const hasGlobalRuns = (await db.select({ id: t.id }).from(t).where(and(eq(t.job, job), isNull(t.target), ne(t.status, 'skipped'))).limit(1)).length > 0
  const wanted = new Set<string | null>([...(hasGlobalRuns || !targets.length ? [null] : []), ...targets])
  const success = new Map<string | null, string>()
  const attempt = new Map<string | null, { run: RunView; outcome: AttemptOutcome }>()
  const scope: SQL | undefined = targets.length ? or(isNull(t.target), inArray(t.target, [...targets])) : isNull(t.target)
  let cursor: { startedAt: string; id: number } | null = null
  for (;;) {
    const after: SQL | undefined = cursor ? or(lt(t.startedAt, cursor.startedAt), and(eq(t.startedAt, cursor.startedAt), lt(t.id, cursor.id))) : undefined
    const rows: RefreshRunRow[] = await db
      .select()
      .from(t)
      .where(and(eq(t.job, job), ne(t.status, 'skipped'), scope, after))
      .orderBy(desc(t.startedAt), desc(t.id))
      .limit(RUN_PAGE)
    for (const r of rows) {
      for (const target of successTargets(r)) if (wanted.has(target) && !success.has(target)) success.set(target, r.finishedAt ?? r.startedAt)
      for (const w of wanted) {
        if (attempt.has(w)) continue
        const o = outcomeFor(r, w, external)
        if (o) attempt.set(w, { run: runView(r), outcome: o })
      }
    }
    const resolved = [...wanted].every((w) => success.has(w) && attempt.has(w))
    if (resolved || rows.length < RUN_PAGE) break
    const last = rows[rows.length - 1]
    cursor = { startedAt: last.startedAt, id: last.id }
  }
  const scopes = new Map<string | null, ScopeHistory>(
    [null, ...targets].map((w) => [w, { lastSuccessAt: success.get(w) ?? null, lastAttempt: attempt.get(w)?.run ?? null, outcome: attempt.get(w)?.outcome ?? null }]),
  )
  return { scopes, hasGlobalRuns }
}

/**
 * Health of a job that only ever runs per target (e.g. official reports), summarised from its targets: the newest
 * attempt and success across targets; failing only when every attempted target failed, partial when some did.
 */
function summariseTargets(targets: readonly RefreshHealth[], demo: boolean): RefreshHealth {
  const attempted = targets.filter((x) => x.lastAttempt)
  const newest = <T,>(xs: (T | null)[], key: (x: T) => string) => xs.filter((x): x is T => !!x).sort((a, b) => key(b).localeCompare(key(a)))[0] ?? null
  const lastAttempt = newest(attempted.map((x) => x.lastAttempt), (r) => r.startedAt)
  const lastSuccessAt = newest(targets.map((x) => x.lastSuccessAt), (x) => x)
  const failing = attempted.filter((x) => x.state === 'failing').length
  const state: RefreshState = demo
    ? 'demo'
    : !attempted.length
      ? 'never-run'
      : failing === attempted.length
        ? 'failing'
        : failing
          ? 'partial'
          : attempted.every((x) => x.state === 'never-succeeded' || x.state === 'nothing-fetched')
            ? 'never-succeeded'
            : attempted.some((x) => x.state === 'stale')
              ? 'stale'
              : 'ok'
  const label: Record<RefreshState, string> = {
    demo: 'Demo mode — demo data is simulated and never refreshed',
    'never-run': 'Never run',
    running: 'Running now',
    failing: 'Failing for every source',
    'nothing-fetched': 'The last runs fetched nothing',
    'never-succeeded': 'Has run, but has never fetched anything successfully',
    stale: 'Some sources are older than expected',
    partial: `Failing for ${failing} of ${attempted.length} sources`,
    ok: 'Up to date',
  }
  return { state, stateLabel: label[state], lastSuccessAt, lastAttempt, lastAttemptOutcome: null }
}

function health(h: ScopeHistory, opts: { demo: boolean; staleAfterMin: number | null; now: string }): RefreshHealth {
  const base = { lastSuccessAt: h.lastSuccessAt, lastAttempt: h.lastAttempt, lastAttemptOutcome: h.outcome }
  const ago = h.lastSuccessAt ? hoursBetween(h.lastSuccessAt, opts.now) : null
  const state: RefreshState = opts.demo
    ? 'demo'
    : !h.lastAttempt
      ? 'never-run'
      : h.outcome === 'running'
        ? 'running'
        : h.outcome === 'failed'
          ? 'failing'
          : h.outcome === 'nothing-fetched'
            ? 'nothing-fetched'
            : !h.lastSuccessAt
              ? 'never-succeeded'
              : opts.staleAfterMin !== null && ago !== null && ago * 60 > opts.staleAfterMin
                ? 'stale'
                : h.outcome === 'partial'
                  ? 'partial'
                  : 'ok'
  const since = h.lastSuccessAt ? '' : ' — it has never succeeded'
  const label: Record<RefreshState, string> = {
    demo: 'Demo mode — demo data is simulated and never refreshed',
    'never-run': 'Never run',
    running: 'Running now',
    failing: `The last refresh failed${since}`,
    'nothing-fetched': `The last run fetched nothing${h.lastAttempt?.notes[0] ? ` (${h.lastAttempt.notes[0]})` : ''}`,
    'never-succeeded': 'Has run, but has never fetched anything successfully',
    stale: 'Up to date as of the last success, which is older than expected',
    partial: 'Up to date; some sources failed in the last run',
    ok: 'Up to date',
  }
  return { ...base, state, stateLabel: label[state] }
}

function cadenceFor(job: JobName, c: Cadences): { minutes: number | null; staleAfterMin: number | null; text: string } {
  const every = (m: number) => (m % 1440 === 0 ? (m === 1440 ? 'Daily' : `Every ${m / 1440} days`) : m % 60 === 0 ? (m === 60 ? 'Hourly' : `Every ${m / 60} h`) : `Every ${m} min`)
  switch (job) {
    case 'weather':
      return { minutes: c.weatherMin, staleAfterMin: 2 * c.weatherMin, text: every(c.weatherMin) }
    case 'nws-alerts':
      return { minutes: c.nwsAlertsMin, staleAfterMin: 2 * c.nwsAlertsMin, text: every(c.nwsAlertsMin) }
    case 'reports':
      return {
        minutes: c.reportsDayMin,
        staleAfterMin: 2 * Math.max(c.reportsDayMin, c.reportsNightMin),
        text: `${every(c.reportsDayMin)} ${c.reportsDayStart}–${c.reportsDayEnd} resort time, ${every(c.reportsNightMin).toLowerCase()} otherwise`,
      }
    case 'status':
      return { minutes: c.statusMin, staleAfterMin: 2 * c.statusMin, text: `${every(c.statusMin)}, and after report changes` }
    case 'assessments':
      return { minutes: c.assessmentsMin, staleAfterMin: 2 * c.assessmentsMin, text: `${every(c.assessmentsMin)}, and after new weather/report/status data` }
    case 'alerts':
      return { minutes: null, staleAfterMin: null, text: 'After every refresh pass' }
    case 'links':
      return { minutes: c.linksMin, staleAfterMin: 2 * c.linksMin, text: every(c.linksMin) }
    case 'fx':
      return { minutes: c.fxMin, staleAfterMin: 2 * c.fxMin, text: every(c.fxMin) }
    case 'prune':
      return { minutes: c.pruneMin, staleAfterMin: 2 * c.pruneMin, text: every(c.pruneMin) }
  }
}

// ---------------------------------------------------------------------------
// Coverage classification

type SourceClass = 'official' | 'manual' | 'derived' | 'researched' | 'reference' | 'demo'
/** Weakest-first ranking for groups of facts: one research-grade fact makes the group "confirm at source". */
const CLASS_RANK: Record<SourceClass, number> = { official: 0, manual: 1, derived: 2, researched: 3, reference: 4, demo: 5 }

export function sourceClass(p: Provenance | null | undefined): SourceClass {
  if (!p) return 'reference'
  if (p.kind === 'demo') return 'demo'
  if (p.kind === 'derived') return 'derived'
  switch (p.verification) {
    case 'api':
    case 'official-page':
      return 'official'
    case 'user-confirmed':
      return 'manual'
    case 'search-summary':
      return 'researched'
    default:
      return 'reference'
  }
}

function cell(field: CoverageField, state: CoverageState, detail: string | null, at: string | null = null, sourceUrl: string | null = null, label?: string): CoverageCell {
  return {
    field,
    state,
    label: label ?? COVERAGE_STATE_LABEL[state],
    detail,
    at,
    sourceUrl,
    confirmAtSource: state === 'researched' || state === 'reference',
  }
}

const provAt = (p: Provenance | null | undefined) => p?.publishedAt ?? p?.fetchedAt ?? null

/** One fact with one provenance. */
function provCell(field: CoverageField, present: boolean, p: Provenance | null | undefined, detail: string | null, missing: string): CoverageCell {
  if (!present) return cell(field, 'missing', missing)
  const c = sourceClass(p)
  return cell(field, c, detail ?? (p ? verificationLabel(p) : 'No source recorded'), provAt(p), p?.sourceUrl ?? null)
}

/** Several facts: the weakest source class wins, with a breakdown. */
function groupCell(field: CoverageField, provs: readonly (Provenance | null | undefined)[], detail: string, missing: string): CoverageCell {
  if (!provs.length) return cell(field, 'missing', missing)
  const classes = provs.map(sourceClass)
  const weakest = classes.reduce((a, b) => (CLASS_RANK[b] > CLASS_RANK[a] ? b : a))
  const counts = new Map<SourceClass, number>()
  for (const c of classes) counts.set(c, (counts.get(c) ?? 0) + 1)
  const breakdown = counts.size > 1 ? ` (${[...counts].sort((a, b) => CLASS_RANK[a[0]] - CLASS_RANK[b[0]]).map(([c, n]) => `${n} ${c}`).join(', ')})` : ''
  const newest = provs.map(provAt).filter((x): x is string => !!x).sort().reverse()[0] ?? null
  const url = provs.find((p) => sourceClass(p) === weakest)?.sourceUrl ?? null
  return cell(field, weakest, `${detail}${breakdown}`, newest, url)
}

const ageText = (h: number) => (h < 1 ? 'under 1 h' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

interface ResortEvidence {
  b: Bundle
  r: ResortRow
  schedules: OperatingScheduleRow[]
  hotels: HotelRow[]
  events: EventRow[]
  prices: PriceSnapshotRow[]
  travel: TravelOptionRow[]
  rules: PassAccessRuleRow[]
  report: OperationalReportRow | undefined
  adapter: ConnectorStatus | undefined
  reports: RefreshHealth | undefined
  weather: RefreshHealth | undefined
}

function priceCell(field: CoverageField, rows: readonly PriceSnapshotRow[], seasonId: string, ctx: DataCtx, what: string): CoverageCell {
  const current = rows.filter((p) => !p.seasonId || p.seasonId === seasonId)
  const valid = current.filter((p) => !isExpired(p.expiresAt, ctx.now, ctx.today))
  if (!valid.length) {
    const other = rows.filter((p) => p.seasonId && p.seasonId !== seasonId).map((p) => p.seasonId!)
    if (current.length) return cell(field, 'stale', `Only expired ${what} quotes on file`)
    if (other.length) return cell(field, 'stale', `Only ${[...new Set(other)].sort().map(seasonLabel).join(', ')} ${what} prices on file`)
    return cell(field, 'missing', `No ${what} prices on file`)
  }
  const provs = valid.map((p) => (p.quoteKind === 'user-estimate' ? { ...p.prov, verification: 'user-confirmed' as const } : p.prov))
  const types = [...new Set(valid.map((p) => p.dayType ?? 'any day'))].sort()
  return groupCell(field, provs, `${plural(valid.length, 'price')} (${types.join(', ')})`, `No ${what} prices on file`)
}

function coverageFor(e: ResortEvidence, ctx: DataCtx, demo: boolean): CoverageCell[] {
  const { b, r } = e
  const now = ctx.now
  const seasonId = b.seasonId
  const season = b.seasons.get(`${r.id}|${seasonId}`)
  const t = r.terrain
  const f = r.features
  const cells: CoverageCell[] = []

  // Catalog facts.
  cells.push(provCell('location', true, r.locationProv, null, 'Location not recorded'))
  const elevKnown = [r.baseElevationM, r.summitElevationM, r.verticalM].filter((x) => x !== null).length
  cells.push(provCell('elevation', elevKnown > 0, r.elevationProv, `${elevKnown} of 3 elevation facts recorded`, 'Elevation not recorded'))
  const terrainKnown = t ? [t.trails, t.lifts, t.skiableAcres, t.beginnerPct, t.intermediatePct, t.advancedPct, t.terrainParks].filter((x) => x !== null).length : 0
  cells.push(provCell('terrain', terrainKnown > 0, t?.prov, `${terrainKnown} of 7 terrain facts recorded`, 'Terrain not recorded'))
  const featuresKnown = f ? [f.nightSkiing, f.snowmakingPct, f.lessons, f.rentals, f.onMountainLodging, f.tubing, f.childcare, f.beginnerArea].filter((x) => x !== null).length : 0
  cells.push(provCell('features', featuresKnown > 0, f?.prov, `${featuresKnown} of 8 features recorded`, 'Lessons, rentals and features not recorded'))

  // Opening dates (active season).
  const st = seasonLabel(seasonId)
  if (!season) cells.push(cell('opening', 'missing', `No ${st} season record`))
  else if (season.actualOpening) cells.push(provCell('opening', true, season.actualOpeningProv, `Opened ${season.actualOpening}`, ''))
  else if (season.announcedOpening || season.announcedOpeningText) {
    cells.push(provCell('opening', true, season.announcedOpeningProv, `Announced: ${season.announcedOpening ?? season.announcedOpeningText}`, ''))
  } else if (season.estimatedOpenFrom) {
    cells.push(cell('opening', 'derived', `Not announced — Piste estimate from past openings (${season.estimatedOpenFrom} to ${season.estimatedOpenTo ?? '?'})`, season.lastCheckedAt))
  } else cells.push(cell('opening', 'missing', `${st} opening not announced`, season.lastCheckedAt))

  // Published hours for the active season.
  const hoursNow = e.schedules.filter((x) => !x.seasonId || x.seasonId === seasonId)
  if (!hoursNow.length) {
    const other = [...new Set(e.schedules.map((x) => x.seasonId).filter((x): x is string => !!x))].sort()
    cells.push(other.length ? cell('hours', 'stale', `Only ${other.map(seasonLabel).join(', ')} hours on file`) : cell('hours', 'missing', 'No published hours on file'))
  } else {
    cells.push(groupCell('hours', hoursNow.map((x) => x.prov), `${plural(hoursNow.length, 'schedule')} for ${st}`, 'No published hours on file'))
  }

  cells.push(priceCell('liftPrices', e.prices.filter((p) => p.subjectType === 'lift-ticket'), seasonId, ctx, 'lift ticket'))
  cells.push(priceCell('rentalPrices', e.prices.filter((p) => p.subjectType === 'rental'), seasonId, ctx, 'rental'))

  // Travel.
  const drive = e.travel.find((o) => o.mode === 'drive-from-home')
  cells.push(
    provCell(
      'drive',
      !!drive && drive.minutes !== null,
      drive?.prov,
      drive?.minutes != null ? `${drive.minutes} min${drive.prov?.verification === 'api' ? '' : ' — curated estimate, not live routing'}` : null,
      'No drive estimate recorded',
    ),
  )
  const airports = e.travel.filter((o) => o.mode === 'airport')
  cells.push(groupCell('airports', airports.map((a) => a.prov), airports.map((a) => `${a.airportIata}${a.role ? ` (${a.role})` : ''}`).join(', '), 'No airports recorded'))
  cells.push(groupCell('hotels', e.hotels.map((h) => h.prov), `${plural(e.hotels.length, 'hotel')} — prices only from dated quotes, else "Check rates"`, 'No hotels on file'))
  const dated = e.events.filter((x) => x.startLocal).length
  cells.push(groupCell('events', e.events.map((x) => x.prov), `${plural(e.events.length, 'event')}, ${dated} dated`, 'No events on file — not proof there are none'))

  // Snow report.
  const rep = e.report
  const repAge = rep ? hoursBetween(rep.reportedAt ?? rep.createdAt, now) : null
  const adapterOn = e.adapter && e.adapter.state !== 'disabled'
  if (demo) cells.push(rep ? cell('report', 'demo', `Demo report for ${rep.localDate}`, rep.reportedAt) : cell('report', 'missing', 'No report in the demo data'))
  else if (adapterOn && e.reports?.state === 'failing') {
    cells.push(
      cell(
        'report',
        'failing',
        `The latest refresh failed${e.reports.lastAttempt?.error ? `: ${e.reports.lastAttempt.error.slice(0, 160)}` : ''}${e.reports.lastSuccessAt ? '' : ' — never succeeded'}`,
        e.reports.lastSuccessAt,
        e.adapter!.sourceUrl || null,
      ),
    )
  } else if (rep) {
    const origin = reportOrigin(rep)
    const fresh = repAge !== null && repAge <= REPORT_LIVE_HOURS
    const what = origin === 'official-adapter' ? 'Official report' : origin === 'official-by-user' ? 'Official report entered by you' : 'Report typed from an official source'
    const detail = `${what} for ${rep.localDate}, published ${rep.reportedAt ? `${ageText(repAge!)} ago` : 'at an unknown time'}${adapterOn ? '' : ' — no report adapter, manual entries only'}`
    // "Live" only for a fresh report from a connected adapter; anything else is judged by its own source.
    const state: CoverageState = !fresh ? 'stale' : adapterOn && origin === 'official-adapter' ? 'live' : sourceClass(rep.prov)
    cells.push(cell('report', state, detail, rep.reportedAt ?? rep.createdAt, rep.prov?.sourceUrl ?? null))
  } else if (adapterOn) {
    cells.push(cell('report', 'missing', e.adapter!.state === 'unverified' ? 'Adapter (unverified) has not produced a report yet' : 'Adapter has not produced a report yet', e.reports?.lastSuccessAt ?? null))
  } else cells.push(cell('report', 'missing', e.adapter ? 'Report adapter disabled — manual entries only' : 'No official report adapter — manual entries only'))

  // Weather (model output).
  const runs = [...(b.runs.get(r.id)?.values() ?? [])]
  const newest = runs.map((x) => x.fetchedAt).sort().reverse()[0] ?? null
  if (demo) cells.push(runs.length ? cell('weather', 'demo', 'Demo forecast', newest) : cell('weather', 'missing', 'No forecast in the demo data'))
  else if (e.weather?.lastAttemptOutcome === 'failed') {
    cells.push(cell('weather', 'failing', `The latest weather refresh failed for this resort${newest ? ` — showing a forecast fetched ${ageText(hoursBetween(newest, now))} ago` : ''}`, e.weather.lastSuccessAt))
  } else if (!runs.length) cells.push(cell('weather', 'missing', 'Weather not fetched yet'))
  else {
    const age = hoursBetween(newest!, now)
    const points = runs.map((x) => x.pointKey).sort().join(' and ')
    cells.push(
      cell(
        'weather',
        age <= WEATHER_LIVE_HOURS ? 'live' : 'stale',
        `Weather model (${[...new Set(runs.map((x) => x.provider))].join(', ')}) for ${points}, fetched ${ageText(age)} ago — modeled, not observed`,
        newest,
        runs[0].prov?.sourceUrl ?? null,
        age <= WEATHER_LIVE_HOURS ? 'Refreshed recently (weather model)' : undefined,
      ),
    )
  }

  // Operating status.
  const sv = statusView(r, b.status.get(r.id), rep, now)
  if (demo) cells.push(sv.basis === 'none' ? cell('status', 'missing', 'No status in the demo data') : cell('status', 'demo', sv.label, sv.since))
  else if (sv.basis === 'none') cells.push(cell('status', 'missing', sv.note ?? 'No operating status recorded', null, sv.prov?.sourceUrl ?? null))
  else if (sv.seasonId && sv.seasonId !== seasonIdFor(ctx.today)) cells.push(cell('status', 'stale', `${sv.label} — ${sv.note ?? `from the ${seasonLabel(sv.seasonId)} season`}`, sv.since, sv.prov?.sourceUrl ?? null))
  else if (sv.basis === 'season') cells.push(cell('status', 'derived', `${sv.label} — derived from season dates, not a report`, sv.since))
  else {
    const c = sourceClass(sv.prov)
    cells.push(cell('status', c, `${sv.label}, stated ${sv.ageHours !== null ? `${ageText(sv.ageHours)} ago` : 'at an unknown time'}`, sv.lastConfirmedAt ?? sv.since, sv.prov?.sourceUrl ?? null))
  }

  // Pass access for this season's products.
  const current = [...new Set(e.rules.map((x) => x.productId))].flatMap((pid) => latestRules(e.rules, pid)).filter((x) => x.resortId === r.id)
  const unknown = current.filter((x) => x.access === 'unknown').length
  cells.push(
    groupCell(
      'passes',
      current.map((x) => x.prov),
      `${plural(current.length, 'product')} with a rule${unknown ? `, ${unknown} with access not confirmed` : ''}`,
      `No pass access recorded for ${st}`,
    ),
  )
  return cells
}

// ---------------------------------------------------------------------------

function heartbeatStaleAfter(mode: string | null): number {
  const env = Number(process.env.PISTE_HEALTH_MAX_HEARTBEAT_MIN)
  if (Number.isFinite(env) && env > 0) return env
  return mode === 'once' ? 240 : 5
}

function parseCadences(v: string | null): { cadences: Cadences; source: 'worker' | 'default' } {
  if (!v) return { cadences: { ...DEFAULT_CADENCES }, source: 'default' }
  try {
    const parsed = JSON.parse(v) as Record<string, unknown>
    const out: Cadences = { ...DEFAULT_CADENCES }
    for (const k of Object.keys(DEFAULT_CADENCES) as (keyof Cadences)[]) {
      const x = parsed[k]
      if (typeof x === typeof DEFAULT_CADENCES[k] && (typeof x !== 'number' || (Number.isFinite(x) && x >= 0))) (out as unknown as Record<string, unknown>)[k] = x
    }
    return { cadences: out, source: 'worker' }
  } catch {
    return { cadences: { ...DEFAULT_CADENCES }, source: 'default' }
  }
}

export async function getSourcesView(ctx: DataCtx): Promise<SourcesView> {
  const { db, now } = ctx
  const b = await loadBundle(ctx)
  const demo = !b.live
  const resortIds = b.resorts.map((r) => r.row.id)
  const connectors = providerStatus()
  const adapterByResort = new Map(connectors.filter((c) => c.role === 'resort-report' && c.resortId).map((c) => [c.resortId!, c]))
  const failSince = addHours(now, -FAILURE_WINDOW_DAYS * 24)
  const sr = s.sourceRecords

  const [schedules, hotels, reportsNow, meta, fetchStats, failureRows, linkRows, allLinks, histories] = await Promise.all([
    db.select().from(s.operatingSchedules),
    db.select().from(s.hotels),
    currentReports(b),
    db
      .select()
      .from(s.appMeta)
      .where(inArray(s.appMeta.key, [HEARTBEAT_KEY, 'scheduler.mode', 'scheduler.startedAt', 'scheduler.stoppedAt', 'scheduler.cadences'])),
    // One grouped pass: newest successful fetch, and the newest fetch (time, then id — deterministic) per adapter.
    db
      .select({
        adapter: sr.adapter,
        lastOk: sql<string | null>`max(case when ${sr.ok} = 1 then ${sr.fetchedAt} end)`,
        newest: sql<string>`max(${sr.fetchedAt} || '#' || printf('%012d', ${sr.id}))`,
      })
      .from(sr)
      .where(lte(sr.fetchedAt, now))
      .groupBy(sr.adapter),
    db
      .select()
      .from(sr)
      .where(and(gte(sr.fetchedAt, failSince), lte(sr.fetchedAt, now), or(eq(sr.ok, false), sql`${sr.parserErrors} is not null and ${sr.parserErrors} <> 'null'`)))
      .orderBy(desc(sr.fetchedAt), desc(sr.id)),
    db.select().from(s.linkChecks),
    collectLinks(db),
    Promise.all(
      JOB_NAMES.map(async (job) => {
        const targets = job === 'weather' ? resortIds : job === 'reports' ? [...adapterByResort.keys()] : []
        return [job, await scanRunHistory(db, job, targets)] as const
      }),
    ),
  ])
  const newestIds = fetchStats.map((x) => Number(String(x.newest).split('#').pop())).filter((n) => Number.isInteger(n) && n > 0)
  const latestFetch = newestIds.length ? await db.select().from(sr).where(inArray(sr.id, newestIds)) : ([] as SourceRecordRow[])
  const history = new Map(histories)
  const metaBy = new Map(meta.map((m) => [m.key, m.value]))
  const { cadences, source: cadenceSource } = parseCadences(metaBy.get('scheduler.cadences') ?? null)

  // --- Jobs --------------------------------------------------------------------------------------------------------
  const names = b.names
  const jobs: JobView[] = JOB_NAMES.map((job) => {
    const c = cadenceFor(job, cadences)
    const h = history.get(job)!
    const targetIds = job === 'weather' ? resortIds : job === 'reports' ? [...adapterByResort.keys()] : []
    const targets = targetIds.map((id) => ({ resortId: id, name: names[id] ?? id, ...health(h.scopes.get(id)!, { demo, staleAfterMin: c.staleAfterMin, now }) }))
    return {
      job,
      title: JOB_LABEL[job],
      external: (EXTERNAL_JOBS as readonly string[]).includes(job),
      cadence: { minutes: c.minutes, text: c.text },
      ...(h.hasGlobalRuns || !targets.length ? health(h.scopes.get(null)!, { demo, staleAfterMin: c.staleAfterMin, now }) : summariseTargets(targets, demo)),
      targets,
    }
  })
  const jobBy = new Map(jobs.map((j) => [j.job, j]))

  // --- Connectors --------------------------------------------------------------------------------------------------
  const lastOkBy = new Map(fetchStats.map((x) => [x.adapter, x.lastOk ?? null]))
  const lastFetchBy = new Map(latestFetch.map((x) => [x.adapter, x]))
  const ROLE_JOB: Record<ConnectorStatus['role'], JobName | null> = { weather: 'weather', alerts: 'nws-alerts', 'resort-report': 'reports', fx: 'fx', flights: null, 'link-check': 'links' }
  const connectorViews: ConnectorView[] = connectors.map((c) => {
    const job = ROLE_JOB[c.role]
    const j = job ? jobBy.get(job)! : null
    const scoped: RefreshHealth | null = j ? (c.role === 'resort-report' && c.resortId ? (j.targets.find((x) => x.resortId === c.resortId) ?? null) : j) : null
    const lf = lastFetchBy.get(c.id)
    const lastFetch: FetchView | null = lf ? { at: lf.fetchedAt, ok: lf.ok, httpStatus: lf.httpStatus, error: lf.error, url: lf.url } : null
    const lastFetchOkAt = lastOkBy.get(c.id) ?? null
    const staleAfterMin = job ? cadenceFor(job, cadences).staleAfterMin : null
    // Weather has two providers under one job: judge each by its own fetch log. Other connectors by their job scope.
    const successAt = c.role === 'weather' ? lastFetchOkAt : (scoped?.lastSuccessAt ?? null)
    let h: ConnectorHealth
    let label: string
    if (demo) [h, label] = ['demo', 'Demo mode — nothing is fetched; demo data is simulated']
    else if (c.state === 'disabled') [h, label] = ['disabled', 'Turned off (PISTE_DISABLED_PROVIDERS) — nothing is fetched']
    else if (c.state === 'needs-credentials') [h, label] = ['not-configured', `Not configured — set ${c.envVars.join(', ') || 'its credential'} to enable; nothing is fetched`]
    else if (!job) [h, label] = ['on-demand', c.testMode ? 'Runs only when you search — test token: results are test data, never real fares' : 'Runs only when you search; no scheduled refresh']
    else if ((lastFetch && !lastFetch.ok) || scoped?.lastAttemptOutcome === 'failed') {
      ;[h, label] = ['failing', `The latest ${lastFetch && !lastFetch.ok ? 'fetch' : 'refresh'} failed${successAt ? '' : ' — it has never succeeded'}`]
    } else if (!successAt) [h, label] = ['never-succeeded', 'No successful fetch yet']
    else if (staleAfterMin !== null && hoursBetween(successAt, now) * 60 > staleAfterMin) [h, label] = ['stale', 'Last success is older than expected']
    else [h, label] = ['ok', c.state === 'unverified' ? 'Working (adapter unverified — the parser may break if the page changes)' : 'Working']
    return {
      ...c,
      health: h,
      healthLabel: label,
      job,
      jobLastSuccessAt: scoped?.lastSuccessAt ?? null,
      lastFetchOkAt,
      lastFetch,
      lastAttempt: scoped?.lastAttempt ?? null,
    }
  })

  // --- Coverage ----------------------------------------------------------------------------------------------------
  const schedulesBy = groupByResort(schedules)
  const hotelsBy = groupByResort(hotels)
  const eventsBy = groupByResort(b.events.filter((e) => e.resortId) as (EventRow & { resortId: string })[])
  const rulesBy = new Map<string, PassAccessRuleRow[]>()
  for (const r of b.pass.rules) rulesBy.set(r.resortId, [...(rulesBy.get(r.resortId) ?? []), r])
  const weatherJob = jobBy.get('weather')!
  const reportsJob = jobBy.get('reports')!
  const rows: CoverageRow[] = [...b.resorts]
    .sort((x, y) => Number(b.favorites.has(y.row.id)) - Number(b.favorites.has(x.row.id)) || (b.favorites.get(x.row.id)?.sortOrder ?? 0) - (b.favorites.get(y.row.id)?.sortOrder ?? 0))
    .map(({ row: r }) => {
      const cells = coverageFor(
        {
          b,
          r,
          schedules: schedulesBy.get(r.id) ?? [],
          hotels: hotelsBy.get(r.id) ?? [],
          events: eventsBy.get(r.id) ?? [],
          prices: b.prices.get(r.id) ?? [],
          travel: b.travel.get(r.id) ?? [],
          rules: rulesBy.get(r.id) ?? [],
          report: reportsNow.get(r.id),
          adapter: adapterByResort.get(r.id),
          reports: reportsJob.targets.find((x) => x.resortId === r.id),
          weather: weatherJob.targets.find((x) => x.resortId === r.id),
        },
        ctx,
        demo,
      )
      const counts: Partial<Record<CoverageState, number>> = {}
      for (const c of cells) counts[c.state] = (counts[c.state] ?? 0) + 1
      return { resortId: r.id, name: r.name, shortName: r.shortName, region: r.region, isFavorite: b.favorites.has(r.id), hasReportAdapter: adapterByResort.has(r.id), cells, counts }
    })
  const byField = Object.fromEntries(
    COVERAGE_FIELDS.map((f, i) => {
      const counts: Partial<Record<CoverageState, number>> = {}
      for (const row of rows) counts[row.cells[i].state] = (counts[row.cells[i].state] ?? 0) + 1
      return [f, counts]
    }),
  ) as Record<CoverageField, Partial<Record<CoverageState, number>>>

  // --- Failures ------------------------------------------------------------------------------------------------------
  const failures: SourceFailureView[] = failureRows.slice(0, 50).map((x) => {
    const parserErrors = Array.isArray(x.parserErrors) ? x.parserErrors : []
    return {
      id: x.id,
      adapter: x.adapter,
      resortId: x.resortId,
      resortName: x.resortId ? (names[x.resortId] ?? x.resortId) : null,
      url: x.url,
      fetchedAt: x.fetchedAt,
      httpStatus: x.httpStatus,
      kind: parserErrors.length ? 'parser' : 'fetch',
      error: x.error,
      parserErrors,
    }
  })
  const byAdapter = new Map<string, { adapter: string; parser: number; fetch: number; lastAt: string }>()
  for (const x of failureRows) {
    const e = byAdapter.get(x.adapter) ?? { adapter: x.adapter, parser: 0, fetch: 0, lastAt: x.fetchedAt }
    if (Array.isArray(x.parserErrors) && x.parserErrors.length) e.parser += 1
    else e.fetch += 1
    if (x.fetchedAt > e.lastAt) e.lastAt = x.fetchedAt
    byAdapter.set(x.adapter, e)
  }

  // --- Links ---------------------------------------------------------------------------------------------------------
  const checks = new Map(linkRows.map((l) => [l.url, l]))
  const shown = new Set(allLinks)
  const inUse = linkRows.filter((l) => shown.has(l.url))
  const staleBefore = addHours(now, -LINK_STALE_DAYS * 24)
  const owners = new Map<string, Set<string>>()
  const own = (url: string | null | undefined, resortId: string | null) => {
    if (!url || !resortId) return
    const set = owners.get(url.trim()) ?? new Set<string>()
    set.add(resortId)
    owners.set(url.trim(), set)
  }
  for (const { row } of b.resorts) {
    for (const [k, v] of Object.entries(row.links ?? {})) {
      if (k === 'more' && Array.isArray(v)) for (const m of v) own(m.url, row.id)
      else if (typeof v === 'string') own(v, row.id)
    }
    own(row.reportSource?.url, row.id)
  }
  for (const h of hotels) own(h.officialUrl, h.resortId)
  for (const e of b.events) {
    own(e.officialUrl, e.resortId)
    own(e.ticketUrl, e.resortId)
  }
  const links: LinksView = {
    total: allLinks.length,
    checked: inUse.length,
    ok: inUse.filter((l) => l.ok === true).length,
    broken: inUse.filter((l) => l.ok === false).length,
    unknown: inUse.filter((l) => l.ok === null).length,
    unchecked: allLinks.filter((u) => !checks.has(u)).length,
    stale: inUse.filter((l) => l.checkedAt < staleBefore).length,
    lastCheckedAt: inUse.map((l) => l.checkedAt).sort().reverse()[0] ?? null,
    brokenLinks: inUse
      .filter((l) => l.ok === false)
      .sort((x, y) => y.checkedAt.localeCompare(x.checkedAt) || x.url.localeCompare(y.url))
      .map((l) => ({ url: l.url, resortIds: [...(owners.get(l.url) ?? [])].sort(), httpStatus: l.httpStatus, error: l.error, checkedAt: l.checkedAt, finalUrl: l.finalUrl })),
  }

  // --- Corrections -----------------------------------------------------------------------------------------------------
  const corrections: CorrectionView[] = b.resorts
    .flatMap(({ row, corrections: cs }) => cs.map((c) => ({ ...c, resortId: row.id, resortName: row.name })))
    .sort((x, y) => y.at.localeCompare(x.at) || x.resortName.localeCompare(y.resortName) || x.field.localeCompare(y.field))

  // --- Scheduler -------------------------------------------------------------------------------------------------------
  const heartbeat = metaBy.get(HEARTBEAT_KEY) ?? null
  const schedMode = metaBy.get('scheduler.mode') ?? null
  const stoppedAt = metaBy.get('scheduler.stoppedAt') ?? null
  const ageMinutes = heartbeat ? Math.max(0, Math.round(hoursBetween(heartbeat, now) * 60)) : null
  const staleAfterMinutes = heartbeatStaleAfter(schedMode)
  const hbStale = ageMinutes === null || ageMinutes > staleAfterMinutes
  const scheduler: SchedulerView = {
    applicable: !demo,
    heartbeat,
    ageMinutes,
    mode: schedMode,
    startedAt: metaBy.get('scheduler.startedAt') ?? null,
    stoppedAt,
    staleAfterMinutes,
    stale: !demo && hbStale,
    running: !demo && !hbStale && schedMode === 'worker' && !(stoppedAt && heartbeat && stoppedAt >= heartbeat),
    cadences,
    cadenceSource,
    note: demo
      ? 'Demo mode: simulated data at a fixed instant. Nothing is refreshed.'
      : !heartbeat
        ? 'The scheduler has never run. Start `npm run worker`, or call `npm run refresh` from cron.'
        : hbStale
          ? `No scheduler heartbeat for ${ageMinutes} min. A sleeping machine cannot collect data — run \`npm run worker\` on an always-on host or \`npm run refresh\` from cron.`
          : null,
  }

  return {
    now,
    mode: ctx.mode,
    demo,
    season: { id: b.seasonId, label: seasonLabel(b.seasonId) },
    connectors: connectorViews,
    jobs,
    scheduler,
    coverage: { fields: COVERAGE_FIELDS.map((key) => ({ key, label: COVERAGE_FIELD_LABEL[key] })), rows, byField },
    failures: { windowDays: FAILURE_WINDOW_DAYS, items: failures, byAdapter: [...byAdapter.values()].sort((x, y) => y.lastAt.localeCompare(x.lastAt)) },
    links,
    corrections,
    notes: [
      'Last success counts only refreshes that fetched something: a failed or empty refresh never advances it.',
      'Weather is model output for a grid cell — "refreshed recently" never means observed.',
      'Researched catalog facts are shown as "confirm at source" until confirmed.',
    ],
  }
}

function groupByResort<T extends { resortId: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) m.set(r.resortId, [...(m.get(r.resortId) ?? []), r])
  return m
}

