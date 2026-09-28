import { describe, expect, it } from 'vitest'
import { refreshRuns } from '@/lib/db/schema'
import { addHours } from '@/lib/domain/time'
import { cadencesFromEnv, DEFAULT_CADENCES, isResortDaytime, jitterMinutes, newTickState, nextDueAt, reportsCadenceMin, tick } from './schedule'
import { addResort, deps, fakeReports, parsedReport, reportResult, T0, testDb } from './test-helpers'
import { getMeta } from './util'

describe('cadences', () => {
  it('reads cadences from the environment and ignores invalid values', () => {
    const c = cadencesFromEnv({ PISTE_WEATHER_EVERY_MIN: '240', PISTE_REPORTS_EVERY_MIN: 'abc', PISTE_FX_EVERY_MIN: '-5' })
    expect(c.weatherMin).toBe(240)
    expect(c.reportsDayMin).toBe(DEFAULT_CADENCES.reportsDayMin)
    expect(c.fxMin).toBe(DEFAULT_CADENCES.fxMin)
  })

  it('refreshes reports hourly in resort-local daytime and every 4 h otherwise', () => {
    const c = DEFAULT_CADENCES
    // 14:00Z = 07:00 in Denver, 09:00 in New York.
    expect(reportsCadenceMin('2027-01-15T14:00:00.000Z', 'America/Denver', c)).toBe(60)
    // 01:30Z = 18:30 in Denver (after 18:00) → night cadence.
    expect(reportsCadenceMin('2027-01-16T01:30:00.000Z', 'America/Denver', c)).toBe(240)
    // 12:30Z = 05:30 Denver (before 06:00) but 13:30 in St. Anton.
    expect(reportsCadenceMin('2027-01-15T12:30:00.000Z', 'America/Denver', c)).toBe(240)
    expect(reportsCadenceMin('2027-01-15T12:30:00.000Z', 'Europe/Vienna', c)).toBe(60)
  })

  it('uses the local clock across DST: 06:00 local is a different UTC hour in winter and summer', () => {
    expect(isResortDaytime('2027-03-13T11:30:00.000Z', 'America/New_York', '06:00', '18:00')).toBe(true) // 06:30 EST
    expect(isResortDaytime('2027-03-14T09:30:00.000Z', 'America/New_York', '06:00', '18:00')).toBe(false) // 05:30 EDT
    expect(isResortDaytime('2027-03-14T10:30:00.000Z', 'America/New_York', '06:00', '18:00')).toBe(true) // 06:30 EDT
  })

  it('keeps jitter within ± the configured fraction and retries errors sooner', () => {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const j = jitterMinutes(180, 0.1, () => r)
      expect(Math.abs(j)).toBeLessThanOrEqual(18)
    }
    expect(nextDueAt(null, 180, 0, DEFAULT_CADENCES)).toBeNull()
    expect(nextDueAt({ startedAt: T0, status: 'ok' }, 180, 12, DEFAULT_CADENCES)).toBe('2027-01-15T17:12:00.000Z')
    expect(nextDueAt({ startedAt: T0, status: 'error' }, 180, 12, DEFAULT_CADENCES)).toBe('2027-01-15T14:30:00.000Z')
  })
})

describe('scheduler tick', () => {
  it('runs every never-run task at startup, writes a heartbeat, then waits for cadences', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    const d = deps({ reportProviders: [fakeReports('alta', () => reportResult(parsedReport(), T0))] })
    const state = newTickState()
    let now = T0
    const first = await tick({ db, deps: d, cadences: DEFAULT_CADENCES, clock: () => now, state, rng: () => 0.5 })
    const jobs = first.map((s) => `${s.job}${s.target ? `:${s.target}` : ''}`)
    expect(jobs).toEqual(['weather', 'nws-alerts', 'reports:alta', 'status', 'assessments', 'fx', 'links', 'prune', 'alerts'])
    expect(first.every((s) => s.trigger === 'startup')).toBe(true)
    expect(await getMeta(db, 'scheduler.heartbeat')).toBe(T0)

    now = addHours(T0, 0.5)
    expect(await tick({ db, deps: d, cadences: DEFAULT_CADENCES, clock: () => now, state, rng: () => 0.5 })).toHaveLength(0)
    expect(await getMeta(db, 'scheduler.heartbeat')).toBe(now)

    // 07:00 Denver + 61 min: the daytime report cadence (60 min) is due again, weather (180) is not.
    now = addHours(T0, 61 / 60)
    const third = await tick({ db, deps: d, cadences: { ...DEFAULT_CADENCES, jitterPct: 0 }, clock: () => now, state, rng: () => 0.5 })
    expect(third.map((s) => `${s.job}${s.target ? `:${s.target}` : ''}`)).toEqual(['nws-alerts', 'reports:alta', 'alerts'])
    expect((await db.select().from(refreshRuns)).every((r) => r.status !== 'running')).toBe(true)
  })

  it('stops between tasks when asked to shut down', async () => {
    const db = await testDb()
    const ac = new AbortController()
    ac.abort()
    const ran = await tick({ db, deps: deps(), cadences: DEFAULT_CADENCES, clock: () => T0, state: newTickState(), signal: ac.signal })
    expect(ran).toHaveLength(0)
  })
})
