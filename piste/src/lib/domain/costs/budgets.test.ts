import { describe, expect, it } from 'vitest'
import type { ExpenseRow, TripItemRow } from '@/lib/db/rows'
import { fromMajor, money, type Money } from '../money'
import { provenance } from '../types'
import type { PassProductInput, PassRuleInput } from '../passes/types'
import type { FxRateRecord } from './fx'
import { comparePasses, type PlannedResortDay } from './pass-calculator'
import { computeSeasonBudget, type ExpenseInput } from './season-budget'
import { computeTripBudget, type TripBudgetItemInput } from './trip-budget'

const _rowCompat: [TripBudgetItemInput, ExpenseInput] = [{} as TripItemRow, {} as ExpenseRow]
void _rowCompat

const NOW = '2027-01-15T14:00:00.000Z'
const TODAY = '2027-01-15'
const usd = (major: string) => fromMajor(major, 'USD')
const rates: FxRateRecord[] = [{ base: 'USD', quote: 'CAD', rate: '1.3700', rateDate: '2027-01-14', provider: 'ECB' }]

function item(p: Partial<TripBudgetItemInput> & Pick<TripBudgetItemInput, 'title'>): TripBudgetItemInput {
  return {
    type: 'other',
    costMinor: null,
    costMaxMinor: null,
    currency: 'USD',
    costKind: 'estimate',
    costBasis: 'per-person',
    quoteExpiresAt: null,
    ...p,
  }
}

const total = (ms: Money[]) => ms.reduce((a, m) => a + m.amountMinor, 0)

