import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { alertRules, alerts, conditionsAssessments, events, priceSnapshots, tripItems, trips } from '@/lib/db/schema'
import { addHours } from '@/lib/domain/time'
import { provenance, type VerificationLevel } from '@/lib/domain/types'
import { ensureDefaultAlertRules, evaluateAlerts } from './alerts'
import { updateSeasonDates } from './status'
import { addPrefs, addResort, addSeason, blankHour, deps, FAIR, T0, testDb } from './test-helpers'
import { persistWeatherSeries } from './weather'

async function setup() {
  const db = await testDb()
  await addPrefs(db)
  const resort = await addResort(db, { id: 'alta', shortName: 'Alta' }, { favorite: true })
  await addSeason(db, 'alta', { announcedOpening: '2026-11-20' })
  const evaluate = (now: string) => evaluateAlerts({ db, now, deps: deps(), target: null, trigger: 'schedule' })
  /** A summit forecast with 1 cm/h for 20 h starting `stormStart` (preceding-hour stamps). */
  const forecast = async (fetchedAt: string, stormStart: string) => {
    const req = { resortId: 'alta', pointKey: 'summit', lat: 40.58, lon: -111.63, elevationM: 3200, timezone: 'America/Denver', country: 'US' }
    const start = addHours(T0, -24)
    const hourly = Array.from({ length: 24 * 8 }, (_, i) => {
      const t = addHours(start, i)
      const inStorm = t > stormStart && t <= addHours(stormStart, 20)
      return { ...blankHour(t), ...FAIR, snowfallCm: inStorm ? 1 : 0 }
    })
    await persistWeatherSeries(db, {
      resort,
      request: req,
      providerId: 'open-meteo',
      series: {
        provider: 'Open-Meteo',
        model: 'best_match',
        kind: 'modeled',
        intervalSemantics: 'preceding-hour',
        requested: { lat: req.lat, lon: req.lon, elevationM: 3200 },
        grid: { lat: 40.58, lon: -111.63, elevationM: 3100 },
        modelRunAt: null,
        horizonDays: 7,
        hourly,
        units: {},
      },
      provenance: provenance({ kind: 'modeled', provider: 'Open-Meteo', fetchedAt }),
      capabilities: { supplied: [], missing: [], limitations: [] },
      now: fetchedAt,
    })
  }
  const byType = async (type: string) => (await db.select().from(alerts)).filter((a) => a.type === type)
  return { db, evaluate, forecast, byType }
}

