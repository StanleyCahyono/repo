/**
 * Passes & Costs screen loaders: the exact-pass checker (unknown is never permission; logged and earlier days of a
 * range consume allotments), and the pass-vs-tickets calculator (each day priced with its own ticket; break-even
 * only when its assumptions fit; sunk vs incremental for a pass you hold; display currency never changes stored
 * values).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import { buildFixture, fixtureResort, NOW, type Fixture } from './fixtures.test-helpers'
import { getCheckerView, getDayCostsView, getPassCompareView, MAX_CHECK_DAYS } from './passes-screen'

let fx: Fixture
const SAT = '2027-01-16'
const WED = '2027-01-20'

beforeAll(async () => {
  fx = await buildFixture({ extraResorts: [fixtureResort('bare-hill', { prices: [] })] })
  // A resort pass at test-peak with a published price, unlimited access and no blackouts: the one product whose
  // break-even assumptions can fit.
  const official = provenance({ kind: 'official', provider: 'example.org', sourceUrl: 'https://example.org/season', verification: 'official-page' })
  await fx.db.insert(s.passProducts).values({ id: 'test-peak-season-2026-27', familyId: 'ikon', seasonId: '2026-27', name: 'Test Peak Season Pass', resortId: 'test-peak', prov: official, updatedAt: NOW })
  await fx.db.insert(s.passAccessRules).values({ productId: 'test-peak-season-2026-27', resortId: 'test-peak', version: 1, access: 'unlimited', blackouts: [], reservationRequired: false, prov: official, updatedAt: NOW })
  await fx.db.insert(s.priceSnapshots).values({
    subjectType: 'pass-product',
    subjectId: 'test-peak-season-2026-27',
    resortId: 'test-peak',
    item: 'Adult season pass',
    category: 'adult',
    amountMinor: 10000,
    currency: 'USD',
    seasonId: '2026-27',
    quoteKind: 'published',
    observedAt: '2026-09-01T00:00:00.000Z',
    prov: official,
  })
  await fx.db.insert(s.fxRates).values({ base: 'USD', quote: 'CAD', rate: '1.3700', rateDate: '2027-01-14', provider: 'test-rates', fetchedAt: '2027-01-14T16:00:00.000Z', kind: 'official' })
})

describe('getCheckerView', () => {
  it('starts from my own pass and answers where it works on the date', async () => {
    const v = await getCheckerView(fx.ctx, {})
    expect(v.mode).toBe('pass')
    expect(v.selection).toMatchObject({ key: `own:${fx.ownershipId}`, productId: 'indy-base-2026-27', from: '2027-01-15', to: '2027-01-15' })
    expect(v.byResort!.map((a) => [a.resort.id, a.days[0].verdict.status])).toEqual([['test-peak', 'included-limited']])
    // My pass is listed first in the picker.
    expect(v.passes[0]).toMatchObject({ key: `own:${fx.ownershipId}`, holder: 'me' })
  })

  it('walks a range day by day: logged days and earlier days of the range use the allowance', async () => {
    const v = await getCheckerView(fx.ctx, { own: fx.ownershipId, resort: 'test-peak', from: SAT, to: '2027-01-17' })
    expect(v.mode).toBe('both')
    const days = v.result!.days.map((d) => [d.date, d.verdict.status, d.verdict.remainingDays])
    expect(days).toEqual([
      [SAT, 'included-limited', 1],
      ['2027-01-17', 'days-exhausted', 0],
    ])
    expect(v.result!.covered).toBe(1)
    expect(v.result!.owned).toMatchObject({ ownershipId: fx.ownershipId, loggedDays: 1 })
    expect(v.result!.days[0].verdict.reasons.join(' ')).toMatch(/No reservation required/)
  })

  it('never treats a missing or unknown rule as permission', async () => {
    const noRule = await getCheckerView(fx.ctx, { own: fx.ownershipId, resort: 'far-west', from: SAT })
    expect(noRule.result!.rule).toBeNull()
    expect(noRule.result!.days[0].verdict).toMatchObject({ status: 'unknown', canSki: false, headline: 'Access unknown' })
    // A rule recorded as 'unknown' is not shown: the checker answers as for no rule, never as included.
    const unknown = await getCheckerView(fx.ctx, { pass: 'ikon-base-2026-27', resort: 'far-west', from: SAT })
    expect(unknown.result!.rule).toBeNull()
    expect(unknown.result!.days[0].verdict).toMatchObject({ status: 'unknown', canSki: false })
    // Resort only: every product with a shown rule there, plus my pass — none can ski.
    const here = await getCheckerView(fx.ctx, { pass: 'none', resort: 'far-west', from: SAT })
    expect(here.mode).toBe('resort')
    expect(here.byProduct!.map((a) => [a.option.key, a.covered])).toEqual([[`own:${fx.ownershipId}`, 0]])
  })

  it('keeps dates inside the season and checks at most two weeks', async () => {
    const outside = await getCheckerView(fx.ctx, { own: fx.ownershipId, resort: 'test-peak', from: '2027-08-01' })
    expect(outside.selection.from).toBe('2027-01-15')
    expect(outside.selection.note).toMatch(/limited to the 2026–27 season/)
    const long = await getCheckerView(fx.ctx, { own: fx.ownershipId, resort: 'test-peak', from: SAT, to: '2027-03-01' })
    expect(long.result!.days).toHaveLength(MAX_CHECK_DAYS)
    expect(long.selection.note).toMatch(/first 14 days/)
  })
})

describe('getPassCompareView', () => {
  const days = [
    { resortId: 'test-peak', date: SAT },
    { resortId: 'test-peak', date: WED },
  ]

  it("prices every planned day with that day's own ticket and splits sunk from incremental for my pass", async () => {
    const v = await getPassCompareView(fx.ctx, { added: [...days, { resortId: 'test-peak', date: '2027-01-02' }, { resortId: 'test-peak', date: SAT }], includeTrips: false })
    // The past day and the duplicate are dropped, not silently re-dated.
    expect(v.dropped).toBe(2)
    expect(v.days.map((d) => [d.date, d.dayType, d.ticket?.amountMinor, d.ticketKind])).toEqual([
      [SAT, 'weekend', 8000, 'published'],
      [WED, 'weekday', 6000, 'published'],
    ])
    const r = v.result!
    expect(r.baseline.total).toEqual({ amountMinor: 14000, currency: 'USD' })

    const indy = r.candidates.find((c) => c.productId === 'indy-base-2026-27')!
    // One day left on my Indy: Saturday is covered, Wednesday finds no days left and is a ticket.
    expect(indy.days.map((d) => d.verdict.status)).toEqual(['included-limited', 'days-exhausted'])
    expect(indy).toMatchObject({
      owned: true,
      alreadyPaid: { amountMinor: 29900 },
      incremental: { amountMinor: 6000 },
      seasonTotal: { amountMinor: 35900 },
      savingsVsTickets: { amountMinor: 8000 },
      breakEven: { status: 'not-shown' },
    })
    expect(v.meta['indy-base-2026-27']).toMatchObject({ ownedByMe: true, priceBasis: 'Price you paid' })
  })

  it('shows a break-even only when the pass covers every planned day and every price is known', async () => {
    const fits = await getPassCompareView(fx.ctx, { added: days, includeTrips: false })
    const season = fits.result!.candidates.find((c) => c.productId === 'test-peak-season-2026-27')!
    expect(season.coveredDays).toBe(2)
    expect(season.breakEven).toMatchObject({ status: 'reached', dayCount: 2, onDate: WED })

    // One day without a ticket price anywhere: the break-even would rest on a guess, so it is not shown.
    const gap = await getPassCompareView(fx.ctx, { added: [...days, { resortId: 'bare-hill', date: SAT }], includeTrips: false })
    expect(gap.result!.baseline).toMatchObject({ total: null, unknownDays: [expect.objectContaining({ resortId: 'bare-hill' })] })
    const seasonGap = gap.result!.candidates.find((c) => c.productId === 'test-peak-season-2026-27')!
    expect(seasonGap.breakEven.status).toBe('not-shown')
    expect(seasonGap.seasonTotal).toBeNull()
    expect(gap.days.find((d) => d.resortId === 'bare-hill')).toMatchObject({ ticket: null, ticketKind: null, ticketEstimate: null })
  })

  it('switches display currency with a stored rate without changing stored values', async () => {
    const usd = await getPassCompareView(fx.ctx, { added: days, includeTrips: false })
    const cad = await getPassCompareView(fx.ctx, { added: days, includeTrips: false, currency: 'cad' })
    expect(cad.currencies).toEqual(['USD', 'CAD'])
    expect(cad.currency).toBe('CAD')
    expect(cad.result!.baseline.total).toEqual({ amountMinor: 19180, currency: 'CAD' })
    // The days keep their own USD prices; only the display converts.
    expect(cad.days[0].ticket).toEqual({ amountMinor: 8000, currency: 'USD' })
    expect(cad.fx).toEqual([expect.objectContaining({ from: 'USD', to: 'CAD', rate: '1 USD = 1.3700 CAD', rateDate: '2027-01-14' })])
    expect(usd.result!.baseline.total).toEqual({ amountMinor: 14000, currency: 'USD' })
    // An unreachable currency falls back to yours.
    expect((await getPassCompareView(fx.ctx, { added: days, includeTrips: false, currency: 'JPY' })).currency).toBe('USD')
  })
})

describe('getDayCostsView', () => {
  it('prices a basket per resort with my pass applied, and marks gaps as an incomplete estimate', async () => {
    const v = await getDayCostsView(fx.ctx, { date: SAT })
    const peak = v.rows.find((r) => r.resort.id === 'test-peak')!
    expect(peak.pass).toMatchObject({ productName: 'Indy Base Pass', canSki: true })
    expect(peak.basket.lines.find((l) => l.key === 'lift')).toMatchObject({ kind: 'pass-covered' })
    // Rental $45 + lunch $25 (lift covered, parking unknown and excluded).
    expect(peak.basket).toMatchObject({ complete: true, total: { amountMinor: 7000 }, label: '$', excluded: ['parking'] })
    const bare = v.rows.find((r) => r.resort.id === 'bare-hill')!
    expect(bare.basket).toMatchObject({ complete: false, total: null, label: 'Incomplete estimate' })
    expect(bare.estimates).toEqual([])
    expect(v.assumptions).toMatchObject({ rentalOption: 'full-package', lunch: { amountMinor: 2500, currency: 'USD' }, lunchCurrency: 'USD', partySize: 1 })
    expect(v.dayType).toBe('weekend')
  })
})
