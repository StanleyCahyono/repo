/**
 * Conditions assessments (Piste Conditions v1) for every resort, local days today−1 … forecast horizon (≤ 16 days),
 * all scoring modes.
 *
 * Inputs are assembled from the database: latest status statement known for the date, latest operations report
 * on or before the date (personal feedback is passed separately, never as an operations report), the latest
 * successful weather run per point from the primary provider, an alternate provider's daily snowfall when one is
 * stored, published lift hours, and official alerts.
 *
 * History: a new row is inserted only when the material result changed (fingerprint of the output plus the
 * report/status evidence it used). Earlier rows are never updated, so the history calendar can show what the app
 * estimated at the time. Weather-run ids are not part of the fingerprint — every refresh creates a new run, and a
 * row is written when the new weather actually changes the result.
 */
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  conditionsAssessments,
  favorites,
  operatingSchedules,
  operationalReports,
  resortSeasons,
  skiDayLogs,
  statusEvents,
  userPreferences,
  weatherAlerts,
} from '@/lib/db/schema'
import type {
  ConditionsAssessmentRow,
  OperatingScheduleRow,
  OperationalReportRow,
  ResortRow,
  ResortSeasonRow,
  StatusEventRow,
  WeatherRunRow,
} from '@/lib/db/rows'
import { aggregateDay, assessDay, prepareSeries, CONDITIONS_CONFIG_V1 } from '@/lib/domain/conditions'
import type { AssessDayInput, DayAssessment, OperationsEvidence, PersonalFeedback, PointWeather } from '@/lib/domain/conditions'
import { addDays, dateRange, isoWeekday, localDateOf, seasonIdFor } from '@/lib/domain/time'
import { SCORING_MODES, type ScoringMode, type UnitPrefs } from '@/lib/domain/types'
import type { OfficialAlert } from '@/lib/providers/types'
import { isPersonalReport } from './reports'
import { STOPPED_NOTE, type ItemOutcome, type JobContext, type JobWorkResult } from './types'
import { errorMessage, hashJson, selectResorts } from './util'
import { latestOkRuns, loadRunSeries, type StoredSeries } from './weather'

export const MAX_HORIZON_DAYS = 16
/** Providers whose runs are the primary forecast, in preference order; any other stored provider is an alternate. */
export const PRIMARY_WEATHER_PROVIDERS = ['open-meteo', 'demo'] as const

type Material = Pick<
  ConditionsAssessmentRow,
  'modelVersion' | 'scoreKind' | 'score' | 'descriptor' | 'coverage' | 'components' | 'surface' | 'confidence' | 'eligibility' | 'inputs' | 'kind'
>

/**
 * Fingerprint of what an assessment concluded and which report/status evidence it used. Excludes timestamps,
 * lead days, explanation/confidence wording (which mention ages) and weather-run ids.
 */
export function assessmentFingerprint(a: Material): string {
  const round = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000)
  return hashJson({
    v: a.modelVersion,
    k: a.kind,
    sk: a.scoreKind,
    s: a.score,
    d: a.descriptor,
    cov: round(a.coverage),
    comp: [...a.components].sort((x, y) => x.key.localeCompare(y.key)).map((c) => [c.key, round(c.value), round(c.weight), c.included]),
    surf: { t: [...a.surface.tags].sort(), b: a.surface.basis, r: [...a.surface.rules].sort() },
    conf: a.confidence,
    el: a.eligibility,
    rep: a.inputs.reportId,
    st: a.inputs.statusEventId,
  })
}

export function toAssessmentRow(resortId: string, a: DayAssessment, demo: boolean): typeof conditionsAssessments.$inferInsert {
  return {
    resortId,
    localDate: a.localDate,
    mode: a.mode,
    modelVersion: a.modelVersion,
    computedAt: a.computedAt,
    kind: demo ? 'demo' : 'derived',
    scoreKind: a.scoreKind,
    score: a.score,
    descriptor: a.descriptor,
    coverage: a.coverage,
    components: a.components,
    surface: a.surface,
    confidence: a.confidence,
    confidenceReasons: a.confidenceReasons,
    eligibility: a.eligibility,
    leadDays: a.leadDays,
    explanation: a.explanation,
    inputs: a.inputs,
  }
}

