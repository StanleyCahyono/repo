import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { eq } from 'drizzle-orm'
import { favorites, refreshRuns, sourceRecords, tripItems, trips } from '@/lib/db/schema'
import { getLiftsRuns } from '@/lib/data/lifts'
import type { SkiAreaExtract } from '@/lib/domain/lifts'
import { addHours, addDays } from '@/lib/domain/time'
import { defaultPreferences } from '@/lib/domain/defaults'
import { provenance } from '@/lib/domain/types'
import { readSkiAreaExtract } from '@/lib/providers/osm/extract'
import type { ProviderResult, SkiAreaProvider, SkiAreaRequest } from '@/lib/providers/types'
import { pruneAll } from './maintenance'
import { osmTargets, refreshOsm } from './osm'
import { lastSuccess, runJob } from './runner'
import { DEFAULT_CADENCES, newTickState, planTasks, runOnce, tick } from './schedule'
import { addResort, deps, T0, testDb } from './test-helpers'
import type { JobContext } from './types'

const ENDPOINT = 'https://overpass-api.de/api/interpreter'

const EXTRACT: SkiAreaExtract = {
  v: 1,
  method: 'area',
  areas: [{ osm: 'way/25712340', name: 'Alta Ski Area' }],
  bbox: null,
  osmTimestamp: '2027-01-15T10:00:00Z',
  lifts: [{ osm: 'way/1', name: 'Collins', ref: null, type: 'chair_lift', lengthM: 1250, capacityPerHour: 1800, occupancy: 3, durationMin: 7 }],
  runs: [
    { osm: 'way/2', name: 'Ballroom', ref: null, difficulty: 'advanced', grooming: null, lengthM: 900, segments: 1 },
    { osm: 'relation/3', name: "Devil's Castle", ref: null, difficulty: 'expert', grooming: null, lengthM: 600, segments: 2 },
  ],
  unnamed: [{ difficulty: 'easy', segments: 2, lengthM: 300 }],
  areaPistes: 0,
}

function okResult(fetchedAt = T0, data: SkiAreaExtract = EXTRACT): ProviderResult<SkiAreaExtract> {
  return {
    ok: true,
    data,
    provenance: provenance({ kind: 'manual', provider: 'OpenStreetMap contributors (ODbL)', fetchedAt, verification: 'unverified' }),
    capabilities: { supplied: ['lifts', 'runs'], missing: ['live lift status'], limitations: [] },
    fetches: [
      { url: ENDPOINT, fetchedAt, httpStatus: 200, contentHash: 'a', ok: true },
      { url: ENDPOINT, fetchedAt, httpStatus: 200, contentHash: 'b', ok: true },
    ],
  }
}

const failed = (fetchedAt = T0): ProviderResult<SkiAreaExtract> => ({
  ok: false,
  error: 'Overpass API: HTTP 504 Gateway Timeout',
  errorKind: 'http',
  retriable: true,
  fetches: [{ url: ENDPOINT, fetchedAt, httpStatus: 504, contentHash: null, ok: false, error: 'HTTP 504' }],
})

function fakeOsm(respond: (req: SkiAreaRequest) => ProviderResult<SkiAreaExtract>): SkiAreaProvider & { calls: SkiAreaRequest[] } {
  const calls: SkiAreaRequest[] = []
  return {
    id: 'osm-overpass',
    label: 'OpenStreetMap lifts & runs (Overpass API)',
    endpoint: ENDPOINT,
    calls,
    async fetchSkiArea(req) {
      calls.push(req)
      return respond(req)
    },
  }
}

const ctx = (db: JobContext['db'], over: Partial<JobContext> = {}): JobContext => ({ db, now: T0, deps: deps(), target: null, trigger: 'manual', ...over })

async function addTrip(db: JobContext['db'], id: string, status: 'draft' | 'booked' | 'done' | 'cancelled', endDate: string, resortId: string) {
  await db.insert(trips).values({ id, name: id, status, startDate: addDays(endDate, -1), endDate, companions: [], createdAt: T0, updatedAt: T0 })
  await db.insert(tripItems).values({ tripId: id, type: 'resort-day', refId: resortId, title: resortId, date: endDate, details: {}, createdAt: T0 })
}

