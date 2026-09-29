import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import { buildFixture, NOW, TODAY, type Fixture } from './fixtures.test-helpers'
import { getResortDetail } from './resort-detail'
import { getTripDetail } from './trips'

let fx: Fixture
beforeAll(async () => {
  fx = await buildFixture()
  const prov = provenance({ kind: 'manual', provider: 'example.org', sourceUrl: 'https://example.org/hours', verification: 'official-page' })
  // MLK Day holiday hours (an exception) for test-peak.
  await fx.db.insert(s.operatingSchedules).values({
    resortId: 'test-peak',
    seasonId: '2026-27',
    activity: 'lifts',
    label: 'MLK Day',
    exceptionDate: '2027-01-18',
    opens: '08:00',
    closes: '21:00',
    closed: false,
    nature: 'published',
    prov,
    updatedAt: NOW,
  })
  // Hotels: one with no quote, one with only an expired quote (and a demo quote), one with a current quote.
  const hotel = (id: string, name: string, tier: 'budget' | 'comfortable' | 'premium') => ({
    id,
    resortId: 'test-peak',
    name,
    tier,
    officialUrl: `https://example.org/${id}`,
    skiInOut: 'unknown' as const,
    origin: 'catalog' as const,
    prov: provenance({ kind: 'manual', provider: 'Piste catalog (web research)', verification: 'search-summary' }),
  })
  await fx.db.insert(s.hotels).values([hotel('h-none', 'Valley Inn', 'budget'), hotel('h-expired', 'Summit Lodge', 'comfortable'), hotel('h-quoted', 'Peak Hotel', 'premium')])
  const quote = (subjectId: string, amount: number, expiresAt: string | null, quoteKind: 'observed-quote' | 'demo' = 'observed-quote') => ({
    subjectType: 'lodging' as const,
    subjectId,
    resortId: 'test-peak',
    item: 'Double room, 1 night',
    category: null,
    amountMinor: amount,
    currency: 'USD',
    seasonId: '2026-27',
    appliesFrom: '2027-01-16',
    appliesTo: '2027-01-17',
    quoteKind,
    observedAt: '2027-01-05T12:00:00.000Z',
    expiresAt,
    prov: provenance({ kind: quoteKind === 'demo' ? 'demo' : 'observed', provider: 'example.org', verification: 'official-page' }),
  })
  await fx.db.insert(s.priceSnapshots).values([
    quote('h-expired', 18900, '2027-01-10T00:00:00.000Z'),
    quote('h-none', 9900, null, 'demo'),
    quote('h-quoted', 24900, '2027-01-20T00:00:00.000Z'),
  ])
})

