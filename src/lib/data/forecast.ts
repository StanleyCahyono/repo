/**
 * Forecast page read models.
 *
 * - getForecast: hourly next 48 h and a daily outlook (≤ 16 days) from the latest successful primary run per
 *   resort and point. Days 8–16 appear only when the provider actually returned them and are flagged `trend`.
 *   Everything here is modeled weather — never "observed".
 * - getHistoryCalendar: per resort-local day of a month — what was reported, what was forecast THEN (the latest
 *   stored run fetched before that day started; never recomputed from later data), what Piste estimated then (the
 *   latest assessment computed before the day), values reported later, and honest gaps (including the days before
 *   tracking started).
 */
import 'server-only'
import { and, eq, gte, inArray, lt, lte, min, or, sql, type SQL } from 'drizzle-orm'
import { DateTime } from 'luxon'
import * as s from '@/lib/db/schema'
import type { ConditionsAssessmentRow, OperationalReportRow, ResortRow, WeatherRunRow } from '@/lib/db/rows'
import { aggregateDay, prepareSeries, type DailyWeatherAggregate } from '@/lib/domain/conditions'
import type { HourlyWeather } from '@/lib/providers/types'
import { addDays, addHours, dateRange, endOfLocalDay, formatInstant, hoursBetween, isoWeekday, localDateOf, startOfLocalDay } from '@/lib/domain/time'
import type { Confidence, ScoreKind, ScoringMode, SnowfallReading, SurfaceInterpretation } from '@/lib/domain/types'
import {
  floorHour,
  groupBy,
  isLive,
  latestRuns,
  loadResortRows,
  NOT_PERSONAL_REPORT,
  NOT_UNVERIFIED_RESEARCH,
  pointsForRuns,
  resortToday,
  toHourly,
  type DataCtx,
} from './core'
import { assessmentThenPick, FORECAST_KEPT_FROM_META, forecastThenHours, forecastThenPick, HISTORY_POINTS, historyRunsFrom, runSemantics } from './deps'
import { reportView, runMeta, type ReportView, type RunMeta } from './views'

export type PointKey = 'base' | 'summit'
export const FORECAST_HOURS = 48
export const MAX_FORECAST_DAYS = 16
/** Days at or beyond this index (0 = today) are a less certain trend. */
export const TREND_FROM_DAY = 7

export interface HourView extends HourlyWeather {
  /** Resort-local date and time of the stamp. */
  localDate: string
  localTime: string
}

export interface DayView extends DailyWeatherAggregate {
  /** 0 = resort-local today. */
  dayIndex: number
  /** Days 8–16: less certain trend (shown only because the provider returned them). */
  trend: boolean
  /** Fewer hours than the local day has. */
  partial: boolean
}

export interface ResortForecast {
  resortId: string
  name: string
  shortName: string
  timezone: string
  today: string
  /** The point requested. */
  point: PointKey
  /** The point actually shown (falls back to the other point when the requested one has no run). */
  shownPoint: PointKey | null
  fallbackFrom: PointKey | null
  run: RunMeta | null
  runs: { base: RunMeta | null; summit: RunMeta | null }
  hourly: HourView[]
  daily: DayView[]
  limitations: string[]
  kind: 'modeled' | 'observed' | 'demo' | null
}

export interface ForecastView {
  now: string
  point: PointKey
  resorts: ResortForecast[]
  notes: string[]
}

const loadResorts = (ctx: DataCtx, ids: readonly string[]): Promise<ResortRow[]> => loadResortRows(ctx, ids)

function hourView(h: HourlyWeather, tz: string): HourView {
  return { ...h, localDate: localDateOf(h.validTime, tz), localTime: formatInstant(h.validTime, tz, 'HH:mm') }
}

