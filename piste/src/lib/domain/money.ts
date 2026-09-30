/**
 * Decimal-safe money. Amounts are integer minor units with an ISO 4217 currency code. Conversion uses decimal
 * string rates through big.js and rounds once, at the end, half-up to the target currency's minor unit.
 * Mixed-currency arithmetic throws — convert explicitly first.
 */
import Big from 'big.js'

export interface Money {
  amountMinor: number
  currency: string
}

/**
 * Currencies offered for display, budgets and entered amounts, everywhere in the app (the same list and order in
 * every picker). Rates come from the FX job (Frankfurter / ECB reference rates, which publish all of these).
 */
export const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'CHF', 'GBP', 'JPY', 'AUD', 'NZD', 'SEK'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const CURRENCY_NAME: Record<SupportedCurrency, string> = {
  USD: 'US dollar',
  CAD: 'Canadian dollar',
  EUR: 'Euro',
  CHF: 'Swiss franc',
  GBP: 'Pound sterling',
  JPY: 'Japanese yen',
  AUD: 'Australian dollar',
  NZD: 'New Zealand dollar',
  SEK: 'Swedish krona',
}

/** A preferred currency first, then the supported list, then any extra codes in use (upper-cased, no repeats). */
export function currencyChoicesFor(preferred: string | null | undefined, ...more: (string | null | undefined)[]): string[] {
  return [...new Set([preferred, ...SUPPORTED_CURRENCIES, ...more].filter((c): c is string => !!c).map((c) => c.toUpperCase()))]
}

const MINOR_DIGITS: Record<string, number> = { JPY: 0, KRW: 0, ISK: 0, CLP: 0 }

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) throw new Error(`Money amount must be an integer number of minor units: ${amountMinor}`)
  return { amountMinor, currency: currency.toUpperCase() }
}

/** Parse a decimal string/number in major units, e.g. ("129.99", "USD") → 12999. */
export function fromMajor(major: string | number, currency: string): Money {
  const digits = minorDigits(currency)
  const minor = new Big(major).times(new Big(10).pow(digits)).round(0, Big.roundHalfUp)
  return money(Number(minor.toString()), currency)
}

export function toMajorString(m: Money): string {
  const digits = minorDigits(m.currency)
  return new Big(m.amountMinor).div(new Big(10).pow(digits)).toFixed(digits)
}

function assertSame(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`)
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b)
  return money(a.amountMinor + b.amountMinor, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  assertSame(a, b)
  return money(a.amountMinor - b.amountMinor, a.currency)
}

export function sum(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => add(acc, m), money(0, currency))
}

export function multiply(m: Money, factor: number): Money {
  if (!Number.isInteger(factor)) throw new Error('multiply() takes an integer factor; use scale() for decimals')
  return money(m.amountMinor * factor, m.currency)
}

/** Multiply by a decimal factor (string for exactness), rounding half-up once. */
export function scale(m: Money, factor: string | number): Money {
  const v = new Big(m.amountMinor).times(new Big(factor)).round(0, Big.roundHalfUp)
  return money(Number(v.toString()), m.currency)
}

/**
 * Split an amount into `parts` shares that sum exactly to the original (remainder distributed to the first
 * shares). Used for shared trip costs.
 */
export function allocate(m: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('allocate() needs a positive integer')
  const base = Math.trunc(m.amountMinor / parts)
  let remainder = m.amountMinor - base * parts
  const step = remainder >= 0 ? 1 : -1
  return Array.from({ length: parts }, () => {
    let v = base
    if (remainder !== 0) {
      v += step
      remainder -= step
    }
    return money(v, m.currency)
  })
}

/**
 * Convert using a decimal rate expressed as "1 unit of `from` = rate units of `to`".
 * Minor-unit exponents are respected (e.g. USD→JPY).
 */
export function convert(m: Money, to: string, rate: string): Money {
  const target = to.toUpperCase()
  if (m.currency === target) return m
  const fromDigits = minorDigits(m.currency)
  const toDigits = minorDigits(target)
  const major = new Big(m.amountMinor).div(new Big(10).pow(fromDigits))
  const converted = major.times(new Big(rate)).times(new Big(10).pow(toDigits)).round(0, Big.roundHalfUp)
  return money(Number(converted.toString()), target)
}

export function compare(a: Money, b: Money): number {
  assertSame(a, b)
  return a.amountMinor - b.amountMinor
}

export function formatMoney(m: Money | null | undefined, opts: { compact?: boolean } = {}): string | null {
  if (!m) return null
  const digits = minorDigits(m.currency)
  const major = m.amountMinor / 10 ** digits
  const whole = opts.compact || m.amountMinor % 10 ** digits === 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: whole ? 0 : digits,
  }).format(major)
}

/** "$120–$160" for estimate ranges. */
export function formatMoneyRange(min: Money | null, max: Money | null): string | null {
  if (!min) return null
  if (!max || max.amountMinor === min.amountMinor) return formatMoney(min)
  return `${formatMoney(min, { compact: true })}–${formatMoney(max, { compact: true })}`
}
