import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { refreshRuns, weatherPoints, weatherRuns } from '@/lib/db/schema'
import { addHours } from '@/lib/domain/time'
import { lastSuccess, runJob } from './runner'
import { addResort, deps, fail, fakeWeather, hours, ok, series, T0, testDb } from './test-helpers'
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
