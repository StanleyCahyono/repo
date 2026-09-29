import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { sourceRecords, weatherAlerts, weatherPoints, weatherRuns } from '@/lib/db/schema'
import { addHours } from '@/lib/domain/time'
import { provenance } from '@/lib/domain/types'
import type { HourlyWeather, WeatherPointRequest } from '@/lib/providers/types'
import { lastSuccess, runJob } from './runner'
import { addResort, blankHour, deps, fail, fakeAlerts, fakeWeather, hours, ok, series, T0, testDb } from './test-helpers'
import type { JobContext } from './types'
import { latestOkRuns, persistWeatherSeries, pruneWeatherRuns, refreshOfficialAlerts, refreshWeather, usableHourCount, weatherLocalDate } from './weather'

const ctx = (db: JobContext['db'], over: Partial<JobContext> = {}): JobContext => ({ db, now: T0, deps: deps(), target: null, trigger: 'schedule', ...over })

describe('weather points: resort-local day attribution', () => {
  it('puts a preceding-hour accumulation stamped local midnight on the previous day', () => {
    // 2027-01-16T05:00Z is 00:00 EST on 16 Jan; under preceding-hour it covers 23:00–24:00 on 15 Jan.
    expect(weatherLocalDate('2027-01-16T05:00:00.000Z', 'preceding-hour', 'America/New_York')).toBe('2027-01-15')
    expect(weatherLocalDate('2027-01-16T05:00:00.000Z', 'following-hour', 'America/New_York')).toBe('2027-01-16')
    expect(weatherLocalDate('2027-01-16T05:00:00.000Z', 'instant', 'America/New_York')).toBe('2027-01-16')
  })

  it('persists 25 hours on the autumn DST day and 23 on the spring one, with the midnight stamp on the prior day', async () => {
    const db = await testDb()
    const resort = await addResort(db, { id: 'greek-peak', timezone: 'America/New_York' })
    const req: WeatherPointRequest = { resortId: 'greek-peak', pointKey: 'base', lat: 42.5, lon: -76.1, elevationM: 350, timezone: 'America/New_York', country: 'US' }
    const persist = async (from: string, n: number) => {
      const s = series(req, hours(from, n))
      return persistWeatherSeries(db, {
        resort,
        request: req,
        providerId: 'open-meteo',
        series: s,
        provenance: provenance({ kind: 'modeled', provider: 'Open-Meteo', fetchedAt: T0 }),
        capabilities: { supplied: [], missing: [], limitations: [] },
        now: T0,
      })
    }
    // Autumn: clocks go back 2026-11-01 02:00 EDT → 01:00 EST (25-hour day). Stamps from 31 Oct 00:00 EDT.
    const autumn = await persist('2026-10-31T04:00:00Z', 96)
    const pts = await db.select().from(weatherPoints).where(eq(weatherPoints.runId, autumn.runId))
    const perDay = (d: string) => pts.filter((p) => p.localDate === d).length
    expect(perDay('2026-11-01')).toBe(25)
    expect(perDay('2026-11-02')).toBe(24)
    // 2026-11-02T05:00Z = 00:00 EST on 2 Nov → its hour belongs to 1 Nov.
    expect(pts.find((p) => p.validTime === '2026-11-02T05:00:00.000Z')?.localDate).toBe('2026-11-01')
    // Stored as the provider stamped it (UTC), not shifted.
    expect(pts.some((p) => p.validTime === '2026-10-31T04:00:00.000Z')).toBe(true)

    // Spring: 2027-03-14 02:00 EST → 03:00 EDT (23-hour day).
    const spring = await persist('2027-03-13T05:00:00Z', 96)
    const sp = await db.select().from(weatherPoints).where(eq(weatherPoints.runId, spring.runId))
    expect(sp.filter((p) => p.localDate === '2027-03-14').length).toBe(23)
    expect(sp.find((p) => p.validTime === '2027-03-15T04:00:00.000Z')?.localDate).toBe('2027-03-14')

    const [run] = await db.select().from(weatherRuns).where(eq(weatherRuns.id, autumn.runId))
    expect(run.intervalSemantics).toBe('preceding-hour')
    expect(run.gridElevationM).toBe(2550) // as returned by the provider
    expect(run.modelRunAt).toBeNull() // not supplied → never inferred
  })

  it('drops unparseable stamps and de-duplicates repeated hours instead of failing the run', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    const provider = fakeWeather((req) => {
      const h = hours('2027-01-15T00:00:00Z', 3)
      return ok(series(req, [...h, { ...h[1], snowfallCm: 2 }, { ...h[0], validTime: 'not-a-time' }]), T0)
    })
    const res = await refreshWeather(ctx(db, { deps: deps({ weatherProviders: [provider] }) }))
    expect(res.items.every((i) => i.ok)).toBe(true)
    const runs = await db.select().from(weatherRuns)
    const pts = await db.select().from(weatherPoints).where(eq(weatherPoints.runId, runs[0].id))
    expect(pts).toHaveLength(3)
    expect(pts.find((p) => p.validTime === '2027-01-15T01:00:00.000Z')?.snowfallCm).toBe(2)
  })

  it('never fetches live weather into the demo database', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    const provider = fakeWeather((req) => ok(series(req, hours(T0, 2)), T0))
    const res = await refreshWeather(ctx(db, { deps: deps({ weatherProviders: [provider], demo: true }) }))
    expect(provider.calls).toHaveLength(0)
    expect(res.items).toHaveLength(0)
  })
})