/** Forecast series for several resorts (e.g. favourites to compare) at one point. */
export async function getForecast(ctx: DataCtx, resortIds: readonly string[], opts: { point?: PointKey } = {}): Promise<ForecastView> {
  const point = opts.point ?? 'base'
  const resorts = await loadResorts(ctx, resortIds)
  const runsBy = await latestRuns(ctx.db, ctx.now, isLive(ctx), resorts.map((r) => r.id))
  const chosen = new Map<string, { run: WeatherRunRow; shown: PointKey; fallback: PointKey | null }>()
  for (const r of resorts) {
    const m = runsBy.get(r.id)
    const other: PointKey = point === 'base' ? 'summit' : 'base'
    const run = m?.get(point) ?? m?.get(other) ?? null
    if (run) chosen.set(r.id, { run, shown: m?.get(point) ? point : other, fallback: m?.get(point) ? null : point })
  }
  const earliest = resorts.map((r) => startOfLocalDay(resortToday(r, ctx.now), r.timezone)).sort()[0] ?? ctx.now
  const latest = addHours(ctx.now, (MAX_FORECAST_DAYS + 2) * 24)
  const points = await pointsForRuns(
    ctx.db,
    [...chosen.values()].map((c) => c.run.id),
    addHours(earliest, -1),
    latest,
  )
  const hourFrom = floorHour(ctx.now)
  const hourTo = addHours(hourFrom, FORECAST_HOURS)

  const out: ResortForecast[] = resorts.map((r) => {
    const today = resortToday(r, ctx.now)
    const m = runsBy.get(r.id)
    const c = chosen.get(r.id)
    const runs = { base: m?.get('base') ? runMeta(m.get('base')!, ctx.now) : null, summit: m?.get('summit') ? runMeta(m.get('summit')!, ctx.now) : null }
    const limitations: string[] = []
    if (!c) {
      limitations.push('Weather not fetched yet — no forecast to show')
      return { resortId: r.id, name: r.name, shortName: r.shortName, timezone: r.timezone, today, point, shownPoint: null, fallbackFrom: null, run: null, runs, hourly: [], daily: [], limitations, kind: null }
    }
    const pts = points.get(c.run.id) ?? []
    const series = prepareSeries(pts, runSemantics(c.run))
    const hourly = pts.filter((h) => h.validTime >= hourFrom && h.validTime <= hourTo).map((h) => hourView(h, r.timezone))
    const daily: DayView[] = []
    for (let i = 0; i < MAX_FORECAST_DAYS; i++) {
      const date = addDays(today, i)
      const agg = aggregateDay(series, date, r.timezone)
      if (agg.hoursCovered === 0) continue
      daily.push({ ...agg, dayIndex: i, trend: i >= TREND_FROM_DAY, partial: !agg.complete })
    }
    if (c.fallback) limitations.push(`No ${c.fallback} forecast stored — showing the ${c.shown} point`)
    if (daily.some((d) => d.trend)) limitations.push(`Days ${TREND_FROM_DAY + 1}–${MAX_FORECAST_DAYS} are a less certain trend`)
    const age = hoursBetween(c.run.fetchedAt, ctx.now)
    if (age > 12) limitations.push(`Forecast fetched ${Math.round(age)} h ago`)
    if (c.run.prov?.note) limitations.push(c.run.prov.note)
    limitations.push('Modeled weather for a grid cell — it does not resolve individual slopes')
    return {
      resortId: r.id,
      name: r.name,
      shortName: r.shortName,
      timezone: r.timezone,
      today,
      point,
      shownPoint: c.shown,
      fallbackFrom: c.fallback,
      run: runMeta(c.run, ctx.now),
      runs,
      hourly,
      daily,
      limitations,
      kind: c.run.kind === 'observed' ? 'observed' : c.run.kind === 'demo' ? 'demo' : 'modeled',
    }
  })
  return {
    now: ctx.now,
    point,
    resorts: out,
    notes: ['Forecasts are weather-model output (modeled), not observations.', 'Dates beyond the provider horizon have no forecast.'],
  }
}

// ---------------------------------------------------------------------------
// History calendar

export interface DayForecastThen {
  runId: number
  provider: string
  fetchedAt: string
  modelRunAt: string | null
  /** Hours between retrieval and the start of the day. */
  leadHours: number
  snowfallCm: number | null
  rainMm: number | null
  tempMinC: number | null
  tempMaxC: number | null
  windMaxKmh: number | null
  gustMaxKmh: number | null
  coverage: number
  complete: boolean
}

export interface AssessmentThen {
  id: number
  mode: ScoringMode
  score: number | null
  scoreKind: ScoreKind
  descriptor: string | null
  confidence: Confidence
  surface: SurfaceInterpretation
  computedAt: string
  leadDays: number | null
  modelVersion: string
}

export interface LaterReported {
  source: 'later-revision' | 'next-day-report'
  localDate: string
  reportedAt: string | null
  window: SnowfallReading['window'] | null
  amountCm: number | null
  note: string
}

