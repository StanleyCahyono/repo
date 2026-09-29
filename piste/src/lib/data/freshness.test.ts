import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { freshnessState, whenLabel, type FreshnessInput } from './freshness'
import type { AttemptOutcome, RunView, ScopeHistory } from './sources'

const TZ = 'America/New_York'
// Tue 29 Sep 2026, 10:00 in Ithaca (EDT, UTC−4).
const NOW = '2026-09-29T14:00:00.000Z'
const TODAY_0702 = '2026-09-29T11:02:00.000Z'
const TODAY_0914 = '2026-09-29T13:14:00.000Z'
const YESTERDAY_0702 = '2026-09-28T11:02:00.000Z'

function run(at: string, status: RunView['status'] = 'ok'): RunView {
  return {
    id: 1,
    job: 'weather',
    target: null,
    trigger: 'schedule',
    status,
    startedAt: at,
    finishedAt: at,
    attempts: 1,
    itemsWritten: 0,
    error: null,
    notes: [],
    items: { ok: 1, failed: 0, skipped: 0 },
  }
}

function scope(lastSuccessAt: string | null, attemptAt: string | null, outcome: AttemptOutcome | null): ScopeHistory {
  return { lastSuccessAt, lastAttempt: attemptAt ? run(attemptAt) : null, outcome }
}

const NEVER = scope(null, null, null)
const input = (weather: ScopeHistory, alerts: ScopeHistory = NEVER, fx: ScopeHistory = NEVER): FreshnessInput => ({ weather, alerts, fx })

describe('whenLabel', () => {
  it('uses the home time zone and calendar days, not 24-hour windows', () => {
    expect(whenLabel(TODAY_0702, NOW, TZ)).toBe('today 07:02')
    expect(whenLabel(YESTERDAY_0702, NOW, TZ)).toBe('yesterday 07:02')
    // 23:30 local on the 27th is two calendar days back, though under 48 h ago.
    expect(whenLabel('2026-09-28T03:30:00.000Z', NOW, TZ)).toBe('Sun 23:30')
    expect(whenLabel('2026-09-20T11:02:00.000Z', NOW, TZ)).toBe('Sun 20 Sep 07:02')
  })
})

describe('freshnessState', () => {
  it('says so when nothing has ever been fetched', () => {
    const f = freshnessState(input(NEVER), NOW, TZ)
    expect(f.state).toBe('never')
    expect(f.text).toMatch(/not fetched yet/)
    expect(f.lastSuccessAt).toBeNull()
    expect(f.detail).toBe('Alerts not fetched yet · Exchange rates not fetched yet')
  })

  it('is current when the last success is today', () => {
    const f = freshnessState(input(scope(TODAY_0702, TODAY_0702, 'ok'), scope(TODAY_0702, TODAY_0702, 'ok'), scope(YESTERDAY_0702, YESTERDAY_0702, 'ok')), NOW, TZ)
    expect(f.state).toBe('current')
    expect(f.text).toBe('Weather updated today 07:02')
    expect(f.detail).toBe('Alerts today 07:02 · Exchange rates yesterday 07:02')
  })

  it('mentions failed sources on a partial success', () => {
    const f = freshnessState(input(scope(TODAY_0702, TODAY_0702, 'partial')), NOW, TZ)
    expect(f.state).toBe('current')
    expect(f.text).toBe('Weather updated today 07:02 — some sources failed')
  })

  it('is stale when the last success was before today', () => {
    const f = freshnessState(input(scope(YESTERDAY_0702, YESTERDAY_0702, 'ok')), NOW, TZ)
    expect(f.state).toBe('stale')
    expect(f.text).toBe('Weather last updated yesterday 07:02 — not yet today')
  })

  it('never counts a failed attempt as an update, and says what is on screen', () => {
    const f = freshnessState(input(scope(YESTERDAY_0702, TODAY_0914, 'failed')), NOW, TZ)
    expect(f.state).toBe('failed')
    expect(f.lastSuccessAt).toBe(YESTERDAY_0702)
    expect(f.text).toBe('Latest weather update failed today 09:14 — the forecast shown is from yesterday 07:02')
  })

  it('reports a failure with no earlier success', () => {
    const f = freshnessState(input(scope(null, TODAY_0914, 'failed')), NOW, TZ)
    expect(f.state).toBe('failed')
    expect(f.text).toBe('Weather update failed today 09:14 — no forecast fetched yet')
  })

  it('treats an attempt that fetched nothing like a failure', () => {
    const f = freshnessState(input(scope(YESTERDAY_0702, TODAY_0914, 'nothing-fetched')), NOW, TZ)
    expect(f.state).toBe('failed')
    expect(f.text).toMatch(/^Latest weather update fetched nothing today 09:14/)
  })

  it('shows an update in progress with the data it replaces', () => {
    const f = freshnessState(input(scope(YESTERDAY_0702, TODAY_0914, 'running')), NOW, TZ)
    expect(f.state).toBe('running')
    expect(f.text).toBe('Updating the weather now — the forecast shown is from yesterday 07:02')
  })

  it('summarises failing alerts and exchange rates in the detail', () => {
    const f = freshnessState(input(scope(TODAY_0702, TODAY_0702, 'ok'), scope(YESTERDAY_0702, TODAY_0914, 'failed'), scope(null, TODAY_0914, 'failed')), NOW, TZ)
    expect(f.detail).toBe('Alerts failed (last good yesterday 07:02) · Exchange rates failed')
  })
})