describe('getResortDetail', () => {
  it('returns the hours that apply on the date: the weekly pattern, or a dated exception that wins', async () => {
    const d = (await getResortDetail(fx.ctx, 'test-peak', { date: TODAY }))!
    expect(d.hours.forDate).toEqual([expect.objectContaining({ activity: 'lifts', opens: '09:00', closes: '16:00', source: 'weekly', nature: 'published', closed: false })])
    expect(d.hours.notes).toContain('Published hours do not mean every lift is running.')
    const mlk = (await getResortDetail(fx.ctx, 'test-peak', { date: '2027-01-18' }))!
    expect(mlk.hours.forDate).toEqual([expect.objectContaining({ activity: 'lifts', label: 'MLK Day', opens: '08:00', closes: '21:00', source: 'exception' })])
  })

  it('shows the zone abbreviation in force on the viewed date', async () => {
    expect((await getResortDetail(fx.ctx, 'test-peak', { date: TODAY }))!.hours).toMatchObject({ timezone: 'America/New_York', zoneAbbrev: 'EST' })
    expect((await getResortDetail(fx.ctx, 'test-peak', { date: '2027-03-20' }))!.hours.zoneAbbrev).toBe('EDT')
  })

  it('lists exact pass access with my owned product first, then other products with a rule here', async () => {
    const far = (await getResortDetail(fx.ctx, 'far-west', { date: TODAY }))!
    // Alphabetically Ikon would come first; ownership wins. Neither is confirmed at far-west.
    expect(far.passAccess.map((p) => [p.productId, p.owned, p.verdict.status])).toEqual([
      ['indy-base-2026-27', true, 'unknown'],
      ['ikon-base-2026-27', false, 'unknown'],
    ])
    const peak = (await getResortDetail(fx.ctx, 'test-peak', { date: TODAY }))!
    expect(peak.passAccess).toEqual([expect.objectContaining({ productId: 'indy-base-2026-27', owned: true })])
    expect(peak.passAccess[0].verdict).toMatchObject({ status: 'included-limited', canSki: true, remainingDays: 1 })
  })

  it('groups price snapshots (tickets, rentals, relevant pass prices) and prices the day basket with my pass', async () => {
    const d = (await getResortDetail(fx.ctx, 'test-peak', { date: TODAY }))!
    expect(d.prices.tickets.map((p) => [p.item, p.amount.amountMinor, p.dayType])).toEqual(
      expect.arrayContaining([
        ['Adult weekday', 6000, 'weekday'],
        ['Adult weekend', 8000, 'weekend'],
      ]),
    )
    expect(d.prices.tickets).toHaveLength(2)
    expect(d.prices.rentals.map((p) => p.amount.amountMinor)).toEqual([4500])
    expect(d.prices.passes).toEqual([expect.objectContaining({ subjectId: 'indy-base-2026-27', amount: { amountMinor: 29900, currency: 'USD' }, quoteLabel: 'Published price' })])
    expect(d.prices.lessons).toEqual([])
    expect(d.basket.lines.find((l) => l.key === 'lift')).toMatchObject({ kind: 'pass-covered', source: 'Indy Base Pass' })
  })

  it('shows "Check rates" unless a sourced, unexpired quote exists (demo quotes never count in live mode)', async () => {
    const d = (await getResortDetail(fx.ctx, 'test-peak', { date: TODAY }))!
    const byId = Object.fromEntries(d.hotels.map((h) => [h.id, h]))
    expect(byId['h-none']).toMatchObject({ quotes: [], priceNote: 'Check rates' })
    expect(byId['h-expired']).toMatchObject({ quotes: [], priceNote: 'Check rates' })
    expect(byId['h-quoted'].priceNote).toBeNull()
    expect(byId['h-quoted'].quotes).toEqual([expect.objectContaining({ amount: { amountMinor: 24900, currency: 'USD' }, expired: false, quoteKind: 'observed-quote' })])
    expect(d.hotels.map((h) => h.tier)).toEqual(['budget', 'comfortable', 'premium'])
  })

  it('returns null for an unknown resort', async () => {
    expect(await getResortDetail(fx.ctx, 'nowhere')).toBeNull()
  })
})

describe('getTripDetail', () => {
  it('prices each day with the access plan: a day the plan leaves uncovered gets a lift ticket', async () => {
    const own = await buildFixture()
    await own.db.insert(s.trips).values({ id: 'weekend', name: 'Test Peak weekend', status: 'draft', startDate: '2027-01-16', endDate: '2027-01-17', partySize: 1, companions: [], createdAt: NOW, updatedAt: NOW })
    const day = (date: string, sortOrder: number) => ({ tripId: 'weekend', type: 'resort-day' as const, refId: 'test-peak', title: `Ski ${date}`, date, status: 'draft' as const, details: {}, sortOrder, createdAt: NOW })
    await own.db.insert(s.tripItems).values([day('2027-01-16', 0), day('2027-01-17', 1)])
    const d = (await getTripDetail(own.ctx, 'weekend'))!
    // Indy: 2 days at test-peak, 1 already logged → Saturday uses the last day, Sunday has none left.
    expect(d.dayAccess.map((x) => [x.date, x.access.status])).toEqual([
      ['2027-01-16', 'covered'],
      ['2027-01-17', 'not-covered'],
    ])
    const [sat, sun] = d.dayBaskets
    expect(sat).toMatchObject({ date: '2027-01-16', expense: { passCoveredBy: 'Indy Base Pass', total: { amountMinor: 7000, currency: 'USD' } } })
    expect(sun.date).toBe('2027-01-17')
    expect(sun.expense.passCoveredBy).toBeNull()
    expect(sun.expense.total).toEqual({ amountMinor: 15000, currency: 'USD' })
    expect(sun.expense.lines.find((l) => l.key === 'lift')).toMatchObject({ kind: 'published', amount: { amountMinor: 8000, currency: 'USD' } })
    expect(sun.expense.lines.find((l) => l.key === 'lift')!.note).toMatch(/Not covered by Indy Base Pass: No days left/)
    // The fit basket is the first planned day's (plan-consistent) basket.
    expect(d.fit.find((f) => f.resortId === 'test-peak')!.fit.components.find((c) => c.key === 'budget')!.note).toMatch(/\$70 per person/)
  })
})