export type HistoryDayState = 'before-tracking' | 'tracked' | 'today' | 'future'

export interface HistoryDay {
  date: string
  weekday: number
  state: HistoryDayState
  /** The report for the day as published by the end of that day (latest revision then). */
  report: ReportView | null
  revisions: number
  forecastThen: { base: DayForecastThen | null; summit: DayForecastThen | null }
  assessmentThen: AssessmentThen | null
  laterReported: LaterReported[]
  /** A tracked day with no stored evidence at all. */
  gap: boolean
  notes: string[]
}

export interface HistoryCalendar {
  resortId: string
  name: string
  timezone: string
  month: string
  mode: ScoringMode
  trackingStart: string | null
  trackingStartBasis: 'recorded' | 'first-data' | 'none'
  days: HistoryDay[]
  /** Tracked dates with no data. */
  gaps: string[]
  notes: string[]
}

async function trackingStart(ctx: DataCtx, resort: ResortRow): Promise<{ date: string | null; basis: HistoryCalendar['trackingStartBasis'] }> {
  const { db } = ctx
  const live = isLive(ctx)
  const meta = await db
    .select()
    .from(s.appMeta)
    .where(inArray(s.appMeta.key, [`tracking.start.${resort.id}`, 'tracking.start']))
  const recorded = meta.find((m) => m.key === `tracking.start.${resort.id}`) ?? meta.find((m) => m.key === 'tracking.start')
  if (recorded?.value) {
    const v = recorded.value
    const date = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : DateTime.fromISO(v).isValid ? localDateOf(v, resort.timezone) : null
    if (date) return { date, basis: 'recorded' }
  }
  const [run, rep, ass] = await Promise.all([
    db
      .select({ v: min(s.weatherRuns.fetchedAt) })
      .from(s.weatherRuns)
      .where(
        and(
          eq(s.weatherRuns.resortId, resort.id),
          eq(s.weatherRuns.status, 'ok'),
          lte(s.weatherRuns.fetchedAt, ctx.now),
          live ? sql`${s.weatherRuns.kind} <> 'demo' and ${s.weatherRuns.provider} <> 'demo'` : undefined,
        ),
      ),
    // Operations evidence only (personal feedback is not tracking), and only what was published by `now`.
    db
      .select({ v: min(s.operationalReports.localDate) })
      .from(s.operationalReports)
      .where(
        and(
          eq(s.operationalReports.resortId, resort.id),
          NOT_PERSONAL_REPORT,
          NOT_UNVERIFIED_RESEARCH,
          sql`(${s.operationalReports.reportedAt} is null or ${s.operationalReports.reportedAt} <= ${ctx.now})`,
          lte(s.operationalReports.createdAt, ctx.now),
          live ? sql`${s.operationalReports.kind} <> 'demo'` : undefined,
        ),
      ),
    db
      .select({ v: min(s.conditionsAssessments.computedAt) })
      .from(s.conditionsAssessments)
      .where(and(eq(s.conditionsAssessments.resortId, resort.id), lte(s.conditionsAssessments.computedAt, ctx.now), live ? sql`${s.conditionsAssessments.kind} <> 'demo'` : undefined)),
  ])
  const candidates = [run[0]?.v ? localDateOf(run[0].v, resort.timezone) : null, rep[0]?.v ?? null, ass[0]?.v ? localDateOf(ass[0].v, resort.timezone) : null].filter(
    (x): x is string => !!x,
  )
  if (!candidates.length) return { date: null, basis: 'none' }
  return { date: candidates.sort()[0], basis: 'first-data' }
}

function reportTime(r: OperationalReportRow): string {
  return r.reportedAt ?? r.createdAt
}

