/**
 * "Track remaining days" views: per-resort and per-pool allowances for one product given logged usage.
 * Dates are not considered (no blackouts here) — this is the season-level balance. Use evaluateAccess for a date.
 */
import type { PassAccessType } from '../types'
import { countUsedDays, isCount, isPoolRule, latestRules, resolvePool } from './rules'
import type { PassProductInput, PassRuleInput, PassUsageInput } from './types'

export type AllowanceStatus = 'unlimited' | 'available' | 'exhausted' | 'unknown' | 'not-included' | 'discount-only'

export interface ResortAllowance {
  resortId: string
  accessType: PassAccessType
  status: AllowanceStatus
  /** Days logged at this resort this season. */
  used: number
  /** Per-resort cap (limited-days), else null. */
  cap: number | null
  capRemaining: number | null
  poolId: string | null
  poolRemaining: number | null
  /** min(capRemaining, poolRemaining); null for unlimited or unknown. */
  remaining: number | null
}

export interface PoolAllowance {
  id: string
  label: string | null
  memberResortIds: string[]
  total: number | null
  used: number
  remaining: number | null
  usedByResort: { resortId: string; used: number; cap: number | null }[]
  conflictingTotals: number[] | null
}

export function remainingByPool(
  product: PassProductInput,
  rules: readonly PassRuleInput[],
  usage: readonly PassUsageInput[],
): PoolAllowance[] {
  const current = latestRules(rules, product.id)
  const poolIds = [...new Set(current.filter((r) => isPoolRule(r) && r.poolId).map((r) => r.poolId!))].sort()
  return poolIds.map((poolId) => {
    const def = resolvePool(product.id, poolId, current)
    const used = countUsedDays(usage, new Set(def.memberResortIds), product.seasonId)
    return {
      ...def,
      used,
      remaining: def.total == null ? null : Math.max(0, def.total - used),
      usedByResort: def.memberResortIds.map((resortId) => {
        const rule = current.find((r) => r.resortId === resortId)
        return {
          resortId,
          used: countUsedDays(usage, new Set([resortId]), product.seasonId),
          cap: rule?.access === 'limited-days' ? rule.days : null,
        }
      }),
    }
  })
}

export function remainingByResort(
  product: PassProductInput,
  rules: readonly PassRuleInput[],
  usage: readonly PassUsageInput[],
): ResortAllowance[] {
  const current = latestRules(rules, product.id).sort((a, b) => a.resortId.localeCompare(b.resortId))
  const pools = new Map(remainingByPool(product, rules, usage).map((p) => [p.id, p]))

  return current.map((rule): ResortAllowance => {
    const used = countUsedDays(usage, new Set([rule.resortId]), product.seasonId)
    const out: ResortAllowance = {
      resortId: rule.resortId,
      accessType: rule.access,
      status: 'unknown',
      used,
      cap: null,
      capRemaining: null,
      poolId: rule.poolId,
      poolRemaining: null,
      remaining: null,
    }
    switch (rule.access) {
      case 'unlimited':
        return { ...out, status: 'unlimited' }
      case 'not-included':
        return { ...out, status: 'not-included' }
      case 'discount-only':
        return { ...out, status: 'discount-only' }
      case 'unknown':
        return out
    }
    if (rule.access === 'limited-days') {
      if (!isCount(rule.days)) return out
      out.cap = rule.days
      out.capRemaining = Math.max(0, rule.days - used)
    }
    if (isPoolRule(rule)) {
      const pool = rule.poolId ? pools.get(rule.poolId) : undefined
      if (!pool || pool.remaining == null) return out
      out.poolRemaining = pool.remaining
    }
    const remaining = Math.min(out.capRemaining ?? Infinity, out.poolRemaining ?? Infinity)
    out.remaining = Number.isFinite(remaining) ? remaining : null
    if (out.remaining === null) return out
    return { ...out, status: out.remaining > 0 ? 'available' : 'exhausted' }
  })
}
