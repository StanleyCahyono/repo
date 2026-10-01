/**
 * Today: the decision dashboard. One batched load feeds the recommendation (recommend.ts), the favourites
 * watchlist, the seven-day strip, the next trip, the opening timeline, new-snow watch, pass deadlines, events,
 * recent changes and unread in-app alerts.
 *
 * `getRecommendation` is the same engine without the rest of the dashboard (weekend finder).
 */
import 'server-only'
import { and, desc, gte, isNull, lte, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { AlertRow, OperationalReportRow } from '@/lib/db/rows'
import { aggregateDay, prepareSeries } from '@/lib/domain/conditions'
import {
  PRESET_LABEL,
  PRESET_MODES,
  RECOMMEND_PRESETS,
  recommend,
  type CandidateConditions,
  type CandidateDay,
  type FactorWeights,
  type Recommendation,
  type RecommendCandidate,
  type RecommendPreset,
} from '@/lib/domain/recommend'
import { isLongHaul } from '@/lib/domain/geo'
import { addDays, addHours, dateRange, endOfLocalDay, formatLocalDate, hemisphereOf, isLocalDate, isWeekend, seasonIdsForDates, startOfLocalDay } from '@/lib/domain/time'
import { OPERATING_STATUS_LABEL, SCORING_MODES, type OpeningLabel, type OperatingStatus, type Provenance, type ScoreKind, type ScoringMode } from '@/lib/domain/types'
import { formatSnow } from '@/lib/domain/units'
import {
  assessmentKey,
  currentReports,
  isLive,
  latestAssessments,
  loadBundle,
  NOT_PERSONAL_REPORT,
  notDemoProv,
  pointsForRuns,
  resortHemisphere,
  resortToday,
  seasonLabel,
  seasonRowFor,
  type Bundle,
  type DataCtx,
} from './core'
import { reportOrigin, type ReportOrigin } from './deps'
import { buildSummaries, type ResortSummary } from './resorts'
import { tripSummaries, type TripSummary } from './trips'
import {
  alertsOverlapping,
  basketVerdict,
  candidateOps,
  catalogResearchGap,
  closureView,
  dayBasket,
  eventsOverlapping,
  myPassView,
  ownedVerdicts,
  reportedWindow,
  statusStatement,
  type ClosureView,
  type EventView,
} from './views'

export const MAX_RANGE_DAYS = 14
export const DEADLINE_WINDOW_DAYS = 45
export const EVENTS_WINDOW_DAYS = 14
export const DEFAULT_SNOW_THRESHOLD_CM = 15
const STRIP_DAYS = 7
const MAX_STRIP_RESORTS = 4

export interface RecommendationOptions {
  /** Resort-local date; defaults to today. */
  date?: string | null
  /** Inclusive date range (≤ 14 days); wins over `date`. */
  range?: { from: string; to: string } | null
  preset?: RecommendPreset | null
  /** Override the preset weights with the saved user weights. */
  useMyWeights?: boolean
}

export function resolveDates(today: string, opts: Pick<RecommendationOptions, 'date' | 'range'>): string[] {
  const r = opts.range
  if (r && isLocalDate(r.from) && isLocalDate(r.to) && r.from <= r.to) {
    const to = r.to < addDays(r.from, MAX_RANGE_DAYS - 1) ? r.to : addDays(r.from, MAX_RANGE_DAYS - 1)
    return dateRange(r.from, to)
  }
  return [opts.date && isLocalDate(opts.date) ? opts.date : today]
}

export function defaultPreset(ability: string): RecommendPreset {
  return ability === 'beginner' || ability === 'novice' ? 'learning' : 'best-snow'
}

function presetMode(preset: RecommendPreset, fallback: ScoringMode): ScoringMode {
  return preset === 'custom' ? fallback : PRESET_MODES[preset][0]
}

const toConditions = (a: { score: number | null; scoreKind: ScoreKind; descriptor: string | null; confidence: CandidateConditions['confidence']; computedAt: string; kind: CandidateConditions['kind'] } | undefined): CandidateConditions | null =>
  a ? { score: a.score, scoreKind: a.scoreKind, descriptor: a.descriptor, confidence: a.confidence, computedAt: a.computedAt, kind: a.kind } : null

/** Larger of the base/summit modeled 72 h snowfall, with whether that sum covers the whole window. */
function forecast72h(sum: ResortSummary): { cm: number | null; complete: boolean | null } {
  const pts = [sum.snow.forecast.base?.next72h, sum.snow.forecast.summit?.next72h].filter((x): x is NonNullable<typeof x> => !!x && x.sumCm !== null)
  if (!pts.length) return { cm: null, complete: null }
  const top = pts.sort((x, y) => y.sumCm! - x.sumCm!)[0]
  return { cm: top.sumCm, complete: top.complete }
}

/**
 * Resorts Today's short-range answers consider: those within LONG_HAUL_KM of home (great circle). Farther resorts
 * are trips to plan (Explore, Trips, Passes, Forecast and favourites keep them); unknown coordinates are kept.
 */
export function nearHome(b: Pick<Bundle, 'resorts' | 'ctx'>): { near: Set<string>; longHaul: string[] } {
  const home = { lat: b.ctx.prefs.homeLat, lon: b.ctx.prefs.homeLon }
  const near = new Set<string>()
  const longHaul: string[] = []
  for (const { row } of b.resorts) {
    if (isLongHaul(home, row)) longHaul.push(row.id)
    else near.add(row.id)
  }
  return { near, longHaul }
}

/** Build recommendation candidates for the bundle's resorts (`only`: restrict to these ids). */
async function buildCandidates(
  b: Bundle,
  dates: readonly string[],
  summaries: readonly ResortSummary[],
  reportsNow: Map<string, OperationalReportRow>,
  only: ReadonlySet<string> | null = null,
): Promise<RecommendCandidate[]> {
  const { db, now } = b.ctx
  const resorts = only ? b.resorts.filter((r) => only.has(r.row.id)) : b.resorts
  const resortIds = resorts.map((r) => r.row.id)
  if (!resortIds.length) return []
  const assessments = await latestAssessments(db, { dates, modes: SCORING_MODES, now, live: b.live, resortIds })
  const byId = new Map(summaries.map((x) => [x.id, x]))
  return resorts.map(({ row: r }) => {
    const sum = byId.get(r.id)!
    const report: OperationalReportRow | undefined = reportsNow.get(r.id)
    // The resort's own season for the first date (a Southern Hemisphere winter changes season on 1 January).
    const season = seasonRowFor(b, r, dates[0])
    const st = statusStatement(b.status.get(r.id), report)
    const snow72 = forecast72h(sum)
    const today = resortToday(r, now)
    const days: CandidateDay[] = dates.map((date) => {
      const verdicts = ownedVerdicts(b, r.id, date).map((v) => v.verdict)
      const pass = myPassView(verdicts)
      const basket = date === sum.date ? null : dayBasket(b, r.id, date, basketVerdict(verdicts))
      const cost = basket
        ? { total: basket.total, tier: basket.tier.tier, missing: basket.missing.filter((m) => m.required).map((m) => m.message), confirmAtSource: basket.lines.some((l) => l.confirmAtSource) }
        : { total: sum.expense.total, tier: sum.expense.tier, missing: sum.expense.requiredMissing, confirmAtSource: sum.expense.confirmAtSource }
      return {
        date,
        conditions: Object.fromEntries(SCORING_MODES.map((m) => [m, toConditions(assessments.get(assessmentKey(r.id, date, m)))])),
        cost,
        // The engine writes "Not covered by your <product>: <note>", so the note is the verdict's own headline
        // ("No days left"), not MyPassView.headline (which already starts with the product name).
        pass: { status: pass.status, productName: pass.productName, note: pass.status === 'not-covered' ? (pass.verdicts[0]?.headline ?? null) : null },
        events: eventsOverlapping(b.events, new Set([r.id]), date, date).map((e) => ({ title: e.title, status: e.status })),
        snow: { forecast72hCm: snow72.cm, forecast72hComplete: snow72.complete, reported24hCm: report && report.localDate === today ? reportedWindow(report, '24h') : null },
        warnings: alertsOverlapping(b.alerts.get(r.id) ?? [], startOfLocalDay(date, r.timezone), endOfLocalDay(date, r.timezone)).map((a) => a.headline ?? a.event),
      }
    })
    return {
      resortId: r.id,
      name: r.shortName || r.name,
      today,
      ops: candidateOps(st, season, resortHemisphere(r)),
      fit: sum.fit,
      travel: sum.fit.travel,
      evidence: {
        reportAt: report?.reportedAt ?? null,
        reportDate: report?.localDate ?? null,
        reportKind: report?.kind ?? null,
        weatherFetchedAt: sum.freshness.weatherFetchedAt,
        catalogResearched: catalogResearchGap(r) !== null,
      },
      days,
    }
  })
}

function runRecommendation(b: Bundle, dates: string[], preset: RecommendPreset, candidates: RecommendCandidate[], useMyWeights: boolean, longHaulExcluded: number): Recommendation {
  const p = b.ctx.prefs
  return recommend({
    candidates,
    dates,
    preset,
    weights: p.weights as Partial<FactorWeights>,
    overrideWeights: useMyWeights,
    defaultMode: p.scoringMode,
    now: b.ctx.now,
    appMode: b.ctx.mode,
    units: p.units,
    homeHemisphere: hemisphereOf(p.homeLat),
    longHaulExcluded,
  })
}

/** Weekend finder / "Where to ski": the recommendation alone (resorts within a long flight of home only). */
export async function getRecommendation(ctx: DataCtx, opts: RecommendationOptions = {}): Promise<Recommendation> {
  const dates = resolveDates(ctx.today, opts)
  const preset = opts.preset ?? defaultPreset(ctx.prefs.ability)
  const b = await loadBundle(ctx, { seasons: seasonIdsForDates(dates) })
  const { near, longHaul } = nearHome(b)
  const [summaries, reportsNow] = await Promise.all([buildSummaries(b, { date: dates[0], mode: presetMode(preset, ctx.prefs.scoringMode) }), currentReports(b)])
  return runRecommendation(b, dates, preset, await buildCandidates(b, dates, summaries, reportsNow, near), !!opts.useMyWeights, longHaul.length)
}

// ---------------------------------------------------------------------------
// Dashboard

export interface ChangeItem {
  at: string
  resortId: string
  resortName: string
  kind: 'status' | 'opening-date' | 'report' | 'official-alert'
  title: string
  detail: string | null
  prov: Provenance | null
}

export interface WatchItem {
  summary: ResortSummary
  /** Important changes for this resort (status, opening dates, alerts, new reports), newest first. */
  changes: ChangeItem[]
}

export interface StripCell {
  resortId: string
  name: string
  /**
   * Modeled snowfall at base and summit over the part of the local day the run covers; null = unknown/not covered.
   * When `partial` is true this is NOT a day total — word it "at least …".
   */
  snowfallCm: { base: number | null; summit: number | null }
  /** Share of the local day (0–1) the model run covers at each point; null = no run. */
  coverage: { base: number | null; summit: number | null }
  /** Some shown weather covers only part of the day (end of the forecast horizon, or today's past hours missing). */
  partial: boolean
  tempMinC: number | null
  tempMaxC: number | null
  /** null when no score — or when `closed` supersedes it. */
  score: number | null
  scoreKind: ScoreKind | null
  descriptor: string | null
  /** Confirmed closure on this date: show "Closed", never a ski-day score. */
  closed: ClosureView | null
}

export interface StripDay {
  date: string
  label: string
  isWeekend: boolean
  /** Part of the selected date/range (the strip drives the date filter). */
  selected: boolean
  cells: StripCell[]
}

export interface OpeningTimelineItem {
  resortId: string
  name: string
  isFavorite: boolean
  label: OpeningLabel
  date: string | null
  to: string | null
  daysAway: number | null
  text: string | null
  basis: string | null
  prov: Provenance | null
  status: OperatingStatus
}

export interface SnowWatchItem {
  resortId: string
  name: string
  isFavorite: boolean
  /** Larger of base/summit modeled snowfall in the next 72 h — a lower bound when `complete` is false. */
  next72hCm: number
  /** The run covers all 72 hours. When false the amount is "at least …". */
  complete: boolean
  /** Hours of the window the run covers with a snowfall value. */
  hoursCovered: number
  next7dCm: number | null
  /** The 7-day sum covers all 168 hours (else a lower bound). */
  next7dComplete: boolean
  point: 'base' | 'summit'
  fetchedAt: string
  /** "Likely …" wording: modeled, not observed; "Likely at least …" for a partial window. */
  text: string
}

export interface PassDeadlineItem {
  productId: string
  name: string
  familyId: string
  familyName: string
  deadline: string
  deadlineText: string | null
  daysLeft: number
  owned: boolean
  prov: Provenance | null
}

export interface TodayView {
  now: string
  today: string
  dates: string[]
  preset: RecommendPreset
  presetLabel: string
  presets: { id: RecommendPreset; label: string }[]
  home: { name: string; timezone: string }
  season: { id: string; label: string }
  demo: boolean
  recommendation: Recommendation
  watchlist: WatchItem[]
  strip: StripDay[]
  stripBasis: 'favourites' | 'winner' | 'none'
  /** Favourites left out of the strip: more than a long flight from home (LONG_HAUL_KM) — planned as trips. */
  stripLongHaul: { resortId: string; name: string }[]
  /** Every resort's name by id (events and changes can be about any resort, near or far). */
  resortNames: Record<string, string>
  nextTrip: TripSummary | null
  openingTimeline: OpeningTimelineItem[]
  newSnowWatch: { thresholdCm: number; windowHours: number; items: SnowWatchItem[] }
  passDeadlines: PassDeadlineItem[]
  events: EventView[]
  recentChanges: ChangeItem[]
  unreadAlerts: AlertRow[]
  preseason: boolean
}

const LABEL_ORDER: Record<OpeningLabel, number> = { announced: 0, estimated: 0, opened: 1, 'not-announced': 2 }

/** "Recent changes" wording per report origin — a simulated demo report is never called official or manual. */
const REPORT_CHANGE_LABEL: Record<ReportOrigin, string> = {
  'official-adapter': 'new official report',
  'official-by-user': 'official report entered by you',
  'manual-transcribed': 'report typed by you from the source',
  personal: 'your own observation',
  demo: 'simulated demo report',
  other: 'new report',
}

async function recentChanges(b: Bundle): Promise<ChangeItem[]> {
  const { db, now } = b.ctx
  const since7 = addHours(now, -7 * 24)
  const since14 = addHours(now, -14 * 24)
  const since2 = addHours(now, -48)
  const name = (id: string) => b.names[id] ?? id
  const [statusRows, historyRows, reportRows] = await Promise.all([
    db
      .select()
      .from(s.statusEvents)
      .where(and(gte(s.statusEvents.effectiveAt, since7), lte(s.statusEvents.effectiveAt, now), b.live ? notDemoProv(s.statusEvents.prov) : undefined))
      .orderBy(desc(s.statusEvents.effectiveAt)),
    db
      .select()
      .from(s.openingDateHistory)
      .where(and(gte(s.openingDateHistory.changedAt, since14), lte(s.openingDateHistory.changedAt, now), b.live ? notDemoProv(s.openingDateHistory.prov) : undefined))
      .orderBy(desc(s.openingDateHistory.changedAt)),
    db
      .select()
      .from(s.operationalReports)
      .where(
        and(
          gte(s.operationalReports.createdAt, since2),
          lte(s.operationalReports.createdAt, now),
          NOT_PERSONAL_REPORT,
          b.live ? sql`${s.operationalReports.kind} <> 'demo'` : undefined,
        ),
      )
      .orderBy(desc(s.operationalReports.createdAt)),
  ])
  const FIELD: Record<string, string> = { announcedOpening: 'Announced opening', actualOpening: 'Opened', announcedClosing: 'Announced closing', actualClosing: 'Closed for the season' }
  const units = b.ctx.prefs.units
  const items: ChangeItem[] = [
    ...statusRows.filter((e) => b.byId.has(e.resortId)).map((e) => ({
      at: e.effectiveAt,
      resortId: e.resortId,
      resortName: name(e.resortId),
      kind: 'status' as const,
      title: `${name(e.resortId)}: ${OPERATING_STATUS_LABEL[e.status]}`,
      detail: e.note,
      prov: e.prov,
    })),
    ...historyRows.filter((h) => b.byId.has(h.resortId)).map((h) => ({
      at: h.changedAt,
      resortId: h.resortId,
      resortName: name(h.resortId),
      kind: 'opening-date' as const,
      title: `${name(h.resortId)}: ${FIELD[h.field] ?? h.field} ${h.newValue ? formatLocalDate(h.newValue) : 'removed'}`,
      detail: h.previousValue ? `Previously ${formatLocalDate(h.previousValue)}` : null,
      prov: h.prov,
    })),
    ...reportRows.filter((r) => b.byId.has(r.resortId)).map((r) => {
      const snow = reportedWindow(r, '24h') ?? reportedWindow(r, 'overnight')
      return {
        at: r.reportedAt ?? r.createdAt,
        resortId: r.resortId,
        resortName: name(r.resortId),
        kind: 'report' as const,
        title: `${name(r.resortId)}: ${REPORT_CHANGE_LABEL[reportOrigin(r)]} for ${formatLocalDate(r.localDate)}${r.revision > 1 ? ` (revision ${r.revision})` : ''}`,
        detail: snow != null ? `Reported ${formatSnow(snow, units)} new snow` : null,
        prov: r.prov,
      }
    }),
    ...[...b.alerts.values()].flat().filter((a) => a.fetchedAt >= since2).map((a) => ({
      at: a.fetchedAt,
      resortId: a.resortId,
      resortName: name(a.resortId),
      kind: 'official-alert' as const,
      title: `${name(a.resortId)}: ${a.event}`,
      detail: a.headline,
      prov: null,
    })),
  ]
  return items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : x.resortId.localeCompare(y.resortId)))
}