describe('alert rules', () => {
  it('creates default rules for favorites once, and does not recreate rules I deleted', async () => {
    const { db } = await setup()
    expect(await ensureDefaultAlertRules(db, T0)).toBe(7)
    expect(await ensureDefaultAlertRules(db, T0)).toBe(0)
    await db.delete(alertRules)
    expect(await ensureDefaultAlertRules(db, T0)).toBe(0)
  })

  it('dedupes repeated forecast refreshes and holds a new bucket back until the cooldown ends', async () => {
    const { forecast, evaluate, byType } = await setup()
    const storm = addHours(T0, 10)
    await forecast(T0, storm)
    await evaluate(T0)
    const first = await byType('snow-threshold')
    expect(first).toHaveLength(1)
    expect(first[0].title).toMatch(/^Alta: likely .* of snow in the next 72 h$/)
    expect(first[0].body).toMatch(/Modeled snowfall/)

    // Three hours later a new model run shows the same storm → same dedupe key, no new alert.
    await forecast(addHours(T0, 3), storm)
    await evaluate(addHours(T0, 3))
    expect(await byType('snow-threshold')).toHaveLength(1)

    // The storm shifts a day (new bucket) but the rule's 12 h cooldown for this resort is active.
    await forecast(addHours(T0, 4), addHours(storm, 24))
    await evaluate(addHours(T0, 4))
    expect(await byType('snow-threshold')).toHaveLength(1)

    // After the cooldown the still-valid condition fires.
    await forecast(addHours(T0, 13), addHours(storm, 24))
    await evaluate(addHours(T0, 13))
    expect(await byType('snow-threshold')).toHaveLength(2)
    await evaluate(addHours(T0, 14))
    expect(await byType('snow-threshold')).toHaveLength(2)
  })

  it('alerts once on an announced opening-date change', async () => {
    const { db, evaluate, byType } = await setup()
    await updateSeasonDates(db, {
      resortId: 'alta',
      seasonId: '2026-27',
      changes: { announcedOpening: '2026-11-27' },
      prov: provenance({ kind: 'official', provider: 'alta.com', sourceUrl: 'https://www.alta.com/news' }),
      now: '2026-11-01T12:00:00.000Z',
    })
    await evaluate('2026-11-01T13:00:00.000Z')
    await evaluate('2026-11-02T13:00:00.000Z')
    const got = await byType('opening-date-change')
    expect(got).toHaveLength(1)
    expect(got[0].title).toMatch(/announced opening changed to Fri 27 Nov 2026/)
    expect(got[0].body).toMatch(/target/)
  })

  it('reports verified price changes only (research summaries are not verified prices)', async () => {
    const { db, evaluate, byType } = await setup()
    const snap = (amountMinor: number, observedAt: string, verification: VerificationLevel) => ({
      subjectType: 'lift-ticket' as const,
      subjectId: 'alta',
      resortId: 'alta',
      item: 'Day ticket',
      category: 'adult',
      amountMinor,
      currency: 'USD',
      seasonId: '2026-27',
      dayType: 'any',
      quoteKind: 'published' as const,
      observedAt,
      prov: provenance({ kind: 'official', provider: 'alta.com', verification }),
    })
    await db.insert(priceSnapshots).values([snap(18900, '2027-01-01T00:00:00.000Z', 'search-summary'), snap(19900, '2027-01-10T00:00:00.000Z', 'search-summary')])
    await evaluate(T0)
    expect(await byType('price-change')).toHaveLength(0)

    await db.insert(priceSnapshots).values([snap(19900, '2027-01-11T00:00:00.000Z', 'official-page'), snap(20900, '2027-01-14T00:00:00.000Z', 'official-page')])
    await evaluate(T0)
    await evaluate(addHours(T0, 1))
    const got = await byType('price-change')
    expect(got).toHaveLength(1)
    expect(got[0].title).toBe('Alta: Day ticket (adult) now $209')
    expect(got[0].body).toMatch(/^Was \$199 /)
  })

  it('stores in-app alerts only, each with a unique dedupe key', async () => {
    const { db, forecast, evaluate } = await setup()
    await forecast(T0, addHours(T0, 10))
    await evaluate(T0)
    const rows = await db.select().from(alerts)
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(rows.length)
    const rule = (await db.select().from(alertRules).where(eq(alertRules.type, 'snow-threshold')))[0]
    expect(rule.lastFiredAt).toBe(T0)
  })

  it('does not flood alerts with existing events, then reports new and changed ones once', async () => {
    const { db, evaluate, byType } = await setup()
    const ev = (id: string, startLocal: string) => ({
      id,
      resortId: 'alta',
      title: id === 'e1' ? 'Torchlight parade' : 'Demo days',
      category: 'festival',
      startLocal,
      timezone: 'America/Denver',
      status: 'announced' as const,
      dedupeKey: id,
    })
    await db.insert(events).values(ev('e1', '2027-03-13T18:30'))
    await evaluate(T0)
    expect(await byType('event')).toHaveLength(0) // existing catalog events are the baseline

    await db.insert(events).values(ev('e2', '2027-02-20'))
    await evaluate(addHours(T0, 1))
    await evaluate(addHours(T0, 2))
    expect((await byType('event')).map((a) => a.title)).toEqual(['New event at Alta: Demo days'])

    await db.update(events).set({ startLocal: '2027-03-20T18:30' }).where(eq(events.id, 'e1'))
    await evaluate(addHours(T0, 3))
    expect((await byType('event')).map((a) => a.title)).toContain('Event updated at Alta: Torchlight parade')
    expect(await byType('event')).toHaveLength(2)
  })

  it('warns when the outlook for a saved trip day drops by the configured amount, once per score band', async () => {
    const { db, evaluate, byType } = await setup()
    await db.insert(trips).values({ id: 't1', name: 'Alta weekend', status: 'booked', startDate: '2027-01-19', endDate: '2027-01-20', companions: [], createdAt: T0, updatedAt: T0 })
    await db.insert(tripItems).values({ tripId: 't1', type: 'resort-day', refId: 'alta', title: 'Alta', date: '2027-01-19', details: {}, createdAt: T0 })
    const assess = (computedAt: string, score: number) =>
      db.insert(conditionsAssessments).values({
        resortId: 'alta',
        localDate: '2027-01-19',
        mode: 'learning',
        modelVersion: 'v1',
        computedAt,
        kind: 'derived',
        scoreKind: 'weather-potential',
        score,
        descriptor: null,
        coverage: 0.5,
        components: [],
        surface: { tags: [], basis: 'none', text: '', rules: [] },
        confidence: 'low',
        confidenceReasons: [],
        eligibility: 'eligible',
        leadDays: 4,
        explanation: [],
        inputs: { reportId: null, weatherRunIds: [], statusEventId: null },
      })
    await assess(addHours(T0, 1), 82)
    await assess(addHours(T0, 4), 74)
    await evaluate(addHours(T0, 4))
    expect(await byType('forecast-deterioration')).toHaveLength(0) // an 8-point drop is below the 15-point default
    await assess(addHours(T0, 7), 61)
    await evaluate(addHours(T0, 7))
    await evaluate(addHours(T0, 8))
    const got = await byType('forecast-deterioration')
    expect(got).toHaveLength(1)
    expect(got[0].title).toBe('Alta on Tue 19 Jan: outlook fell to 61')
    expect(got[0].body).toMatch(/Down from 82 .*Weather potential only/)
    expect(got[0].link).toBe('/trips/t1')
  })
})
