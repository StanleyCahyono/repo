/**
 * Currency conversion from stored decimal rate records (fx_rates rows). Never fetches, never guesses a rate:
 * when no usable record exists the result is null and the caller shows the original currency.
 *
 * Rate records read "1 `base` = `rate` `quote`". Lookups try, in order: identity, the direct pair, the inverse
 * pair (divide), then a cross through USD (two legs). Arithmetic is decimal (big.js) with one half-up rounding to
 * the target currency's minor unit at the very end. Inputs are never mutated.
 */
import Big from 'big.js'
import { minorDigits, money, type Money } from '../money'

export interface FxRateRecord {
  base: string
  quote: string
  /** Decimal string — never a float. */
  rate: string
  /** Date (or instant) the rate applies to. */
  rateDate: string
  provider: string
  fetchedAt?: string | null
  kind?: string | null
}

export type FxPath = 'identity' | 'direct' | 'inverse' | 'cross'

export interface FxRateUsed {
  from: string
  to: string
  /** Effective rate "1 from = rate to", rounded to 10 decimal places for display. */
  rate: string
  /** Date of the rate; for a cross rate, the older of the two legs. null for identity. */
  rateDate: string | null
  provider: string | null
  path: FxPath
  /** Copies of the stored records used (0, 1 or 2). */
  legs: FxRateRecord[]
}

export interface FxConversion {
  original: Money
  converted: Money
  fx: FxRateUsed
}

export const FX_PIVOT = 'USD'

interface Leg {
  record: FxRateRecord
  invert: boolean
}

function parseRate(r: FxRateRecord): Big | null {
  try {
    const b = new Big(r.rate)
    return b.gt(0) ? b : null
  } catch {
    return null
  }
}

function bestLeg(rates: readonly FxRateRecord[], from: string, to: string, asOf: string | null): Leg | null {
  let best: (Leg & { date: string }) | null = null
  for (const record of rates) {
    const base = record.base.toUpperCase()
    const quote = record.quote.toUpperCase()
    let invert: boolean
    if (base === from && quote === to) invert = false
    else if (base === to && quote === from) invert = true
    else continue
    if (!parseRate(record)) continue
    const date = record.rateDate.slice(0, 10)
    if (asOf && date > asOf) continue
    // Most recent date wins; on a tie the direct quote beats the inverse.
    if (!best || date > best.date || (date === best.date && best.invert && !invert)) best = { record, invert, date }
  }
  return best ? { record: best.record, invert: best.invert } : null
}

function applyLegs(value: Big, legs: readonly Leg[]): Big {
  return legs.reduce((v, leg) => {
    const r = parseRate(leg.record)!
    return leg.invert ? v.div(r) : v.times(r)
  }, value)
}

/**
 * Find the rate to convert `from` → `to`. `asOf` (YYYY-MM-DD) ignores records dated after it — use it to
 * reproduce a conversion "as of" a quote date.
 */
export function findRate(
  rates: readonly FxRateRecord[],
  from: string,
  to: string,
  opts: { asOf?: string | null } = {},
): FxRateUsed | null {
  const f = from.toUpperCase()
  const t = to.toUpperCase()
  if (f === t) return { from: f, to: t, rate: '1', rateDate: null, provider: null, path: 'identity', legs: [] }
  const asOf = opts.asOf ? opts.asOf.slice(0, 10) : null

  let legs: Leg[] | null = null
  let path: FxPath = 'direct'
  const single = bestLeg(rates, f, t, asOf)
  if (single) {
    legs = [single]
    path = single.invert ? 'inverse' : 'direct'
  } else if (f !== FX_PIVOT && t !== FX_PIVOT) {
    const a = bestLeg(rates, f, FX_PIVOT, asOf)
    const b = bestLeg(rates, FX_PIVOT, t, asOf)
    if (a && b) {
      legs = [a, b]
      path = 'cross'
    }
  }
  if (!legs) return null

  const dates = legs.map((l) => l.record.rateDate).sort()
  const providers = [...new Set(legs.map((l) => l.record.provider))]
  return {
    from: f,
    to: t,
    rate: applyLegs(new Big(1), legs).round(10, Big.roundHalfUp).toString(),
    rateDate: dates[0],
    provider: providers.join(' + '),
    path,
    legs: legs.map((l) => ({ ...l.record })),
  }
}

function legsFor(fx: FxRateUsed): Leg[] {
  // Rebuild leg direction from the stored records.
  let cursor = fx.from
  return fx.legs.map((record) => {
    const invert = record.base.toUpperCase() !== cursor
    cursor = invert ? record.base.toUpperCase() : record.quote.toUpperCase()
    return { record, invert }
  })
}

/** Convert with an already chosen rate. The original Money is returned untouched alongside the result. */
export function convertWith(m: Money, fx: FxRateUsed): FxConversion {
  if (m.currency.toUpperCase() !== fx.from) throw new Error(`convertWith: ${m.currency} does not match rate ${fx.from}→${fx.to}`)
  const original = { amountMinor: m.amountMinor, currency: m.currency }
  if (fx.path === 'identity') return { original, converted: money(m.amountMinor, fx.to), fx }
  const major = new Big(m.amountMinor).div(new Big(10).pow(minorDigits(fx.from)))
  const minor = applyLegs(major, legsFor(fx)).times(new Big(10).pow(minorDigits(fx.to))).round(0, Big.roundHalfUp)
  return { original, converted: money(Number(minor.toString()), fx.to), fx }
}

/** Convert Money into `to`, or null when no stored rate can do it (caller then shows the original currency). */
export function convertMoney(
  m: Money,
  to: string,
  rates: readonly FxRateRecord[],
  opts: { asOf?: string | null } = {},
): FxConversion | null {
  const fx = findRate(rates, m.currency, to, opts)
  return fx ? convertWith(m, fx) : null
}

/**
 * Convert with a locked per-item rate ("1 from = rate to", e.g. stored on a trip item when quoted).
 * Returns null for an unparseable or non-positive rate.
 */
export function convertAtRate(
  m: Money,
  to: string,
  rate: string,
  meta: { rateDate: string | null; provider?: string | null },
): FxConversion | null {
  const record: FxRateRecord = {
    base: m.currency.toUpperCase(),
    quote: to.toUpperCase(),
    rate,
    rateDate: meta.rateDate ?? '',
    provider: meta.provider ?? 'Stored on item',
  }
  if (!parseRate(record)) return null
  if (record.base === record.quote) return convertWith(m, findRate([], record.base, record.quote)!)
  return convertWith(m, {
    from: record.base,
    to: record.quote,
    rate: new Big(rate).round(10, Big.roundHalfUp).toString(),
    rateDate: meta.rateDate,
    provider: record.provider,
    path: 'direct',
    legs: [record],
  })
}
