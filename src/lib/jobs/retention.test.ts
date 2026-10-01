import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { createMemoryDb, type Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import { seedCatalog } from '@/lib/catalog/seed'
import { fixtureResort } from '@/lib/data/fixtures.test-helpers'
import { latestAssessments, latestRuns, pointsForRuns, type DataCtx } from '@/lib/data/core'
import { getHistoryCalendar } from '@/lib/data/forecast'
import { getResortDetail } from '@/lib/data/resort-detail'
import { defaultPreferences } from '@/lib/domain/defaults'
import { addDays, addHours, dateRange, localDateOf } from '@/lib/domain/time'
import { provenance, SCORING_MODES, type ScoringMode } from '@/lib/domain/types'
import type { WeatherPointRequest, WeatherSeries } from '@/lib/providers/types'
import { pruneAll } from './maintenance'
import { assessmentThenPick, COMPACTED_EXPLANATION, FORECAST_KEPT_FROM_META, forecastThenPick, pruneAssessments, pruneWeatherHistory } from './retention'
import { deps, hours } from './test-helpers'
import type { JobContext } from './types'
import { persistWeatherSeries, recordWeatherFailure } from './weather'

// ---------------------------------------------------------------------------------------------------------------------
// A month of irregular daily use: two resorts (a favourite in Denver, another in New York), Open-Meteo + NWS for base
// and summit, days without a visit, a day with two visits, a failed Open-Meteo fetch, a point only NWS covers, and
// assessments appended the way the job appends them (only some rows change per pass).

const FAV = 'fav-peak'
const OTHER = 'other-hill'
const DAY1 = '2026-12-20T15:00:00.000Z'
const NOW = addHours(DAY1, 29 * 24 + 1) // 2027-01-18, 30 days later
const SKIPPED = new Set([6, 7, 13])
const TWICE = new Set([3, 20])

function hash(x: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function passTimes(): string[] {
  const out: string[] = []
  for (let d = 1; d <= 30; d++) {
    if (SKIPPED.has(d)) continue
    const t = addHours(DAY1, (d - 1) * 24 + ((d * 7) % 5))
    out.push(t)
    if (TWICE.has(d)) out.push(addHours(t, 11))
  }
  return out.filter((t) => t <= NOW)
}

async function persist(db: Db, resortId: string, tz: string, point: 'base' | 'summit', provider: 'open-meteo' | 'nws-grid', at: string) {
  const floor = `${at.slice(0, 13)}:00:00.000Z`
  const om = provider === 'open-meteo'
  const from = addHours(floor, om ? -24 : -2)
  const hourly = hours(from, om ? 6 * 24 : 3 * 24, (i, t) => ({
    temperatureC: -8 + (hash(`${at}|${t}|t`) % 60) / 10,
    snowfallCm: (hash(`${at}|${resortId}|${point}|${t}`) % 9) / 10,
    windKmh: 5 + (hash(`${at}|${t}|w`) % 40),
    gustKmh: 20 + (hash(`${at}|${t}|g`) % 40),
    rainMm: om ? 0 : null,
  }))
  const request: WeatherPointRequest = { resortId, pointKey: point, lat: 40, lon: -105, elevationM: 3000, timezone: tz, country: 'US' }
  const series: WeatherSeries = {
    provider,
    model: om ? 'best_match' : 'NWS BOU gridpoint 1,2',
    kind: 'modeled',
    intervalSemantics: om ? 'preceding-hour' : 'following-hour',
    requested: { lat: 40, lon: -105, elevationM: 3000 },
    grid: { lat: 40.01, lon: -105.01, elevationM: 2990 },
    modelRunAt: null,
    horizonDays: om ? 5 : 3,
    hourly,
    units: {},
  }
  await persistWeatherSeries(db, {
    resort: { id: resortId, timezone: tz },
    request,
    providerId: provider,
    series,
    provenance: provenance({ kind: 'modeled', provider, fetchedAt: at }),
    capabilities: { supplied: ['snowfall'], missing: [], limitations: [] },
    now: at,
  })
}

const assessment = (resortId: string, localDate: string, mode: ScoringMode, computedAt: string, score: number) => ({
  resortId,
  localDate,
  mode,
  modelVersion: 'piste-conditions/1.0',
  computedAt,
  kind: 'derived' as const,
  scoreKind: score % 3 === 0 ? ('weather-potential' as const) : ('conditions' as const),
  score,
  descriptor: score >= 70 ? 'Good' : 'Mixed',
  coverage: 0.8,
  components: [{ key: 'W' as const, value: score, weight: 20, included: true, inputs: { peakGustKmh: 40 }, note: `Wind ${score}` }],
  surface: { tags: ['packed-powder' as const], basis: 'inferred' as const, text: `Surface ${score}`, rules: [] },
  confidence: 'medium' as const,
  confidenceReasons: [`Reason ${score}`],
  eligibility: 'eligible' as const,
  leadDays: 1,
  explanation: [`Explanation ${score}`, 'Second line'],
  inputs: { reportId: null, weatherRunIds: [1, 2], statusEventId: null },
})

async function world(): Promise<{ db: Db; ctx: DataCtx; tripCreatedAt: string; tripDay: string }> {
  const { db } = await createMemoryDb()
  await seedCatalog(
    db,
    { resorts: [fixtureResort(FAV, { timezone: 'America/Denver' }), fixtureResort(OTHER)], passes: null, airports: null, hotels: null, events: null },
    DAY1,
  )
  const prefs = defaultPreferences(DAY1)
  await db.insert(s.userPreferences).values(prefs).onConflictDoNothing()
  await db.delete(s.favorites)
  await db.insert(s.favorites).values({ resortId: FAV, addedAt: DAY1, sortOrder: 0 })
  const zones = { [FAV]: 'America/Denver', [OTHER]: 'America/New_York' } as const
  const tripCreatedAt = addHours(DAY1, 19 * 24 + 5)
  const tripDay = localDateOf(addHours(NOW, 48), zones[FAV])
  const passes = passTimes()
  for (const [n, at] of passes.entries()) {
    for (const [resortId, tz] of Object.entries(zones)) {
      for (const point of ['base', 'summit'] as const) {
        // OTHER's summit is covered by NWS only; FAV's base Open-Meteo fetch failed on one visit.
        if (!(resortId === OTHER && point === 'summit')) {
          if (resortId === FAV && point === 'base' && n === 9) {
            await recordWeatherFailure(db, { resort: { id: resortId, timezone: tz }, request: { resortId, pointKey: point, lat: 40, lon: -105, elevationM: 3000, timezone: tz, country: 'US' }, provider: { id: 'open-meteo', label: 'Open-Meteo' }, error: 'timeout: Open-Meteo', sourceUrl: null, now: at })
          } else await persist(db, resortId, tz, point, 'open-meteo', at)
        }
        await persist(db, resortId, tz, point, 'nws-grid', at)
      }
      const today = localDateOf(at, tz)
      const rows = []
      for (const date of dateRange(addDays(today, -1), addDays(today, 15))) {
        for (const mode of SCORING_MODES) {
          // Like the job: a row is appended only when the result changed (here: 2 passes in 3).
          if (n > 0 && hash(`${at}|${resortId}|${date}|${mode}`) % 3 === 0) continue
          rows.push(assessment(resortId, date, mode, at, hash(`${at}|${date}|${mode}|s`) % 100))
        }
      }
      await db.insert(s.conditionsAssessments).values(rows)
    }
    if (at <= tripCreatedAt && passes[n + 1] > tripCreatedAt) {
      await db.insert(s.trips).values({ id: 'trip-1', name: 'Trip', status: 'booked', startDate: tripDay, endDate: tripDay, companions: [], createdAt: tripCreatedAt, updatedAt: tripCreatedAt })
      await db.insert(s.tripItems).values({ tripId: 'trip-1', type: 'resort-day', refId: FAV, title: 'Ski', date: tripDay, details: {}, createdAt: tripCreatedAt })
    }
  }
  return { db, ctx: { db, now: NOW, today: localDateOf(NOW, prefs.homeTimezone), prefs, mode: 'live' }, tripCreatedAt, tripDay }
}

const MONTHS = ['2026-12', '2027-01']
const jobCtx = (db: Db, now = NOW): JobContext => ({ db, now, deps: deps(), target: null, trigger: 'schedule' })

/** Everything a screen or alert reads from weather runs and assessments. */
async function readers(w: Awaited<ReturnType<typeof world>>) {
  const { db, ctx } = w
  const calendars = []
  for (const id of [FAV, OTHER]) for (const month of MONTHS) for (const mode of SCORING_MODES) calendars.push(await getHistoryCalendar(ctx, id, month, { mode }))
  const runs = await latestRuns(db, NOW, true)
  const runIds = [...runs.values()].flatMap((m) => [...m.values()].map((r) => r.id)).sort()
  const points = await pointsForRuns(db, runIds, '2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z')
  const dates = dateRange('2026-12-18', '2027-02-05')
  const newest = [...(await latestAssessments(db, { dates, now: NOW, live: true })).values()].sort((a, b) => a.id - b.id)
  const trip = await db
    .select({ score: s.conditionsAssessments.score, kind: s.conditionsAssessments.scoreKind, at: s.conditionsAssessments.computedAt, mode: s.conditionsAssessments.mode })
    .from(s.conditionsAssessments)
    .where(and(eq(s.conditionsAssessments.resortId, FAV), eq(s.conditionsAssessments.localDate, w.tripDay), gte(s.conditionsAssessments.computedAt, w.tripCreatedAt)))
    .orderBy(asc(s.conditionsAssessments.computedAt), asc(s.conditionsAssessments.id))
  return { calendars, runIds, points: [...points.entries()], newest, trip }
}

const count = async (db: Db, table: string) => Number((await db.all<{ n: number }>(sql.raw(`select count(*) as n from ${table}`)))[0].n)

describe('retention keeps exactly what the readers read', () => {
  let w: Awaited<ReturnType<typeof world>>
  let before: Awaited<ReturnType<typeof readers>>
  let counts: Record<string, number>
  beforeAll(async () => {
    w = await world()
    before = await readers(w)
    counts = { runs: await count(w.db, 'weather_runs'), points: await count(w.db, 'weather_points'), assessments: await count(w.db, 'conditions_assessments') }
  }, 60_000)

  it('the fixture exercises the history calendar (forecast then, estimated then, NWS-only point, skipped days)', () => {
    const days = before.calendars.flatMap((c) => c!.days.filter((d) => d.state === 'tracked'))
    expect(days.length).toBeGreaterThan(40)
    expect(days.filter((d) => d.forecastThen.base && d.forecastThen.summit && d.assessmentThen).length).toBeGreaterThan(30)
    expect(days.some((d) => d.forecastThen.summit?.provider === 'nws-grid')).toBe(true)
    expect(before.trip.length).toBeGreaterThan(3)
  })

  it('prunes most rows, and every screen, calendar and alert input reads the same afterwards', async () => {
    const res = await pruneAll(jobCtx(w.db), { weatherKeepDays: 1 })
    expect(res.items.every((i) => i.ok)).toBe(true)
    expect(await readers(w)).toEqual(before)
    // Old Open-Meteo runs are trimmed to one day of hours, old NWS runs are gone unless a day's forecast-then used one.
    expect(await count(w.db, 'weather_points')).toBeLessThan(counts.points / 4)
    expect(await count(w.db, 'weather_runs')).toBeLessThan(counts.runs * 0.7)
    expect(await count(w.db, 'conditions_assessments')).toBeLessThan(counts.assessments / 2)
    const nws = await w.db
      .select({ id: s.weatherRuns.id })
      .from(s.weatherRuns)
      .where(and(eq(s.weatherRuns.resortId, FAV), eq(s.weatherRuns.provider, 'nws-grid'), sql`${s.weatherRuns.fetchedAt} < ${addHours(NOW, -24)}`))
    expect(nws.length).toBeLessThanOrEqual(1) // the earliest run (tracking start) keeps its row
    // Superseded rows kept only for their headline facts are compacted; the newest rows keep everything.
    const compacted = await w.db.select().from(s.conditionsAssessments).where(sql`${s.conditionsAssessments.explanation} = ${JSON.stringify([COMPACTED_EXPLANATION])}`)
    expect(compacted.length).toBeGreaterThan(50)
    expect(compacted.every((r) => r.components.length === 0 && r.confidenceReasons.length === 0 && r.surface.text !== null)).toBe(true)
  })

  it('is idempotent', async () => {
    const res = await pruneAll(jobCtx(w.db), { weatherKeepDays: 1 })
    expect(res.items.map((i) => [i.key, i.written]).filter(([, n]) => n)).toEqual([])
    expect(await readers(w)).toEqual(before)
  })

  it('a view whose assessment points at pruned weather runs still loads (no screen dereferences them)', async () => {
    const detail = await getResortDetail(w.ctx, FAV, { date: '2026-12-24' })
    expect(detail?.summary.score).not.toBeNull()
  })
})

describe('retention rules', () => {
  it('keeps the latest run of every point and provider whole however old, and leaves future-stamped assessments alone', async () => {
    const w = await world()
    // The app was not opened for three weeks.
    const later = addHours(NOW, 20 * 24)
    const latest = await latestRuns(w.db, later, true)
    const ids = [...latest.values()].flatMap((m) => [...m.values()].map((r) => r.id))
    const before = await pointsForRuns(w.db, ids, '2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z')
    await pruneWeatherHistory(w.db, later, 1)
    expect(await pointsForRuns(w.db, ids, '2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z')).toEqual(before)
    const alternates = await w.db.select().from(s.weatherRuns).where(and(eq(s.weatherRuns.resortId, FAV), eq(s.weatherRuns.provider, 'nws-grid'), eq(s.weatherRuns.pointKey, 'base')))
    expect(alternates.map((r) => r.fetchedAt).sort().at(-1)).toBe(passTimes().at(-1))

    const future = addHours(NOW, 5)
    await w.db.insert(s.conditionsAssessments).values([assessment(FAV, '2026-12-25', 'learning', future, 50)])
    await pruneAssessments(w.db, NOW, { weatherHistoryDays: null, assessmentDetailDays: null })
    const left = await w.db.select().from(s.conditionsAssessments).where(eq(s.conditionsAssessments.computedAt, future))
    expect(left.map((r) => r.explanation)).toEqual([['Explanation 50', 'Second line']])
  }, 60_000)

  it('the selection helpers match the history reader on ties and look-back', () => {
    const run = (id: number, provider: string, fetchedAt: string, horizonDays = 16) => ({ id, provider, fetchedAt, horizonDays })
    const runs = [run(1, 'nws-grid', '2027-01-14T20:00:00.000Z'), run(2, 'open-meteo', '2027-01-13T20:00:00.000Z'), run(3, 'open-meteo', '2027-01-15T08:00:00.000Z')]
    // Primary provider wins even when older; a run fetched after the day started (07:00Z in Denver) is not "then".
    expect(forecastThenPick(runs, '2027-01-15', 'America/Denver')?.id).toBe(2)
    // February looks back 17 days from 1 Feb only.
    expect(forecastThenPick([run(4, 'open-meteo', '2027-01-10T12:00:00.000Z')], '2027-02-10', 'America/Denver')).toBeNull()
    const rows = [
      { id: 7, computedAt: '2027-01-15T06:00:00.000Z' },
      { id: 8, computedAt: '2027-01-15T06:00:00.000Z' },
      { id: 9, computedAt: '2027-01-15T07:00:00.000Z' },
    ]
    expect(assessmentThenPick(rows, '2027-01-15T07:00:00.000Z')?.id).toBe(8)
  })
})

describe('optional size limits (single-file build)', () => {
  it('keeps full forecast-then for favourites and trip resorts only past the limit, and says so for the others', async () => {
    const w = await world()
    const before = await readers(w)
    vi.stubEnv('PISTE_WEATHER_HISTORY_DAYS', '5')
    vi.stubEnv('PISTE_ASSESSMENT_DETAIL_DAYS', '5')
    try {
      await pruneAll(jobCtx(w.db), { weatherKeepDays: 1, vacuum: true })
    } finally {
      vi.unstubAllEnvs()
    }
    const after = await readers(w)
    const boundary = addDays(localDateOf(NOW, 'America/New_York'), -5)
    const meta = await w.db.select().from(s.appMeta).where(eq(s.appMeta.key, FORECAST_KEPT_FROM_META + OTHER))
    expect(meta[0]?.value).toBe(boundary)
    expect(await w.db.select().from(s.appMeta).where(eq(s.appMeta.key, FORECAST_KEPT_FROM_META + FAV))).toEqual([])
    for (const [i, cal] of after.calendars.entries()) {
      const was = before.calendars[i]!
      expect(cal!.days.map((d) => d.assessmentThen)).toEqual(was.days.map((d) => d.assessmentThen))
      if (cal!.resortId === FAV) {
        expect(cal!.days.map((d) => d.forecastThen)).toEqual(was.days.map((d) => d.forecastThen))
        continue
      }
      for (const [j, d] of cal!.days.entries()) {
        if (d.state !== 'tracked' && d.state !== 'today') continue
        if (d.date >= boundary) expect(d.forecastThen).toEqual(was.days[j].forecastThen)
        else {
          expect(d.forecastThen).toEqual({ base: null, summit: null })
          expect(d.notes.join(' ')).toMatch(/not kept/)
          expect(d.gap).toBe(false)
        }
      }
      if (cal!.month === '2026-12') expect(cal!.notes.join(' ')).toMatch(/not kept for this resort/)
    }
    // Days older than the limit keep only what was estimated before them (headline facts); recent and future days keep
    // their newest assessment whole.
    const limit = (r: { resortId: string }) => addDays(localDateOf(NOW, r.resortId === FAV ? 'America/Denver' : 'America/New_York'), -5)
    for (const r of after.newest) {
      const old = r.localDate < limit(r)
      const was = before.newest.find((x) => x.id === r.id)
      if (!old) expect(r).toEqual(was)
      else {
        expect(r.explanation).toEqual([COMPACTED_EXPLANATION])
        expect(r.components).toEqual([])
        const cal = after.calendars.find((c) => c!.resortId === r.resortId && c!.mode === r.mode && c!.month === r.localDate.slice(0, 7))!
        const then = cal.days.find((d) => d.date === r.localDate)!.assessmentThen
        if (then) expect({ id: r.id, score: r.score, surface: r.surface }).toEqual({ id: then.id, score: then.score, surface: then.surface })
        else expect(r.id).toBe(was?.id)
      }
    }
    expect(after.newest.length).toBe(before.newest.length)
    const detail = await getResortDetail(w.ctx, OTHER, { date: '2026-12-24' })
    expect(detail?.summary.score?.explanation).toEqual([COMPACTED_EXPLANATION])
    expect(after.trip).toEqual(before.trip)
    // VACUUM ran: no free pages left in the file.
    expect(Number((await w.db.all<{ freelist_count: number }>(sql`PRAGMA freelist_count`))[0].freelist_count)).toBe(0)
  }, 60_000)
})
