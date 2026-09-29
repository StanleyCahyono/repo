import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { refreshRuns, weatherPoints, weatherRuns, type RefreshItemOutcome } from '@/lib/db/schema'
import { addHours } from '@/lib/domain/time'
import { lastSuccess, runJob, successTargets } from './runner'
import { addResort, deps, fail, fakeWeather, hours, ok, series, T0, testDb } from './test-helpers'
import { chunk } from './util'
import { latestOkRuns } from './weather'

const later = (h: number) => addHours(T0, h)

describe('runJob — refresh failure behaviour', () => {
  it('a failed refresh keeps the last good run and does not advance lastSuccess', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    let mode: 'ok' | 'fail' = 'ok'
    const provider = fakeWeather((req) => (mode === 'ok' ? ok(series(req, hours('2027-01-14T00:00:00Z', 48)), T0) : fail('upstream timeout after 15 s')))

    const good = await runJob({ db, job: 'weather', trigger: 'schedule', now: T0, deps: deps({ weatherProviders: [provider] }) })
    expect(good.status).toBe('ok')
    expect(await lastSuccess(db, 'weather')).toBe(T0)
    const goodRuns = await latestOkRuns(db, 'alta')
    const goodIds = [...goodRuns.values()].map((r) => r.id).sort()
    const pointsBefore = (await db.select().from(weatherPoints)).length

    mode = 'fail'
    const bad = await runJob({ db, job: 'weather', trigger: 'schedule', now: later(3), deps: deps({ weatherProviders: [provider] }), maxAttempts: 1 })
    expect(bad.status).toBe('error')
    expect(bad.error).toMatch(/timeout/)
    // "Last successfully updated" is unchanged, for the job and for the resort.
    expect(await lastSuccess(db, 'weather')).toBe(T0)
    expect(await lastSuccess(db, 'weather', 'alta')).toBe(T0)
    // The last good runs are still the latest ok runs, with all their points.
    expect([...(await latestOkRuns(db, 'alta')).values()].map((r) => r.id).sort()).toEqual(goodIds)
    expect((await db.select().from(weatherPoints)).length).toBe(pointsBefore)
    // The failure is visible (error rows for Sources), not silent.
    const errors = await db.select().from(weatherRuns).where(eq(weatherRuns.status, 'error'))
    expect(errors).toHaveLength(2)
    expect(errors[0].error).toMatch(/timeout/)
  })

  it('isolates per-source failures: one resort failing does not abort the others', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    await addResort(db, { id: 'greek-peak', timezone: 'America/New_York' })
    const provider = fakeWeather((req) => {
      if (req.resortId === 'alta') throw new Error('socket hang up')
      return ok(series(req, hours('2027-01-14T00:00:00Z', 24)), T0)
    })
    const s = await runJob({ db, job: 'weather', trigger: 'schedule', now: T0, deps: deps({ weatherProviders: [provider] }) })
    expect(s.status).toBe('partial')
    expect(provider.calls.map((c) => c.resortId)).toEqual(expect.arrayContaining(['alta', 'greek-peak']))
    expect((await latestOkRuns(db, 'greek-peak')).size).toBe(2)
    expect((await latestOkRuns(db, 'alta')).size).toBe(0)
    // A partial run advances the job and the resort that succeeded — not the one that failed.
    expect(await lastSuccess(db, 'weather')).toBe(T0)
    expect(await lastSuccess(db, 'weather', 'greek-peak')).toBe(T0)
    expect(await lastSuccess(db, 'weather', 'alta')).toBeNull()
    const [run] = await db.select().from(refreshRuns)
    expect(run.details?.items.filter((i) => !i.ok).map((i) => i.target)).toEqual(['alta', 'alta'])
  })

  it('retries a job whose body throws, then records the error with the attempt count', async () => {
    const db = await testDb()
    let calls = 0
    const s = await runJob({
      db,
      job: 'prune',
      trigger: 'schedule',
      now: T0,
      deps: deps(),
      maxAttempts: 3,
      work: async () => {
        calls++
        throw new Error('database is locked')
      },
    })
    expect(calls).toBe(3)
    expect(s.status).toBe('error')
    expect(s.attempts).toBe(3)
    expect(await lastSuccess(db, 'prune')).toBeNull()
  })
})

