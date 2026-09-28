import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createMemoryDb } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import { CatalogResort, CatalogPasses } from './schema'
import { seedCatalog, type Catalog } from './seed'

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
