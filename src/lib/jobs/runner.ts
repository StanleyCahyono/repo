/**
 * Job runner: records every run in `refresh_runs` (running → ok / partial / error / skipped), isolates per-source
 * failures (one resort failing never aborts the others), retries a job whose body throws with bounded backoff,
 * enforces the manual-refresh cooldown and prevents overlapping runs of the same job + target.
 *
 * "Last successful update" only ever moves on ok/partial runs that actually did something (see ./success.ts) — a
 * failed run, or an external job that fetched nothing, never advances it.
 */
import { and, desc, eq, inArray, isNull, lt, ne, or, type SQL } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { refreshRuns, type RefreshRunDetails } from '@/lib/db/schema'
import type { RefreshRunRow } from '@/lib/db/rows'
import { successTargets } from './success'
import type { ItemOutcome, JobContext, JobDeps, JobName, JobWork, JobWorkResult, RunStatus, Trigger } from './types'
import { defaultSleep, errorMessage, minutesAfter, truncate } from './util'
import { JOB_WORK } from './work'

export { successTargets }

export const DEFAULT_COOLDOWN_MINUTES = 10
/** A 'running' row older than this is treated as abandoned (the process died mid-run). */
export const STALE_RUNNING_MINUTES = 90

export interface RunJobArgs {
  db: Db
  job: JobName
  target?: string | null
  trigger: Trigger
  /** App clock at start. */
  now: string
  deps: JobDeps
  /** Manual-refresh cooldown per job + target. Default 10 min; 0 disables (used for follow-up runs). */
  cooldownMinutes?: number
  /** Total attempts when the job body throws. Default 1 for manual runs, 2 for scheduled runs. */
  maxAttempts?: number
  backoffMs?: number
  /** Clock for `finishedAt` (default: the start instant, keeping tests deterministic). */
  clock?: () => string
  /** Override the job body (tests, one-off work). Defaults to the registered job. */
  work?: JobWork
  /** Shutdown request, passed to the job so it stops between items. */
  signal?: AbortSignal
}

export interface RunSummary {
  runId: number | null
  job: JobName
  target: string | null
  trigger: Trigger
  status: Exclude<RunStatus, 'running'>
  startedAt: string
  finishedAt: string
  attempts: number
  itemsWritten: number
  error: string | null
  items: ItemOutcome[]
  notes: string[]
  /** For skipped manual runs: when the next manual refresh is allowed. */
  nextAllowedAt: string | null
  /** True when the run wrote data (drives follow-up assessments/alerts). */
  changed: boolean
}

const targetCond = (target: string | null) => (target === null ? isNull(refreshRuns.target) : eq(refreshRuns.target, target))

/** Overall status from per-item outcomes. Skipped items are neither successes nor failures. */
export function statusFromItems(items: readonly ItemOutcome[]): 'ok' | 'partial' | 'error' {
  const counted = items.filter((i) => !i.skipped)
  const failed = counted.filter((i) => !i.ok)
  if (failed.length === 0) return 'ok'
  return failed.length < counted.length ? 'partial' : 'error'
}

function itemsError(items: readonly ItemOutcome[]): string | null {
  const failed = items.filter((i) => !i.ok && !i.skipped)
  if (failed.length === 0) return null
  return truncate(failed.map((i) => `${i.key}: ${i.error ?? 'failed'}`).join('; '))
}

/** Mark 'running' rows older than STALE_RUNNING_MINUTES as abandoned errors. */
async function reapStaleRuns(db: Db, job: JobName, target: string | null, now: string) {
  const cutoff = minutesAfter(now, -STALE_RUNNING_MINUTES)
  await db
    .update(refreshRuns)
    .set({ status: 'error', finishedAt: now, error: 'Abandoned: the process stopped before the run finished' })
    .where(and(eq(refreshRuns.job, job), targetCond(target), eq(refreshRuns.status, 'running'), lt(refreshRuns.startedAt, cutoff)))
}

