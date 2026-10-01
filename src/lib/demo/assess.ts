/**
 * Demo conditions assessments computed "as of" a past instant, using only what existed at that instant.
 *
 * The assessments job (src/lib/jobs/assessments.ts) always reads the latest evidence in the database, so the demo
 * builds the evidence itself — season dates as known then, status statements and reports published by then, my
 * ski-day feedback written by then, and the latest simulated forecast run fetched by then — and then reuses the
 * job's `buildAssessInput` + `toAssessmentRow` and the engine's `assessDay` unchanged.
 *
 * Rows written per simulated resort (all three modes, kind 'demo'):
 * - every past local day at 07:00 local that day ("the morning assessment");
 * - today … today+16 at DEMO_NOW;
 * - where a daily forecast run existed, each day as estimated the previous morning (D−1 11:05Z, lead 1) — that is
 *   what the history calendar shows as "what Piste estimated then" (computed before the day started).
 */
import type { conditionsAssessments } from '@/lib/db/schema'
import type { OperatingScheduleRow, OperationalReportRow, ResortRow, ResortSeasonRow, StatusEventRow, WeatherRunRow } from '@/lib/db/rows'
import { assessDay, type PersonalFeedback } from '@/lib/domain/conditions'
import { addDays, dateRange, endOfLocalDay, localTimeToInstant, startOfLocalDay } from '@/lib/domain/time'
import { SCORING_MODES, type ScoringMode, type UnitPrefs } from '@/lib/domain/types'
import { buildAssessInput, toAssessmentRow } from '@/lib/jobs/assessments'
import type { StoredSeries } from '@/lib/jobs/weather'
import type { HourlyWeather } from '@/lib/providers/types'

type Evidence = Parameters<typeof buildAssessInput>[0]
export type AssessmentInsert = typeof conditionsAssessments.$inferInsert

export interface StoredRun {
  run: WeatherRunRow
  hourly: HourlyWeather[]
}

export interface ResortTimeline {
  resort: ResortRow
  /** Lift schedules (the job reads activity 'lifts' only). */
  schedules: OperatingScheduleRow[]
  /** Season row versions, ascending by `at` (the first is the catalog baseline with `at` = ''). */
  seasonVersions: { at: string; row: ResortSeasonRow }[]
  /** Status events, ascending by effectiveAt then id (as the job loads them). */
  events: StatusEventRow[]
  /** Operations reports (kind demo), any order. */
  reports: OperationalReportRow[]
  /** Ski-day log feedback, with the time it was written. */
  personal: (PersonalFeedback & { recordedAt: string })[]
  /** Runs per point key, ascending by fetchedAt. */
  runs: Map<string, StoredRun[]>
}

const H = 3_600_000

/**
 * How far before a date's local start the engine can look: a stale report up to 96 h before the reference instant
 * (07:00 on past days, lift opening on future days — at most 89 h before the day starts) and 72 h before lift
 * opening for the thaw/refreeze rule. 92 h leaves a margin; generate.test.ts asserts sliced == full.
 */
const LOOKBACK_MS = 92 * H

const dayBounds = new Map<string, [string, string]>()
/** [start − 92 h, end + 1 h] of a resort-local date, as canonical ISO strings (memoised). */
function sliceBounds(date: string, tz: string): [string, string] {
  const key = `${tz}|${date}`
  let b = dayBounds.get(key)
  if (!b) {
    const from = new Date(Date.parse(startOfLocalDay(date, tz)) - LOOKBACK_MS).toISOString()
    const to = new Date(Date.parse(endOfLocalDay(date, tz)) + H).toISOString()
    b = [from, to]
    dayBounds.set(key, b)
  }
  return b
}

/**
 * The hours of a run the engine can use for `date` (see LOOKBACK_MS); nothing after the end of the day is read.
 * Result-preserving — it only keeps each assessment fast; the stored run is unchanged.
 */
export function sliceForDate(hourly: readonly HourlyWeather[], date: string, tz: string): HourlyWeather[] {
  const [from, to] = sliceBounds(date, tz)
  return hourly.filter((h) => h.validTime >= from && h.validTime <= to)
}

function latestAt<T>(list: readonly T[], ok: (x: T) => boolean): T | null {
  let hit: T | null = null
  for (const x of list) if (ok(x)) hit = x
  return hit
}

/** Evidence as it existed at `asOf` (weather sliced for `date` unless `full`). */
export function evidenceAt(tl: ResortTimeline, asOf: string, date: string, opts: { full?: boolean } = {}): Evidence {
  const tz = tl.resort.timezone
  const season = latestAt(tl.seasonVersions, (v) => v.at <= asOf)?.row ?? null
  const primary = new Map<string, StoredSeries>()
  for (const [key, runs] of tl.runs) {
    const run = latestAt(runs, (r) => r.run.fetchedAt <= asOf)
    if (!run) continue
    primary.set(key, { run: run.run, hourly: opts.full ? run.hourly : sliceForDate(run.hourly, date, tz), semantics: run.run.intervalSemantics ?? 'preceding-hour' })
  }
  return {
    resort: tl.resort,
    seasons: season ? [season] : [],
    events: tl.events.filter((e) => e.effectiveAt <= asOf),
    reports: tl.reports.filter((r) => (r.reportedAt ?? r.createdAt) <= asOf && r.createdAt <= asOf),
    personal: tl.personal.filter((p) => p.recordedAt <= asOf),
    schedules: tl.schedules,
    alerts: [],
    primary,
    alternates: new Map(),
  }
}

/** Assess `dates` × `modes` with the evidence known at `asOf`. */
export function assessAt(tl: ResortTimeline, asOf: string, dates: readonly string[], units: UnitPrefs, modes: readonly ScoringMode[] = SCORING_MODES): AssessmentInsert[] {
  const out: AssessmentInsert[] = []
  for (const date of dates) {
    const ev = evidenceAt(tl, asOf, date)
    for (const mode of modes) {
      const a = assessDay(buildAssessInput(ev, { date, mode, now: asOf, demo: true, units }))
      out.push(toAssessmentRow(tl.resort.id, a, true))
    }
  }
  return out
}

export interface AssessmentPlan {
  trackingStart: string
  today: string
  lastDate: string
  now: string
  /** Also write the previous-morning estimate (D−1 11:05Z) for each day (resorts with daily runs). */
  previousMorning: boolean
}

/** Every demo assessment row for one resort. */
export function assessResortTimeline(tl: ResortTimeline, plan: AssessmentPlan, units: UnitPrefs): AssessmentInsert[] {
  const tz = tl.resort.timezone
  const rows: AssessmentInsert[] = []
  // Past days: the morning assessment at 07:00 local, with the 06:30 report and that morning's forecast.
  for (const date of dateRange(plan.trackingStart, addDays(plan.today, -1))) {
    rows.push(...assessAt(tl, localTimeToInstant(date, '07:00', tz), [date], units))
  }
  // Previous-morning estimates (only when a forecast run existed before the day started).
  if (plan.previousMorning) {
    for (const date of dateRange(addDays(plan.trackingStart, 1), plan.today)) {
      rows.push(...assessAt(tl, `${addDays(date, -1)}T11:05:00.000Z`, [date], units))
    }
  }
  // Today and the forecast horizon, as of now.
  rows.push(...assessAt(tl, plan.now, dateRange(plan.today, plan.lastDate), units))
  return rows
}