// ---------------------------------------------------------------------------
// Evidence loading

interface ResortEvidence {
  resort: ResortRow
  seasons: ResortSeasonRow[]
  events: StatusEventRow[]
  reports: OperationalReportRow[]
  personal: PersonalFeedback[]
  schedules: OperatingScheduleRow[]
  alerts: OfficialAlert[]
  primary: Map<string, StoredSeries>
  alternates: Map<string, StoredSeries>
}

function pointWeather(s: StoredSeries): PointWeather {
  const r = s.run
  return {
    pointKey: r.pointKey,
    kind: r.kind === 'observed' ? 'observed' : r.kind === 'demo' ? 'demo' : 'modeled',
    provider: r.prov?.provider ?? r.provider,
    model: r.model,
    intervalSemantics: s.semantics,
    fetchedAt: r.fetchedAt,
    modelRunAt: r.modelRunAt,
    elevationM: r.requestedElevationM ?? r.gridElevationM,
    horizonDays: r.horizonDays,
    hourly: s.hourly,
  }
}

function pickRuns(runs: Map<string, WeatherRunRow>): { primary: Map<string, WeatherRunRow>; alternates: Map<string, WeatherRunRow> } {
  const byPoint = new Map<string, WeatherRunRow[]>()
  for (const r of runs.values()) byPoint.set(r.pointKey, [...(byPoint.get(r.pointKey) ?? []), r])
  const primary = new Map<string, WeatherRunRow>()
  const alternates = new Map<string, WeatherRunRow>()
  const rank = (p: string) => {
    const i = (PRIMARY_WEATHER_PROVIDERS as readonly string[]).indexOf(p)
    return i === -1 ? 99 : i
  }
  for (const [point, list] of byPoint) {
    const sorted = [...list].sort((a, b) => rank(a.provider) - rank(b.provider) || (b.horizonDays ?? 0) - (a.horizonDays ?? 0) || b.fetchedAt.localeCompare(a.fetchedAt))
    primary.set(point, sorted[0])
    const alt = sorted.slice(1).find((r) => r.provider !== sorted[0].provider)
    if (alt) alternates.set(point, alt)
  }
  return { primary, alternates }
}

async function loadEvidence(db: Db, resort: ResortRow): Promise<ResortEvidence> {
  const [seasons, events, reports, logs, schedules, alertRows, runs] = await Promise.all([
    db.select().from(resortSeasons).where(eq(resortSeasons.resortId, resort.id)),
    db.select().from(statusEvents).where(eq(statusEvents.resortId, resort.id)).orderBy(asc(statusEvents.effectiveAt), asc(statusEvents.id)),
    db
      .select()
      .from(operationalReports)
      .where(eq(operationalReports.resortId, resort.id))
      .orderBy(asc(operationalReports.localDate), asc(operationalReports.id)),
    db.select().from(skiDayLogs).where(eq(skiDayLogs.resortId, resort.id)),
    db.select().from(operatingSchedules).where(and(eq(operatingSchedules.resortId, resort.id), eq(operatingSchedules.activity, 'lifts'))),
    db.select().from(weatherAlerts).where(eq(weatherAlerts.resortId, resort.id)),
    latestOkRuns(db, resort.id),
  ])
  const { primary, alternates } = pickRuns(runs)
  const load = async (m: Map<string, WeatherRunRow>) => {
    const out = new Map<string, StoredSeries>()
    for (const [k, run] of m) out.set(k, await loadRunSeries(db, run))
    return out
  }
  const personal: PersonalFeedback[] = [
    ...logs
      .filter((l) => l.surfaceFeedback.length > 0)
      .map((l) => ({ date: l.date, surfaceTags: l.surfaceFeedback, recordedAt: l.createdAt, note: l.notes })),
    ...reports
      .filter((r) => isPersonalReport(r) && r.surfaceTags.length > 0)
      .map((r) => ({ date: r.localDate, surfaceTags: r.surfaceTags, recordedAt: r.reportedAt ?? r.createdAt, note: r.surfaceText ?? r.notes })),
  ]
  return {
    resort,
    seasons,
    events,
    reports: reports.filter((r) => !isPersonalReport(r)),
    personal,
    schedules,
    alerts: alertRows.map((a) => ({ id: a.id, event: a.event, headline: a.headline, severity: a.severity, onset: a.onset, ends: a.ends, url: a.url })),
    primary: await load(primary),
    alternates: await load(alternates),
  }
}

