/**
 * Tiny fixture catalog + inserted evidence rows for the read-model tests. Not imported by production code.
 * Clock: Friday 15 Jan 2027, 09:00 in New York.
 */
import { eq } from 'drizzle-orm'
import { createMemoryDb, type Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import { CatalogPasses, CatalogResort } from '@/lib/catalog/schema'
import { seedCatalog } from '@/lib/catalog/seed'
import { defaultPreferences } from '@/lib/domain/defaults'
import { addHours, localDateOf } from '@/lib/domain/time'
import { provenance } from '@/lib/domain/types'
import type { DataCtx } from './core'

export const NOW = '2027-01-15T14:00:00.000Z'
export const TODAY = '2027-01-15'

const price = (item: string, amount: number, dayType: string | null, subjectType = 'lift-ticket') => ({
  subjectType,
  item,
  category: subjectType === 'lift-ticket' || subjectType === 'rental' ? 'adult' : null,
  amount,
  currency: 'USD',
  season: '2026-27',
  dayType,
  source: { url: 'https://example.org/prices', verification: 'official-page' },
})

/** A small catalog resort (New York timezone, Ithaca-practical) with `over` applied. */
export function fixtureResort(id: string, over: Record<string, unknown> = {}) {
  return CatalogResort.parse({
    id,
    name: `${id} resort`,
    shortName: id,
    country: 'US',
    region: 'Central New York',
    timezone: 'America/New_York',
    priority: 1,
    location: { lat: 42.5, lon: -76.1 },
    elevation: { baseM: 350, summitM: 640, verticalM: 290, source: { url: 'https://example.org/stats' } },
    weatherPoints: [
      { key: 'base', label: 'Base', lat: 42.5, lon: -76.1, elevationM: 350 },
      { key: 'summit', label: 'Summit', lat: 42.49, lon: -76.11, elevationM: 640 },
    ],
    terrain: { beginnerPct: 40, intermediatePct: 35, advancedPct: 25, source: { url: 'https://example.org/stats', verification: 'official-page' } },
    features: { lessons: true, rentals: true, beginnerArea: 'Carpet area', source: { url: 'https://example.org/learn', verification: 'official-page' } },
    season: { season: '2026-27', announcedOpening: { date: '2026-11-27', source: { url: 'https://example.org/news' } }, announcedClosing: {}, history: [] },
    hours: [{ activity: 'lifts', label: 'Daily', days: [1, 2, 3, 4, 5, 6, 7], opens: '09:00', closes: '16:00', season: '2026-27', source: { url: 'https://example.org/hours' } }],
    prices: [price('Adult weekday', 60, 'weekday'), price('Adult weekend', 80, 'weekend'), price('full-package', 45, null, 'rental')],
    links: { official: 'https://example.org/', snowReport: 'https://example.org/report' },
    travel: { driveFromIthaca: { minutes: 35, km: 32, basis: 'curated estimate', source: { url: 'https://example.org/drive' } } },
    research: {},
    ...over,
  })
}

export const FIXTURE_RESORTS = [
  fixtureResort('test-peak', { priority: 2 }),
  fixtureResort('expert-bowl', {
    terrain: { beginnerPct: 5, intermediatePct: 25, advancedPct: 70, source: { url: 'https://example.org/stats', verification: 'official-page' } },
    travel: { driveFromIthaca: { minutes: 90, km: 120, basis: 'curated estimate', source: { url: 'https://example.org/drive' } } },
  }),
  fixtureResort('far-west', {
    timezone: 'America/Denver',
    region: 'Colorado',
    priority: 0,
    travel: { driveFromIthaca: null, airports: [{ iata: 'DEN', role: 'practical', minutes: 120, km: 150, basis: 'estimate', source: { url: 'https://example.org/den' } }] },
  }),
  fixtureResort('quiet-hill', {
    season: { season: '2026-27', announcedOpening: { date: '2027-01-10', text: 'Targeting Jan 10', source: { url: 'https://example.org/news' } }, announcedClosing: {}, history: [] },
  }),
]

const passes = CatalogPasses.parse({
  families: [
    { id: 'indy', name: 'Indy Pass', links: {} },
    { id: 'ikon', name: 'Ikon Pass', links: {} },
  ],
  products: [
    {
      id: 'indy-base-2026-27',
      family: 'indy',
      name: 'Indy Base Pass',
      season: '2026-27',
      salesDeadline: '2027-02-10',
      prices: [{ category: 'adult', amount: 299, currency: 'USD', source: { url: 'https://example.org/indy' } }],
      source: { url: 'https://example.org/indy' },
    },
    { id: 'ikon-base-2026-27', family: 'ikon', name: 'Ikon Base Pass', season: '2026-27', prices: [] },
  ],
  access: [
    { productId: 'indy-base-2026-27', resortId: 'test-peak', access: 'limited-days', days: 2, blackouts: [], reservationRequired: false, source: { url: 'https://example.org/indy', verification: 'official-page' } },
    { productId: 'ikon-base-2026-27', resortId: 'far-west', access: 'unknown' },
  ],
})

/** Hourly weather rows starting at `from` (UTC, hour-aligned) with preceding-hour semantics. */
export async function insertRun(
  db: Db,
  a: { resortId: string; pointKey: 'base' | 'summit'; fetchedAt: string; from: string; hours: number; tz?: string; snow?: (validTime: string) => number | null; provider?: string },
): Promise<number> {
  const tz = a.tz ?? 'America/New_York'
  const [run] = await db
    .insert(s.weatherRuns)
    .values({
      resortId: a.resortId,
      pointKey: a.pointKey,
      provider: a.provider ?? 'open-meteo',
      model: 'best_match',
      kind: 'modeled',
      requestedLat: 42.5,
      requestedLon: -76.1,
      requestedElevationM: 350,
      gridLat: 42.51,
      gridLon: -76.09,
      gridElevationM: 380,
      fetchedAt: a.fetchedAt,
      modelRunAt: null,
      timezone: tz,
      horizonDays: 16,
      variables: ['temperature_2m', 'snowfall'],
      units: { snowfall: 'cm' },
      intervalSemantics: 'preceding-hour',
      status: 'ok',
      prov: provenance({ kind: 'modeled', provider: 'Open-Meteo', fetchedAt: a.fetchedAt }),
    })
    .returning({ id: s.weatherRuns.id })
  const rows = Array.from({ length: a.hours }, (_, i) => {
    const validTime = addHours(a.from, i + 1)
    return {
      runId: run.id,
      validTime,
      localDate: localDateOf(addHours(validTime, -1), tz),
      temperatureC: -5,
      apparentTemperatureC: -9,
      snowfallCm: a.snow ? a.snow(validTime) : 0,
      rainMm: 0,
      precipitationMm: 0,
      windKmh: 12,
      gustKmh: 25,
      humidityPct: 80,
      visibilityM: 15000,
      cloudCoverPct: 40,
      freezingLevelM: 200,
      snowDepthM: null,
      weatherCode: 71,
      isDay: null,
    }
  })
  for (let i = 0; i < rows.length; i += 200) await db.insert(s.weatherPoints).values(rows.slice(i, i + 200))
  return run.id
}

const official = (at: string, url = 'https://example.org/report') => provenance({ kind: 'official', provider: 'example.org', sourceUrl: url, publishedAt: at, fetchedAt: at, verification: 'official-page' })

export interface Fixture {
  db: Db
  ctx: DataCtx
  runs: { a: number; b: number; c: number; summit: number }
  /** My owned Indy Base Pass (2 days at test-peak, one logged on 2027-01-02). */
  ownershipId: number
}

/** Seed the fixture catalog and a small, known set of evidence rows. `extraResorts` are seeded alongside. */
export async function buildFixture(opts: { extraResorts?: ReturnType<typeof fixtureResort>[] } = {}): Promise<Fixture> {
  const { db } = await createMemoryDb()
  await seedCatalog(db, { resorts: [...FIXTURE_RESORTS, ...(opts.extraResorts ?? [])], passes, airports: null, hotels: null, events: null }, '2026-09-28T12:00:00.000Z')

  // Season facts: three resorts actually opened; quiet-hill's announced date passed without an opening.
  for (const [id, opened] of [
    ['test-peak', '2026-11-28'],
    ['expert-bowl', '2026-12-05'],
    ['far-west', '2026-12-01'],
  ] as const) {
    await db
      .update(s.resortSeasons)
      .set({ actualOpening: opened, actualOpeningProv: official(`${opened}T12:00:00.000Z`) })
      .where(eqResort(id))
  }

  // Status events (appended on change only).
  await db.insert(s.statusEvents).values([
    { resortId: 'test-peak', status: 'open', effectiveAt: '2027-01-15T12:00:00.000Z', localDate: TODAY, prov: official('2027-01-15T12:00:00.000Z') },
    { resortId: 'expert-bowl', status: 'open', effectiveAt: '2026-12-05T12:00:00.000Z', localDate: '2026-12-05', prov: official('2026-12-05T12:00:00.000Z') },
    { resortId: 'expert-bowl', status: 'temporarily-closed', effectiveAt: '2027-01-15T11:00:00.000Z', localDate: TODAY, note: 'Wind hold', prov: official('2027-01-15T11:00:00.000Z') },
    { resortId: 'far-west', status: 'open', effectiveAt: '2026-12-01T15:00:00.000Z', localDate: '2026-12-01', prov: official('2026-12-01T15:00:00.000Z') },
  ])

  // Reports: test-peak Jan 14 (two revisions, the second published after the day ended) and Jan 15; far-west today.
  const report = (resortId: string, localDate: string, revision: number, reportedAt: string, over: Partial<typeof s.operationalReports.$inferInsert> = {}) => ({
    resortId,
    localDate,
    revision,
    kind: 'official' as const,
    reportedAt,
    fetchedAt: reportedAt,
    status: 'open' as const,
    snowfall: [{ window: '24h' as const, amountCm: 10, sourceText: '4" in 24 hours' }],
    baseDepthCm: 80,
    baseDepthLocation: 'Mid-mountain',
    summitDepthCm: null,
    surfaceTags: ['packed-powder' as const],
    surfaceText: 'Packed powder',
    groomingText: '20 trails groomed',
    groomedRuns: 20,
    snowmakingText: null,
    openTrails: 30,
    totalTrails: 55,
    openLifts: 6,
    totalLifts: 8,
    openBeginnerTrails: 8,
    totalBeginnerTrails: 10,
    openAcres: null,
    notes: null,
    contentHash: `${resortId}-${localDate}-${revision}`,
    prov: official(reportedAt),
    createdAt: reportedAt,
    ...over,
  })
  await db.insert(s.operationalReports).values([
    report('test-peak', '2027-01-14', 1, '2027-01-14T12:00:00.000Z', { snowfall: [{ window: '24h', amountCm: 3, sourceText: '1"' }] }),
    report('test-peak', '2027-01-14', 2, '2027-01-15T06:00:00.000Z', { snowfall: [{ window: '24h', amountCm: 5, sourceText: '2"' }], notes: 'Corrected' }),
    report('test-peak', TODAY, 1, '2027-01-15T12:10:00.000Z'),
    report('far-west', TODAY, 1, '2027-01-15T13:00:00.000Z'),
    // My own feedback is never an operations report.
    report('test-peak', TODAY, 1, '2027-01-15T13:30:00.000Z', { kind: 'manual', status: null, surfaceTags: ['icy-refrozen'], prov: provenance({ kind: 'manual', provider: 'You', note: 'personal' }) }),
  ])

  // Weather for test-peak base: run A fetched the evening before Jan 14 (NY), run B during Jan 14, run C today.
  const jan14 = (t: string) => localDateOf(addHours(t, -1), 'America/New_York') === '2027-01-14'
  const a = await insertRun(db, { resortId: 'test-peak', pointKey: 'base', fetchedAt: '2027-01-14T00:30:00.000Z', from: '2027-01-13T05:00:00.000Z', hours: 96, snow: (t) => (jan14(t) ? 0.5 : 0) })
  const b = await insertRun(db, { resortId: 'test-peak', pointKey: 'base', fetchedAt: '2027-01-14T13:00:00.000Z', from: '2027-01-14T05:00:00.000Z', hours: 96, snow: (t) => (jan14(t) ? 1.5 : 0.1) })
  const c = await insertRun(db, {
    resortId: 'test-peak',
    pointKey: 'base',
    fetchedAt: '2027-01-15T12:00:00.000Z',
    from: '2027-01-15T05:00:00.000Z',
    hours: 16 * 24,
    snow: (t) => (localDateOf(addHours(t, -1), 'America/New_York') === '2027-01-16' ? 1 : 0),
  })
  const summit = await insertRun(db, {
    resortId: 'test-peak',
    pointKey: 'summit',
    fetchedAt: '2027-01-15T12:00:00.000Z',
    from: '2027-01-15T05:00:00.000Z',
    hours: 7 * 24,
    snow: () => 0.2,
  })
  // An error run is never "the latest forecast".
  await db.insert(s.weatherRuns).values({
    resortId: 'test-peak',
    pointKey: 'base',
    provider: 'open-meteo',
    kind: 'modeled',
    requestedLat: 42.5,
    requestedLon: -76.1,
    fetchedAt: '2027-01-15T13:00:00.000Z',
    timezone: 'America/New_York',
    variables: [],
    units: {},
    status: 'error',
    error: 'timeout',
    prov: provenance({ kind: 'modeled', provider: 'Open-Meteo' }),
  })

  // Assessments (appended). For Jan 15 the latest wins; for Jan 14 only the one computed before the day counts as "then".
  const assess = (localDate: string, computedAt: string, score: number, mode: 'learning' | 'all-mountain' | 'powder' = 'learning', resortId = 'test-peak') => ({
    resortId,
    localDate,
    mode,
    modelVersion: 'piste-conditions/1.0',
    computedAt,
    kind: 'derived' as const,
    scoreKind: 'conditions' as const,
    score,
    descriptor: score >= 70 ? 'Good' : 'Mixed',
    coverage: 1,
    components: [],
    surface: { tags: ['packed-powder' as const], basis: 'reported' as const, text: 'Packed powder', rules: [] },
    confidence: 'high' as const,
    confidenceReasons: [],
    eligibility: 'eligible' as const,
    leadDays: 0,
    explanation: [],
    inputs: { reportId: null, weatherRunIds: [], statusEventId: null },
  })
  await db.insert(s.conditionsAssessments).values([
    assess('2027-01-14', '2027-01-14T04:00:00.000Z', 64),
    assess('2027-01-14', '2027-01-14T18:00:00.000Z', 88),
    assess(TODAY, '2027-01-14T20:00:00.000Z', 70),
    assess(TODAY, '2027-01-15T12:30:00.000Z', 78),
    assess(TODAY, '2027-01-15T12:30:00.000Z', 90, 'learning', 'expert-bowl'),
    assess(TODAY, '2027-01-15T13:30:00.000Z', 72, 'learning', 'far-west'),
  ])

  // Manual corrections: two valid, two rejected.
  await db.insert(s.resortOverrides).values([
    { resortId: 'test-peak', field: 'terrain.beginnerPct', value: 50, note: 'Counted on the trail map', sourceUrl: 'https://example.org/map', createdAt: '2027-01-02T00:00:00.000Z' },
    { resortId: 'test-peak', field: 'name', value: 'Test Peak (corrected)', note: null, sourceUrl: null, createdAt: '2027-01-02T00:00:00.000Z' },
    { resortId: 'test-peak', field: 'id', value: 'hijack', note: null, sourceUrl: null, createdAt: '2027-01-02T00:00:00.000Z' },
    { resortId: 'test-peak', field: 'features.lessons', value: 'yes', note: null, sourceUrl: null, createdAt: '2027-01-02T00:00:00.000Z' },
  ])

  // An owned pass with one logged day.
  const [own] = await db.insert(s.passOwnership).values({ productId: 'indy-base-2026-27', holder: 'me', purchasedOn: '2026-04-01', pricePaidMinor: 29900, currency: 'USD', createdAt: NOW }).returning()
  await db.insert(s.passUsage).values({ ownershipId: own.id, resortId: 'test-peak', date: '2027-01-02', createdAt: NOW })

  const prefs = defaultPreferences(NOW)
  return { db, ctx: { db, now: NOW, today: TODAY, prefs, mode: 'live' }, runs: { a, b, c, summit }, ownershipId: own.id }
}

function eqResort(id: string) {
  return eq(s.resortSeasons.resortId, id)
}
