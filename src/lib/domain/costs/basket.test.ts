import { describe, expect, it } from 'vitest'
import type { PriceSnapshotRow } from '@/lib/db/rows'
import { fromMajor, money } from '../money'
import { provenance } from '../types'
import { computeDayBasket, liftTicketFor, type BasketAssumptions, type BasketPass } from './basket'
import { DEFAULT_DAY_TYPE_CONFIG, dayTypeFor, HOLIDAY_CALENDAR_COUNTRIES, holidayCalendarApplies, holidaysForSeason, HOLIDAYS_2026_27 } from './day-type'
import type { FxRateRecord } from './fx'
import { isExpired, selectPrice, type PriceSnapshotInput } from './prices'

const _rowCompat: PriceSnapshotInput = {} as PriceSnapshotRow
void _rowCompat

const NOW = '2027-01-15T14:00:00.000Z'
const TODAY = '2027-01-15'
let nextId = 1
function snap(p: Partial<PriceSnapshotInput> & Pick<PriceSnapshotInput, 'subjectType' | 'amountMinor'>): PriceSnapshotInput {
  return {
    id: nextId++,
    subjectId: 'greek-peak',
    resortId: 'greek-peak',
    item: 'Adult 1-day',
    category: 'adult',
    amountMaxMinor: null,
    currency: 'USD',
    seasonId: '2026-27',
    dayType: 'any',
    appliesFrom: null,
    appliesTo: null,
    quoteKind: 'published',
    observedAt: '2026-10-01T00:00:00.000Z',
    expiresAt: null,
    prov: provenance({ kind: 'official', provider: 'greekpeak.net' }),
    ...p,
  }
}

const gp: PriceSnapshotInput[] = [
  snap({ subjectType: 'lift-ticket', amountMinor: 7900, dayType: 'weekday' }),
  snap({ subjectType: 'lift-ticket', amountMinor: 9900, dayType: 'weekend' }),
  snap({ subjectType: 'rental', item: 'full-package', amountMinor: 4500, dayType: 'any' }),
  snap({ subjectType: 'parking', item: 'Day lot', category: null, amountMinor: 1000 }),
]

const assumptions: BasketAssumptions = {
  currency: 'USD',
  rentalOption: 'full-package',
  lunch: fromMajor('25', 'USD'),
  partySize: 3,
}
const ctx = { now: NOW, today: TODAY, rates: [] as FxRateRecord[] }

