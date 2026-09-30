/**
 * Scheduler: cadences, due-time planning, the long-running worker loop (`npm run worker`) and a single pass for
 * cron (`npm run refresh`).
 *
 * - Due times derive from `refresh_runs`, so restarting the worker does not re-run everything and two processes
 *   cannot overlap a job (the runner skips a job + target that is already running).
 * - Cadences come from the environment with defaults: weather 180 min; official reports 60 min between 06:00 and
 *   18:00 resort-local and 240 min otherwise; official alerts 60 min; status 60 min (local and cheap: an announced
 *   date passing, or a recorded closing, shows up within the hour); links/fx/prune daily; assessments every 6 h and
 *   after weather/report/status changes; alerts after each refresh pass; OpenStreetMap lifts & runs weekly, per resort,
 *   for favourites and resorts in upcoming trips (./osm.ts). Each due time gets ± jitter.
 * - The worker writes a heartbeat to app_meta('scheduler.heartbeat') every tick. A sleeping or powered-off machine
 *   collects nothing: run the worker on an always-on host, or call `npm run refresh` from cron.
 */
import type { Db } from '@/lib/db/client'
import { localTimeToInstant } from '@/lib/domain/time'
import { DateTime } from 'luxon'
import { lastAttemptRun, reapInterruptedScheduledRuns, runJob, type RunSummary } from './runner'
import type { JobDeps, JobName, Trigger } from './types'
import { osmTargets } from './osm'
import { minutesAfter, selectResorts, setMeta } from './util'

export interface Cadences {
  weatherMin: number
  nwsAlertsMin: number
  reportsDayMin: number
  reportsNightMin: number
  /** Resort-local window (HH:mm) using the daytime report cadence. */
  reportsDayStart: string
  reportsDayEnd: string
  assessmentsMin: number
  statusMin: number
  linksMin: number
  fxMin: number
  pruneMin: number
  /** OpenStreetMap lifts & runs, per favourite / upcoming-trip resort (community map data changes slowly). */
  osmMin: number
  /** ± fraction of each cadence added as jitter (0.1 = ±10%). */
  jitterPct: number
  /** After a failed run, retry after min(cadence, this). */
  errorRetryMin: number
  tickSeconds: number
}

export const DEFAULT_CADENCES: Cadences = {
  weatherMin: 180,
  nwsAlertsMin: 60,
  reportsDayMin: 60,
  reportsNightMin: 240,
  reportsDayStart: '06:00',
  reportsDayEnd: '18:00',
  assessmentsMin: 360,
  statusMin: 60,
  linksMin: 1440,
  fxMin: 1440,
  pruneMin: 1440,
  osmMin: 10_080,
  jitterPct: 0.1,
  errorRetryMin: 30,
  tickSeconds: 60,
}

const ENV_KEYS: Partial<Record<keyof Cadences, string>> = {
  weatherMin: 'PISTE_WEATHER_EVERY_MIN',
  nwsAlertsMin: 'PISTE_ALERTS_EVERY_MIN',
  reportsDayMin: 'PISTE_REPORTS_EVERY_MIN',
  reportsNightMin: 'PISTE_REPORTS_NIGHT_EVERY_MIN',
  assessmentsMin: 'PISTE_ASSESSMENTS_EVERY_MIN',
  statusMin: 'PISTE_STATUS_EVERY_MIN',
  linksMin: 'PISTE_LINKS_EVERY_MIN',
  fxMin: 'PISTE_FX_EVERY_MIN',
  pruneMin: 'PISTE_PRUNE_EVERY_MIN',
  osmMin: 'PISTE_OSM_EVERY_MIN',
  tickSeconds: 'PISTE_WORKER_TICK_SECONDS',
}

/** Cadences from the environment; invalid or non-positive values fall back to the defaults. */
export function cadencesFromEnv(env: Record<string, string | undefined> = process.env): Cadences {
  const c: Cadences = { ...DEFAULT_CADENCES }
  for (const [field, name] of Object.entries(ENV_KEYS) as [keyof Cadences, string][]) {
    const v = Number(env[name])
    if (env[name] !== undefined && Number.isFinite(v) && v > 0) (c as unknown as Record<string, number>)[field] = v
  }
  const j = Number(env.PISTE_SCHEDULER_JITTER)
  if (env.PISTE_SCHEDULER_JITTER !== undefined && Number.isFinite(j) && j >= 0 && j < 1) c.jitterPct = j
  return c
}

/** True when the resort-local wall time of `now` is within [start, end). DST-safe (resolved per local date). */
export function isResortDaytime(now: string, tz: string, start: string, end: string): boolean {
  const local = DateTime.fromISO(now, { zone: 'utc' }).setZone(tz)
  const date = local.toISODate()!
  return now >= localTimeToInstant(date, start, tz) && now < localTimeToInstant(date, end, tz)
}

