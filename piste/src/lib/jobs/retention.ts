/**
 * History retention: which OLD weather runs and assessments the app still reads, and the prune that deletes the rest.
 * The history reader (src/lib/data/forecast.ts) selects with the same helpers, so what the prune keeps and what the
 * history calendar reads cannot drift apart.
 *
 * Who reads old rows (everything else is deleted once it is older than the full-retention window):
 * - Forecast, resort pages, Today, assessments and alerts: the LATEST successful run per resort, point and provider
 *   (all its hours). Nothing compares a run with earlier runs; the alternate model (NWS) is only read while it is the
 *   latest run of its provider.
 * - History calendar "forecast then": for each past resort-local day D and point (base, summit), the primary run
 *   fetched most recently before D started ({@link forecastThenPick}) — and only its hours in
 *   [start of D, end of D + 1 h] ({@link forecastThenHours}).
 * - History calendar "Piste estimated then": for each past D and mode, the newest assessment computed before D started
 *   ({@link assessmentThenPick}); every screen that shows a date: the newest assessment per resort, date and mode.
 * - "Outlook fell" alerts: every assessment of a planned trip day (today or later) computed since the trip was created.
 * - Tracking start (history calendar, when not recorded): the earliest successful run and earliest assessment per resort.
 * - No screen dereferences an assessment's `inputs.weatherRunIds`; the report and status ids it holds are never pruned.
 *
 * Rows are only ever deleted, never rewritten. The prune is idempotent: a second pass deletes nothing.
 */
import { and, eq, inArray, not, or, sql, type SQL } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { appMeta, conditionsAssessments, favorites, resorts, tripItems, trips, weatherPoints, weatherRuns } from '@/lib/db/schema'
import { addDays, addHours, dateRange, endOfLocalDay, isLocalDate, localDateOf, startOfLocalDay } from '@/lib/domain/time'
import { chunk, daysBefore, setMeta } from './util'

/** Providers whose runs are the primary forecast, in preference order (any other provider is an alternate). */
export const PRIMARY_WEATHER_PROVIDERS = ['open-meteo', 'demo'] as const
/** Points the history calendar shows. */
export const HISTORY_POINTS = ['base', 'summit'] as const
/** A history month considers runs fetched up to this many days before the month starts (forecast horizon + 1). */
export const HISTORY_LOOKBACK_DAYS = 17

// ---------------------------------------------------------------------------------------------------------------------
// Optional size limits (off by default; the single-file build turns them on — see docs/scheduler.md)

export interface HistoryPolicy {
  /**
   * Past days for which EVERY resort keeps its forecast-then (PISTE_WEATHER_HISTORY_DAYS). Older days keep it only for
   * favourites and resorts in a trip; for the others the history calendar says it is not kept. null = every day.
   */
  weatherHistoryDays: number | null
  /**
   * Past days that keep their newest assessment with its factor breakdown and reasons (PISTE_ASSESSMENT_DETAIL_DAYS).
   * Older days keep only what Piste estimated before the day ("estimated then": score, descriptor, confidence, coverage,
   * surface), which the resort page then shows as the latest stored assessment, with an explanation saying the
   * breakdown is not kept. null = every day.
   */
  assessmentDetailDays: number | null
}

export function historyPolicy(env: Record<string, string | undefined> = process.env): HistoryPolicy {
  const days = (v: string | undefined) => {
    const n = Number(v)
    return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  }
  return { weatherHistoryDays: days(env.PISTE_WEATHER_HISTORY_DAYS), assessmentDetailDays: days(env.PISTE_ASSESSMENT_DETAIL_DAYS) }
}

/** app_meta key (+ resort id): the first resort-local day whose forecast-then is still kept for that resort. */
export const FORECAST_KEPT_FROM_META = 'history.forecastKeptFrom.'