describe('computeTripBudget', () => {
  it('splits a shared $100 three ways exactly', () => {
    const b = computeTripBudget({
      items: [item({ title: 'Condo cleaning fee', costMinor: 10000, costBasis: 'shared' })],
      partySize: 3,
      currency: 'USD',
      rates,
      now: NOW,
    })
    const shares = b.lines[0].shares!.min
    expect(shares.map((s) => s.amountMinor).sort()).toEqual([3333, 3333, 3334])
    expect(total(shares)).toBe(10000)
    expect(total(b.perPerson.map((p) => p.min))).toBe(b.group.min.amountMinor)
    expect(b.perPersonMax.min).toEqual(money(3334, 'USD'))
  })

  it('rotates leftover cents across people and keeps every total exact', () => {
    const items = Array.from({ length: 3 }, (_, i) => item({ title: `Shared ${i}`, costMinor: 10000, costBasis: 'shared' as const }))
    const b = computeTripBudget({ items, partySize: 3, currency: 'USD', rates, now: NOW })
    expect(b.perPerson.map((p) => p.min.amountMinor)).toEqual([10000, 10000, 10000])
    expect(b.group.min).toEqual(money(30000, 'USD'))
  })

  it('multiplies per-person items by party size and sums ranges as min–max', () => {
    const b = computeTripBudget({
      items: [
        item({ title: 'Lift tickets', costMinor: 12000, costMaxMinor: 15000 }),
        item({ title: 'Lodging', costMinor: 60000, costMaxMinor: 90000, costBasis: 'shared', costKind: 'quote' }),
      ],
      partySize: 2,
      currency: 'USD',
      rates,
      now: NOW,
    })
    expect(b.group).toEqual({ min: money(24000 + 60000, 'USD'), max: money(30000 + 90000, 'USD') })
    expect(b.perPerson[0]).toEqual({ min: money(12000 + 30000, 'USD'), max: money(15000 + 45000, 'USD') })
    expect(b.lines[0].isRange).toBe(true)
  })

  it('flags expired quotes but not booked or actual costs', () => {
    const b = computeTripBudget({
      items: [
        item({ id: 1, title: 'Flight quote', costMinor: 40000, costKind: 'quote', quoteExpiresAt: '2027-01-14T23:00:00.000Z' }),
        item({ id: 2, title: 'Hotel quote', costMinor: 40000, costKind: 'quote', quoteExpiresAt: '2027-01-20' }),
        item({ id: 3, title: 'Booked hotel', costMinor: 40000, costKind: 'quote', status: 'booked', quoteExpiresAt: '2027-01-01' }),
        item({ id: 4, title: 'Paid shuttle', costMinor: 4000, costKind: 'actual', quoteExpiresAt: '2027-01-01' }),
      ],
      partySize: 1,
      currency: 'USD',
      rates,
      now: NOW,
      today: TODAY,
    })
    expect(b.expiredQuotes.map((q) => q.id)).toEqual([1])
    expect(b.lines[0].expired).toBe(true)
    expect(b.lines[0].flags[0]).toContain('Quote expired')
    // Still counted — it is the best number on file.
    expect(b.group.min.amountMinor).toBe(124000)
  })

  it('lists missing items and keeps unconvertible items in their original currency', () => {
    const b = computeTripBudget({
      items: [
        item({ id: 'a', title: 'Rental car', costMinor: null }),
        item({ id: 'b', title: 'Arlberg ticket', costMinor: 7900, currency: 'EUR' }),
        item({ id: 'c', title: 'Whistler lodging', costMinor: 27400, currency: 'CAD', costBasis: 'shared' }),
      ],
      partySize: 2,
      currency: 'USD',
      rates,
      now: NOW,
    })
    expect(b.missing).toEqual([{ id: 'a', title: 'Rental car', reason: 'No cost entered' }])
    expect(b.unconverted.map((u) => u.id)).toEqual(['b'])
    expect(b.unconverted[0].original.min).toEqual(money(7900, 'EUR'))
    expect(b.complete).toBe(false)
    // The partial sum is never offered as the trip total.
    expect(b.total).toBeNull()
    expect(b.perPersonTotal).toBeNull()
    const cad = b.lines[2]
    expect(cad.original!.min).toEqual(money(27400, 'CAD'))
    expect(cad.display!.min).toEqual(money(20000, 'USD'))
    expect(cad.fx).toMatchObject({ rateDate: '2027-01-14', provider: 'ECB' })
    expect(cad.fxSource).toBe('stored-rates')
    expect(b.group.min).toEqual(money(20000, 'USD'))
  })

  it('a trip whose only item has no cost has no total — not $0', () => {
    const b = computeTripBudget({ items: [item({ title: 'Rental car' })], partySize: 2, currency: 'USD', rates, now: NOW })
    expect(b.complete).toBe(false)
    expect(b.total).toBeNull()
    expect(b.perPersonTotal).toBeNull()
    const priced = computeTripBudget({
      items: [item({ title: 'Condo', costMinor: 10000, costBasis: 'shared' })],
      partySize: 3,
      currency: 'USD',
      rates,
      now: NOW,
    })
    expect(priced.total).toEqual({ min: money(10000, 'USD'), max: money(10000, 'USD') })
    expect(priced.perPersonTotal).toEqual({ min: money(3334, 'USD'), max: money(3334, 'USD') })
  })

  it('uses a locked per-item rate only when its target currency is known', () => {
    const locked = item({ title: 'Prepaid CAD hotel', costMinor: 10000, currency: 'CAD', fxRate: '0.70', fxDate: '2026-11-02', fxQuote: 'USD' })
    const b = computeTripBudget({ items: [locked], partySize: 1, currency: 'USD', rates, now: NOW })
    expect(b.lines[0].display!.min).toEqual(money(7000, 'USD'))
    expect(b.lines[0].fxSource).toBe('item')
    const unknownTarget = computeTripBudget({ items: [{ ...locked, fxQuote: null }], partySize: 1, currency: 'USD', rates, now: NOW })
    expect(unknownTarget.lines[0].fxSource).toBe('stored-rates')
  })
})

// ---------------------------------------------------------------------------

const prov = provenance({ kind: 'official', verification: 'official-page' })
const ikon: PassProductInput = { id: 'ikon', familyId: 'ikon', seasonId: '2026-27', name: 'Ikon Pass' }
const rule = (p: Partial<PassRuleInput> & Pick<PassRuleInput, 'resortId' | 'access'>): PassRuleInput => ({
  productId: 'ikon',
  days: null,
  poolId: null,
  poolLabel: null,
  blackouts: [],
  reservationRequired: false,
  prov,
  ...p,
})

