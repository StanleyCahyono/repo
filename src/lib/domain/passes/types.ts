/**
 * Pass-access vocabulary. Input shapes mirror the DB rows (PassProductRow, PassAccessRuleRow, PassUsageRow) as
 * structural subsets, so rows can be passed straight in while this module stays free of DB imports.
 * (A compile-time check in access.test.ts keeps them assignable.)
 */
import type { DateRange, PassAccessType, Provenance } from '../types'

/** Subset of PassProductRow needed to answer access questions. */
export interface PassProductInput {
  id: string
  familyId: string
  /** e.g. '2026-27'. A product only applies to dates in this season. */
  seasonId: string
  name: string
  resortId?: string | null
  reservationsSummary?: string | null
  blackoutsSummary?: string | null
}

/** Subset of PassAccessRuleRow (one exact product at one resort, versioned). */
export interface PassRuleInput {
  productId: string
  resortId: string
  version?: number | null
  access: PassAccessType
  /**
   * - `limited-days`: the per-resort cap.
   * - `shared-pool`: the pool's total days (every member rule normally carries the same number).
   * - otherwise ignored.
   */
  days: number | null
  /** Resorts sharing one allotment carry the same pool id. */
  poolId: string | null
  poolLabel: string | null
  /**
   * Explicit pool total. Optional domain extension (no DB column): use it when every member of a pool also has
   * its own per-resort cap, so no `shared-pool` member carries the total in `days`.
   */
  poolDays?: number | null
  /** Inclusive local-date ranges. */
  blackouts: DateRange[] | null
  /** true/false when known; null = unknown. */
  reservationRequired: boolean | null
  reservationNotes?: string | null
  discountText?: string | null
  eligibilityNotes?: string | null
  notes?: string | null
  prov?: Provenance | null
}

/** Subset of PassUsageRow. `planned` marks synthetic usage added while walking a plan (never persisted). */
export interface PassUsageInput {
  resortId: string
  date: string
  planned?: boolean
}

export const ACCESS_STATUSES = [
  'included',
  'included-limited',
  'blackout',
  'days-exhausted',
  'discount-only',
  'not-included',
  'unknown',
  'season-mismatch',
] as const
export type AccessStatus = (typeof ACCESS_STATUSES)[number]

export const ACCESS_STATUS_LABEL: Record<AccessStatus, string> = {
  included: 'Included',
  'included-limited': 'Included (limited days)',
  blackout: 'Blacked out',
  'days-exhausted': 'No days left',
  'discount-only': 'Discount only',
  'not-included': 'Not included',
  unknown: 'Access not confirmed',
  'season-mismatch': 'Different season',
}

/** Shown whenever a rule is missing or recorded as unknown. Unknown is never permission. */
export const UNCONFIRMED_ACCESS_MESSAGE = 'Access rules not confirmed for this product — check the official page'

export interface PoolInfo {
  id: string
  label: string | null
  memberResortIds: string[]
  /** Pool size in days; null when not recorded. */
  total: number | null
  /** Days already consumed at any member resort, not counting the visit being evaluated. */
  used: number
  remaining: number | null
  /** Distinct totals found across member rules (conflicting records); the smallest is used. */
  conflictingTotals: number[] | null
}

export interface ResortCapInfo {
  total: number
  used: number
  remaining: number
}

export interface AccessVerdict {
  productId: string
  productName: string
  familyId: string
  resortId: string
  date: string
  status: AccessStatus
  /** True only for included / included-limited with a day available and no blackout. */
  canSki: boolean
  /** Short label for badges and table cells. */
  headline: string
  /** Plain-language explanation; the first entry states the main reason. */
  reasons: string[]
  accessType: PassAccessType | null
  ruleVersion: number | null
  /** Days available on this date before this visit (min of per-resort cap and pool). null = unlimited/unknown. */
  remainingDays: number | null
  /** Days left after this visit if it is taken. null = unlimited/unknown. */
  remainingAfterVisit: number | null
  resortCap: ResortCapInfo | null
  pool: PoolInfo | null
  /** The blackout range that matched, if any. */
  blackout: DateRange | null
  reservationRequired: boolean | null
  reservationNotes: string | null
  discountText: string | null
  eligibilityNotes: string | null
  /** The rule is research-grade or unsourced — show "confirm at source". */
  confirmAtSource: boolean
  /** This resort/date is already in the usage list (a logged day, or earlier in the same plan). */
  alreadyCounted: 'logged' | 'planned' | null
  /** The date is before `today`. */
  isPast: boolean
}
