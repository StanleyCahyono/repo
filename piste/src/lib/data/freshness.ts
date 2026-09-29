/**
 * "When was the data last updated?" for the top of Today, in live mode. The data is refreshed by the scheduler (the
 * worker, cron, or — in the single-file build — the page itself while it is open and online), so the question a
 * daily visit needs answered is simply whether today's refresh has happened, and if not, why.
 *
 * Honesty rules: the time shown is always the last SUCCESSFUL update (a failed or empty attempt never counts, the
 * same rule Sources & Sync uses via scanRunHistory); a failure after a success says the data on screen is from
 * then; demo mode has no freshness line (demo data is simulated, never fetched).
 */
import 'server-only'
import type { JobName } from '@/lib/jobs/types'
import { addDays, daysBetween, formatInstant, localDateOf } from '@/lib/domain/time'
import type { DataCtx } from './core'
import { scanRunHistory, type ScopeHistory } from './sources'

export type FreshnessState = 'never' | 'running' | 'current' | 'stale' | 'failed'

export interface FreshnessView {
  state: FreshnessState
  /** One sentence about the weather forecast, e.g. "Weather updated today 07:02". */
  text: string
  /** Alerts and exchange rates in a few words, e.g. "Alerts today 07:02 · Exchange rates today 07:03". */
  detail: string
  /** Last successful weather update (ISO), or null when it has never succeeded. */
  lastSuccessAt: string | null
}

export interface FreshnessInput {
  weather: ScopeHistory
  alerts: ScopeHistory
  fx: ScopeHistory
}

/** Jobs the "Update now" button runs, in this order. */
export const FRESHNESS_JOBS: readonly JobName[] = ['weather', 'nws-alerts', 'fx']

const EMPTY: ScopeHistory = { lastSuccessAt: null, lastAttempt: null, outcome: null }

/** "today 07:02", "yesterday 07:02", "Mon 07:02" within a week, else "Mon 21 Sep 07:02". */
export function whenLabel(instant: string, now: string, tz: string): string {
  const day = localDateOf(instant, tz)
  const today = localDateOf(now, tz)
  const time = formatInstant(instant, tz, 'HH:mm')
  if (day === today) return `today ${time}`
  if (day === addDays(today, -1)) return `yesterday ${time}`
  const ago = daysBetween(day, today)
  if (ago > 0 && ago < 6) return formatInstant(instant, tz, 'ccc HH:mm')
  return formatInstant(instant, tz, 'ccc d LLL HH:mm')
}

/** The time of the attempt a history ends with (its finish, or start while it runs). */
const attemptAt = (h: ScopeHistory) => h.lastAttempt?.finishedAt ?? h.lastAttempt?.startedAt ?? null

/** True when the newest attempt came after the last success and did not succeed. */
function failedSinceSuccess(h: ScopeHistory): boolean {
  if (h.outcome !== 'failed' && h.outcome !== 'nothing-fetched') return false
  const at = attemptAt(h)
  return !h.lastSuccessAt || (at !== null && at > h.lastSuccessAt)
}

function shortStatus(label: string, h: ScopeHistory, now: string, tz: string): string {
  if (h.outcome === 'running') return `${label} updating`
  if (failedSinceSuccess(h)) return `${label} failed${h.lastSuccessAt ? ` (last good ${whenLabel(h.lastSuccessAt, now, tz)})` : ''}`
  if (h.lastSuccessAt) return `${label} ${whenLabel(h.lastSuccessAt, now, tz)}`
  return `${label} not fetched yet`
}

/** Pure: run histories → the line Today shows. `now` is the app clock; `tz` the home time zone. */
export function freshnessState(input: FreshnessInput, now: string, tz: string): FreshnessView {
  const w = input.weather
  const detail = [shortStatus('Alerts', input.alerts, now, tz), shortStatus('Exchange rates', input.fx, now, tz)].join(' · ')
  const success = w.lastSuccessAt
  const at = attemptAt(w)

  if (w.outcome === 'running') {
    return { state: 'running', text: `Updating the weather now${success ? ` — the forecast shown is from ${whenLabel(success, now, tz)}` : ''}`, detail, lastSuccessAt: success }
  }
  if (!w.lastAttempt && !success) {
    return { state: 'never', text: 'Weather not fetched yet — Piste updates it while it is open and online', detail, lastSuccessAt: null }
  }
  if (failedSinceSuccess(w)) {
    const verb = w.outcome === 'nothing-fetched' ? 'fetched nothing' : 'failed'
    const when = at ? ` ${whenLabel(at, now, tz)}` : ''
    return {
      state: 'failed',
      text: success ? `Latest weather update ${verb}${when} — the forecast shown is from ${whenLabel(success, now, tz)}` : `Weather update ${verb}${when} — no forecast fetched yet`,
      detail,
      lastSuccessAt: success,
    }
  }
  if (success && localDateOf(success, tz) === localDateOf(now, tz)) {
    return { state: 'current', text: `Weather updated ${whenLabel(success, now, tz)}${w.outcome === 'partial' ? ' — some sources failed' : ''}`, detail, lastSuccessAt: success }
  }
  return {
    state: 'stale',
    text: success ? `Weather last updated ${whenLabel(success, now, tz)} — not yet today` : 'Weather not fetched yet — Piste updates it while it is open and online',
    detail,
    lastSuccessAt: success,
  }
}

/** Live mode only: null in demo mode (simulated data is never fetched). */
export async function getFreshness(ctx: DataCtx): Promise<FreshnessView | null> {
  if (ctx.mode === 'demo') return null
  const [weather, alerts, fx] = await Promise.all(FRESHNESS_JOBS.map((job) => scanRunHistory(ctx.db, job, [])))
  return freshnessState(
    { weather: weather.scopes.get(null) ?? EMPTY, alerts: alerts.scopes.get(null) ?? EMPTY, fx: fx.scopes.get(null) ?? EMPTY },
    ctx.now,
    ctx.prefs.homeTimezone,
  )
}