describe('comparePasses', () => {
  const days: PlannedResortDay[] = [
    { resortId: 'greek-peak', date: '2027-01-09', ticket: usd('99') },
    { resortId: 'greek-peak', date: '2027-01-13', ticket: usd('79') },
    { resortId: 'killington', date: '2027-01-23', ticket: usd('159') },
    { resortId: 'alta', date: '2027-02-06', ticket: usd('239') }, // the most expensive walk-up
  ]
  const unlimited = ['greek-peak', 'killington', 'alta'].map((resortId) => rule({ resortId, access: 'unlimited' }))

  it("baseline is the sum of each day's own ticket, not max walk-up × days", () => {
    const r = comparePasses({ days, candidates: [], currency: 'USD', rates })
    expect(r.baseline.total).toEqual(usd('576'))
    expect(r.baseline.total!.amountMinor).not.toBe(23900 * days.length)
  })

  it('break-even counts own-day prices cumulatively in date order', () => {
    const r = comparePasses({ days, candidates: [{ product: ikon, rules: unlimited, price: usd('300') }], currency: 'USD', rates })
    const c = r.candidates[0]
    expect(c.coveredDays).toBe(4)
    expect(c.seasonTotal).toEqual(usd('300'))
    expect(c.savingsVsTickets).toEqual(usd('276'))
    // 99 + 79 + 159 = 337 ≥ 300 on the 3rd day. A max-walk-up denominator (239) would claim 2 days.
    expect(c.breakEven).toMatchObject({ status: 'reached', dayCount: 3, onDate: '2027-01-23' })
  })

  it('reports when planned days do not reach the pass price', () => {
    const r = comparePasses({ days, candidates: [{ product: ikon, rules: unlimited, price: usd('1000') }], currency: 'USD', rates })
    expect(r.candidates[0].breakEven).toMatchObject({ status: 'not-reached', shortfall: usd('424') })
  })

  it('adds ticket costs of blackout/exhausted/not-included days and withholds break-even', () => {
    const rules = [
      rule({ resortId: 'greek-peak', access: 'limited-days', days: 1 }),
      rule({ resortId: 'killington', access: 'unlimited', blackouts: [{ from: '2027-01-23', to: '2027-01-23' }] }),
      rule({ resortId: 'alta', access: 'not-included' }),
    ]
    const c = comparePasses({ days, candidates: [{ product: ikon, rules, price: usd('100') }], currency: 'USD', rates }).candidates[0]
    expect(c.coveredDays).toBe(1)
    expect(c.uncovered.byStatus).toEqual({ 'days-exhausted': 1, blackout: 1, 'not-included': 1 })
    expect(c.uncoveredTicketCost).toEqual(usd(String(79 + 159 + 239)))
    expect(c.seasonTotal).toEqual(usd(String(100 + 79 + 159 + 239)))
    expect(c.breakEven.status).toBe('not-shown')
    expect(c.breakEven.explanation).toContain('does not cover every planned day')
  })

  it('never treats unknown access as covered and never guesses a missing ticket', () => {
    const rules = [rule({ resortId: 'greek-peak', access: 'unlimited' })] // no rule for killington/alta
    const withGap = [...days.slice(0, 3), { resortId: 'alta', date: '2027-02-06', ticket: null }]
    const r = comparePasses({ days: withGap, candidates: [{ product: ikon, rules, price: usd('300') }], currency: 'USD', rates })
    const c = r.candidates[0]
    expect(r.baseline.total).toBeNull()
    expect(r.baseline.unknownDays).toHaveLength(1)
    expect(c.uncovered.byStatus.unknown).toBe(2)
    expect(c.uncoveredTicketCost).toBeNull()
    expect(c.uncoveredKnownCost).toEqual(usd('159'))
    expect(c.seasonTotal).toBeNull()
    expect(c.breakEven).toMatchObject({ status: 'not-shown' })
    expect(c.breakEven.explanation).toContain('Ticket prices are missing')
  })

  it('separates already-paid from incremental for an owned pass, with a season-total view', () => {
    const rules = [
      rule({ resortId: 'greek-peak', access: 'unlimited' }),
      rule({ resortId: 'killington', access: 'unlimited' }),
      rule({ resortId: 'alta', access: 'limited-days', days: 2 }),
    ]
    const logged = [
      { resortId: 'alta', date: '2026-12-20' },
      { resortId: 'alta', date: '2026-12-21' },
    ]
    const c = comparePasses({
      days,
      candidates: [{ product: ikon, rules, price: usd('1200'), owned: { usage: logged } }],
      currency: 'USD',
      rates,
    }).candidates[0]
    expect(c.owned).toBe(true)
    expect(c.alreadyPaid).toEqual(usd('1200'))
    expect(c.incremental).toEqual(usd('239')) // Alta allotment already used up
    expect(c.seasonTotal).toEqual(usd('1439'))
    expect(c.savingsVsTickets).toEqual(usd('337'))
    expect(c.seasonSavingsVsTickets).toEqual(usd('-863'))
    expect(c.breakEven.status).toBe('not-shown')
  })

  it("converts each day's ticket in its own currency", () => {
    const r = comparePasses({
      days: [{ resortId: 'whistler', date: '2027-01-16', ticket: fromMajor('274', 'CAD') }, days[0]],
      candidates: [],
      currency: 'USD',
      rates,
    })
    expect(r.baseline.total).toEqual(usd(String(200 + 99)))
  })
})