describe('day types', () => {
  it('computes 2026-27 US federal holidays and the Christmas–New Year period', () => {
    const dates = HOLIDAYS_2026_27.map((h) => h.date)
    expect(dates).toContain('2026-11-26') // Thanksgiving
    expect(dates).toContain('2027-01-18') // MLK Day
    expect(dates).toContain('2027-02-15') // Presidents' Day
    expect(dates).toContain('2026-12-29') // inside Christmas–New Year
    expect(dates).not.toContain('2026-12-24')
    expect(dates).not.toContain('2027-01-02')
  })

  it('holiday beats weekend; ordinary days fall back to weekday/weekend', () => {
    expect(dayTypeFor('2027-01-18')).toEqual({ dayType: 'holiday', holidayName: 'Martin Luther King Jr. Day' })
    expect(dayTypeFor('2027-01-02').dayType).toBe('weekend') // Saturday just after the period
    expect(dayTypeFor('2027-01-20').dayType).toBe('weekday')
  })

  it('is configurable and works for later seasons', () => {
    const cfg = {
      usFederalHolidays: false,
      includeObserved: false,
      christmasNewYear: null,
      extraHolidays: [],
      extraRanges: [{ from: '2027-02-13', to: '2027-02-21', label: "Presidents' week" }],
    }
    expect(dayTypeFor('2027-01-18', cfg).dayType).toBe('weekday')
    expect(dayTypeFor('2027-02-17', cfg)).toEqual({ dayType: 'holiday', holidayName: "Presidents' week" })
    expect(holidaysForSeason('2027-28').map((h) => h.date)).toContain('2027-11-25') // Thanksgiving 2027
  })

  it('applies the holiday calendar to US and Canadian resorts only; elsewhere weekday/weekend', () => {
    expect(HOLIDAY_CALENDAR_COUNTRIES).toEqual(['US', 'CA'])
    // MLK Day (a Monday) and 29 Dec (inside the Christmas–New Year period, a Tuesday).
    expect(dayTypeFor('2027-01-18', DEFAULT_DAY_TYPE_CONFIG, 'US')).toEqual({ dayType: 'holiday', holidayName: 'Martin Luther King Jr. Day' })
    expect(dayTypeFor('2027-01-18', DEFAULT_DAY_TYPE_CONFIG, 'CA').dayType).toBe('holiday')
    for (const country of ['AT', 'CH', 'FR', 'JP', 'AU', 'NZ']) {
      expect(dayTypeFor('2027-01-18', DEFAULT_DAY_TYPE_CONFIG, country)).toEqual({ dayType: 'weekday', holidayName: null })
      expect(dayTypeFor('2026-12-29', DEFAULT_DAY_TYPE_CONFIG, country).dayType).toBe('weekday')
      expect(dayTypeFor('2027-01-16', DEFAULT_DAY_TYPE_CONFIG, country).dayType).toBe('weekend')
    }
    // An unknown country gets no holidays (never assumed American); an omitted one keeps the calendar.
    expect(dayTypeFor('2027-01-18', DEFAULT_DAY_TYPE_CONFIG, null).dayType).toBe('weekday')
    expect(dayTypeFor('2027-01-18').dayType).toBe('holiday')
    expect(holidayCalendarApplies('us')).toBe(true)
  })

  it('prices a basket by the resort country and a season-tagged price by the resort hemisphere', () => {
    const a: BasketAssumptions = { currency: 'AUD', rentalOption: 'none', lunch: null, partySize: 1 }
    const aud = (p: Partial<PriceSnapshotInput>) => snap({ subjectType: 'lift-ticket', amountMinor: 0, currency: 'AUD', subjectId: 'thredbo', resortId: 'thredbo', ...p })
    // Thredbo's 2027 winter is season 2026-27: a 2026-27 weekday price applies on a Monday in August 2027.
    const prices = [aud({ amountMinor: 18_900, dayType: 'weekday' }), aud({ amountMinor: 19_900, dayType: 'weekend' }), aud({ amountMinor: 25_000, dayType: 'holiday' })]
    const day = { resortId: 'thredbo', date: '2027-08-02', prices, country: 'AU', hemisphere: 'south' as const }
    const b = computeDayBasket(day, a, { now: NOW, today: TODAY, rates: [] })
    expect(b.dayType).toBe('weekday')
    expect(b.lines.find((l) => l.key === 'lift')?.amount).toEqual(money(18_900, 'AUD'))
    // Read as a northern resort, August 2027 is season 2027-28 and the 2026-27 prices would not apply.
    expect(computeDayBasket({ ...day, hemisphere: 'north' }, a, { now: NOW, today: TODAY, rates: [] }).lines.find((l) => l.key === 'lift')?.amount).toBeNull()
    // No US holiday in Australia: MLK Day 2027 is an ordinary Monday there.
    const mlk = computeDayBasket({ ...day, date: '2027-01-18' }, a, { now: NOW, today: TODAY, rates: [] })
    expect(mlk.dayType).toBe('weekday')
    expect(liftTicketFor(prices, 'thredbo', '2027-08-02', { now: NOW, today: TODAY, country: 'AU', hemisphere: 'south' }).price).toEqual(money(18_900, 'AUD'))
  })
})