/** Published lift hours for a date: a dated exception wins over the weekly pattern; live statements over published. */
export function liftHoursFor(schedules: readonly OperatingScheduleRow[], date: string): { opens: string; closes: string } | null {
  const seasonId = seasonIdFor(date)
  const applicable = schedules.filter((s) => !s.seasonId || s.seasonId === seasonId)
  const byNature = (a: OperatingScheduleRow, b: OperatingScheduleRow) => (a.nature === b.nature ? 0 : a.nature === 'live' ? -1 : 1)
  const exception = applicable.filter((s) => s.exceptionDate === date).sort(byNature)[0]
  if (exception) return exception.closed || !exception.opens || !exception.closes ? null : { opens: exception.opens, closes: exception.closes }
  const wd = isoWeekday(date)
  const weekly = applicable
    .filter((s) => !s.exceptionDate && !s.closed && s.opens && s.closes)
    .filter((s) => (!s.daysOfWeek || s.daysOfWeek.includes(wd)) && (!s.startDate || s.startDate <= date) && (!s.endDate || s.endDate >= date))
    .sort(byNature)[0]
  return weekly ? { opens: weekly.opens!, closes: weekly.closes! } : null
}

export interface BuildInputArgs {
  date: string
  mode: ScoringMode
  now: string
  demo: boolean
  units?: UnitPrefs
}