export async function stripFor(
  b: Bundle,
  resortIds: readonly string[],
  dates7: readonly string[],
  selected: ReadonlySet<string>,
  mode: ScoringMode,
  reportsNow: Map<string, OperationalReportRow>,
): Promise<StripDay[]> {
  const { db, now } = b.ctx
  const ids = resortIds.filter((id) => b.byId.has(id))
  const runs = ids.flatMap((id) => [...(b.runs.get(id)?.values() ?? [])])
  const zones = [...new Set(ids.map((id) => b.byId.get(id)!.row.timezone))]
  const from = zones.length ? zones.map((z) => startOfLocalDay(dates7[0], z)).sort()[0] : now
  const to = zones.length ? addHours(zones.map((z) => endOfLocalDay(dates7[dates7.length - 1], z)).sort().reverse()[0], 1) : now
  const [points, assessments] = await Promise.all([
    pointsForRuns(
      db,
      runs.map((r) => r.id),
      from,
      to,
    ),
    latestAssessments(db, { dates: dates7, modes: [mode], now, live: b.live, resortIds: ids }),
  ])
  const series = new Map(runs.map((r) => [r.id, prepareSeries(points.get(r.id) ?? [], r.intervalSemantics ?? 'preceding-hour')]))
  const statements = new Map(ids.map((id) => [id, statusStatement(b.status.get(id), reportsNow.get(id))]))
  return dates7.map((date) => ({
    date,
    label: formatLocalDate(date, 'ccc d'),
    isWeekend: isWeekend(date),
    selected: selected.has(date),
    cells: ids.map((id): StripCell => {
      const r = b.byId.get(id)!.row
      const agg = (key: string) => {
        const run = b.runs.get(id)?.get(key)
        if (!run) return null
        const a = aggregateDay(series.get(run.id)!, date, r.timezone)
        return a.hoursCovered > 0 ? a : null
      }
      const base = agg('base')
      const summit = agg('summit')
      const a = assessments.get(assessmentKey(id, date, mode))
      // Same rule as the resort summaries and recommendation eligibility: a confirmed closure shows "Closed".
      const closed = closureView(statements.get(id)!, seasonRowFor(b, r, date), date, resortHemisphere(r))
      const shown = [base, summit].filter((x): x is NonNullable<typeof x> => !!x)
      return {
        resortId: id,
        name: r.shortName || r.name,
        snowfallCm: { base: base?.snowfallCm ?? null, summit: summit?.snowfallCm ?? null },
        coverage: { base: base ? Math.round(base.coverage * 1000) / 1000 : null, summit: summit ? Math.round(summit.coverage * 1000) / 1000 : null },
        partial: shown.some((x) => !x.complete),
        tempMinC: (base ?? summit)?.tempMinC ?? null,
        tempMaxC: (base ?? summit)?.tempMaxC ?? null,
        score: closed ? null : (a?.score ?? null),
        scoreKind: closed ? 'closed' : (a?.scoreKind ?? null),
        descriptor: closed ? null : (a?.descriptor ?? null),
        closed,
      }
    }),
  }))
}