describe('selectPrice', () => {
  const q = { subjectType: 'lift-ticket', resortId: 'greek-peak', date: '2027-01-16', dayType: 'weekend' as const, category: 'adult', now: NOW, today: TODAY }

  it('prefers published/observed over user estimates even when the estimate is more specific', () => {
    const est = snap({ subjectType: 'lift-ticket', amountMinor: 5000, dayType: 'weekend', appliesFrom: '2027-01-16', appliesTo: '2027-01-16', quoteKind: 'user-estimate' })
    const pub = snap({ subjectType: 'lift-ticket', amountMinor: 9900, dayType: 'any' })
    const sel = selectPrice([est, pub], q)
    expect(sel.snapshot?.id).toBe(pub.id)
    expect(sel.basis).toContain('Published')
    // With only the estimate, it is used and labelled as such.
    expect(selectPrice([est], q).basis).toContain('Your estimate')
  })

  it('picks the most specific applicable price: exact day type and narrowest dated window', () => {
    const any = snap({ subjectType: 'lift-ticket', amountMinor: 8000 })
    const weekend = snap({ subjectType: 'lift-ticket', amountMinor: 9900, dayType: 'weekend' })
    const janWeekend = snap({ subjectType: 'lift-ticket', amountMinor: 10900, dayType: 'weekend', appliesFrom: '2027-01-01', appliesTo: '2027-01-31' })
    const decWeekend = snap({ subjectType: 'lift-ticket', amountMinor: 11900, dayType: 'weekend', appliesFrom: '2026-12-01', appliesTo: '2026-12-31' })
    expect(selectPrice([any, weekend, janWeekend, decWeekend], q).snapshot?.id).toBe(janWeekend.id)
  })

  it('skips expired quotes, closed purchase windows, other seasons, categories and day types', () => {
    const expired = snap({ subjectType: 'lift-ticket', amountMinor: 6000, quoteKind: 'observed-quote', expiresAt: '2027-01-15T13:59:00.000Z' })
    const advance = snap({ subjectType: 'lift-ticket', amountMinor: 5500, purchaseBy: '2027-01-14' })
    const lastSeason = snap({ subjectType: 'lift-ticket', amountMinor: 7000, seasonId: '2025-26' })
    const child = snap({ subjectType: 'lift-ticket', amountMinor: 4000, category: 'child' })
    const weekday = snap({ subjectType: 'lift-ticket', amountMinor: 7900, dayType: 'weekday' })
    const sel = selectPrice([expired, advance, lastSeason, child, weekday], q)
    expect(sel.snapshot).toBeNull()
    expect(sel.expired).toBe(2)
  })

  it('does not reuse a weekend price for a holiday', () => {
    expect(selectPrice(gp, { ...q, date: '2027-01-18', dayType: 'holiday' }).snapshot).toBeNull()
  })

  it('marks research-grade prices "confirm at source" and says when the day type is not stated', () => {
    const researched = snap({
      subjectType: 'lift-ticket',
      amountMinor: 12000,
      dayType: null,
      prov: provenance({ kind: 'manual', provider: 'Piste catalog', verification: 'search-summary' }),
    })
    const sel = selectPrice([researched], { ...q, date: '2027-01-18', dayType: 'holiday' })
    expect(sel.snapshot?.id).toBe(researched.id)
    expect(sel.confirmAtSource).toBe(true)
    expect(sel.basis).toContain('Researched — confirm at source')
    expect(sel.basis).toContain('day type not stated')
    expect(selectPrice(gp, q).confirmAtSource).toBe(false)
  })

  it('date-only expiry is valid through that local day, even after UTC midnight', () => {
    // 22:30 in Ithaca on 14 Jan is already 15 Jan in UTC; a quote valid through 14 Jan is still valid.
    expect(isExpired('2027-01-14', '2027-01-15T03:30:00.000Z', '2027-01-14')).toBe(false)
    expect(isExpired('2027-01-15', NOW, TODAY)).toBe(false)
    expect(isExpired('2027-01-14', NOW, TODAY)).toBe(true)
    expect(isExpired('2027-01-15T14:00:00.000Z', NOW)).toBe(true)
    expect(isExpired(null, NOW)).toBe(false)
  })
})