/** Assemble the engine input for one resort / date / mode from loaded evidence (pure). */
export function buildAssessInput(ev: ResortEvidence, a: BuildInputArgs): AssessDayInput {
  const { resort } = ev
  const tz = resort.timezone
  const season = ev.seasons.find((s) => s.seasonId === seasonIdFor(a.date)) ?? null
  const event = [...ev.events].filter((e) => e.localDate <= a.date).pop() ?? null
  const report =
    [...ev.reports]
      .filter((r) => r.localDate <= a.date && (a.demo || r.kind !== 'demo'))
      .sort((x, y) => x.localDate.localeCompare(y.localDate) || x.id - y.id)
      .pop() ?? null
  const operations: OperationsEvidence = {
    status: event?.status ?? null,
    statusDate: event?.localDate ?? null,
    statusAt: event?.effectiveAt ?? null,
    announcedOpening: season?.announcedOpening ?? null,
    estimatedOpenFrom: season?.estimatedOpenFrom ?? null,
    actualOpening: season?.actualOpening ?? null,
    announcedClosing: season?.announcedClosing ?? null,
    actualClosing: season?.actualClosing ?? null,
  }
  const base = ev.primary.get('base')
  const summit = ev.primary.get('summit')
  let alternateModel: AssessDayInput['alternateModel'] = null
  for (const key of CONDITIONS_CONFIG_V1.points.surface[a.mode]) {
    const alt = ev.alternates.get(key)
    if (!alt) continue
    const day = aggregateDay(prepareSeries(alt.hourly, alt.semantics), a.date, tz)
    if ((day.variableCoverage.snowfallCm ?? 0) >= 1) alternateModel = { label: alt.run.prov?.provider ?? alt.run.provider, snowfallCm: day.snowfallCm }
    break
  }
  return {
    date: a.date,
    timezone: tz,
    now: a.now,
    mode: a.mode,
    weather: { base: base ? pointWeather(base) : null, summit: summit ? pointWeather(summit) : null },
    report,
    personalFeedback: ev.personal.filter((p) => p.date <= a.date),
    operations,
    alerts: ev.alerts,
    operatingHours: liftHoursFor(ev.schedules, a.date),
    alternateModel,
    units: a.units,
    appMode: a.demo ? 'demo' : 'live',
    refs: {
      reportId: report?.id ?? null,
      weatherRunIds: [base?.run.id, summit?.run.id].filter((x): x is number => typeof x === 'number'),
      statusEventId: event?.id ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// Job

export interface AssessmentsOptions {
  resortIds?: readonly string[] | null
  horizonDays?: number
  modes?: readonly ScoringMode[]
}

export interface ResortAssessmentResult {
  inserted: number
  unchanged: number
  dates: string[]
}

export async function assessResort(
  db: Db,
  resort: ResortRow,
  a: { now: string; demo: boolean; units?: UnitPrefs; horizonDays?: number; modes?: readonly ScoringMode[] },
): Promise<ResortAssessmentResult> {
  const ev = await loadEvidence(db, resort)
  const today = localDateOf(a.now, resort.timezone)
  const runHorizon = Math.max(0, ...[...ev.primary.values()].map((s) => s.run.horizonDays ?? 0))
  // Without any stored forecast there is nothing to say about future days: assess yesterday and today only
  // (reports/status can still support them). Otherwise follow the forecast's horizon, capped at 16 days.
  const fallback = ev.primary.size === 0 ? 1 : CONDITIONS_CONFIG_V1.horizon.defaultDays
  const horizon = Math.min(MAX_HORIZON_DAYS, Math.max(1, a.horizonDays ?? (runHorizon || fallback)))
  const dates = dateRange(addDays(today, -1), addDays(today, horizon - 1))
  const modes = a.modes ?? SCORING_MODES

  const existing = await db
    .select()
    .from(conditionsAssessments)
    .where(and(eq(conditionsAssessments.resortId, resort.id), gte(conditionsAssessments.localDate, dates[0]), inArray(conditionsAssessments.mode, [...modes])))
    .orderBy(desc(conditionsAssessments.computedAt), desc(conditionsAssessments.id))
  const latest = new Map<string, ConditionsAssessmentRow>()
  for (const r of existing) {
    const k = `${r.localDate}|${r.mode}`
    if (!latest.has(k)) latest.set(k, r)
  }

  const toInsert: (typeof conditionsAssessments.$inferInsert)[] = []
  let unchanged = 0
  for (const date of dates) {
    for (const mode of modes) {
      const out = assessDay(buildAssessInput(ev, { date, mode, now: a.now, demo: a.demo, units: a.units }))
      const row = toAssessmentRow(resort.id, out, a.demo)
      const prev = latest.get(`${date}|${mode}`)
      if (prev && assessmentFingerprint(prev) === assessmentFingerprint(row as Material)) {
        unchanged++
        continue
      }
      toInsert.push(row)
    }
  }
  for (let i = 0; i < toInsert.length; i += 50) await db.insert(conditionsAssessments).values(toInsert.slice(i, i + 50))
  return { inserted: toInsert.length, unchanged, dates }
}

export async function refreshAssessments(ctx: JobContext, opts: AssessmentsOptions = {}): Promise<JobWorkResult> {
  const { db, now, deps } = ctx
  const ids = opts.resortIds ?? (ctx.target ? [ctx.target] : null)
  // selectResorts orders favorites first, then every catalog (and user-added) resort.
  const resorts = await selectResorts(db, ids)
  const prefs = (await db.select().from(userPreferences).where(eq(userPreferences.id, 1)))[0]
  const favIds = new Set((await db.select({ id: favorites.resortId }).from(favorites)).map((f) => f.id))
  const items: ItemOutcome[] = []
  for (const resort of resorts) {
    if (ctx.signal?.aborted) return { items, notes: [STOPPED_NOTE] }
    try {
      const res = await assessResort(db, resort, { now, demo: deps.demo, units: prefs?.units, horizonDays: opts.horizonDays, modes: opts.modes })
      items.push({ key: resort.id, target: resort.id, ok: true, written: res.inserted })
    } catch (e) {
      items.push({ key: resort.id, target: resort.id, ok: false, written: 0, error: errorMessage(e) })
    }
  }
  return { items, notes: [`${favIds.size} favorites, ${resorts.length} resorts assessed`] }
}