/** The history calendar for one resort and month ('YYYY-MM'). */
export async function getHistoryCalendar(ctx: DataCtx, resortId: string, month: string, opts: { mode?: ScoringMode } = {}): Promise<HistoryCalendar | null> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Invalid month: ${month}`)
  const [resort] = await loadResorts(ctx, [resortId])
  if (!resort) return null
  const { db, now } = ctx
  const live = isLive(ctx)
  const tz = resort.timezone
  const mode = opts.mode ?? ctx.prefs.scoringMode
  const first = `${month}-01`
  const last = DateTime.fromISO(first, { zone: 'UTC' }).endOf('month').toISODate()!
  const dates = dateRange(first, last)
  const today = resortToday(resort, now)

  const runWindowFrom = historyRunsFrom(month, tz)
  const runWindowTo = startOfLocalDay(addDays(last, 1), tz)
  const [tracking, keptFromRow, reports, runs, assessments] = await Promise.all([
    trackingStart(ctx, resort),
    // Set by the prune when this resort's older forecast-then is not kept (PISTE_WEATHER_HISTORY_DAYS).
    db.select({ v: s.appMeta.value }).from(s.appMeta).where(eq(s.appMeta.key, FORECAST_KEPT_FROM_META + resortId)),
    db
      .select()
      .from(s.operationalReports)
      .where(
        and(
          eq(s.operationalReports.resortId, resortId),
          gte(s.operationalReports.localDate, first),
          lte(s.operationalReports.localDate, addDays(last, 1)),
          sql`(${s.operationalReports.reportedAt} is null or ${s.operationalReports.reportedAt} <= ${now})`,
          NOT_PERSONAL_REPORT,
          NOT_UNVERIFIED_RESEARCH,
          live ? sql`${s.operationalReports.kind} <> 'demo'` : undefined,
        ),
      ),
    db
      .select()
      .from(s.weatherRuns)
      .where(
        and(
          eq(s.weatherRuns.resortId, resortId),
          eq(s.weatherRuns.status, 'ok'),
          gte(s.weatherRuns.fetchedAt, runWindowFrom),
          lt(s.weatherRuns.fetchedAt, runWindowTo),
          lte(s.weatherRuns.fetchedAt, now),
          live ? sql`${s.weatherRuns.kind} <> 'demo' and ${s.weatherRuns.provider} <> 'demo'` : undefined,
        ),
      ),
    db
      .select()
      .from(s.conditionsAssessments)
      .where(
        and(
          eq(s.conditionsAssessments.resortId, resortId),
          eq(s.conditionsAssessments.mode, mode),
          gte(s.conditionsAssessments.localDate, first),
          lte(s.conditionsAssessments.localDate, last),
          lte(s.conditionsAssessments.computedAt, now),
          live ? sql`${s.conditionsAssessments.kind} <> 'demo'` : undefined,
        ),
      ),
  ])

  // Forecast-then: per day and point, the primary run fetched most recently BEFORE the local day started (the rule and
  // the hours read are shared with the prune job, which keeps exactly these).
  const picks: { date: string; point: PointKey; run: WeatherRunRow; from: string; to: string }[] = []
  const runsByPoint = groupBy(runs, (r) => r.pointKey)
  const keptFrom = keptFromRow[0]?.v ?? null
  const notKept = (date: string) => !!keptFrom && date < keptFrom
  for (const date of dates) {
    if (date > today || notKept(date)) continue
    for (const point of HISTORY_POINTS) {
      const run = forecastThenPick(runsByPoint.get(point) ?? [], date, tz)
      if (run) picks.push({ date, point, run, ...forecastThenHours(date, tz) })
    }
  }
  const pointRows = new Map<string, HourlyWeather[]>()
  for (let i = 0; i < picks.length; i += 40) {
    const part = picks.slice(i, i + 40)
    const conds: SQL[] = part.map((p) => and(eq(s.weatherPoints.runId, p.run.id), gte(s.weatherPoints.validTime, p.from), lte(s.weatherPoints.validTime, p.to))!)
    const rows = await db
      .select()
      .from(s.weatherPoints)
      .where(or(...conds))
    for (const p of part) {
      const list = rows.filter((r) => r.runId === p.run.id && r.validTime >= p.from && r.validTime <= p.to).sort((a, b) => a.validTime.localeCompare(b.validTime))
      pointRows.set(`${p.date}|${p.point}`, list.map(toHourly))
    }
  }

  const reportsByDate = groupBy(reports, (r) => r.localDate)
  const assessByDate = groupBy(assessments, (a) => a.localDate)
  const days: HistoryDay[] = dates.map((date) => {
    const dayStart = startOfLocalDay(date, tz)
    const dayEnd = endOfLocalDay(date, tz)
    const state: HistoryDayState =
      date > today ? 'future' : date === today ? 'today' : !tracking.date || date < tracking.date ? 'before-tracking' : 'tracked'
    const notes: string[] = []
    if (state === 'future') {
      return { date, weekday: isoWeekday(date), state, report: null, revisions: 0, forecastThen: { base: null, summit: null }, assessmentThen: null, laterReported: [], gap: false, notes }
    }
    const dayReports = (reportsByDate.get(date) ?? []).sort((a, b) => a.revision - b.revision || a.id - b.id)
    const asReported = dayReports.filter((r) => reportTime(r) < dayEnd)
    const report = asReported[asReported.length - 1]
    const later: LaterReported[] = dayReports
      .filter((r) => reportTime(r) >= dayEnd)
      .map((r) => ({
        source: 'later-revision' as const,
        localDate: r.localDate,
        reportedAt: r.reportedAt,
        window: null,
        amountCm: null,
        note: `Revision ${r.revision} published after the day ended`,
      }))
    const next = (reportsByDate.get(addDays(date, 1)) ?? []).sort((a, b) => a.revision - b.revision || a.id - b.id)[0]
    if (next) {
      for (const w of ['overnight', '24h'] as const) {
        const hit = next.snowfall.find((x) => x.window === w)
        if (hit) {
          later.push({
            source: 'next-day-report',
            localDate: next.localDate,
            reportedAt: next.reportedAt,
            window: w,
            amountCm: hit.amountCm,
            note: `Next morning's report: ${w} snowfall${hit.sourceText ? ` ("${hit.sourceText}")` : ''} — its window may not match this local day exactly`,
          })
        }
      }
    }

    const then = (point: PointKey): DayForecastThen | null => {
      const pick = picks.find((p) => p.date === date && p.point === point)
      if (!pick) return null
      const pts = pointRows.get(`${date}|${point}`) ?? []
      const agg = aggregateDay(prepareSeries(pts, runSemantics(pick.run)), date, tz)
      if (agg.hoursCovered === 0) {
        notes.push(`The last ${point} run before this day (${pick.run.fetchedAt}) did not cover it`)
        return null
      }
      return {
        runId: pick.run.id,
        provider: pick.run.provider,
        fetchedAt: pick.run.fetchedAt,
        modelRunAt: pick.run.modelRunAt,
        leadHours: Math.round(hoursBetween(pick.run.fetchedAt, dayStart) * 10) / 10,
        snowfallCm: agg.snowfallCm,
        rainMm: agg.rainMm,
        tempMinC: agg.tempMinC,
        tempMaxC: agg.tempMaxC,
        windMaxKmh: agg.windMaxKmh,
        gustMaxKmh: agg.gustMaxKmh,
        coverage: agg.coverage,
        complete: agg.complete,
      }
    }
    const forecastThen = { base: then('base'), summit: then('summit') }

    const a: ConditionsAssessmentRow | undefined = assessmentThenPick(assessByDate.get(date) ?? [], dayStart)
    const assessmentThen: AssessmentThen | null = a
      ? { id: a.id, mode: a.mode, score: a.score, scoreKind: a.scoreKind, descriptor: a.descriptor, confidence: a.confidence, surface: a.surface, computedAt: a.computedAt, leadDays: a.leadDays, modelVersion: a.modelVersion }
      : null

    const tracked = state === 'tracked' || state === 'today'
    // A day whose forecast-then was deliberately not kept is not a collection gap.
    const gap = state === 'tracked' && !notKept(date) && !report && !forecastThen.base && !forecastThen.summit && !assessmentThen && !later.length
    if (state === 'before-tracking') notes.push('Before tracking started — no history is shown for this day')
    if (tracked && notKept(date)) notes.push('Forecast-then for this day is not kept (older history is kept for favourites and trip resorts)')
    if (tracked && !report) notes.push('No report stored for this day')
    return {
      date,
      weekday: isoWeekday(date),
      state,
      report: reportView(report, now, tz),
      revisions: dayReports.length,
      forecastThen,
      assessmentThen,
      laterReported: later,
      gap,
      notes,
    }
  })

  return {
    resortId,
    name: resort.name,
    timezone: tz,
    month,
    mode,
    trackingStart: tracking.date,
    trackingStartBasis: tracking.basis,
    days,
    gaps: days.filter((d) => d.gap).map((d) => d.date),
    notes: [
      'Forecast-then is the stored run fetched before the day started; it is never recomputed from later data.',
      'For older days only the run and hours used here are kept; other runs are pruned.',
      ...(keptFrom && first < keptFrom
        ? [`Forecast-then before ${keptFrom} is not kept for this resort — favourites and resorts in a trip keep their whole history.`]
        : []),
    ],
  }
}
