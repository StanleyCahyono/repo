/**
 * Expense tiers ($ … $$$$) for the per-person day basket. The bands are UI classification thresholds in USD,
 * not price estimates. Amounts in other currencies are converted to the band currency first; without a rate
 * there is no tier.
 */
import { formatMoney, money, type Money } from '../money'
import { EXPENSE_TIERS, type ExpenseTier } from '../types'
import { convertMoney, type FxRateRecord, type FxRateUsed } from './fx'

export const INCOMPLETE_ESTIMATE = 'Incomplete estimate'

export interface TierBands {
  currency: string
  /** Lower bound (inclusive, minor units) per tier, ascending; the first must be 0. */
  thresholds: { tier: ExpenseTier; minMinor: number }[]
}

/** $ < 125 · $$ 125–249.99 · $$$ 250–449.99 · $$$$ ≥ 450 (USD, per person per day). */
export const DEFAULT_TIER_BANDS: TierBands = {
  currency: 'USD',
  thresholds: [
    { tier: '$', minMinor: 0 },
    { tier: '$$', minMinor: 12_500 },
    { tier: '$$$', minMinor: 25_000 },
    { tier: '$$$$', minMinor: 45_000 },
  ],
}

export function validateBands(bands: TierBands): void {
  const t = bands.thresholds
  if (t.length !== EXPENSE_TIERS.length) throw new Error('Tier bands need one threshold per tier')
  if (t[0].minMinor !== 0) throw new Error('The first tier band must start at 0')
  t.forEach((b, i) => {
    if (b.tier !== EXPENSE_TIERS[i]) throw new Error(`Tier bands out of order at ${i}: ${b.tier}`)
    if (!Number.isInteger(b.minMinor)) throw new Error('Tier thresholds are integer minor units')
    if (i > 0 && b.minMinor <= t[i - 1].minMinor) throw new Error('Tier thresholds must strictly increase')
  })
}

/** Classify an amount already in the band currency. */
export function classifyTier(amount: Money, bands: TierBands = DEFAULT_TIER_BANDS): ExpenseTier {
  validateBands(bands)
  if (amount.currency !== bands.currency.toUpperCase()) {
    throw new Error(`classifyTier expects ${bands.currency}; convert ${amount.currency} first`)
  }
  if (amount.amountMinor < 0) throw new Error('classifyTier: negative amount')
  let tier: ExpenseTier = bands.thresholds[0].tier
  for (const b of bands.thresholds) if (amount.amountMinor >= b.minMinor) tier = b.tier
  return tier
}

export type TierResult =
  | { tier: ExpenseTier; label: ExpenseTier; amount: Money; fx: FxRateUsed | null; reason: null }
  | { tier: 'incomplete'; label: typeof INCOMPLETE_ESTIMATE; amount: null; fx: null; reason: string }

export function incompleteTier(reason: string): TierResult {
  return { tier: 'incomplete', label: INCOMPLETE_ESTIMATE, amount: null, fx: null, reason }
}

/** Tier for a total in any currency; converts to the band currency with stored rates. */
export function tierFor(
  total: Money | null,
  opts: { bands?: TierBands; rates?: readonly FxRateRecord[]; asOf?: string | null } = {},
): TierResult {
  const bands = opts.bands ?? DEFAULT_TIER_BANDS
  if (!total) return incompleteTier('Important prices are missing.')
  const conv = convertMoney(total, bands.currency, opts.rates ?? [], { asOf: opts.asOf })
  if (!conv) return incompleteTier(`No stored ${total.currency}→${bands.currency} rate to classify this total.`)
  const tier = classifyTier(conv.converted, bands)
  return { tier, label: tier, amount: conv.converted, fx: conv.fx.path === 'identity' ? null : conv.fx, reason: null }
}

/** Human-readable band ranges for legends: "$$ — $125–$249.99". */
export function describeBands(bands: TierBands = DEFAULT_TIER_BANDS): { tier: ExpenseTier; range: string }[] {
  validateBands(bands)
  const cur = bands.currency.toUpperCase()
  return bands.thresholds.map((b, i) => {
    const next = bands.thresholds[i + 1]
    const lo = formatMoney(money(b.minMinor, cur))!
    const range = !next
      ? `${lo} and up`
      : i === 0
        ? `under ${formatMoney(money(next.minMinor, cur))}`
        : `${lo}–${formatMoney(money(next.minMinor - 1, cur))}`
    return { tier: b.tier, range }
  })
}