export function reportsCadenceMin(now: string, tz: string, c: Cadences): number {
  return isResortDaytime(now, tz, c.reportsDayStart, c.reportsDayEnd) ? c.reportsDayMin : c.reportsNightMin
}

export interface ScheduledTask {
  key: string
  job: JobName
  target: string | null
  everyMin: number
}

export function planTasks(
  now: string,
  c: Cadences,
  reportTargets: readonly { resortId: string; timezone: string }[],
  /** Resorts whose OpenStreetMap lifts & runs load on schedule (see osmTargets). */
  osmTargetIds: readonly string[] = [],
): ScheduledTask[] {
  const g = (job: JobName, everyMin: number): ScheduledTask => ({ key: job, job, target: null, everyMin })
  return [
    g('weather', c.weatherMin),
    g('nws-alerts', c.nwsAlertsMin),
    ...reportTargets.map((t) => ({ key: `reports:${t.resortId}`, job: 'reports' as const, target: t.resortId, everyMin: reportsCadenceMin(now, t.timezone, c) })),
    g('status', c.statusMin),
    g('assessments', c.assessmentsMin),
    g('fx', c.fxMin),
    g('links', c.linksMin),
    g('prune', c.pruneMin),
    // Last: community map data never holds up the forecast, status or alerts.
    ...osmTargetIds.map((id) => ({ key: `osm:${id}`, job: 'osm' as const, target: id, everyMin: c.osmMin })),
  ]
}

/** Signed jitter in minutes, uniform in ±pct × cadence. */
export function jitterMinutes(everyMin: number, pct: number, rng: () => number = Math.random): number {
  return (rng() * 2 - 1) * pct * everyMin
}

/** When a task is next due, from its last (non-skipped) run. Never-run tasks are due immediately. */
export function nextDueAt(
  last: { startedAt: string; status: string } | null,
  everyMin: number,
  jitterMin: number,
  c: Pick<Cadences, 'errorRetryMin'>,
): string | null {
  if (!last) return null
  const wait = last.status === 'error' ? Math.min(everyMin, c.errorRetryMin) : everyMin + jitterMin
  return minutesAfter(last.startedAt, Math.max(1, wait))
}

export const HEARTBEAT_KEY = 'scheduler.heartbeat'

export async function writeHeartbeat(db: Db, now: string, mode: 'worker' | 'once', extra: Record<string, string> = {}) {
  await setMeta(db, HEARTBEAT_KEY, now, now)
  await setMeta(db, 'scheduler.mode', mode, now)
  for (const [k, v] of Object.entries(extra)) await setMeta(db, `scheduler.${k}`, v, now)
}

// ---------------------------------------------------------------------------
// Tick

export interface TickState {
  /** Jitter per task key, fixed until the task runs again (keeps due checks stable between ticks). */
  jitter: Map<string, number>
  firstTick: boolean
}

export function newTickState(): TickState {
  return { jitter: new Map(), firstTick: true }
}

export interface TickArgs {
  db: Db
  deps: JobDeps
  cadences: Cadences
  clock: () => string
  state: TickState
  rng?: () => number
  signal?: AbortSignal
  log?: (line: string) => void
}

const REFRESH_JOBS: readonly JobName[] = ['weather', 'nws-alerts', 'reports', 'status']
const EVIDENCE_JOBS: readonly JobName[] = ['weather', 'reports', 'status']

/** One scheduler pass: heartbeat, run every due task, then assessments/alerts follow-ups. */
export async function tick(a: TickArgs): Promise<RunSummary[]> {
  const { db, deps, cadences: c, state } = a
  const rng = a.rng ?? Math.random
  const log = a.log ?? (() => {})
  const now = a.clock()
  await writeHeartbeat(db, now, 'worker')
  const trigger: Trigger = state.firstTick ? 'startup' : 'schedule'
  state.firstTick = false

  const reportResorts = await selectResorts(db, deps.reportProviders.map((p) => p.resortId))
  const osmIds = deps.osmProvider && !deps.demo ? await osmTargets(db, now) : []
  const tasks = planTasks(now, c, reportResorts.map((r) => ({ resortId: r.id, timezone: r.timezone })), osmIds)
  const ran: RunSummary[] = []
  for (const t of tasks) {
    if (a.signal?.aborted) break
    const last = await lastAttemptRun(db, t.job, t.target)
    if (!state.jitter.has(t.key)) state.jitter.set(t.key, jitterMinutes(t.everyMin, c.jitterPct, rng))
    const due = nextDueAt(last, t.everyMin, state.jitter.get(t.key)!, c)
    const at = a.clock()
    if (due && due > at) continue
    const s = await runJob({ db, job: t.job, target: t.target, trigger, now: at, deps, clock: a.clock, signal: a.signal })
    state.jitter.set(t.key, jitterMinutes(t.everyMin, c.jitterPct, rng))
    log(`[${at}] ${t.key}: ${s.status}${s.itemsWritten ? ` (+${s.itemsWritten})` : ''}${s.error ? ` — ${s.error.slice(0, 200)}` : ''}`)
    ran.push(s)
  }
  if (a.signal?.aborted) return ran

  // Follow-ups: fresh evidence → new assessments; any refresh → alerts.
  const evidenceChanged = ran.some((s) => EVIDENCE_JOBS.includes(s.job) && s.changed)
  const assessedThisTick = ran.some((s) => s.job === 'assessments')
  if (evidenceChanged && !assessedThisTick) {
    const s = await runJob({ db, job: 'assessments', target: null, trigger, now: a.clock(), deps, clock: a.clock })
    log(`[${s.startedAt}] assessments (after new evidence): ${s.status}${s.itemsWritten ? ` (+${s.itemsWritten})` : ''}`)
    ran.push(s)
  }
  if (!a.signal?.aborted && ran.some((s) => REFRESH_JOBS.includes(s.job) || s.job === 'assessments')) {
    const s = await runJob({ db, job: 'alerts', target: null, trigger, now: a.clock(), deps, clock: a.clock })
    log(`[${s.startedAt}] alerts: ${s.status}${s.itemsWritten ? ` (+${s.itemsWritten})` : ''}`)
    ran.push(s)
  }
  return ran
}

