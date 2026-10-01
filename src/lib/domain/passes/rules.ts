/**
 * Low-level helpers shared by the access evaluator and the allowance trackers: picking the current rule version,
 * resolving shared day pools and counting consumed days.
 */
import { isLocalDate, northernSeasonOf, type SeasonOf } from '../time'
import type { DateRange } from '../types'
import type { PassRuleInput, PassUsageInput } from './types'

/** Highest-version rule for one product at one resort (rules are versioned, never overwritten). */
export function latestRule(rules: readonly PassRuleInput[], productId: string, resortId: string): PassRuleInput | null {
  let best: PassRuleInput | null = null
  for (const r of rules) {
    if (r.productId !== productId || r.resortId !== resortId) continue
    if (!best || (r.version ?? 1) > (best.version ?? 1)) best = r
  }
  return best
}

/** Current rule per resort for one product. */
export function latestRules(rules: readonly PassRuleInput[], productId: string): PassRuleInput[] {
  const byResort = new Map<string, PassRuleInput>()
  for (const r of rules) {
    if (r.productId !== productId) continue
    const prev = byResort.get(r.resortId)
    if (!prev || (r.version ?? 1) > (prev.version ?? 1)) byResort.set(r.resortId, r)
  }
  return [...byResort.values()]
}

/** Matching inclusive blackout range for a local date, if any. Reversed ranges are normalised. */
export function findBlackout(blackouts: readonly DateRange[] | null | undefined, date: string): DateRange | null {
  for (const b of blackouts ?? []) {
    if (!b || !isLocalDate(b.from) || !isLocalDate(b.to)) continue
    const [from, to] = b.from <= b.to ? [b.from, b.to] : [b.to, b.from]
    if (date >= from && date <= to) return b
  }
  return null
}

/**
 * Blackout entries whose dates cannot be read. `findBlackout` has to skip them, so a rule carrying one cannot
 * confirm any date (an unreadable blackout is not "no blackout").
 */
export function invalidBlackouts(blackouts: readonly DateRange[]): unknown[] {
  return blackouts.filter((b) => !b || !isLocalDate(b.from) || !isLocalDate(b.to))
}

export const usageKey = (u: { resortId: string; date: string }) => `${u.resortId}|${u.date}`

/**
 * Is a usage day in `seasonId` at its resort? `seasonOf` resolves the resort's hemisphere (a Southern Hemisphere
 * winter — June–October 2027 — is season 2026-27); without it every resort is treated as northern.
 */
export function usageInSeason(u: { resortId: string; date: string }, seasonId: string, seasonOf: SeasonOf = northernSeasonOf): boolean {
  return isLocalDate(u.date) && seasonOf(u.resortId, u.date) === seasonId
}

/**
 * Distinct resort-days consumed at any of `resortIds` within `seasonId`. Duplicate log entries for the same
 * resort and date count once. Two different member resorts on the same date count as two days (conservative).
 */
export function countUsedDays(
  usage: readonly PassUsageInput[],
  resortIds: ReadonlySet<string>,
  seasonId: string,
  excludeKey: string | null = null,
  seasonOf: SeasonOf = northernSeasonOf,
): number {
  const seen = new Set<string>()
  for (const u of usage) {
    if (!resortIds.has(u.resortId) || !usageInSeason(u, seasonId, seasonOf)) continue
    const k = usageKey(u)
    if (k !== excludeKey) seen.add(k)
  }
  return seen.size
}

export interface PoolDefinition {
  id: string
  label: string | null
  memberResortIds: string[]
  total: number | null
  conflictingTotals: number[] | null
}

/** A usable day count: a non-negative integer. */
export const isCount = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

/**
 * Resolve a shared pool from the product's rules.
 * Pool total = explicit `poolDays` on any member, otherwise `days` of `shared-pool` members. Members that
 * disagree are reported as a conflict and the smallest figure is used (never the more generous one).
 * `override` replaces the stored rule for its resort (the rule the caller is evaluating).
 */
export function resolvePool(
  productId: string,
  poolId: string,
  rules: readonly PassRuleInput[],
  override?: PassRuleInput | null,
): PoolDefinition {
  const current = latestRules(rules, productId).filter((r) => r.resortId !== override?.resortId)
  if (override && override.productId === productId) current.push(override)
  const members = current.filter((r) => r.poolId === poolId)
  const explicit = members.map((r) => r.poolDays).filter(isCount)
  const candidates = explicit.length
    ? explicit
    : members.filter((r) => r.access === 'shared-pool').map((r) => r.days).filter(isCount)
  const distinct = [...new Set(candidates)].sort((a, b) => a - b)
  return {
    id: poolId,
    label: members.find((r) => r.poolLabel)?.poolLabel ?? null,
    memberResortIds: members.map((r) => r.resortId).sort(),
    total: distinct.length ? distinct[0] : null,
    conflictingTotals: distinct.length > 1 ? distinct : null,
  }
}

/** A rule participates in a pool when it is `shared-pool`, or `limited-days` with a pool id (cap inside a pool). */
export function isPoolRule(rule: PassRuleInput): boolean {
  return rule.access === 'shared-pool' || (rule.access === 'limited-days' && !!rule.poolId)
}