describe('which resorts load on schedule', () => {
  it('takes favourites in their order, then resorts in upcoming draft or booked trips', async () => {
    const db = await testDb()
    for (const id of ['alta', 'snowbird', 'brighton', 'solitude', 'jay-peak', 'stowe']) await addResort(db, { id })
    await addResort(db, { id: 'greek-peak' }, { favorite: true })
    await db.update(favorites).set({ sortOrder: 5 }).where(eq(favorites.resortId, 'greek-peak'))
    await db.insert(favorites).values({ resortId: 'alta', addedAt: T0, sortOrder: 1 })
    await addTrip(db, 'next-weekend', 'booked', '2027-01-23', 'snowbird')
    await addTrip(db, 'idea', 'draft', '2027-02-10', 'brighton')
    await addTrip(db, 'ends-today', 'booked', '2027-01-15', 'stowe')
    await addTrip(db, 'last-month', 'done', '2026-12-20', 'solitude')
    await addTrip(db, 'cancelled', 'cancelled', '2027-02-01', 'jay-peak')
    await addTrip(db, 'twice', 'draft', '2027-03-01', 'alta')
    expect(await osmTargets(db, T0)).toEqual(['alta', 'greek-peak', 'brighton', 'snowbird', 'stowe'])
  })
})

describe("job 'osm'", () => {
  it('stores the compact extract as one source record per attempt, and a failure never replaces it', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta', name: 'Alta Ski Area', shortName: 'Alta' })
    let respond = () => okResult()
    const provider = fakeOsm(() => respond())
    const d = deps({ osmProvider: provider })

    const first = await runJob({ db, job: 'osm', target: 'alta', trigger: 'manual', now: T0, deps: d })
    expect(first).toMatchObject({ status: 'ok', itemsWritten: 1, changed: true })
    expect(provider.calls[0]).toMatchObject({
      resortId: 'alta',
      names: ['Alta Ski Area', 'Alta'],
      country: 'US',
      points: [
        { lat: 40.59, lon: -111.64 },
        { lat: 40.58, lon: -111.63 },
      ],
    })
    const [rec] = await db.select().from(sourceRecords)
    expect(rec).toMatchObject({ adapter: 'osm-overpass', resortId: 'alta', url: ENDPOINT, ok: true, httpStatus: 200, adapterVersion: 'extract-v1' })
    expect(readSkiAreaExtract(rec.extract)).toEqual(EXTRACT)
    expect((rec.extract as { requests: number }).requests).toBe(2)
    expect(await lastSuccess(db, 'osm', 'alta')).toBe(T0)

    // A week later the refresh fails: a failed record is added, the last good extract stays the newest successful one.
    const later = addDays(T0.slice(0, 10), 8) + 'T14:00:00.000Z'
    respond = () => failed(later)
    const second = await runJob({ db, job: 'osm', target: 'alta', trigger: 'schedule', now: later, deps: d, maxAttempts: 1 })
    expect(second.status).toBe('error')
    expect(second.error).toMatch(/504/)
    const rows = await db.select().from(sourceRecords)
    expect(rows.map((r) => r.ok)).toEqual([true, false])
    expect(rows[1]).toMatchObject({ extract: null, httpStatus: 504 })
    expect(await lastSuccess(db, 'osm', 'alta')).toBe(T0)

    // The resort page keeps showing the good list, and says the latest attempt failed.
    const prefs = defaultPreferences(later)
    const view = await getLiftsRuns({ db, now: later, today: later.slice(0, 10), prefs, mode: 'live' }, { id: 'alta', country: 'US', lat: 40.59, lon: -111.64 })
    expect(view.loaded).toMatchObject({ fetchedAt: T0, method: 'area', liftCounts: '1 chairlift', runCounts: '1 black diamond · 1 double black diamond' })
    expect(view.loaded?.areas).toEqual([{ name: 'Alta Ski Area', url: 'https://www.openstreetmap.org/way/25712340' }])
    expect(view.loaded?.totals).toMatchObject({ lifts: 1, runs: 2, unnamedSegments: 2, capacityPerHour: 1800 })
    expect(view.loaded?.prov).toMatchObject({ kind: 'manual', verification: 'unverified', provider: 'OpenStreetMap contributors (ODbL)' })
    expect(view.lastAttempt).toMatchObject({ outcome: 'failed', trigger: 'schedule' })
    expect(view.lastAttempt?.error).toMatch(/504/)
    expect(view).toMatchObject({ demo: false, scheduled: false, convention: 'north-america' })

    // Demo mode reads nothing from live records.
    const demo = await getLiftsRuns({ db, now: later, today: later.slice(0, 10), prefs, mode: 'demo' }, { id: 'alta', country: 'US', lat: 40.59, lon: -111.64 })
    expect(demo).toMatchObject({ demo: true, loaded: null, lastAttempt: null })
  })

  it('writes no fetch record when nothing was requested, and leaves the other resorts for their next turn', async () => {
    const db = await testDb()
    for (const id of ['a', 'b', 'c']) await addResort(db, { id }, { favorite: true })
    const provider = fakeOsm(() => ({ ok: false, error: 'Overpass API asked Piste to slow down', errorKind: 'rate-limited', retriable: true, fetches: [] }))
    const out = await refreshOsm(ctx(db, { deps: deps({ osmProvider: provider }) }))
    expect(provider.calls).toHaveLength(1)
    expect(out.items.map((i) => [i.target, i.ok, !!i.skipped])).toEqual([
      ['a', false, false],
      ['b', true, true],
      ['c', true, true],
    ])
    expect(await db.select().from(sourceRecords)).toHaveLength(0)
  })

  it('never runs against the demo database, and says when the connector is off or nothing is scheduled', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    const provider = fakeOsm(() => okResult())
    expect((await refreshOsm(ctx(db, { deps: deps({ demo: true, osmProvider: provider }), target: 'alta' }))).notes?.[0]).toMatch(/Demo database/)
    expect((await refreshOsm(ctx(db, { target: 'alta' }))).notes?.[0]).toMatch(/turned off/)
    expect((await refreshOsm(ctx(db, { deps: deps({ osmProvider: provider }) }))).notes?.[0]).toMatch(/No favourites or upcoming trips/)
    expect(provider.calls).toHaveLength(0)
  })

  it('keeps the newest successful record through retention, whatever its age and however many failures follow', async () => {
    const db = await testDb()
    const at = (days: number) => addHours(T0, -24 * days)
    const rec = (fetchedAt: string, ok: boolean) =>
      db.insert(sourceRecords).values({ adapter: 'osm-overpass', resortId: 'alta', url: ENDPOINT, fetchedAt, ok, extract: ok ? { skiArea: EXTRACT, requests: 2 } : null, error: ok ? null : 'http: 504' })
    await rec(at(90), true) // older good copy: goes
    await rec(at(60), true) // the newest good copy: kept
    await rec(at(45), false)
    await rec(at(40), false)
    await rec(at(1), false) // the newest record: kept
    await pruneAll(ctx(db, { trigger: 'schedule' }))
    const left = await db.select().from(sourceRecords)
    expect(left.map((r) => [r.fetchedAt, r.ok])).toEqual([
      [at(60), true],
      [at(1), false],
    ])
  })
})

