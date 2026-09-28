/**
 * Trip budget: itemised costs with original currency, conversion rate/date, per-person vs shared basis,
 * estimate ranges, quote expiry and missing items.
 *
 * - Ranges are carried as min–max and summed separately.
 * - `per-person` items: each person pays the amount; the group pays amount × party size.
 * - `shared` items: the (converted) total is split with money.allocate so the shares sum exactly to the total.
 *   Leftover cents rotate across people from item to item so no one absorbs every rounding cent.
 * - Items are converted to the display currency before splitting; an item with no usable rate stays in its
 *   original currency, is listed in `unconverted`, and is left out of the display totals (budget incomplete).
 * - Expired quotes stay in the totals (they are the best number on file) but are flagged.
 */
import { allocate, money, sum, type Money } from '../money'
import { convertAtRate, convertMoney, convertWith, type FxRateRecord, type FxRateUsed } from './fx'
import { isExpired } from './prices'

export type TripCostKind = 'quote' | 'estimate' | 'actual'
export type CostBasis = 'per-person' | 'shared'

/** Subset of TripItemRow, plus the optional `fxQuote` needed to trust a stored per-item rate. */
export interface TripBudgetItemInput {
  id?: number | string | null
  type: string
  title: string
  date?: string | null
  status?: 'idea' | 'draft' | 'booked' | null
  costMinor: number | null
  costMaxMinor: number | null
  currency: string | null
  costKind: TripCostKind | null
  costBasis: CostBasis
  /** Locked rate stored on the item: 1 item currency = fxRate `fxQuote`. */
  fxRate?: string | null
  fxDate?: string | null
  /** Currency the stored rate converts into. Without it the stored rate is ignored (its target is unknown). */
  fxQuote?: string | null
  quoteExpiresAt: string | null
}

export interface MoneyRange {
  min: Money
  max: Money
}

export interface TripBudgetLine {
  id: number | string | null
  type: string
  title: string
  date: string | null
  status: TripBudgetItemInput['status']
  costKind: TripCostKind | null
  costBasis: CostBasis
  isRange: boolean
  /** As entered (per person for per-person items, whole amount for shared items). */
  original: MoneyRange | null
  /** Same basis, display currency. */
  display: MoneyRange | null
  /** Whole party, display currency. */
  groupTotal: MoneyRange | null
  /** Each person's share, display currency; sums exactly to groupTotal. */
  shares: { min: Money[]; max: Money[] } | null
  fx: FxRateUsed | null
  fxSource: 'item' | 'stored-rates' | null
  expired: boolean
  flags: string[]
}

export interface TripBudget {
  currency: string
  partySize: number
  lines: TripBudgetLine[]
  /**
   * Whole party, sum of the priced and converted lines only — PARTIAL when `complete` is false (missing and
   * unconverted items contribute nothing). For itemised display next to `missing`; never label it the trip total.
   */
  group: MoneyRange
  /** Person i's known total; the list sums exactly to `group` (partial when incomplete, like `group`). */
  perPerson: MoneyRange[]
  /** Largest individual known share (partial when incomplete). */
  perPersonMax: MoneyRange
  /** Whole-party trip total; null unless `complete` — unknown items are never read as $0. */
  total: MoneyRange | null
  /** Headline "per person" figure (largest share); null unless `complete`. */
  perPersonTotal: MoneyRange | null
  missing: { id: TripBudgetLine['id']; title: string; reason: string }[]
  unconverted: { id: TripBudgetLine['id']; title: string; original: MoneyRange }[]
  expiredQuotes: { id: TripBudgetLine['id']; title: string; expiresAt: string }[]
  /** Every item has a cost and converts to the display currency. */
  complete: boolean
}

function rotate(shares: Money[], offset: number): Money[] {
  const n = shares.length
  const out = new Array<Money>(n)
  shares.forEach((s, k) => (out[(k + offset) % n] = s))
  return out
}

/** How many leading shares received a remainder cent. */
function extraCount(shares: Money[]): number {
  const last = shares[shares.length - 1].amountMinor
  return shares.filter((s) => s.amountMinor !== last).length
}