describe('computeDayBasket', () => {
  it('adds lift + rental + lunch + per-person parking share with kinds and sources', () => {
    const b = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices: gp }, assumptions, ctx)
    expect(b.dayType).toBe('weekend')
    const byKey = Object.fromEntries(b.lines.map((l) => [l.key, l]))
    expect(byKey.lift.amount).toEqual(money(9900, 'USD'))
    expect(byKey.lift.kind).toBe('published')
    expect(byKey.rental.amount).toEqual(money(4500, 'USD'))
    expect(byKey.lunch).toMatchObject({ kind: 'user-estimate', source: 'Your lunch estimate (Settings)' })
    // $10 per vehicle ÷ 3 → 3.34 (largest exact share, never under-counted)
    expect(byKey.parking.amount).toEqual(money(334, 'USD'))
    expect(byKey.parking.note).toContain('per vehicle')
    expect(b.complete).toBe(true)
    expect(b.total).toEqual(money(9900 + 4500 + 2500 + 334, 'USD'))
    expect(b.label).toBe('$$')
  })

  it('is an incomplete estimate — no total, no tier — when the lift price is missing', () => {
    const noTicket = gp.filter((s) => s.subjectType !== 'lift-ticket')
    const b = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices: noTicket }, assumptions, ctx)
    expect(b.complete).toBe(false)
    expect(b.total).toBeNull()
    expect(b.tier.tier).toBe('incomplete')
    expect(b.label).toBe('Incomplete estimate')
    // Human date in the sentence, never the raw ISO date.
    expect(b.missing.find((m) => m.key === 'lift')).toMatchObject({ required: true, message: 'No weekend lift ticket price for Sat 16 Jan.' })
    // The known lines are still shown for itemisation.
    expect(b.knownSubtotal.amountMinor).toBe(4500 + 2500 + 334)
  })

  it('is incomplete when a needed rental price is missing, but not when you own gear', () => {
    const noRental = gp.filter((s) => s.subjectType !== 'rental')
    const need = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices: noRental }, assumptions, ctx)
    expect(need.tier.tier).toBe('incomplete')
    const own = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices: noRental }, { ...assumptions, rentalOption: 'none' }, ctx)
    expect(own.complete).toBe(true)
    expect(own.lines.find((l) => l.key === 'rental')).toMatchObject({ kind: 'assumption', note: 'Own gear — no rental' })
  })

  it('a pass that covers the day makes lift access 0 with a "Covered by" note', () => {
    const pass: BasketPass = { canSki: true, status: 'included', productName: 'Ikon Pass', reservationRequired: true, discountText: null }
    const noTicket = gp.filter((s) => s.subjectType !== 'lift-ticket')
    const b = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices: noTicket, pass }, assumptions, ctx)
    const lift = b.lines.find((l) => l.key === 'lift')!
    expect(lift.amount).toEqual(money(0, 'USD'))
    expect(lift.kind).toBe('pass-covered')
    expect(lift.note).toBe('Covered by Ikon Pass — reservation required')
    expect(b.complete).toBe(true)
    expect(b.total).toEqual(money(4500 + 2500 + 334, 'USD'))
  })

  it('carries research-grade flags into lines and caveats, and never hides an unknown reservation rule', () => {
    const researchedLift = snap({
      subjectType: 'lift-ticket',
      amountMinor: 9900,
      dayType: 'weekend',
      prov: provenance({ kind: 'manual', verification: 'search-summary' }),
    })
    const prices = [researchedLift, ...gp.filter((s) => s.subjectType !== 'lift-ticket')]
    const b = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices }, assumptions, ctx)
    const lift = b.lines.find((l) => l.key === 'lift')!
    expect(lift.kind).toBe('published')
    expect(lift.confirmAtSource).toBe(true)
    expect(lift.source).toContain('Researched — confirm at source')
    expect(b.caveats).toContain('Researched — confirm at source: lift ticket')

    const pass: BasketPass = {
      canSki: true,
      status: 'included',
      productName: 'Ikon Pass',
      reservationRequired: null,
      discountText: null,
      confirmAtSource: true,
    }
    const covered = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices: gp, pass }, assumptions, ctx)
    const passLine = covered.lines.find((l) => l.key === 'lift')!
    expect(passLine.confirmAtSource).toBe(true)
    expect(passLine.note).toContain('reservation requirement not recorded')
    expect(passLine.note).toContain('confirm at source')
  })

  it('a pass that does not cover the day (e.g. blackout) still needs a ticket price', () => {
    const pass: BasketPass = { canSki: false, status: 'blackout', productName: 'Ikon Pass', reservationRequired: null, discountText: null }
    const b = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices: gp, pass }, assumptions, ctx)
    const lift = b.lines.find((l) => l.key === 'lift')!
    expect(lift.amount).toEqual(money(9900, 'USD'))
    expect(lift.note).toContain('Not covered by Ikon Pass')
  })

  it('unknown parking is listed and excluded, while confirmed free parking is 0', () => {
    const noParking = gp.filter((s) => s.subjectType !== 'parking')
    const b = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-20', prices: noParking }, assumptions, ctx)
    expect(b.excluded).toEqual(['parking'])
    expect(b.missing.some((m) => m.key === 'parking' && !m.required)).toBe(true)
    const free = computeDayBasket(
      { resortId: 'greek-peak', date: '2027-01-20', prices: noParking, parking: { status: 'free', source: 'greekpeak.net' } },
      assumptions,
      ctx,
    )
    expect(free.excluded).toEqual([])
    expect(free.lines.find((l) => l.key === 'parking')?.amount).toEqual(money(0, 'USD'))
  })

  it('converts foreign prices for display, keeps originals, and classifies in USD', () => {
    const rates: FxRateRecord[] = [{ base: 'USD', quote: 'CAD', rate: '1.3700', rateDate: '2027-01-14', provider: 'ECB' }]
    const wb: PriceSnapshotInput[] = [
      snap({ subjectType: 'lift-ticket', resortId: 'whistler', subjectId: 'whistler', amountMinor: 32900, currency: 'CAD', dayType: 'weekend' }),
      snap({ subjectType: 'rental', resortId: 'whistler', subjectId: 'whistler', item: 'Full package', amountMinor: 8900, currency: 'CAD' }),
    ]
    const b = computeDayBasket(
      { resortId: 'whistler', date: '2027-01-16', prices: wb, parking: { status: 'not-needed' } },
      assumptions,
      { now: NOW, today: TODAY, rates },
    )
    const lift = b.lines.find((l) => l.key === 'lift')!
    expect(lift.amount).toEqual(money(32900, 'CAD'))
    expect(lift.display).toEqual(money(24015, 'USD')) // 329 / 1.37 = 240.146 → 240.15
    expect(lift.fx).toMatchObject({ rateDate: '2027-01-14', path: 'inverse' })
    expect(b.tier.tier).toBe('$$$') // 240.15 + 64.96 + 25 = 330.11
    // Without a rate: prices known, but no display total and no tier.
    const noFx = computeDayBasket({ resortId: 'whistler', date: '2027-01-16', prices: wb, parking: { status: 'not-needed' } }, assumptions, ctx)
    expect(noFx.complete).toBe(true)
    expect(noFx.total).toBeNull()
    expect(noFx.tier.tier).toBe('incomplete')
    expect(noFx.missing.some((m) => m.key === 'fx')).toBe(true)
  })

  it('classifies an estimate range at both ends when it crosses a tier band', () => {
    const range = snap({ subjectType: 'lift-ticket', amountMinor: 10000, amountMaxMinor: 14000, quoteKind: 'user-estimate' })
    const b = computeDayBasket(
      { resortId: 'greek-peak', date: '2027-01-20', prices: [range], parking: { status: 'free', source: 'greekpeak.net' } },
      { ...assumptions, rentalOption: 'none', lunch: fromMajor('20', 'USD') },
      ctx,
    )
    expect(b.total).toEqual(money(12000, 'USD'))
    expect(b.totalMax).toEqual(money(16000, 'USD'))
    expect(b.tier.tier).toBe('$')
    expect(b.tierMax).toBe('$$')
    expect(b.caveats).toContain('Estimate range spans $ to $$')
    // A point estimate has no high-end tier.
    expect(computeDayBasket({ resortId: 'greek-peak', date: '2027-01-16', prices: gp }, assumptions, ctx).tierMax).toBeNull()
  })

  it('does not label an unsourced parking fact as a published price', () => {
    const b = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-20', prices: gp, parking: { status: 'free' } }, assumptions, ctx)
    expect(b.lines.find((l) => l.key === 'parking')?.kind).toBe('assumption')
    const sourced = computeDayBasket(
      { resortId: 'greek-peak', date: '2027-01-20', prices: gp, parking: { status: 'free', source: 'greekpeak.net' } },
      assumptions,
      ctx,
    )
    expect(sourced.lines.find((l) => l.key === 'parking')?.kind).toBe('published')
  })

  it('can require parking too, and refuses a pass verdict for another day', () => {
    const noParking = gp.filter((s) => s.subjectType !== 'parking')
    const strict = computeDayBasket(
      { resortId: 'greek-peak', date: '2027-01-20', prices: noParking },
      { ...assumptions, required: ['lift', 'rental', 'parking'] },
      ctx,
    )
    expect(strict.complete).toBe(false)
    expect(strict.label).toBe('Incomplete estimate')
    const lenient = computeDayBasket({ resortId: 'greek-peak', date: '2027-01-20', prices: noParking }, assumptions, ctx)
    expect(lenient.caveats).toEqual(['Excludes parking (unknown)'])

    const wrongDay: BasketPass = { canSki: true, status: 'included', productName: 'Ikon Pass', reservationRequired: false, discountText: null, date: '2027-01-21' }
    expect(() => computeDayBasket({ resortId: 'greek-peak', date: '2027-01-20', prices: gp, pass: wrongDay }, assumptions, ctx)).toThrow()
  })

  it('liftTicketFor returns each day its own price by day type', () => {
    expect(liftTicketFor(gp, 'greek-peak', '2027-01-20', { now: NOW }).price).toEqual(money(7900, 'USD'))
    expect(liftTicketFor(gp, 'greek-peak', '2027-01-23', { now: NOW }).price).toEqual(money(9900, 'USD'))
    expect(liftTicketFor(gp, 'greek-peak', '2027-01-18', { now: NOW }).price).toBeNull() // MLK Day: no holiday price
  })
})