describe('weather: a response without usable hours is a schema change, not a forecast', () => {
  /** A good run, then the same provider answers "ok" with `bad` hours. */
  async function goodThenBad(bad: HourlyWeather[]) {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    let respond: HourlyWeather[] = hours('2027-01-14T00:00:00Z', 48)
    const provider = fakeWeather((req) => ok(series(req, respond), T0))
    const run = (now: string) => runJob({ db, job: 'weather', trigger: 'schedule', now, deps: deps({ weatherProviders: [provider] }), maxAttempts: 1 })
    expect((await run(T0)).status).toBe('ok')
    const goodIds = [...(await latestOkRuns(db, 'alta')).values()].map((r) => r.id).sort()
    const pointsBefore = (await db.select().from(weatherPoints)).length
    respond = bad
    const later = addHours(T0, 3)
    const summary = await run(later)
    return { db, summary, goodIds, pointsBefore, later }
  }

  async function expectLastGoodRunKept(r: Awaited<ReturnType<typeof goodThenBad>>, records: number) {
    const { db, summary, goodIds, pointsBefore } = r
    // Every point failed as a non-retriable schema change; the job is an error and "last success" does not move.
    expect(summary.status).toBe('error')
    expect(summary.items.every((i) => !i.ok && /^schema-changed: .*no usable hourly values/.test(i.error ?? ''))).toBe(true)
    expect(await lastSuccess(db, 'weather', 'alta')).toBe(T0)
    // The last good runs are still the latest ok runs, with all their points.
    expect([...(await latestOkRuns(db, 'alta')).values()].map((x) => x.id).sort()).toEqual(goodIds)
    expect((await db.select().from(weatherPoints)).length).toBe(pointsBefore)
    // The failure is visible: an error run per point and a failed fetch record with the parser error.
    const errors = await db.select().from(weatherRuns).where(eq(weatherRuns.status, 'error'))
    expect(errors).toHaveLength(2)
    expect(errors.every((e) => e.error?.includes(`(${records} record`))).toBe(true)
    const recs = await db.select().from(sourceRecords).orderBy(sourceRecords.id)
    const last = recs[recs.length - 1]
    expect(last.ok).toBe(false)
    expect(last.parserErrors?.[0]).toMatch(/no usable hourly values/)
  }

  it('an empty time axis keeps the last good forecast', async () => {
    await expectLastGoodRunKept(await goodThenBad([]), 0)
  })

  it('24 hours of nulls (renamed variables) keep the last good forecast; isDay alone is not weather', async () => {
    await expectLastGoodRunKept(await goodThenBad(hours('2027-01-15T00:00:00Z', 24, () => ({ isDay: true }))), 24)
  })

  it('counts an hour as usable when it has a valid time and any finite weather value', () => {
    const t = '2027-01-15T00:00:00Z'
    expect(usableHourCount([])).toBe(0)
    expect(usableHourCount([{ ...blankHour(t), snowDepthM: 1.2 }, { ...blankHour('not-a-time'), temperatureC: -3 }, { ...blankHour(t), windKmh: Number.NaN }])).toBe(1)
  })
})