describe('last successful update', () => {
  it('does not advance when an external job fetched nothing (no provider, every point unsupported)', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    const weather = (now: string, over = {}) => runJob({ db, job: 'weather', trigger: 'schedule', now, deps: deps(over) })

    // No weather provider configured (or PISTE_DISABLED_PROVIDERS=open-meteo): the run is "ok" with nothing done.
    const none = await weather(T0)
    expect(none.status).toBe('ok')
    expect(none.notes).toEqual(['No weather provider configured'])
    // A provider that supports none of the points: every item is skipped.
    const provider = fakeWeather((req) => ok(series(req, hours('2027-01-14T00:00:00Z', 24)), T0))
    const unsupported = await weather(later(1), { weatherProviders: [{ ...provider, supports: () => false }] })
    expect(unsupported.items.every((i) => i.skipped)).toBe(true)
    // A targeted run of an external job with nothing to fetch for that target.
    await runJob({ db, job: 'reports', target: 'alta', trigger: 'schedule', now: later(1), deps: deps() })
    expect(await lastSuccess(db, 'weather')).toBeNull()
    expect(await lastSuccess(db, 'weather', 'alta')).toBeNull()
    expect(await lastSuccess(db, 'reports', 'alta')).toBeNull()

    // A real fetch advances both.
    await weather(later(2), { weatherProviders: [provider] })
    expect(await lastSuccess(db, 'weather')).toBe(later(2))
    expect(await lastSuccess(db, 'weather', 'alta')).toBe(later(2))

    // Local jobs are unchanged: evaluating and finding nothing to change is a successful run.
    await runJob({ db, job: 'status', target: 'alta', trigger: 'schedule', now: later(3), deps: deps() })
    expect(await lastSuccess(db, 'status', 'alta')).toBe(later(3))
  })

  it('finds a resort’s last success behind more than 500 later runs in which it failed', async () => {
    const db = await testDb()
    const item = (target: string, okay: boolean): RefreshItemOutcome => ({ key: `${target}:base:open-meteo`, target, ok: okay, written: okay ? 10 : 0, error: okay ? null : 'timeout' })
    const run = (job: string, startedAt: string, status: 'ok' | 'partial', items: RefreshItemOutcome[]) => ({
      job,
      target: null,
      trigger: 'schedule' as const,
      startedAt,
      finishedAt: startedAt,
      status,
      details: { items },
    })
    await db.insert(refreshRuns).values(run('weather', T0, 'ok', [item('alta', true), item('greek-peak', true)]))
    const failing = Array.from({ length: 600 }, (_, i) => run('weather', later(3 * (i + 1)), 'partial', [item('alta', false), item('greek-peak', true)]))
    for (const part of chunk(failing, 100)) await db.insert(refreshRuns).values(part)
    expect(await lastSuccess(db, 'weather', 'alta')).toBe(T0)
    expect(await lastSuccess(db, 'weather', 'greek-peak')).toBe(later(1800))
    expect(await lastSuccess(db, 'weather')).toBe(later(1800))

    // Page boundaries inside runs that share a start time are ordered by id, so none is skipped.
    const t = later(5)
    await db.insert(refreshRuns).values(run('nws-alerts', t, 'ok', [item('alta', true)]))
    const sameTime = Array.from({ length: 500 }, () => run('nws-alerts', t, 'partial', [item('alta', false), item('greek-peak', true)]))
    for (const part of chunk(sameTime, 100)) await db.insert(refreshRuns).values(part)
    expect(await lastSuccess(db, 'nws-alerts', 'alta')).toBe(t)
    expect(await lastSuccess(db, 'nws-alerts', 'stowe')).toBeNull()
  })

  it('successTargets: which job + targets a finished run counts for', () => {
    const items = (...xs: [string | null, boolean, boolean?][]) => ({ items: xs.map(([target, okay, skipped]) => ({ key: String(target), target, ok: okay, skipped, written: 0 })) })
    expect(successTargets({ job: 'weather', target: null, status: 'error', details: items(['alta', false]) })).toEqual([])
    expect(successTargets({ job: 'weather', target: null, status: 'partial', details: items(['alta', true], ['stowe', false]) })).toEqual([null, 'alta'])
    expect(successTargets({ job: 'weather', target: null, status: 'ok', details: items(['alta', true, true]) })).toEqual([])
    expect(successTargets({ job: 'fx', target: null, status: 'ok', details: items([null, true]) })).toEqual([null])
    expect(successTargets({ job: 'reports', target: 'alta', status: 'ok', details: items() })).toEqual([])
    expect(successTargets({ job: 'reports', target: 'alta', status: 'ok', details: null })).toEqual(['alta'])
    expect(successTargets({ job: 'assessments', target: null, status: 'ok', details: items() })).toEqual([null])
    expect(successTargets({ job: 'status', target: 'alta', status: 'ok', details: items(['alta', true, true]) })).toEqual(['alta'])
  })
})

describe('runJob — manual refresh cooldown and overlap', () => {
  it('skips a manual refresh within the cooldown and reports when the next one is allowed', async () => {
    const db = await testDb()
    let calls = 0
    const work = async () => {
      calls++
      return { items: [{ key: 'x', target: 'alta', ok: true, written: 1 }] }
    }
    const first = await runJob({ db, job: 'reports', target: 'alta', trigger: 'manual', now: T0, deps: deps(), work })
    expect(first.status).toBe('ok')

    const second = await runJob({ db, job: 'reports', target: 'alta', trigger: 'manual', now: addHours(T0, 5 / 60), deps: deps(), work })
    expect(second.status).toBe('skipped')
    expect(second.nextAllowedAt).toBe('2027-01-15T14:10:00.000Z')
    expect(calls).toBe(1)

    // A skipped attempt does not extend the cooldown; other targets are independent.
    const other = await runJob({ db, job: 'reports', target: 'greek-peak', trigger: 'manual', now: addHours(T0, 6 / 60), deps: deps(), work })
    expect(other.status).toBe('ok')
    const third = await runJob({ db, job: 'reports', target: 'alta', trigger: 'manual', now: addHours(T0, 11 / 60), deps: deps(), work })
    expect(third.status).toBe('ok')
    expect(calls).toBe(3)
  })

  it('never overlaps a job + target that is still running; stale running rows are reaped', async () => {
    const db = await testDb()
    await db.insert(refreshRuns).values({ job: 'weather', target: null, trigger: 'schedule', startedAt: T0, status: 'running' })
    const work = async () => ({ items: [] })
    const blocked = await runJob({ db, job: 'weather', trigger: 'schedule', now: addHours(T0, 0.1), deps: deps(), work })
    expect(blocked.status).toBe('skipped')
    const after = await runJob({ db, job: 'weather', trigger: 'schedule', now: addHours(T0, 2), deps: deps(), work })
    expect(after.status).toBe('ok')
    const rows = await db.select().from(refreshRuns).orderBy(refreshRuns.id)
    expect(rows[0].status).toBe('error')
    expect(rows[0].error).toMatch(/Abandoned/)
  })
})