// ---------------------------------------------------------------------------

describe('computeSeasonBudget', () => {
  const pass = {
    ownershipId: 7,
    productName: 'Ikon Pass',
    pricePaid: usd('1200'),
    usage: [
      { resortId: 'killington', date: '2027-01-09' },
      { resortId: 'killington', date: '2027-01-10' },
      { resortId: 'alta', date: '2027-02-06' },
    ],
  }
  const exp = (p: Partial<ExpenseInput> & Pick<ExpenseInput, 'category' | 'amountMinor'>): ExpenseInput => ({
    date: '2027-01-09',
    label: p.category,
    currency: 'USD',
    ...p,
  })

  it('counts a pass purchase once when it is both an expense and the ownership price', () => {
    const b = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      expenses: [exp({ category: 'pass', label: 'Ikon Pass purchase', amountMinor: 120000, date: '2026-09-01', passOwnershipId: 7 })],
      passes: [pass],
    })
    const passLine = b.categories.find((c) => c.category === 'pass')!
    expect(passLine.actual).toEqual(usd('1200'))
    expect(b.actualTotal).toEqual(usd('1200'))
    expect(b.passes[0]).toMatchObject({ costSource: 'linked-expenses', daysUsed: 3, costPerDay: usd('400') })
  })

  it('uses the ownership price when no expense exists, and matches an unlinked expense of the same amount', () => {
    const fromRecord = computeSeasonBudget({ currency: 'USD', rates, today: TODAY, expenses: [], passes: [pass] })
    expect(fromRecord.actualTotal).toEqual(usd('1200'))
    expect(fromRecord.passes[0].costSource).toBe('pass-record')

    const unlinked = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      expenses: [exp({ category: 'pass', label: 'Ikon', amountMinor: 120000, date: '2026-09-01' })],
      passes: [pass],
    })
    expect(unlinked.actualTotal).toEqual(usd('1200'))
    expect(unlinked.passes[0].costSource).toBe('matched-expense')
    expect(unlinked.warnings.join(' ')).toContain('counted once')
  })

  it("counts a pass bought in the spring sale (dated last season) in the season it is for — once", () => {
    const b = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      seasonId: '2026-27',
      expenses: [
        exp({ category: 'pass', label: 'Ikon spring sale', amountMinor: 120000, date: '2026-04-01', passOwnershipId: 7 }),
        // Linked to a pass that is not part of this season's budget and dated last season: stays out.
        exp({ category: 'pass', label: 'Old pass', amountMinor: 50000, date: '2025-09-01', passOwnershipId: 3 }),
      ],
      passes: [{ ...pass, pricePaid: null }],
    })
    expect(b.categories.find((c) => c.category === 'pass')!.actual).toEqual(usd('1200'))
    expect(b.actualTotal).toEqual(usd('1200'))
    expect(b.passes[0]).toMatchObject({ cost: usd('1200'), costSource: 'linked-expenses', costPerDay: usd('400') })
    expect(b.warnings.join(' ')).not.toContain('not recorded')
  })

  it('an unlinked pass purchase logged as a lift expense is not also counted as lift cash', () => {
    const b = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      expenses: [
        exp({ category: 'lift', label: 'Ikon', amountMinor: 120000, date: '2026-10-01' }),
        exp({ category: 'lift', label: 'Greek Peak ticket', amountMinor: 9900, date: '2027-01-20' }),
      ],
      passes: [pass],
    })
    expect(b.actualTotal).toEqual(usd('1299'))
    expect(b.categories.find((c) => c.category === 'lift')!.actual).toEqual(usd('99'))
    expect(b.passes[0].costSource).toBe('matched-expense')
    expect(b.warnings.join(' ')).toContain('logged as lift')
  })

  it('an expense linked to a pass counts as the pass, never as daily lift cash', () => {
    const b = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      expenses: [exp({ category: 'lift', label: 'Ikon (logged as lift)', amountMinor: 120000, passOwnershipId: 7 })],
      passes: [pass],
    })
    expect(b.categories.find((c) => c.category === 'lift')!.actual.amountMinor).toBe(0)
    expect(b.categories.find((c) => c.category === 'pass')!.actual).toEqual(usd('1200'))
  })

  it('pass-covered planned days add no lift cost; the owned pass is planned exactly once', () => {
    const b = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      expenses: [],
      passes: [pass],
      planned: [
        { category: 'lift', label: 'Killington day', amount: usd('159'), date: '2027-02-20', passCovered: true },
        { category: 'lift', label: 'Greek Peak day', amount: usd('99'), date: '2027-02-21' },
        { category: 'pass', label: 'Ikon', amount: usd('1200'), passOwnershipId: 7 },
        { category: 'pass', label: 'Ikon (dup)', amount: usd('1200'), passOwnershipId: 7 },
      ],
    })
    expect(b.categories.find((c) => c.category === 'lift')!.planned).toEqual(usd('99'))
    expect(b.categories.find((c) => c.category === 'pass')!.planned).toEqual(usd('1200'))
    expect(b.plannedTotal).toEqual(usd('1299'))
  })

  it('an unlinked planned pass line priced like the owned pass is planned once, not twice', () => {
    const b = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      expenses: [],
      passes: [pass],
      planned: [{ category: 'pass', label: 'Ikon Pass', amount: usd('1200') }],
    })
    expect(b.categories.find((c) => c.category === 'pass')!.planned).toEqual(usd('1200'))
    expect(b.warnings.join(' ')).toContain('planned once')
    // A different planned pass (e.g. a second product you might buy) still counts.
    const two = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      expenses: [],
      passes: [pass],
      planned: [{ category: 'pass', label: 'Indy Pass', amount: usd('399') }],
    })
    expect(two.categories.find((c) => c.category === 'pass')!.planned).toEqual(usd('1599'))
  })

  it('cost per ski day, pass usage value and warnings for lift cash on pass days', () => {
    const b = computeSeasonBudget({
      currency: 'USD',
      rates,
      today: TODAY,
      seasonId: '2026-27',
      expenses: [
        exp({ category: 'pass', amountMinor: 120000, date: '2026-09-01', passOwnershipId: 7 }),
        exp({ category: 'lift', label: 'Buddy ticket', amountMinor: 10000, date: '2027-01-10' }),
        exp({ category: 'food', amountMinor: 5000, date: '2027-01-20' }),
        exp({ category: 'lodging', amountMinor: 999999, date: '2026-03-01' }), // last season — excluded
      ],
      passes: [pass],
      skiDays: [{ resortId: 'greek-peak', date: '2027-01-20' }],
      ticketValues: [
        { resortId: 'killington', date: '2027-01-09', ticket: usd('159') },
        { resortId: 'killington', date: '2027-01-10', ticket: usd('159') },
        { resortId: 'alta', date: '2027-02-06', ticket: fromMajor('274', 'CAD') },
      ],
    })
    expect(b.actualTotal).toEqual(usd('1350'))
    expect(b.skiDays).toBe(4)
    expect(b.costPerSkiDay).toEqual(fromMajor('337.50', 'USD'))
    expect(b.onSnowCostPerSkiDay).toEqual(usd('325'))
    expect(b.warnings.some((w) => w.includes('Buddy ticket'))).toBe(true)
    expect(b.passes[0].ticketValue).toEqual(usd(String(159 + 159 + 200)))
    expect(b.passes[0].netValue).toEqual(usd(String(518 - 1200)))
  })

  it('leaves pass value unknown when a used day has no ticket price', () => {
    const b = computeSeasonBudget({ currency: 'USD', rates, today: TODAY, expenses: [], passes: [pass], ticketValues: [] })
    expect(b.passes[0]).toMatchObject({ ticketValue: null, unknownValueDays: 3, netValue: null })
  })
})
