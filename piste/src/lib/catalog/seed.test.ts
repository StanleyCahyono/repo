import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createMemoryDb } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import { CatalogResort, CatalogPasses } from './schema'
import { seedCatalog, type Catalog } from './seed'
import { isResearchedReport, latestOfficialReport, reportOrigin } from '@/lib/jobs/reports'

function resort(overrides: Record<string, unknown> = {}) {
  return CatalogResort.parse({
    id: 'test-peak',
    name: 'Test Peak Resort',
    shortName: 'Test Peak',
    country: 'US',
    region: 'Central New York',
    timezone: 'America/New_York',
    priority: 1,
    location: { lat: 42.5, lon: -76.1, source: { url: 'https://example.org/stats' } },
    elevation: { baseM: 350, summitM: 640, verticalM: 290 },
    weatherPoints: [{ key: 'base', label: 'Base', lat: 42.5, lon: -76.1, elevationM: 350 }],
    terrain: {},
    features: { nightSkiing: true },
    season: {
      season: '2026-27',
      announcedOpening: { date: null, text: null },
      announcedClosing: {},
      history: [
        { season: '2025-26', opened: '2025-11-28' },
        { season: '2024-25', opened: '2024-12-05' },
      ],
    },
    hours: [{ activity: 'lifts', label: 'Weekday', days: [1, 2, 3, 4, 5], opens: '09:00', closes: '16:00', season: '2025-26' }],
    prices: [{ subjectType: 'lift-ticket', item: 'Adult day ticket', amount: 99.5, currency: 'USD', season: '2025-26', dayType: 'weekend', source: { url: 'https://example.org/tickets' } }],
    links: { official: 'https://example.org/' },
    travel: { driveFromIthaca: { minutes: 35, km: 32, basis: 'test' } },
    research: {},
    ...overrides,
  })
}

const passes = CatalogPasses.parse({
  families: [{ id: 'indy', name: 'Indy Pass', links: {} }],
  products: [{ id: 'indy-base-2026-27', family: 'indy', name: 'Indy Base Pass', season: '2026-27', prices: [{ category: 'Adult', amount: 299, currency: 'USD' }] }],
  access: [{ productId: 'indy-base-2026-27', resortId: 'test-peak', access: 'limited-days', days: 2 }],
})

describe('seedCatalog', () => {
  it('is idempotent and derives an estimated opening window', async () => {
    const { db } = await createMemoryDb()
    const catalog: Catalog = { resorts: [resort()], passes, airports: null, hotels: null, events: null }
    const first = await seedCatalog(db, catalog, '2026-09-28T12:00:00.000Z')
    expect(first.firstRun).toBe(true)
    const again = await seedCatalog(db, catalog, '2026-09-29T12:00:00.000Z')
    expect(again.prices).toBe(0)
    expect(again.ruleVersionsAdded).toBe(0)
    expect(await db.select().from(s.operatingSchedules)).toHaveLength(1)
    expect(await db.select().from(s.travelOptions)).toHaveLength(1)
    const [rs] = await db.select().from(s.resortSeasons)
    expect(rs.estimatedOpenFrom).toBe('2026-11-28')
    expect(rs.estimatedOpenTo).toBe('2026-12-05')
    expect(rs.announcedOpening).toBeNull()
    const [price] = await db.select().from(s.priceSnapshots).where(eq(s.priceSnapshots.subjectType, 'lift-ticket'))
    expect(price.amountMinor).toBe(9950)
    expect(price.prov.verification).toBe('search-summary')
  })

  it('logs announced-date changes, versions changed pass rules, and never touches actual openings or user rows', async () => {
    const { db } = await createMemoryDb()
    await seedCatalog(db, { resorts: [resort()], passes, airports: null, hotels: null, events: null }, '2026-09-28T12:00:00.000Z')
    await db.update(s.resortSeasons).set({ actualOpening: '2026-11-27' })
    await db.insert(s.operatingSchedules).values({ resortId: 'test-peak', activity: 'lifts', label: 'My note', closed: false, nature: 'published', prov: { kind: 'manual', provider: 'You', sourceUrl: null }, updatedAt: 'x' })
    const changed = resort({
      season: {
        season: '2026-27',
        announcedOpening: { date: '2026-11-27', text: 'Targeting Nov 27', source: { url: 'https://example.org/news' } },
        announcedClosing: {},
        history: [],
      },
    })
    const changedPasses = { ...passes, access: [{ ...passes.access[0], days: 3 }] }
    const r = await seedCatalog(db, { resorts: [changed], passes: changedPasses, airports: null, hotels: null, events: null }, '2026-10-02T12:00:00.000Z')
    expect(r.openingChanges).toBe(1)
    expect(r.ruleVersionsAdded).toBe(1)
    const [rs] = await db.select().from(s.resortSeasons)
    expect(rs.actualOpening).toBe('2026-11-27')
    expect(rs.announcedOpening).toBe('2026-11-27')
    const hist = await db.select().from(s.openingDateHistory)
    expect(hist[0]).toMatchObject({ previousValue: null, newValue: '2026-11-27' })
    const rules = await db.select().from(s.passAccessRules)
    expect(rules.map((x) => x.version).sort()).toEqual([1, 2])
    const schedules = await db.select().from(s.operatingSchedules)
    expect(schedules.some((x) => x.label === 'My note')).toBe(true)
  })
})