export async function getTodayView(ctx: DataCtx, opts: RecommendationOptions = {}): Promise<TodayView> {
  const { db, now } = ctx
  const dates = resolveDates(ctx.today, opts)
  const preset = opts.preset ?? defaultPreset(ctx.prefs.ability)
  const mode = presetMode(preset, ctx.prefs.scoringMode)
  const dates7 = dateRange(ctx.today, addDays(ctx.today, STRIP_DAYS - 1))
  const b = await loadBundle(ctx, { seasons: seasonIdsForDates([...dates, ...dates7]) })
  // Today's short-range answers (ranking, strip) leave out resorts more than a long flight from home.
  const { near, longHaul } = nearHome(b)
  const [summaries, reportsNow] = await Promise.all([buildSummaries(b, { date: dates[0], mode }), currentReports(b)])
  const [candidates, changes, trips, unreadAlerts, snowRules] = await Promise.all([
    buildCandidates(b, dates, summaries, reportsNow, near),
    recentChanges(b),
    tripSummaries(ctx),
    db.select().from(s.alerts).where(isNull(s.alerts.readAt)).orderBy(desc(s.alerts.firedAt), desc(s.alerts.id)).limit(20),
    db.select().from(s.alertRules).where(and(sql`${s.alertRules.type} = 'snow-threshold'`, sql`${s.alertRules.enabled} = 1`)),
  ])
  const recommendation = runRecommendation(b, dates, preset, candidates, !!opts.useMyWeights, longHaul.length)

  // Watchlist: favourites in their saved order (every favourite, however far away).
  const favs = summaries.filter((x) => x.isFavorite).sort((a, b2) => (a.favoriteOrder ?? 0) - (b2.favoriteOrder ?? 0) || a.name.localeCompare(b2.name))
  const watchlist: WatchItem[] = favs.map((summary) => ({ summary, changes: changes.filter((c) => c.resortId === summary.id).slice(0, 3) }))

  // Seven-day strip for favourites within a long flight of home (or the winner).
  const nearFavs = favs.filter((f) => near.has(f.id))
  const stripIds = nearFavs.length ? nearFavs.slice(0, MAX_STRIP_RESORTS).map((f) => f.id) : recommendation.winner ? [recommendation.winner.resortId] : []
  const strip = await stripFor(b, stripIds, dates7, new Set(dates), mode, reportsNow)
  const stripLongHaul = favs.filter((f) => !near.has(f.id)).map((f) => ({ resortId: f.id, name: f.shortName || f.name }))

  const nextTrip = trips.find((t) => t.phase === 'in-progress') ?? trips.find((t) => t.phase === 'upcoming') ?? null

  // Openings in the home hemisphere only: a New Zealand opening in June is not part of a New York preseason.
  const homeHemisphere = hemisphereOf(ctx.prefs.homeLat)
  const openingTimeline: OpeningTimelineItem[] = summaries
    .filter((x) => hemisphereOf(x.lat) === homeHemisphere)
    .map((x) => ({
      resortId: x.id,
      name: x.name,
      isFavorite: x.isFavorite,
      label: x.opening.label,
      date: x.opening.date,
      to: x.opening.to,
      daysAway: x.opening.daysAway,
      text: x.opening.text,
      basis: x.opening.basis,
      prov: x.opening.prov,
      status: x.status.status,
    }))
    .sort(
      (a, c) =>
        LABEL_ORDER[a.label] - LABEL_ORDER[c.label] ||
        (a.label === 'opened' ? (c.date ?? '').localeCompare(a.date ?? '') : (a.date ?? '9999').localeCompare(c.date ?? '9999')) ||
        Number(c.isFavorite) - Number(a.isFavorite) ||
        a.name.localeCompare(c.name),
    )

  const thresholds = snowRules.map((r) => Number((r.params as { thresholdCm?: unknown }).thresholdCm)).filter((n) => Number.isFinite(n) && n > 0)
  const thresholdCm = thresholds.length ? Math.min(...thresholds) : DEFAULT_SNOW_THRESHOLD_CM
  const units = ctx.prefs.units
  const newSnow: SnowWatchItem[] = summaries
    .flatMap((x) => {
      const pts = (['base', 'summit'] as const)
        .map((k) => ({ k, f: x.snow.forecast[k] }))
        .filter((p) => p.f && p.f.next72h.sumCm !== null)
        .sort((p, q) => q.f!.next72h.sumCm! - p.f!.next72h.sumCm!)
      const top = pts[0]
      // An incomplete sum is a lower bound: it can confirm the threshold, never rule it out.
      if (!top || top.f!.next72h.sumCm! < thresholdCm) return []
      const w = top.f!.next72h
      const cm = w.sumCm!
      const amount = formatSnow(cm, units)
      return [
        {
          resortId: x.id,
          name: x.name,
          isFavorite: x.isFavorite,
          next72hCm: cm,
          complete: w.complete,
          hoursCovered: w.hoursWithValue,
          next7dCm: top.f!.next7d.sumCm,
          next7dComplete: top.f!.next7d.complete,
          point: top.k,
          fetchedAt: top.f!.run.fetchedAt,
          text: w.complete
            ? `Likely ${amount} of new snow in the next 72 h at the ${top.k} (weather model)`
            : `Likely at least ${amount} of new snow in the next 72 h at the ${top.k} (weather model; the forecast covers ${w.hoursWithValue} of 72 h)`,
        },
      ]
    })
    .sort((a, c) => c.next72hCm - a.next72hCm || a.name.localeCompare(c.name))

  const famName = new Map(b.pass.families.map((f) => [f.id, f.name]))
  const ownedIds = new Set(b.pass.owned.map((o) => o.product.id))
  const horizon = addDays(ctx.today, DEADLINE_WINDOW_DAYS)
  const passDeadlines: PassDeadlineItem[] = b.pass.products
    .filter((p) => p.salesDeadline && p.salesDeadline >= ctx.today && p.salesDeadline <= horizon)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      familyId: p.familyId,
      familyName: famName.get(p.familyId) ?? p.familyId,
      deadline: p.salesDeadline!,
      deadlineText: p.salesDeadlineText,
      daysLeft: Math.round((Date.parse(p.salesDeadline!) - Date.parse(ctx.today)) / 86_400_000),
      owned: ownedIds.has(p.id),
      prov: p.prov,
    }))
    .sort((a, c) => a.deadline.localeCompare(c.deadline) || a.name.localeCompare(c.name))

  const eventResorts = new Set([...favs.map((f) => f.id), ...trips.filter((t) => t.phase === 'upcoming' || t.phase === 'in-progress').flatMap((t) => t.resorts.map((r) => r.id))])
  const events = eventsOverlapping(b.events, eventResorts, ctx.today, addDays(ctx.today, EVENTS_WINDOW_DAYS))

  return {
    now,
    today: ctx.today,
    dates,
    preset,
    presetLabel: PRESET_LABEL[preset],
    presets: RECOMMEND_PRESETS.map((id) => ({ id, label: PRESET_LABEL[id] })),
    home: { name: ctx.prefs.homeName, timezone: ctx.prefs.homeTimezone },
    season: { id: b.seasonId, label: seasonLabel(b.seasonId) },
    demo: !isLive(ctx),
    recommendation,
    watchlist,
    strip,
    stripBasis: nearFavs.length ? 'favourites' : stripIds.length ? 'winner' : 'none',
    stripLongHaul,
    resortNames: Object.fromEntries(summaries.map((x) => [x.id, x.name])),
    nextTrip,
    openingTimeline,
    newSnowWatch: { thresholdCm, windowHours: 72, items: newSnow },
    passDeadlines,
    events,
    recentChanges: changes.slice(0, 20),
    unreadAlerts,
    preseason: recommendation.preseason,
  }
}
