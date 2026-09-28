import { describe, expect, it } from 'vitest'
import type { FxRateRow } from '@/lib/db/rows'
import { fromMajor, money } from '../money'
import { convertAtRate, convertMoney, findRate, type FxRateRecord } from './fx'
import { classifyTier, DEFAULT_TIER_BANDS, describeBands, tierFor, validateBands } from './tiers'

const _rowCompat: FxRateRecord = {} as FxRateRow
void _rowCompat

const rates: FxRateRecord[] = [
  { base: 'USD', quote: 'CAD', rate: '1.3700', rateDate: '2027-01-10', provider: 'ECB' },
  { base: 'USD', quote: 'CAD', rate: '1.3500', rateDate: '2027-01-05', provider: 'ECB' },
  { base: 'EUR', quote: 'USD', rate: '1.0850', rateDate: '2027-01-10', provider: 'ECB' },
  { base: 'USD', quote: 'JPY', rate: '157.25', rateDate: '2027-01-10', provider: 'ECB' },
]

describe('fx', () => {
  it('converts with the latest direct rate, rounding half-up once, and preserves the original', () => {
    const original = Object.freeze(fromMajor('100.00', 'USD'))
    const r = convertMoney(original, 'CAD', rates)!
    expect(r.converted).toEqual(money(13700, 'CAD'))
    expect(r.fx).toMatchObject({ path: 'direct', rate: '1.37', rateDate: '2027-01-10', provider: 'ECB' })
    expect(r.original).toEqual({ amountMinor: 10000, currency: 'USD' })
    expect(original).toEqual({ amountMinor: 10000, currency: 'USD' })
  })

  it('honours asOf to reproduce a past conversion', () => {
    const r = convertMoney(fromMajor('100', 'USD'), 'CAD', rates, { asOf: '2027-01-06' })!
    expect(r.converted.amountMinor).toBe(13500)
    expect(r.fx.rateDate).toBe('2027-01-05')
  })

  it('divides for the inverse pair without float drift', () => {
    // 137 CAD / 1.37 = exactly 100 USD
    const r = convertMoney(money(13700, 'CAD'), 'USD', rates)!
    expect(r.fx.path).toBe('inverse')
    expect(r.converted).toEqual(money(10000, 'USD'))
    // 0.01 CAD / 1.37 = 0.0073 USD → rounds half-up to 0.01
    expect(convertMoney(money(1, 'CAD'), 'USD', rates)!.converted.amountMinor).toBe(1)
  })

  it('rounds exactly at the half cent', () => {
    // 0.05 USD * 1.3700 = 0.0685 CAD → 0.07 (half-up)
    expect(convertMoney(money(5, 'USD'), 'CAD', rates)!.converted.amountMinor).toBe(7)
    // 1.00 EUR * 1.0850 = 1.085 USD → 1.09 (half-up, not banker's 1.08)
    expect(convertMoney(money(100, 'EUR'), 'USD', rates)!.converted.amountMinor).toBe(109)
  })

  it('crosses through USD and reports the older leg date', () => {
    const r = convertMoney(fromMajor('100', 'EUR'), 'CAD', [
      ...rates,
      { base: 'USD', quote: 'CAD', rate: '1.3800', rateDate: '2027-01-12', provider: 'Bank' },
    ])!
    expect(r.fx.path).toBe('cross')
    expect(r.fx.legs).toHaveLength(2)
    expect(r.fx.rateDate).toBe('2027-01-10')
    // 100 EUR * 1.085 * 1.38 = 149.73 CAD
    expect(r.converted).toEqual(money(14973, 'CAD'))
  })

  it('respects zero-decimal currencies', () => {
    const r = convertMoney(fromMajor('10.00', 'USD'), 'JPY', rates)!
    expect(r.converted).toEqual(money(1573, 'JPY')) // 1572.5 → 1573
  })

  it('returns null when no stored rate exists — never guesses', () => {
    expect(convertMoney(money(100, 'CHF'), 'USD', rates)).toBeNull()
    expect(findRate(rates, 'CAD', 'USD', { asOf: '2026-12-01' })).toBeNull()
    expect(convertMoney(money(100, 'USD'), 'CAD', [{ ...rates[0], rate: 'abc' }])).toBeNull()
  })

  it('identity conversion needs no rate', () => {
    const r = convertMoney(money(123, 'usd'), 'USD', [])!
    expect(r.fx.path).toBe('identity')
    expect(r.converted).toEqual(money(123, 'USD'))
  })

  it('converts with a locked per-item rate', () => {
    const r = convertAtRate(money(20000, 'CAD'), 'USD', '0.73', { rateDate: '2026-11-01' })!
    expect(r.converted).toEqual(money(14600, 'USD'))
    expect(r.fx.rateDate).toBe('2026-11-01')
    expect(convertAtRate(money(1, 'CAD'), 'USD', '0', { rateDate: null })).toBeNull()
  })
})

describe('tiers', () => {
  const usd = (major: string) => fromMajor(major, 'USD')

  it('classifies at the band boundaries', () => {
    expect(classifyTier(usd('0'))).toBe('$')
    expect(classifyTier(usd('124.99'))).toBe('$')
    expect(classifyTier(usd('125.00'))).toBe('$$')
    expect(classifyTier(usd('249.99'))).toBe('$$')
    expect(classifyTier(usd('250.00'))).toBe('$$$')
    expect(classifyTier(usd('449.99'))).toBe('$$$')
    expect(classifyTier(usd('450'))).toBe('$$$$')
  })

  it('refuses to classify an unconverted currency', () => {
    expect(() => classifyTier(fromMajor('100', 'CAD'))).toThrow(/convert/)
  })

  it('converts to USD before classifying, and is incomplete without a rate', () => {
    // 170 CAD / 1.37 = 124.09 USD → $, although 170 would be $$ if read as USD
    const t = tierFor(fromMajor('170', 'CAD'), { rates })
    expect(t.tier).toBe('$')
    expect(t.amount).toEqual(money(12409, 'USD'))
    expect(tierFor(fromMajor('170', 'CHF'), { rates })).toMatchObject({ tier: 'incomplete', label: 'Incomplete estimate' })
    expect(tierFor(null)).toMatchObject({ tier: 'incomplete' })
  })

  it('accepts custom bands and rejects malformed ones', () => {
    const custom = { ...DEFAULT_TIER_BANDS, thresholds: DEFAULT_TIER_BANDS.thresholds.map((b, i) => ({ ...b, minMinor: i * 10000 })) }
    expect(classifyTier(usd('100'), custom)).toBe('$$')
    expect(() => validateBands({ ...custom, thresholds: [...custom.thresholds].reverse() })).toThrow()
    expect(describeBands()[1]).toEqual({ tier: '$$', range: '$125–$249.99' })
  })
})