describe('scheduling', () => {
  it('plans one weekly task per scheduled resort, after everything else', () => {
    const tasks = planTasks(T0, DEFAULT_CADENCES, [], ['alta', 'greek-peak'])
    expect(tasks.slice(-2)).toEqual([
      { key: 'osm:alta', job: 'osm', target: 'alta', everyMin: 10_080 },
      { key: 'osm:greek-peak', job: 'osm', target: 'greek-peak', everyMin: 10_080 },
    ])
    expect(planTasks(T0, DEFAULT_CADENCES, []).some((t) => t.job === 'osm')).toBe(false)
  })

  it('loads favourites at the next tick, then weekly; a failure is retried sooner', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' }, { favorite: true })
    await addResort(db, { id: 'jay-peak' })
    let respond = () => failed()
    const provider = fakeOsm(() => respond())
    const d = deps({ osmProvider: provider })
    const state = newTickState()
    const c = { ...DEFAULT_CADENCES, jitterPct: 0 }
    let now = T0
    const osmRuns = (xs: Awaited<ReturnType<typeof tick>>) => xs.filter((s) => s.job === 'osm').map((s) => `${s.target}:${s.status}`)

    expect(osmRuns(await tick({ db, deps: d, cadences: c, clock: () => now, state }))).toEqual(['alta:error'])
    now = addHours(T0, 0.25)
    expect(osmRuns(await tick({ db, deps: d, cadences: c, clock: () => now, state }))).toEqual([])
    respond = () => okResult(now)
    now = addHours(T0, 0.6)
    expect(osmRuns(await tick({ db, deps: d, cadences: c, clock: () => now, state }))).toEqual(['alta:ok'])
    now = addHours(T0, 24 * 6)
    expect(osmRuns(await tick({ db, deps: d, cadences: c, clock: () => now, state }))).toEqual([])
    now = addHours(T0, 24 * 7 + 1)
    expect(osmRuns(await tick({ db, deps: d, cadences: c, clock: () => now, state }))).toEqual(['alta:ok'])
    expect(provider.calls.map((r) => r.resortId)).toEqual(['alta', 'alta', 'alta'])
    expect((await db.select().from(refreshRuns).where(eq(refreshRuns.job, 'osm'))).every((r) => r.target === 'alta')).toBe(true)
  })

  it('a cron pass loads only the scheduled resorts that are due', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' }, { favorite: true })
    const provider = fakeOsm(() => okResult())
    const d = deps({ osmProvider: provider })
    const once = (now: string) => runOnce({ db, deps: d, clock: () => now, jobs: ['osm'], cadences: DEFAULT_CADENCES })
    expect((await once(T0)).map((s) => s.target)).toEqual(['alta'])
    expect(await once(addHours(T0, 1))).toEqual([])
    expect((await once(addHours(T0, 24 * 7 + 1))).map((s) => s.target)).toEqual(['alta'])
  })
})