describe('weather retention', () => {
  it('keeps every recent run and the first successful run per resort / point / local day for older ones', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta', timezone: 'America/Denver' })
    const insertRun = async (fetchedAt: string, status: 'ok' | 'error' = 'ok') => {
      const [r] = await db
        .insert(weatherRuns)
        .values({
          resortId: 'alta',
          pointKey: 'base',
          provider: 'open-meteo',
          model: 'best_match',
          kind: 'modeled',
          requestedLat: 40.59,
          requestedLon: -111.64,
          fetchedAt,
          timezone: 'America/Denver',
          variables: [],
          units: {},
          intervalSemantics: 'preceding-hour',
          status,
          prov: provenance({ kind: 'modeled', provider: 'Open-Meteo', fetchedAt }),
        })
        .returning()
      await db.insert(weatherPoints).values({ runId: r.id, validTime: fetchedAt, localDate: fetchedAt.slice(0, 10), snowfallCm: 1 })
      return r
    }
    const jan1a = await insertRun('2027-01-01T08:00:00.000Z') // 01:00 MST 1 Jan — first of the local day
    await insertRun('2027-01-01T10:00:00.000Z', 'error')
    await insertRun('2027-01-01T14:00:00.000Z')
    await insertRun('2027-01-02T03:00:00.000Z') // 20:00 MST on 1 Jan — same local day, not first
    const jan2 = await insertRun('2027-01-02T08:00:00.000Z') // first of 2 Jan (local)
    await insertRun('2027-01-02T20:00:00.000Z')
    const recent1 = await insertRun('2027-01-25T08:00:00.000Z')
    const recent2 = await insertRun('2027-01-25T11:00:00.000Z')

    const now = '2027-01-30T12:00:00.000Z'
    const res = await pruneWeatherRuns(db, now, 14)
    expect(res.runsDeleted).toBe(4)
    const left = await db.select().from(weatherRuns).orderBy(weatherRuns.id)
    expect(left.map((r) => r.id)).toEqual([jan1a.id, jan2.id, recent1.id, recent2.id])
    // Kept rows are untouched — never rewritten with newer data.
    expect(left[0]).toEqual(jan1a)
    // Points of deleted runs are gone; kept runs keep theirs.
    const pts = await db.select().from(weatherPoints)
    expect(new Set(pts.map((p) => p.runId))).toEqual(new Set(left.map((r) => r.id)))
    // Idempotent.
    expect((await pruneWeatherRuns(db, now, 14)).runsDeleted).toBe(0)
  })
})

describe('official alerts', () => {
  it('upserts active alerts, removes ended or withdrawn ones, and keeps existing alerts when a fetch fails', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    const a = (id: string, ends: string | null) => ({ id, event: 'Winter Storm Warning', headline: null, severity: 'Severe', onset: T0, ends, url: null })
    let response = ok([a('w1', '2027-01-16T00:00:00Z'), a('w2', null), a('old', '2027-01-15T10:00:00Z')], T0)
    const provider = fakeAlerts(() => response)
    const run = (now = T0) => refreshOfficialAlerts(ctx(db, { now, deps: deps({ alertsProvider: provider }) }))

    await run()
    expect((await db.select().from(weatherAlerts)).map((r) => r.id).sort()).toEqual(['alta|w1', 'alta|w2'])

    response = fail('HTTP 503', 'http')
    const failed = await run('2027-01-15T15:00:00.000Z')
    expect(failed.items[0].ok).toBe(false)
    expect((await db.select().from(weatherAlerts)).length).toBe(2)

    // w1 ends; the issuer withdrew w2 (no longer returned).
    response = ok([], T0)
    await run('2027-01-16T01:00:00.000Z')
    expect(await db.select().from(weatherAlerts)).toHaveLength(0)
  })
})
