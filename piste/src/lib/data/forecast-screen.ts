/**
 * Forecast screen read model — one call for /forecast. Wraps getForecast / getHistoryCalendar (forecast.ts) and adds
 * what the screen needs around them:
 *
 * - the resort picker catalogue (favourites first) and the resolved comparison set (≤ 4);
 * - per selected resort: configured weather points (what Piste requests), useful official links and whether an
 *   official alert feed covers it (NWS: US only);
 * - weather potential per resort-local day from STORED assessments (never recomputed here), with a confirmed closure
 *   replacing the score ("Closed"), exactly like Today and Explore;
 * - official alerts for the chosen resorts (shown independently of any score) and when alerts were last checked;
 * - per-resort weather fetch health: the last successful run and any failed attempt since (a failure never counts as
 *   an update);
 * - planning facts (status, opening/closing, pass families, your pass on the date) for dates beyond the forecast.
 */
import 'server-only'
import { and, desc, eq, lte, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { ComponentResult } from '@/lib/db/schema'
import { addDays, dateRange, isLocalDate, seasonIdsForDates } from '@/lib/domain/time'
import type { AppMode, Confidence, DataKind, Eligibility, Provenance, ScoreKind, ScoringMode, SurfaceInterpretation, UnitPrefs } from '@/lib/domain/types'
import {
  assessmentKey,
  currentReports,
  isLive,
  latestAssessments,
  latestRuns,
  loadBundle,
  loadResortRows,
  resortHemisphere,
  resortSeasonFor,
  resortToday,
  seasonLabel,
  seasonRowFor,
  type DataCtx,
} from './core'
import { lastAttemptRun, lastSuccess } from './deps'
import { getForecast, getHistoryCalendar, MAX_FORECAST_DAYS, type ForecastView, type HistoryCalendar, type PointKey } from './forecast'
import {
  alertView,
  applyClosure,
  closureView,
  myPassView,
  openingView,
  ownedVerdicts,
  passBadges,
  scoreView,
  statusStatement,
  statusView,
  type AlertView,
  type ClosureView,
  type MyPassView,
  type OpeningView,
  type PassBadgeView,
  type StatusView,
} from './views'

export const MAX_COMPARE = 4

/** The provider error-kind prefix jobs store before the message ("http: Open-Meteo: HTTP 403"). */
const ERROR_KIND_PREFIX = /^(timeout|http|network|parse|schema-changed|unsupported|not-configured|rate-limited):\s*/

/** Official alert feeds Piste reads (NWS / api.weather.gov) cover US locations only. */
const ALERT_COUNTRIES = new Set(['US'])

export interface ForecastScreenOptions {
  /** Requested resort ids; null = favourites; [] = explicitly none. */
  resorts: readonly string[] | null
  focus: string | null
  point: PointKey
  /** Selected resort-local date (any date: past, forecast or beyond). */
  date: string | null
  /** History month 'YYYY-MM'. */
  month: string | null
  mode: ScoringMode | null
}

export interface PickerResort {
  id: string
  name: string
  shortName: string
  region: string
  stateProvince: string | null
  country: string
  timezone: string
  isFavorite: boolean
  favoriteOrder: number | null
  /** A successful weather run is stored. */
  hasForecast: boolean
}

/** Catalog facts about a selected resort that the screen shows around the forecast. */
export interface ResortInfo {
  id: string
  name: string
  shortName: string
  timezone: string
  /** Resort-local today. */
  today: string
  country: string
  /** Resort reference location (catalog). */
  lat: number
  lon: number
  /** Configured weather points — what Piste requests from the providers (elevations in metres). */
  points: { key: string; label: string; lat: number; lon: number; elevationM: number | null }[]
  links: {
    official: string | null
    snowReport: string | null
    avalanche: string | null
    roadInfo: string | null
  }
  alerts: {
    /** An official alert feed Piste reads covers this location. */
    covered: boolean
    /** Last successful alerts check covering this resort (a failed check never advances it). */
    checkedAt: string | null
  }
}

export interface DayPotential {
  date: string
  score: number | null
  scoreKind: ScoreKind
  descriptor: string | null
  confidence: Confidence
  confidenceReasons: string[]
  eligibility: Eligibility
  coverage: number
  surface: SurfaceInterpretation
  components: ComponentResult[]
  explanation: string[]
  leadDays: number | null
  computedAt: string
  modelVersion: string
  kind: DataKind
  prov: Provenance
  /** A confirmed closure replaced the score for this date. */
  closure: { reason: string } | null
}

export interface WeatherHealth {
  /** Fetch time of the newest successful run (any point). A failed attempt never advances it. */
  lastOkAt: string | null
  /** The newest failed attempt, when it is newer than the last success. */
  lastFailure: { at: string; provider: string; pointKey: string; error: string | null } | null
}

export interface PlanningView {
  resortId: string
  /** The date the planning facts describe. */
  date: string
  seasonId: string
  seasonLabel: string
  status: StatusView
  opening: OpeningView
  /** Confirmed closure on `date`, if any. */
  closure: ClosureView | null
  /** Pass families (discovery only). */
  passes: PassBadgeView[]
  /** Your owned products evaluated for `date`. */
  myPass: MyPassView
}

export interface JobHealth {
  lastAttemptAt: string | null
  lastAttemptStatus: string | null
  lastAttemptError: string | null
  lastSuccessAt: string | null
}
/** @deprecated use JobHealth */
export type WeatherJobHealth = JobHealth

export interface ForecastScreen {
  mode: AppMode
  now: string
  homeToday: string
  homeTimezone: string
  units: UnitPrefs
  scoringMode: ScoringMode
  point: PointKey
  catalog: PickerResort[]
  selected: string[]
  selectionBasis: 'url' | 'favourites' | 'none'
  /** Ids in the URL that are not in the catalogue. */
  unknownIds: string[]
  focus: string | null
  resorts: Record<string, ResortInfo>
  forecast: ForecastView
  potentials: Record<string, DayPotential[]>
  health: Record<string, WeatherHealth>
  weatherJob: JobHealth
  alertsJob: JobHealth
  alerts: AlertView[]
  planning: Record<string, PlanningView>
  history: HistoryCalendar | null
  historyMonth: string | null
  selectedDate: string | null
}

function potentialOf(v: ReturnType<typeof scoreView>): DayPotential | null {
  if (!v) return null
  return {
    date: v.date,
    score: v.score,
    scoreKind: v.scoreKind,
    descriptor: v.descriptor,
    confidence: v.confidence,
    confidenceReasons: v.confidenceReasons,
    eligibility: v.eligibility,
    coverage: v.coverage,
    surface: v.surface,
    components: v.components,
    explanation: v.explanation,
    leadDays: v.leadDays,
    computedAt: v.computedAt,
    modelVersion: v.modelVersion,
    kind: v.kind,
    prov: v.prov,
    closure: v.supersededByClosure ? { reason: v.supersededByClosure.reason } : null,
  }
}

function jobHealth(attempt: { finishedAt: string | null; startedAt: string; status: string; error: string | null } | null, success: string | null): JobHealth {
  return {
    lastAttemptAt: attempt?.finishedAt ?? attempt?.startedAt ?? null,
    lastAttemptStatus: attempt?.status ?? null,
    lastAttemptError: attempt?.error ?? null,
    lastSuccessAt: success,
  }
}

export async function getForecastScreen(ctx: DataCtx, opts: ForecastScreenOptions): Promise<ForecastScreen> {
  const { db, now } = ctx
  const live = isLive(ctx)
  const mode = opts.mode ?? ctx.prefs.scoringMode

  // --- Catalogue and selection -------------------------------------------------
  const [rows, favRows, allRuns] = await Promise.all([loadResortRows(ctx, null), db.select().from(s.favorites), latestRuns(db, now, live, null)])
  const favs = new Map(favRows.map((f) => [f.resortId, f.sortOrder]))
  const catalog: PickerResort[] = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      shortName: r.shortName,
      region: r.region,
      stateProvince: r.stateProvince,
      country: r.country,
      timezone: r.timezone,
      isFavorite: favs.has(r.id),
      favoriteOrder: favs.get(r.id) ?? null,
      hasForecast: allRuns.has(r.id),
    }))
    .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || (a.favoriteOrder ?? 0) - (b.favoriteOrder ?? 0))
  const known = new Set(catalog.map((r) => r.id))
  let selected: string[]
  let selectionBasis: ForecastScreen['selectionBasis']
  let unknownIds: string[] = []
  if (opts.resorts !== null) {
    unknownIds = opts.resorts.filter((id) => !known.has(id))
    selected = [...new Set(opts.resorts.filter((id) => known.has(id)))].slice(0, MAX_COMPARE)
    selectionBasis = selected.length ? 'url' : 'none'
  } else {
    selected = catalog
      .filter((r) => r.isFavorite)
      .map((r) => r.id)
      .slice(0, MAX_COMPARE)
    selectionBasis = selected.length ? 'favourites' : 'none'
  }
  const focus = opts.focus && selected.includes(opts.focus) ? opts.focus : (selected[0] ?? null)
  const selectedDate = opts.date && isLocalDate(opts.date) ? opts.date : null

  // --- Forecast (modeled) + everything keyed by resort --------------------------
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const focusRow = focus ? (rowById.get(focus) ?? null) : null
  const focusToday = focusRow ? resortToday(focusRow, now) : ctx.today
  const historyMonth = focus ? (opts.month ?? (selectedDate && selectedDate < focusToday ? selectedDate.slice(0, 7) : focusToday.slice(0, 7))) : null

  const todays = selected.map((id) => resortToday(rowById.get(id)!, now)).sort()
  const dates = todays.length ? dateRange(todays[0], addDays(todays[todays.length - 1], MAX_FORECAST_DAYS - 1)) : []
  const planDate = selectedDate ?? ctx.today

  const w = s.weatherRuns
  const [forecast, assessments, history, bundle, failures, weatherAttempt, weatherSuccess, alertsAttempt, alertsSuccess, alertChecks] = await Promise.all([
    getForecast(ctx, selected, { point: opts.point }),
    latestAssessments(db, { dates, modes: [mode], now, live, resortIds: selected }),
    focus && historyMonth ? getHistoryCalendar(ctx, focus, historyMonth, { mode }) : Promise.resolve(null),
    selected.length ? loadBundle(ctx, { ids: selected, seasons: seasonIdsForDates([planDate, ...dates]) }) : Promise.resolve(null),
    // The newest failed attempt per resort: its error rows (one per point × provider, bounded).
    Promise.all(
      selected.map((id) =>
        db
          .select({ resortId: w.resortId, pointKey: w.pointKey, provider: w.provider, fetchedAt: w.fetchedAt, error: w.error })
          .from(w)
          .where(and(eq(w.resortId, id), eq(w.status, 'error'), lte(w.fetchedAt, now), live ? sql`${w.kind} <> 'demo' and ${w.provider} <> 'demo'` : undefined))
          .orderBy(desc(w.fetchedAt), desc(w.id))
          .limit(8)
          .then((rows) => rows.filter((r) => r.fetchedAt === rows[0]?.fetchedAt)),
      ),
    ).then((lists) => lists.flat()),
    lastAttemptRun(db, 'weather', null),
    lastSuccess(db, 'weather', null),
    lastAttemptRun(db, 'nws-alerts', null),
    lastSuccess(db, 'nws-alerts', null),
    Promise.all(selected.map((id) => lastSuccess(db, 'nws-alerts', id))),
  ])

  // Catalog facts per selected resort.
  const resorts: Record<string, ResortInfo> = {}
  selected.forEach((id, i) => {
    const r = rowById.get(id)!
    const covered = ALERT_COUNTRIES.has(r.country)
    resorts[id] = {
      id,
      name: r.name,
      shortName: r.shortName,
      timezone: r.timezone,
      today: resortToday(r, now),
      country: r.country,
      lat: r.lat,
      lon: r.lon,
      points: (r.weatherPoints ?? []).map((p) => ({ key: p.key, label: p.label, lat: p.lat, lon: p.lon, elevationM: p.elevationM })),
      links: {
        official: r.links?.official ?? null,
        snowReport: r.links?.snowReport ?? null,
        avalanche: r.links?.avalanche ?? null,
        roadInfo: r.links?.roadInfo ?? null,
      },
      alerts: { covered, checkedAt: alertChecks[i] ?? null },
    }
  })

  // Weather health per resort.
  const health: Record<string, WeatherHealth> = {}
  for (const id of selected) {
    const f = forecast.resorts.find((r) => r.resortId === id)
    const oks = [f?.runs.base?.fetchedAt, f?.runs.summit?.fetchedAt].filter((x): x is string => !!x).sort()
    const lastOkAt = oks[oks.length - 1] ?? null
    const fails = failures.filter((x) => x.resortId === id)
    const fail = fails[0]
    // One attempt fails per point and provider; report each distinct error once ("Open-Meteo: HTTP 403; NWS points: …").
    const errors = [...new Set(fails.map((x) => x.error?.replace(ERROR_KIND_PREFIX, '') ?? null).filter((e): e is string => !!e))]
    health[id] = {
      lastOkAt,
      lastFailure:
        fail && (!lastOkAt || fail.fetchedAt > lastOkAt)
          ? { at: fail.fetchedAt, provider: fail.provider, pointKey: fail.pointKey, error: errors.length ? errors.join('; ') : null }
          : null,
    }
  }

  // Planning facts + closure-aware weather potential.
  const planning: Record<string, PlanningView> = {}
  const potentials: Record<string, DayPotential[]> = {}
  if (bundle) {
    const reports = await currentReports(bundle)
    for (const id of selected) {
      const rec = bundle.byId.get(id)
      if (!rec) continue
      const r = rec.row
      const today = resortToday(r, now)
      const event = bundle.status.get(id)
      const report = reports.get(id)
      const st = statusStatement(event, report)
      // The resort's own season for each date (a Southern Hemisphere winter changes season on 1 January).
      const hemisphere = resortHemisphere(r)
      const seasonFor = (date: string) => seasonRowFor(bundle, r, date)
      const days = dateRange(today, addDays(today, MAX_FORECAST_DAYS - 1))
      potentials[id] = days
        .map((date) => potentialOf(applyClosure(scoreView(assessments.get(assessmentKey(id, date, mode))), closureView(st, seasonFor(date), date, hemisphere))))
        .filter((p): p is DayPotential => !!p)
      const planSeason = resortSeasonFor(r, planDate)
      planning[id] = {
        resortId: id,
        date: planDate,
        seasonId: planSeason,
        seasonLabel: seasonLabel(planSeason),
        status: statusView(r, event, report, now),
        opening: openingView(bundle.seasons.get(`${id}|${planSeason}`), planSeason, today),
        closure: closureView(st, seasonFor(planDate), planDate, hemisphere),
        passes: passBadges(bundle, id),
        myPass: myPassView(ownedVerdicts(bundle, id, planDate).map((v) => v.verdict)),
      }
    }
  }

  const alerts: AlertView[] = bundle
    ? selected
        .flatMap((id) => (bundle.alerts.get(id) ?? []).map((a) => alertView(a, now)))
        .sort((a, b) => (a.onset ?? '').localeCompare(b.onset ?? '') || a.resortId.localeCompare(b.resortId))
    : []

  return {
    mode: ctx.mode,
    now,
    homeToday: ctx.today,
    homeTimezone: ctx.prefs.homeTimezone,
    units: ctx.prefs.units,
    scoringMode: mode,
    point: opts.point,
    catalog,
    selected,
    selectionBasis,
    unknownIds,
    focus,
    resorts,
    forecast,
    potentials,
    health,
    weatherJob: jobHealth(weatherAttempt, weatherSuccess),
    alertsJob: jobHealth(alertsAttempt, alertsSuccess),
    alerts,
    planning,
    history,
    historyMonth,
    selectedDate,
  }
}
