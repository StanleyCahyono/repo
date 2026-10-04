import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import { buildFixture, NOW, type Fixture } from './fixtures.test-helpers'
import { getPassesView } from './passes'

let fx: Fixture
beforeAll(async () => {
  fx = await buildFixture()
})

describe('getPassesView', () => {
  it("counts my logged days: owned Indy has 1 of 2 days left at test-peak (per resort, in 'owned')", async () => {
    const v = await getPassesView(fx.ctx)
    const mine = v.owned[0]
    expect(mine).toMatchObject({ ownershipId: fx.ownershipId, holder: 'me', productId: 'indy-base-2026-27', daysUsed: 1, pricePaid: { amountMinor: 29900, currency: 'USD' } })
    expect(mine.usage).toEqual([expect.objectContaining({ date: '2027-01-02', resortId: 'test-peak', inSeason: true })])
    expect(mine.byResort).toEqual([expect.objectContaining({ resortId: 'test-peak', status: 'available', cap: 2, used: 1, remaining: 1, statusLabel: '1 day left' })])
  })

  it('lists products with their current price, sales deadline and ownership', async () => {
    const v = await getPassesView(fx.ctx)
    const indy = v.products.find((p) => p.id === 'indy-base-2026-27')!
    expect(indy).toMatchObject({ familyName: 'Indy Pass', ownedByMe: true, ownedBy: ['me'], salesDeadline: { date: '2027-02-10', daysLeft: 26, passed: false } })
    expect(indy.currentPrice).toMatchObject({ amount: { amountMinor: 29900, currency: 'USD' }, category: 'adult', quoteLabel: 'Published price' })
    const ikon = v.products.find((p) => p.id === 'ikon-base-2026-27')!
    // No price on file → null ("Price not recorded"), never $0.
    expect(ikon).toMatchObject({ currentPrice: null, prices: [], ownedByMe: false, salesDeadline: null })
    expect(v.families.map((f) => f.id)).toEqual(['ikon', 'indy'])
    expect(v.comparison).toMatchObject({ plannedDays: [], result: null })
    expect(v.comparison.notes[0]).toMatch(/No upcoming resort days/)
  })

  it('compares passes with tickets on the planned days, each priced with its own ticket', async () => {
    const own = await buildFixture()
    await own.db.insert(s.trips).values({ id: 'jan', name: 'January', status: 'booked', startDate: '2027-01-16', endDate: '2027-01-23', partySize: 1, companions: [], createdAt: NOW, updatedAt: NOW })
    const day = (date: string, i: number, status: 'draft' | 'idea' = 'draft') => ({ tripId: 'jan', type: 'resort-day' as const, refId: 'test-peak', title: date, date, status, details: {}, sortOrder: i, createdAt: NOW })
    await own.db.insert(s.tripItems).values([day('2027-01-16', 0), day('2027-01-20', 1), day('2027-01-23', 2), day('2027-01-24', 3, 'idea')])
    const v = await getPassesView(own.ctx)
    expect(v.comparison.plannedDays.map((d) => [d.date, d.ticket?.amountMinor])).toEqual([
      ['2027-01-16', 8000],
      ['2027-01-20', 6000],
      ['2027-01-23', 8000],
    ])
    const r = v.comparison.result!
    expect(r.baseline.total).toEqual({ amountMinor: 22000, currency: 'USD' })
    const indy = r.candidates.find((c) => c.productId === 'indy-base-2026-27')!
    // One Indy day left: Saturday is covered; Wednesday and the next Saturday are tickets.
    expect(indy).toMatchObject({ owned: true, coveredDays: 1, incremental: { amountMinor: 14000, currency: 'USD' }, alreadyPaid: { amountMinor: 29900, currency: 'USD' } })
    const ikon = r.candidates.find((c) => c.productId === 'ikon-base-2026-27')!
    expect(ikon).toMatchObject({ owned: false, passPrice: null, seasonTotal: null })
    expect(ikon.notes).toContain('Pass price not recorded.')
  })
})
