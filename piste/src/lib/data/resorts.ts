/**
 * Resort summaries for Explore, Today's watchlist, comparison and the resort header: one batched load for all
 * resorts (no per-resort queries), manual corrections applied on read, provenance on every fact.
 */
import 'server-only'
import type { ResortRow } from '@/lib/db/rows'
import type { FeatureInfo } from '@/lib/db/schema'
import { aggregateDay, prepareSeries } from '@/lib/domain/conditions'
import type { FitResult } from '@/lib/domain/fit'
import { endOfLocalDay, hoursBetween, isLocalDate, seasonIdFor, startOfLocalDay } from '@/lib/domain/time'
import type { Provenance, ScoringMode } from '@/lib/domain/types'
import {
  forecastSnowSums,
  latestAssessments,
  latestReports,
  loadBundle,
  pointsForRuns,
  resortToday,
  assessmentKey,
  seasonLabel,
  type Bundle,
  type Correction,
  type DataCtx,
} from './core'
import { providerStatus } from './deps'
import {
  alertView,
  beginnerView,
  catalogResearchGap,
  dayBasket,
  eventsOverlapping,
  eventWindow,
  expenseView,
  fitView,
  myPassView,
  openingView,
  ownedVerdicts,
  passBadges,
  reportView,
  runMeta,
  scoreView,
  statusView,
  travelView,
  type AlertView,
  type BeginnerView,
  type DayWeatherView,
  type EventView,
  type ExpenseView,
  type ForecastSnowView,
  type MyPassView,
  type OpeningView,
  type PassBadgeView,
  type ScoreView,
  type SnowView,
  type StatusView,
  type TravelView,
} from './views'

export interface ResortIdentity {
  id: string
  name: string
  shortName: string
  region: string
  locality: string | null
  stateProvince: string | null
  country: string
  timezone: string
  lat: number
  lon: number
  priority: number
  operator: string | null
  baseElevationM: number | null
  summitElevationM: number | null
  verticalM: number | null
  /** Licensed photo, or null → designed placeholder. Never invented. */
  photo: ResortRow['photo']
  locationProv: Provenance | null
  elevationProv: Provenance | null
}

export interface ResortFreshness {
  statusAt: string | null
  reportPublishedAt: string | null
  reportFetchedAt: string | null
  weatherFetchedAt: string | null
  assessmentComputedAt: string | null
  seasonCheckedAt: string | null
  catalogCheckedOn: string | null
}

export interface ResortSummary extends ResortIdentity {
  /** The resort-local date the date-specific fields describe. */
  date: string
  mode: ScoringMode
  /** Resort-local today (app clock). */
  today: string
  isFavorite: boolean
  favoriteOrder: number | null
  status: StatusView
  opening: OpeningView
  /** Latest stored assessment for (date, mode); null → "No score yet". */
  score: ScoreView | null
  snow: SnowView
  /** Daily weather aggregates for the date at base and summit (modeled). */
  weather: DayWeatherView
  /** Family badges — discovery only, never an ownership or access claim. */
  passes: PassBadgeView[]
  /** Owned passes evaluated for the date. */
  myPass: MyPassView
  expense: ExpenseView
  travel: TravelView
  features: FeatureInfo | null
  beginner: BeginnerView
  fit: FitResult
  eventsInWindow: EventView[]
  officialAlerts: AlertView[]
  freshness: ResortFreshness
  dataGaps: string[]
  corrections: Correction[]
  /** Demo data: label everywhere. */
  demo: boolean
}

export interface SummaryOptions {
  /** Resort-local date (YYYY-MM-DD); defaults to the home "today". */
  date?: string
  /** Scoring mode; defaults to the user's preferred mode. */
  mode?: ScoringMode
  /** Restrict to these resorts. */
  ids?: readonly string[] | null
}