describe('seedCatalog: lifts, runs and dated reports found by research', () => {
  const NOW = '2026-09-30T02:00:00.000Z' // midday in Sydney
  const src = (url: string, checkedOn = '2026-09-29') => ({ url, checkedOn })
  const southern = (recentReports: unknown[]) =>
    resort({
      id: 'thredbo-test',
      country: 'AU',
      region: 'New South Wales',
      timezone: 'Australia/Sydney',
      location: { lat: -36.5, lon: 148.3 },
      weatherPoints: [{ key: 'base', label: 'Valley', lat: -36.505, lon: 148.305, elevationM: 1365 }],
      terrain: {
        lifts: 16,
        pisteKm: 52,
        expertPct: 12,
        liftCapacityPerHour: 24_000,
        liftsByType: { gondolas: 1, chairlifts: 5, surfaceLifts: 10 },
        season: '2025-26',
        source: { url: 'https://example.org/stats' },
      },
      links: { official: 'https://example.org/', liftStatus: 'https://example.org/lifts-trails' },
      recentReports,
    })
  const REPORTS = [
    { observedOn: '2026-09-21', baseDepthCm: 0, summitDepthCm: 0, newSnow24hCm: 2, liftsOpen: 0, liftsTotal: 16, source: src('https://example.org/report') },
    { observedOn: '2026-09-13', operatingStatus: 'closed-for-season', note: 'Closing day of the 2026 winter.', source: src('https://example.org/closing') },
    { observedOn: '2026-10-05', operatingStatus: 'closed-for-season', source: src('https://example.org/future', '2026-10-05') },
    { observedOn: '2026-09-20', source: src('https://example.org/empty') },
    { observedOn: '2026-09-29', baseDepthCm: 5, source: src('https://example.org/late', '2026-09-28') },
  ]
  const catalog = (r: ReturnType<typeof resort>): Catalog => ({ resorts: [r], passes: null, airports: null, hotels: null, events: null })

  it('stores the new terrain facts and the live lift status link', async () => {
    const { db } = await createMemoryDb()
    await seedCatalog(db, catalog(southern([])), NOW)
    const [row] = await db.select().from(s.resorts)
    expect(row.terrain).toMatchObject({
      lifts: 16,
      pisteKm: 52,
      expertPct: 12,
      liftCapacityPerHour: 24_000,
      liftsByType: { gondolas: 1, cableCars: null, chairlifts: 5, surfaceLifts: 10, other: null },
    })
    expect(row.terrain?.prov?.verification).toBe('search-summary')
    expect(row.links.liftStatus).toBe('https://example.org/lifts-trails')
  })

  it('stores dated reports as researched official reports of their own day — once, never resetting their age', async () => {
    const { db } = await createMemoryDb()
    const first = await seedCatalog(db, catalog(southern(REPORTS)), NOW)
    expect(first.recentReports).toBe(2)
    expect(first.recentReportsSkipped).toHaveLength(3)
    expect(first.recentReportsSkipped.join(' | ')).toMatch(/2026-10-05: .*future/)
    expect(first.recentReportsSkipped.join(' | ')).toMatch(/2026-09-20: Nothing reported/)
    expect(first.recentReportsSkipped.join(' | ')).toMatch(/2026-09-29: .*after the research date/)

    const reports = (await db.select().from(s.operationalReports)).sort((a, b) => a.localDate.localeCompare(b.localDate))
    expect(reports.map((r) => [r.localDate, r.kind, r.revision, r.status])).toEqual([
      ['2026-09-13', 'official', 1, 'closed-for-season'],
      ['2026-09-21', 'official', 1, null],
    ])
    for (const r of reports) {
      expect(r.prov).toMatchObject({ kind: 'official', provider: 'Piste catalog (web research)', verification: 'search-summary', note: 'catalog-research' })
      // No publish time: its age runs from the start of its own day. Retrieved when the research checked it.
      expect(r).toMatchObject({ reportedAt: null, fetchedAt: '2026-09-29T12:00:00.000Z', createdAt: '2026-09-29T12:00:00.000Z' })
      expect(reportOrigin(r)).toBe('other')
      expect(isResearchedReport(r)).toBe(true)
    }
    expect(reports[0].prov.sourceUrl).toBe('https://example.org/closing')
    expect(reports[0].notes).toBe('Closing day of the 2026 winter.')
    expect(reports[1]).toMatchObject({ baseDepthCm: 0, summitDepthCm: 0, openLifts: 0, totalLifts: 16, snowfall: [{ window: '24h', amountCm: 2 }] })
    // Never mistaken for a report Piste read itself (the adapters' change detection ignores it).
    expect(await latestOfficialReport(db, 'thredbo-test')).toBeNull()

    // Its status went through the status pipeline: stated at local noon of its day.
    const events = await db.select().from(s.statusEvents)
    expect(events.map((e) => [e.status, e.localDate, e.effectiveAt])).toEqual([['closed-for-season', '2026-09-13', '2026-09-13T02:00:00.000Z']])
    expect(events[0].note).toMatch(/catalog research/)

    // Re-seeding the same research writes nothing: no new revision, and the observation age is not reset.
    const again = await seedCatalog(db, catalog(southern(REPORTS)), '2026-10-02T02:00:00.000Z')
    expect(again.recentReports).toBe(0)
    const after = await db.select().from(s.operationalReports)
    expect(after).toHaveLength(2)
    expect(after.every((r) => r.fetchedAt === '2026-09-29T12:00:00.000Z')).toBe(true)
    expect(await db.select().from(s.statusEvents)).toHaveLength(1)

    // Changed research for the same day is a new revision; the first one stays in the history.
    const corrected = REPORTS.map((r) => (r.observedOn === '2026-09-21' ? { ...r, baseDepthCm: 3, source: src('https://example.org/report', '2026-10-01') } : r))
    const third = await seedCatalog(db, catalog(southern(corrected)), '2026-10-02T02:00:00.000Z')
    expect(third.recentReports).toBe(1)
    const day = (await db.select().from(s.operationalReports).where(eq(s.operationalReports.localDate, '2026-09-21'))).sort((a, b) => a.revision - b.revision)
    expect(day.map((r) => [r.revision, r.baseDepthCm, r.fetchedAt])).toEqual([
      [1, 0, '2026-09-29T12:00:00.000Z'],
      [2, 3, '2026-10-01T12:00:00.000Z'],
    ])
  })

  it('records an "open" snapshot as a status, never as the season’s actual opening', async () => {
    const { db } = await createMemoryDb()
    await seedCatalog(db, catalog(southern([{ observedOn: '2026-09-27', operatingStatus: 'open', baseDepthCm: 112, source: src('https://example.org/open') }])), NOW)
    expect((await db.select().from(s.statusEvents)).map((e) => e.status)).toEqual(['open'])
    expect((await db.select().from(s.resortSeasons)).every((x) => x.actualOpening === null)).toBe(true)
  })

  it('leaves them out of the demo database', async () => {
    const { db } = await createMemoryDb()
    const r = await seedCatalog(db, catalog(southern(REPORTS)), NOW, { recentReports: false })
    expect(r.recentReports).toBe(0)
    expect(await db.select().from(s.operationalReports)).toHaveLength(0)
    expect(await db.select().from(s.statusEvents)).toHaveLength(0)
  })
})