export async function runJob(args: RunJobArgs): Promise<RunSummary> {
  const { db, job, trigger, now, deps } = args
  const target = args.target ?? null
  const clock = args.clock ?? (() => now)
  const work = args.work ?? JOB_WORK[job]
  const cooldown = args.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES
  const maxAttempts = Math.max(1, args.maxAttempts ?? (trigger === 'manual' ? 1 : 2))
  const backoffMs = args.backoffMs ?? 5_000
  const sleep = deps.sleep ?? defaultSleep

  const skip = async (reason: string, nextAllowedAt: string | null): Promise<RunSummary> => {
    const [row] = await db
      .insert(refreshRuns)
      .values({ job, target, trigger, startedAt: now, finishedAt: now, status: 'skipped', attempts: 0, itemsWritten: 0, error: reason })
      .returning({ id: refreshRuns.id })
    return {
      runId: row?.id ?? null,
      job,
      target,
      trigger,
      status: 'skipped',
      startedAt: now,
      finishedAt: now,
      attempts: 0,
      itemsWritten: 0,
      error: reason,
      items: [],
      notes: [reason],
      nextAllowedAt,
      changed: false,
    }
  }

  await reapStaleRuns(db, job, target, now)

  // Never overlap the same job + target.
  const running = await db
    .select()
    .from(refreshRuns)
    .where(and(eq(refreshRuns.job, job), targetCond(target), eq(refreshRuns.status, 'running')))
    .limit(1)
  if (running[0]) return skip(`Already running since ${running[0].startedAt}`, null)

  // Manual cooldown: any non-skipped run of this job + target that started within the window.
  if (trigger === 'manual' && cooldown > 0) {
    const recent = await db
      .select()
      .from(refreshRuns)
      .where(and(eq(refreshRuns.job, job), targetCond(target), ne(refreshRuns.status, 'skipped')))
      .orderBy(desc(refreshRuns.startedAt), desc(refreshRuns.id))
      .limit(1)
    const last = recent[0]
    if (last) {
      const nextAllowedAt = minutesAfter(last.startedAt, cooldown)
      if (nextAllowedAt > now) return skip(`Cooldown: refreshed at ${last.startedAt}; next manual refresh allowed at ${nextAllowedAt}`, nextAllowedAt)
    }
  }

  const [inserted] = await db
    .insert(refreshRuns)
    .values({ job, target, trigger, startedAt: now, status: 'running', attempts: 0, itemsWritten: 0 })
    .returning({ id: refreshRuns.id })
  const runId = inserted.id

  const ctx: JobContext = { db, now, deps, target, trigger, signal: args.signal }
  let attempts = 0
  let result: JobWorkResult | null = null
  let thrown: string | null = null
  while (attempts < maxAttempts) {
    attempts++
    if (attempts > 1 && args.signal?.aborted) break
    try {
      result = await work(ctx)
      thrown = null
      break
    } catch (e) {
      thrown = errorMessage(e)
      deps.log?.(`[${job}${target ? `:${target}` : ''}] attempt ${attempts} failed: ${thrown}`)
      if (attempts < maxAttempts) await sleep(backoffMs * 2 ** (attempts - 1))
    }
  }

  const items = result?.items ?? []
  const status: RunSummary['status'] = result ? statusFromItems(items) : 'error'
  const error = result ? itemsError(items) : truncate(thrown ?? 'Job failed')
  const itemsWritten = items.reduce((a, i) => a + (i.written || 0), 0)
  const finishedAt = clock()
  const details: RefreshRunDetails = { items, notes: result?.notes ?? [] }
  await db.update(refreshRuns).set({ status, finishedAt, attempts, itemsWritten, error, details }).where(eq(refreshRuns.id, runId))

  return {
    runId,
    job,
    target,
    trigger,
    status,
    startedAt: now,
    finishedAt,
    attempts,
    itemsWritten,
    error,
    items,
    notes: result?.notes ?? [],
    nextAllowedAt: null,
    changed: itemsWritten > 0,
  }
}

const LAST_SUCCESS_PAGE = 500

/**
 * Last successful update of a job (optionally for one target), per `successTargets`: only ok/partial runs count;
 * external jobs need a real successful fetch (a run that fetched nothing does not count); for a target, a global
 * run counts only when that target's own item succeeded — a partial run in which this resort failed does not
 * advance its "last successful update". Pages back through the whole history, so a source that has been failing
 * for months still reports its real last success instead of "never".
 */
export async function lastSuccess(db: Db, job: JobName, target: string | null = null): Promise<string | null> {
  // Only global runs can count for the job as a whole; for a target, its own runs and global runs.
  const scope = target === null ? isNull(refreshRuns.target) : or(isNull(refreshRuns.target), eq(refreshRuns.target, target))
  let cursor: { startedAt: string; id: number } | null = null
  for (;;) {
    const after: SQL | undefined = cursor
      ? or(lt(refreshRuns.startedAt, cursor.startedAt), and(eq(refreshRuns.startedAt, cursor.startedAt), lt(refreshRuns.id, cursor.id)))
      : undefined
    const rows: RefreshRunRow[] = await db
      .select()
      .from(refreshRuns)
      .where(and(eq(refreshRuns.job, job), inArray(refreshRuns.status, ['ok', 'partial']), scope, after))
      .orderBy(desc(refreshRuns.startedAt), desc(refreshRuns.id))
      .limit(LAST_SUCCESS_PAGE)
    for (const r of rows) {
      if (successTargets(r).includes(target)) return r.finishedAt ?? r.startedAt
    }
    if (rows.length < LAST_SUCCESS_PAGE) return null
    const last: RefreshRunRow = rows[rows.length - 1]
    cursor = { startedAt: last.startedAt, id: last.id }
  }
}

/** Most recent run of a job + target (any status). */
export async function lastRun(db: Db, job: JobName, target: string | null = null): Promise<RefreshRunRow | null> {
  const rows = await db
    .select()
    .from(refreshRuns)
    .where(and(eq(refreshRuns.job, job), targetCond(target)))
    .orderBy(desc(refreshRuns.startedAt), desc(refreshRuns.id))
    .limit(1)
  return rows[0] ?? null
}

/** Most recent run that actually ran (skipped rows — cooldown or overlap — are not attempts). */
export async function lastAttemptRun(db: Db, job: JobName, target: string | null = null): Promise<RefreshRunRow | null> {
  const rows = await db
    .select()
    .from(refreshRuns)
    .where(and(eq(refreshRuns.job, job), targetCond(target), ne(refreshRuns.status, 'skipped')))
    .orderBy(desc(refreshRuns.startedAt), desc(refreshRuns.id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * At worker start-up: scheduled runs still marked 'running' belong to a previous worker process that stopped
 * mid-run (only one worker runs scheduled jobs). Manual runs are left to the stale-run timer.
 */
export async function reapInterruptedScheduledRuns(db: Db, now: string): Promise<number> {
  const rows = await db
    .update(refreshRuns)
    .set({ status: 'error', finishedAt: now, error: 'Abandoned: the worker stopped before the run finished' })
    .where(and(eq(refreshRuns.status, 'running'), inArray(refreshRuns.trigger, ['schedule', 'startup'])))
    .returning({ id: refreshRuns.id })
  return rows.length
}