/** Resorts that keep their whole forecast-then history under a {@link HistoryPolicy}: favourites and trip resorts. */
export async function fullHistoryResorts(db: Db): Promise<Set<string>> {
  const favs = await db.select({ id: favorites.resortId }).from(favorites)
  const inTrips = await db
    .selectDistinct({ id: tripItems.refId })
    .from(tripItems)
    .innerJoin(trips, eq(trips.id, tripItems.tripId))
    .where(and(eq(tripItems.type, 'resort-day'), inArray(trips.status, ['draft', 'booked', 'done'])))
  return new Set([...favs.map((f) => f.id), ...inTrips.map((t) => t.id).filter((id): id is string => !!id)])
}

// ---------------------------------------------------------------------------------------------------------------------
// Selection rules (shared with the history reader)

export interface RunChoice {
  id: number
  provider: string
  fetchedAt: string
  horizonDays: number | null
}

const providerRank = (p: string) => {
  const i = (PRIMARY_WEATHER_PROVIDERS as readonly string[]).indexOf(p)
  return i === -1 ? 99 : i
}

/**
 * "The forecast" among the latest ok run per provider for one point: primary provider first, then the longer horizon,
 * then the most recent.
 */
export function pickPrimaryRun<T extends RunChoice>(runs: readonly T[]): T | null {
  const sorted = [...runs].sort(
    (a, b) => providerRank(a.provider) - providerRank(b.provider) || (b.horizonDays ?? 0) - (a.horizonDays ?? 0) || b.fetchedAt.localeCompare(a.fetchedAt) || b.id - a.id,
  )
  return sorted[0] ?? null
}

/** Earliest fetch time the history calendar considers for a month ('YYYY-MM'). */
export function historyRunsFrom(month: string, tz: string): string {
  return startOfLocalDay(addDays(`${month}-01`, -HISTORY_LOOKBACK_DAYS), tz)
}

/** Hours of the chosen run the history calendar reads for a day (inclusive bounds). */
export function forecastThenHours(date: string, tz: string): { from: string; to: string } {
  return { from: startOfLocalDay(date, tz), to: addHours(endOfLocalDay(date, tz), 1) }
}

/**
 * "Forecast then" for one resort-local day and one point, from that point's successful runs: among runs fetched before
 * the day started (and not before its month's look-back), the latest run of each provider, then {@link pickPrimaryRun}.
 * Never recomputed from later data.
 */
export function forecastThenPick<T extends RunChoice>(runs: readonly T[], date: string, tz: string): T | null {
  return latestPrimaryBetween(runs, historyRunsFrom(date.slice(0, 7), tz), startOfLocalDay(date, tz))
}

/** {@link pickPrimaryRun} over the latest run per provider fetched in [from, before). */
function latestPrimaryBetween<T extends RunChoice>(runs: readonly T[], from: string, before: string): T | null {
  const latest = new Map<string, T>()
  for (const r of runs) {
    if (r.fetchedAt < from || r.fetchedAt >= before) continue
    const cur = latest.get(r.provider)
    if (!cur || r.fetchedAt > cur.fetchedAt || (r.fetchedAt === cur.fetchedAt && r.id > cur.id)) latest.set(r.provider, r)
  }
  return pickPrimaryRun([...latest.values()])
}

/** "Piste estimated then": the newest assessment computed before the day started (`dayStart`, UTC). */
export function assessmentThenPick<T extends { id: number; computedAt: string }>(rows: readonly T[], dayStart: string): T | undefined {
  let best: T | undefined
  for (const r of rows) {
    if (r.computedAt >= dayStart) continue
    if (!best || r.computedAt > best.computedAt || (r.computedAt === best.computedAt && r.id > best.id)) best = r
  }
  return best
}

// ---------------------------------------------------------------------------------------------------------------------
// Weather

export interface WeatherPruneResult {
  /** Runs deleted (with all their hours). */
  runsDeleted: number
  /** Runs older than the window that are kept (the latest per point/provider, forecast-then picks, tracking start). */
  runsKept: number
  /** Hours deleted from kept runs (outside the hours a past day's forecast-then reads). */
  pointsDeleted: number
}

const byTime = <T extends { fetchedAt: string; id: number }>(a: T, b: T) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const list = out.get(k)
    if (list) list.push(x)
    else out.set(k, [x])
  }
  return out
}