export function identityOf(r: ResortRow): ResortIdentity {
  return {
    id: r.id,
    name: r.name,
    shortName: r.shortName,
    region: r.region,
    locality: r.locality,
    stateProvince: r.stateProvince,
    country: r.country,
    timezone: r.timezone,
    lat: r.lat,
    lon: r.lon,
    priority: r.priority,
    operator: r.operator,
    baseElevationM: r.baseElevationM,
    summitElevationM: r.summitElevationM,
    verticalM: r.verticalM,
    photo: r.photo,
    locationProv: r.locationProv,
    elevationProv: r.elevationProv,
  }
}

const WEATHER_STALE_H = 12

/** Summaries for every resort (or `ids`) for one date. */
export async function listResortSummaries(ctx: DataCtx, opts: SummaryOptions = {}): Promise<ResortSummary[]> {
  const date = opts.date && isLocalDate(opts.date) ? opts.date : ctx.today
  const bundle = await loadBundle(ctx, { ids: opts.ids ?? null, seasons: [seasonIdFor(date)] })
  return buildSummaries(bundle, { date, mode: opts.mode ?? ctx.prefs.scoringMode })
}

/** Build summaries from an already-loaded bundle (shared with Today and the resort page). */
export async function buildSummaries(b: Bundle, opts: { date: string; mode: ScoringMode }): Promise<ResortSummary[]> {
  const { db, now } = b.ctx
  const { date, mode } = opts
  const resortIds = b.resorts.map((r) => r.row.id)
  if (!resortIds.length) return []
  const runs = [...b.runs.values()].flatMap((m) => [...m.values()])

  // One window covering the local date in every resort timezone involved (+1 h for preceding-hour stamps).
  const zones = [...new Set(b.resorts.map((r) => r.row.timezone))]
  const from = zones.map((z) => startOfLocalDay(date, z)).sort()[0]
  const to = zones.map((z) => endOfLocalDay(date, z)).sort().reverse()[0]
  const toPlus = new Date(Date.parse(to) + 3_600_000).toISOString()

  const [reports, assessments, snow, dayPoints] = await Promise.all([
    latestReports(db, { date, now, live: b.live, resortIds }),
    latestAssessments(db, { dates: [date], modes: [mode], now, live: b.live, resortIds }),
    forecastSnowSums(db, runs, now, [72, 168]),
    pointsForRuns(
      db,
      runs.map((r) => r.id),
      from,
      toPlus,
    ),
  ])
  const connectors = providerStatus()
  const reportAdapters = new Map(connectors.filter((c) => c.role === 'resort-report' && c.resortId).map((c) => [c.resortId!, c]))

  return b.resorts.map(({ row: r, corrections }) => {
    const today = resortToday(r, now)
    const report = reports.get(r.id)
    const event = b.status.get(r.id)
    const status = statusView(r, event, report, now)
    const season = b.seasons.get(`${r.id}|${b.seasonId}`)
    const opening = openingView(season, b.seasonId, today)
    const score = scoreView(assessments.get(assessmentKey(r.id, date, mode)))
    const pointRuns = b.runs.get(r.id) ?? new Map()

    const forecastFor = (key: string): ForecastSnowView | null => {
      const run = pointRuns.get(key)
      if (!run) return null
      const sums = snow.get(run.id)!
      return { pointKey: key, next72h: sums[72], next7d: sums[168], run: runMeta(run, now) }
    }
    const dayAgg = (key: string) => {
      const run = pointRuns.get(key)
      const pts = run ? dayPoints.get(run.id) : undefined
      if (!run || !pts?.length) return null
      const agg = aggregateDay(prepareSeries(pts, run.intervalSemantics ?? 'preceding-hour'), date, r.timezone)
      return agg.hoursCovered > 0 ? agg : null
    }
    const weather: DayWeatherView = {
      date,
      base: dayAgg('base'),
      summit: dayAgg('summit'),
      baseRun: pointRuns.get('base') ? runMeta(pointRuns.get('base')!, now) : null,
      summitRun: pointRuns.get('summit') ? runMeta(pointRuns.get('summit')!, now) : null,
    }

    const verdicts = ownedVerdicts(b, r.id, date)
    const myPass = myPassView(verdicts.map((v) => v.verdict))
    const bestCanSki = verdicts.map((v) => v.verdict).find((v) => v.canSki) ?? null
    const basketPass = bestCanSki ?? (myPass.verdicts[0] ?? null)
    const basket = dayBasket(b, r.id, date, basketPass)
    const expense = expenseView(basket)
    const travel = travelView(b, r.id)
    const fit = fitView(b, r, travel, basket)
    const badges = passBadges(b, r.id)
    const win = eventWindow(date, 3)
    const eventsInWindow = eventsOverlapping(b.events, new Set([r.id]), win.from, win.to)
    const officialAlerts = (b.alerts.get(r.id) ?? []).map((a) => alertView(a, now))
    const weatherFetchedAt = [pointRuns.get('base')?.fetchedAt, pointRuns.get('summit')?.fetchedAt].filter((x): x is string => !!x).sort().reverse()[0] ?? null

    // Honest gaps, most decision-relevant first.
    const gaps: string[] = []
    if (status.status === 'unknown') gaps.push(event && status.note ? `Operating status unavailable — ${status.note}` : 'Operating status unavailable — nothing recorded yet')
    const adapter = reportAdapters.get(r.id)
    if (!adapter) gaps.push('No official report adapter — manual entries only')
    else if (adapter.state === 'unverified') gaps.push('Official report adapter is unverified — the parser may fail')
    else if (adapter.state === 'disabled') gaps.push('Official report adapter is disabled')
    if (!report) gaps.push('No snow report on file')
    if (!pointRuns.size) gaps.push('Weather not fetched yet')
    else if (weatherFetchedAt && hoursBetween(weatherFetchedAt, now) > WEATHER_STALE_H) gaps.push(`Weather data is ${Math.round(hoursBetween(weatherFetchedAt, now))} h old`)
    if (!score) gaps.push('No conditions score yet for this date')
    const seasonTxt = seasonLabel(b.seasonId)
    if (!badges.length) gaps.push(`No pass access recorded for ${seasonTxt}`)
    else if (badges.some((x) => !x.confirmed)) gaps.push(`Pass access unconfirmed for ${seasonTxt}`)
    if (myPass.status === 'unconfirmed') gaps.push(`Access with your ${myPass.productName} is not confirmed`)
    if (expense.tier === 'incomplete') gaps.push(`Cost estimate incomplete${expense.requiredMissing.length ? `: ${expense.requiredMissing.join(' ')}` : ''}`)
    if (opening.label === 'not-announced') gaps.push(`Opening date for ${seasonTxt} not announced`)
    if (travel.driveMinutes !== null && travel.isEstimate) gaps.push('Drive time is a curated estimate, not live routing')
    if (travel.driveMinutes === null && !travel.airports.length) gaps.push('No travel information recorded')
    const research = catalogResearchGap(r)
    if (research) gaps.push(research)

    return {
      ...identityOf(r),
      date,
      mode,
      today,
      isFavorite: b.favorites.has(r.id),
      favoriteOrder: b.favorites.get(r.id)?.sortOrder ?? null,
      status,
      opening,
      score,
      snow: { report: reportView(report, now), forecast: { base: forecastFor('base'), summit: forecastFor('summit') } },
      weather,
      passes: badges,
      myPass,
      expense,
      travel,
      features: r.features,
      beginner: beginnerView(r),
      fit,
      eventsInWindow,
      officialAlerts,
      freshness: {
        statusAt: status.lastConfirmedAt ?? status.since,
        reportPublishedAt: report?.reportedAt ?? null,
        reportFetchedAt: report?.fetchedAt ?? null,
        weatherFetchedAt,
        assessmentComputedAt: score?.computedAt ?? null,
        seasonCheckedAt: season?.lastCheckedAt ?? null,
        catalogCheckedOn: r.research?.date ?? null,
      },
      dataGaps: gaps,
      corrections,
      demo: !b.live,
    }
  })
}

/** Convenience: a single resort's summary (null when the id is unknown). */
export async function getResortSummary(ctx: DataCtx, id: string, opts: Omit<SummaryOptions, 'ids'> = {}): Promise<ResortSummary | null> {
  const [s] = await listResortSummaries(ctx, { ...opts, ids: [id] })
  return s ?? null
}