export function computeTripBudget(input: {
  items: readonly TripBudgetItemInput[]
  partySize: number
  currency: string
  rates: readonly FxRateRecord[]
  now: string
  today?: string | null
}): TripBudget {
  const { partySize } = input
  if (!Number.isInteger(partySize) || partySize < 1) throw new Error('Trip party size must be a positive integer')
  const currency = input.currency.toUpperCase()
  const today = input.today ?? input.now.slice(0, 10)
  const zero = money(0, currency)

  const missing: TripBudget['missing'] = []
  const unconverted: TripBudget['unconverted'] = []
  const expiredQuotes: TripBudget['expiredQuotes'] = []
  const personMin: Money[] = Array.from({ length: partySize }, () => zero)
  const personMax: Money[] = Array.from({ length: partySize }, () => zero)
  let offMin = 0
  let offMax = 0

  const lines = input.items.map((item): TripBudgetLine => {
    const flags: string[] = []
    const id = item.id ?? null
    const expired =
      item.costKind !== 'actual' && item.status !== 'booked' && isExpired(item.quoteExpiresAt, input.now, today)
    if (expired && item.quoteExpiresAt) {
      expiredQuotes.push({ id, title: item.title, expiresAt: item.quoteExpiresAt })
      flags.push(`Quote expired ${item.quoteExpiresAt.slice(0, 10)} — re-check the price.`)
    }
    const line: TripBudgetLine = {
      id,
      type: item.type,
      title: item.title,
      date: item.date ?? null,
      status: item.status ?? null,
      costKind: item.costKind,
      costBasis: item.costBasis,
      isRange: false,
      original: null,
      display: null,
      groupTotal: null,
      shares: null,
      fx: null,
      fxSource: null,
      expired,
      flags,
    }

    if (item.costMinor == null) {
      missing.push({ id, title: item.title, reason: 'No cost entered' })
      return line
    }
    if (!item.currency) {
      missing.push({ id, title: item.title, reason: 'Currency not recorded' })
      return line
    }
    const min = money(item.costMinor, item.currency)
    let max = min
    if (item.costMaxMinor != null) {
      if (item.costMaxMinor >= item.costMinor) max = money(item.costMaxMinor, item.currency)
      else flags.push('Range maximum is below the minimum — using the minimum.')
    }
    line.original = { min, max }
    line.isRange = max.amountMinor !== min.amountMinor

    // Conversion: a locked per-item rate into this display currency wins; otherwise stored rates.
    let conv = null
    if (min.currency !== currency && item.fxRate && item.fxQuote?.toUpperCase() === currency) {
      conv = convertAtRate(min, currency, item.fxRate, { rateDate: item.fxDate ?? null, provider: 'Rate saved with item' })
      if (conv) line.fxSource = 'item'
    }
    if (!conv) {
      conv = convertMoney(min, currency, input.rates, { asOf: today })
      if (conv && conv.fx.path !== 'identity') line.fxSource = 'stored-rates'
    }
    if (!conv) {
      unconverted.push({ id, title: item.title, original: line.original })
      flags.push(`No ${min.currency}→${currency} rate stored — shown in ${min.currency} and left out of totals.`)
      return line
    }
    line.fx = conv.fx.path === 'identity' ? null : conv.fx
    const dMin = conv.converted
    const dMax = convertWith(max, conv.fx).converted
    line.display = { min: dMin, max: dMax }

    if (item.costBasis === 'shared') {
      const aMin = allocate(dMin, partySize)
      const aMax = allocate(dMax, partySize)
      line.shares = { min: rotate(aMin, offMin), max: rotate(aMax, offMax) }
      offMin = (offMin + extraCount(aMin)) % partySize
      offMax = (offMax + extraCount(aMax)) % partySize
      line.groupTotal = { min: dMin, max: dMax }
    } else {
      line.shares = {
        min: Array.from({ length: partySize }, () => dMin),
        max: Array.from({ length: partySize }, () => dMax),
      }
      line.groupTotal = { min: money(dMin.amountMinor * partySize, currency), max: money(dMax.amountMinor * partySize, currency) }
    }
    line.shares.min.forEach((s, i) => (personMin[i] = money(personMin[i].amountMinor + s.amountMinor, currency)))
    line.shares.max.forEach((s, i) => (personMax[i] = money(personMax[i].amountMinor + s.amountMinor, currency)))
    return line
  })

  const priced = lines.filter((l) => l.groupTotal)
  const group = {
    min: sum(priced.map((l) => l.groupTotal!.min), currency),
    max: sum(priced.map((l) => l.groupTotal!.max), currency),
  }
  const perPerson = personMin.map((m, i) => ({ min: m, max: personMax[i] }))
  const perPersonMax = {
    min: personMin.reduce((a, b) => (b.amountMinor > a.amountMinor ? b : a), zero),
    max: personMax.reduce((a, b) => (b.amountMinor > a.amountMinor ? b : a), zero),
  }

  const complete = missing.length === 0 && unconverted.length === 0
  return {
    currency,
    partySize,
    lines,
    group,
    perPerson,
    perPersonMax,
    total: complete ? group : null,
    perPersonTotal: complete ? perPersonMax : null,
    missing,
    unconverted,
    expiredQuotes,
    complete,
  }
}