/** First index whose fetchedAt is >= t (runs sorted by time). */
function lowerBound(runs: readonly { fetchedAt: string }[], t: string): number {
  let lo = 0
  let hi = runs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (runs[mid].fetchedAt < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Merge inclusive [from, to] windows that overlap or touch. */
function mergeWindows(ws: readonly { from: string; to: string }[]): { from: string; to: string }[] {
  const sorted = [...ws].sort((a, b) => a.from.localeCompare(b.from))
  const out: { from: string; to: string }[] = []
  for (const w of sorted) {
    const last = out[out.length - 1]
    if (last && w.from <= last.to) {
      if (w.to > last.to) last.to = w.to
    } else out.push({ ...w })
  }
  return out
}

/**
 * Weather retention. Every run fetched in the last `keepDays` days (and any run stamped in the future) is kept whole.
 * Older runs are kept only as far as a reader needs them:
 * - the latest successful run per resort / point / provider stays whole (it is still "the forecast");
 * - a run that is a past day's "forecast then" keeps only the hours that day reads (a run can serve several days
 *   when the app was not opened in between);
 * - the earliest successful run per resort keeps its row (tracking start);
 * everything else — superseded runs, alternate-model (NWS) runs no past day uses, old error rows — is deleted.
 * With `policy.weatherHistoryDays`, resorts that are neither favourites nor in a trip keep forecast-then only for that
 * many past days; the first day still kept is recorded in app_meta ({@link FORECAST_KEPT_FROM_META}) for the reader.
 */
export async function pruneWeatherHistory(db: Db, now: string, keepDays: number, policy: HistoryPolicy = historyPolicy()): Promise<WeatherPruneResult> {
  const cutoff = daysBefore(now, keepDays)
  const runs = await db
    .select({
      id: weatherRuns.id,
      resortId: weatherRuns.resortId,
      pointKey: weatherRuns.pointKey,
      provider: weatherRuns.provider,
      fetchedAt: weatherRuns.fetchedAt,
      horizonDays: weatherRuns.horizonDays,
      status: weatherRuns.status,
      timezone: weatherRuns.timezone,
    })
    .from(weatherRuns)
  const old = runs.filter((r) => r.fetchedAt < cutoff)
  if (old.length === 0) return { runsDeleted: 0, runsKept: 0, pointsDeleted: 0 }
  const zones = new Map((await db.select({ id: resorts.id, tz: resorts.timezone }).from(resorts)).map((r) => [r.id, r.tz]))
  const full = policy.weatherHistoryDays === null ? null : await fullHistoryResorts(db)
  const keptFrom = new Map<string, string>()

  const whole = new Set<number>()
  const tracking = new Set<number>()
  const hours = new Map<number, { from: string; to: string }[]>()
  for (const [resortId, list] of groupBy(runs, (r) => r.resortId)) {
    // The history reader works in the resort's zone; a run's own zone is only a fallback for an unknown resort.
    const tz = zones.get(resortId) ?? list[0].timezone
    const ok = list.filter((r) => r.status === 'ok' && r.fetchedAt <= now).sort(byTime)
    if (ok.length === 0) continue
    tracking.add(ok[0].id)
    for (const group of groupBy(ok, (r) => `${r.pointKey}|${r.provider}`).values()) whole.add(group[group.length - 1].id)
    const last = localDateOf(now, tz)
    const boundary = full && policy.weatherHistoryDays !== null && !full.has(resortId) ? addDays(last, -policy.weatherHistoryDays) : null
    if (boundary) keptFrom.set(resortId, boundary)
    for (const point of HISTORY_POINTS) {
      const pts = ok.filter((r) => r.pointKey === point)
      if (!pts.length || pts[0].fetchedAt >= cutoff) continue
      for (const date of dateRange(addDays(localDateOf(pts[0].fetchedAt, tz), 1), last)) {
        if (boundary && date < boundary) continue
        const dayStart = startOfLocalDay(date, tz)
        if (dayStart > now) break
        const from = historyRunsFrom(date.slice(0, 7), tz)
        // Same rule as forecastThenPick, on the runs in [from, dayStart) found by binary search.
        const pick = latestPrimaryBetween(pts.slice(lowerBound(pts, from), lowerBound(pts, dayStart)), from, dayStart)
        if (!pick || pick.fetchedAt >= cutoff) continue
        const list = hours.get(pick.id) ?? []
        list.push(forecastThenHours(date, tz))
        hours.set(pick.id, list)
      }
    }
  }

  // Record where each limited resort's forecast-then history now starts (it only ever moves forward), before deleting.
  if (keptFrom.size) {
    const keys = [...keptFrom.keys()].map((id) => FORECAST_KEPT_FROM_META + id)
    const stored = new Map((await db.select().from(appMeta).where(inArray(appMeta.key, keys))).map((m) => [m.key, m.value]))
    for (const [resortId, date] of keptFrom) {
      const cur = stored.get(FORECAST_KEPT_FROM_META + resortId)
      if (!cur || cur < date) await setMeta(db, FORECAST_KEPT_FROM_META + resortId, date, now)
    }
  }

  const doomed = old.filter((r) => !whole.has(r.id) && !hours.has(r.id) && !tracking.has(r.id)).map((r) => r.id)
  for (const ids of chunk(doomed, 400)) {
    await db.delete(weatherPoints).where(inArray(weatherPoints.runId, ids))
    await db.delete(weatherRuns).where(inArray(weatherRuns.id, ids))
  }

  // Trim kept old runs to the hours their days read. A run whose stored hours already lie inside one window is left alone.
  const trimmed = old.filter((r) => !whole.has(r.id) && (hours.has(r.id) || tracking.has(r.id)))
  let pointsDeleted = 0
  for (const part of chunk(trimmed, 400)) {
    const stats = await db
      .select({ runId: weatherPoints.runId, lo: sql<string>`min(${weatherPoints.validTime})`, hi: sql<string>`max(${weatherPoints.validTime})` })
      .from(weatherPoints)
      .where(
        inArray(
          weatherPoints.runId,
          part.map((r) => r.id),
        ),
      )
      .groupBy(weatherPoints.runId)
    for (const s of stats) {
      const ws = mergeWindows(hours.get(s.runId) ?? [])
      if (ws.length === 1 && s.lo >= ws[0].from && s.hi <= ws[0].to) continue
      const inside: SQL[] = ws.map((w) => sql`${weatherPoints.validTime} between ${w.from} and ${w.to}`)
      const res = await db
        .delete(weatherPoints)
        .where(and(eq(weatherPoints.runId, s.runId), inside.length ? not(or(...inside)!) : undefined))
      pointsDeleted += res.rowsAffected
    }
  }
  return { runsDeleted: doomed.length, runsKept: old.length - doomed.length, pointsDeleted }
}

// ---------------------------------------------------------------------------------------------------------------------
// Assessments

/** Explanation left on an older estimate whose details were compacted (no screen reads them; see pruneAssessments). */
export const COMPACTED_EXPLANATION = 'Older assessment: its breakdown and reasons are not kept.'

export interface AssessmentPruneResult {
  deleted: number
  /** Kept rows whose unread details (components, explanation, confidence reasons) were emptied. */
  compacted: number
}

/**
 * Assessment retention (no window: superseded rows go as soon as no reader can reach them). Per resort, date and mode:
 * - the NEWEST row is kept whole — screens show its full breakdown for any date, past or future;
 * - kept for their headline facts only: for a day that has started, the newest row computed before it started
 *   ("Piste estimated then": score, descriptor, confidence, surface, lead time); every row computed since the trip
 *   was created for a planned trip day that is not over ("outlook fell" alerts: score and kind); the earliest row per
 *   resort (tracking start). Their components, explanation and confidence reasons are never read, so they are emptied
 *   (with an explanation saying so) — a row that is not the newest can never become the newest again;
 * - anything stamped in the future (clock skew) is left alone;
 * everything else is deleted. With `policy.assessmentDetailDays`, a day further back than that keeps only its
 * "estimated then" row (or, when nothing was estimated before it, its newest row) — headline facts only.
 */
export async function pruneAssessments(db: Db, now: string, policy: HistoryPolicy = historyPolicy()): Promise<AssessmentPruneResult> {
  const rows = await db
    .select({
      id: conditionsAssessments.id,
      resortId: conditionsAssessments.resortId,
      localDate: conditionsAssessments.localDate,
      mode: conditionsAssessments.mode,
      computedAt: conditionsAssessments.computedAt,
    })
    .from(conditionsAssessments)
  if (rows.length === 0) return { deleted: 0, compacted: 0 }
  const zones = new Map((await db.select({ id: resorts.id, tz: resorts.timezone }).from(resorts)).map((r) => [r.id, r.tz]))
  // Planned trip days (draft or booked trips): "outlook fell" alerts compare every assessment since the trip was made.
  const tripSince = new Map<string, string>()
  for (const t of await db
    .select({ resortId: tripItems.refId, date: tripItems.date, since: trips.createdAt })
    .from(tripItems)
    .innerJoin(trips, eq(trips.id, tripItems.tripId))
    .where(and(eq(tripItems.type, 'resort-day'), inArray(trips.status, ['draft', 'booked'])))) {
    if (!t.resortId || !t.date) continue
    const k = `${t.resortId}|${t.date}`
    const cur = tripSince.get(k)
    if (!cur || t.since < cur) tripSince.set(k, t.since)
  }

  const whole = new Set<number>()
  const headline = new Set<number>()
  const dayStarts = new Map<string, string>()
  for (const [resortId, list] of groupBy(rows, (r) => r.resortId)) {
    const tz = zones.get(resortId)
    if (!tz) {
      for (const r of list) whole.add(r.id)
      continue
    }
    const today = localDateOf(now, tz)
    const detailFrom = policy.assessmentDetailDays === null ? null : addDays(today, -policy.assessmentDetailDays)
    let earliest = list[0]
    for (const r of list) if (r.computedAt < earliest.computedAt || (r.computedAt === earliest.computedAt && r.id < earliest.id)) earliest = r
    headline.add(earliest.id)
    for (const group of groupBy(list, (r) => `${r.localDate}|${r.mode}`).values()) {
      const date = group[0].localDate
      if (!isLocalDate(date)) {
        for (const r of group) whole.add(r.id)
        continue
      }
      let newest: (typeof group)[number] | undefined
      for (const r of group) {
        if (r.computedAt > now) whole.add(r.id)
        else if (!newest || r.computedAt > newest.computedAt || (r.computedAt === newest.computedAt && r.id > newest.id)) newest = r
      }
      const zk = `${tz}|${date}`
      let dayStart = dayStarts.get(zk)
      if (dayStart === undefined) dayStarts.set(zk, (dayStart = startOfLocalDay(date, tz)))
      const then = dayStart <= now ? assessmentThenPick(group, dayStart) : undefined
      if (then) headline.add(then.id)
      if (newest) {
        if (!detailFrom || date >= detailFrom) whole.add(newest.id)
        // Beyond the detail limit a day keeps what was estimated before it; its newest row only when nothing was.
        else if (!then) headline.add(newest.id)
      }
      const since = tripSince.get(`${resortId}|${date}`)
      if (since !== undefined && date >= addDays(today, -1)) for (const r of group) if (r.computedAt >= since) headline.add(r.id)
    }
  }
  const doomed = rows.filter((r) => !whole.has(r.id) && !headline.has(r.id)).map((r) => r.id)
  for (const ids of chunk(doomed, 400)) await db.delete(conditionsAssessments).where(inArray(conditionsAssessments.id, ids))
  const marker = [COMPACTED_EXPLANATION]
  let compacted = 0
  for (const ids of chunk(
    [...headline].filter((id) => !whole.has(id)),
    400,
  )) {
    const res = await db
      .update(conditionsAssessments)
      .set({ components: [], confidenceReasons: [], explanation: marker })
      .where(and(inArray(conditionsAssessments.id, ids), sql`${conditionsAssessments.explanation} <> ${JSON.stringify(marker)}`))
    compacted += res.rowsAffected
  }
  return { deleted: doomed.length, compacted }
}