// ---------------------------------------------------------------------------
// Worker loop and single pass

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

export interface WorkerArgs extends Omit<TickArgs, 'state'> {
  state?: TickState
}

/**
 * Run until `signal` aborts. A tick in progress finishes its current job (jobs are idempotent and short), then the
 * loop exits; the caller closes the database.
 */
export async function runWorker(a: WorkerArgs): Promise<void> {
  const state = a.state ?? newTickState()
  const log = a.log ?? (() => {})
  const reaped = await reapInterruptedScheduledRuns(a.db, a.clock())
  if (reaped) log(`Marked ${reaped} interrupted run(s) from a previous worker as abandoned`)
  await setMeta(a.db, 'scheduler.startedAt', a.clock(), a.clock())
  await setMeta(a.db, 'scheduler.cadences', JSON.stringify(a.cadences), a.clock())
  while (!a.signal?.aborted) {
    try {
      await tick({ ...a, state })
    } catch (e) {
      log(`[${a.clock()}] tick failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    await abortableSleep(a.cadences.tickSeconds * 1000, a.signal)
  }
  await setMeta(a.db, 'scheduler.stoppedAt', a.clock(), a.clock())
}

export const ONCE_ORDER: readonly JobName[] = ['weather', 'nws-alerts', 'reports', 'status', 'assessments', 'alerts', 'fx', 'links', 'osm', 'prune']

/**
 * OpenStreetMap targets that are due (their last attempt is older than the cadence): a cron pass may run hourly, but
 * community map data is fetched weekly — and a failed attempt is retried after `errorRetryMin`.
 */
async function dueOsmTargets(db: Db, deps: JobDeps, now: string, c: Cadences): Promise<string[]> {
  if (!deps.osmProvider || deps.demo) return []
  const due: string[] = []
  for (const id of await osmTargets(db, now)) {
    const next = nextDueAt(await lastAttemptRun(db, 'osm', id), c.osmMin, 0, c)
    if (!next || next <= now) due.push(id)
  }
  return due
}

/** One pass of every job (for cron). Reports run per adapter so one failing source never hides the others. */
export async function runOnce(a: {
  db: Db
  deps: JobDeps
  clock: () => string
  jobs?: readonly JobName[]
  signal?: AbortSignal
  log?: (line: string) => void
  /** Cadences for the jobs that keep their own pace in a cron pass (OpenStreetMap). Default: from the environment. */
  cadences?: Cadences
}): Promise<RunSummary[]> {
  const log = a.log ?? (() => {})
  const jobs = a.jobs ?? ONCE_ORDER
  await writeHeartbeat(a.db, a.clock(), 'once')
  const out: RunSummary[] = []
  for (const job of ONCE_ORDER.filter((j) => jobs.includes(j))) {
    if (a.signal?.aborted) break
    const targets: (string | null)[] =
      job === 'reports'
        ? [...new Set(a.deps.reportProviders.map((p) => p.resortId))]
        : job === 'osm'
          ? await dueOsmTargets(a.db, a.deps, a.clock(), a.cadences ?? cadencesFromEnv())
          : [null]
    for (const target of targets) {
      const s = await runJob({ db: a.db, job, target, trigger: 'schedule', now: a.clock(), deps: a.deps, clock: a.clock, signal: a.signal })
      log(`${job}${target ? `:${target}` : ''}: ${s.status}${s.itemsWritten ? ` (+${s.itemsWritten})` : ''}${s.error ? ` — ${s.error.slice(0, 300)}` : ''}`)
      out.push(s)
    }
  }
  await writeHeartbeat(a.db, a.clock(), 'once')
  return out
}
