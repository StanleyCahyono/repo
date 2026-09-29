/**
 * What counts as a "successful update" of a job (and of each resort it covers). Shared by `lastSuccess` (runner.ts)
 * and retention (maintenance.ts), so pruning can never delete the run that "last successful update" points at.
 * No job imports here: runner → work → maintenance must not form an import cycle.
 */
import type { RefreshRunRow } from '@/lib/db/rows'
import { EXTERNAL_JOBS } from './types'

/**
 * Targets whose "last successful update" a finished run advances; `null` stands for the job as a whole.
 *
 * - Only `ok` / `partial` runs count; a failed run never advances anything.
 * - Rows without per-item details (older or hand-written rows) are judged by their status alone.
 * - Jobs that call external sources count only when at least one real (non-skipped) fetch succeeded. A run that
 *   fetched nothing — no provider configured or disabled, every source unsupported, every item skipped, a target
 *   with no items — must not show live-looking freshness for a disconnected provider.
 * - For a resort, a global run counts only when that resort's own (non-skipped) item succeeded.
 */
export function successTargets(r: Pick<RefreshRunRow, 'job' | 'target' | 'status' | 'details'>): (string | null)[] {
  if (r.status !== 'ok' && r.status !== 'partial') return []
  if (!r.details) return [r.target]
  const external = (EXTERNAL_JOBS as readonly string[]).includes(r.job)
  const counted = (r.details.items ?? []).filter((i) => !i.skipped)
  if (r.target === null) {
    const okTargets = [...new Set(counted.filter((i) => i.ok && i.target !== null).map((i) => i.target as string))]
    return [...(!external || counted.some((i) => i.ok) ? [null] : []), ...okTargets]
  }
  const own = counted.filter((i) => i.target === r.target)
  // Local jobs (status, assessments, …): a targeted run with nothing to do is still a successful evaluation.
  const counts = external ? own.some((i) => i.ok) : r.status === 'ok' || own.length === 0 || own.some((i) => i.ok)
  return counts ? [r.target] : []
}
