/**
 * "Can I use my exact pass here on this date?" — answered from product-specific rules only.
 *
 * Evaluation order (first match wins):
 *   1. season-mismatch — the product's season does not contain the date.
 *   2. unknown        — no rule, rule access 'unknown', or a limit/pool whose size or members are not recorded.
 *   3. not-included
 *   4. unknown        — blackout dates not recorded (null) or unreadable: the date cannot be confirmed.
 *      blackout       — inclusive local-date ranges; applies to included and discount-only benefits alike.
 *   5. discount-only
 *   6. included       — unlimited.
 *   7. days-exhausted / included-limited — per-resort cap and/or shared pool, counting logged usage.
 *
 * Reservation requirements never block; they are surfaced in `reservationRequired` and `reasons`.
 */
import { isLocalDate, seasonIdFor } from '../time'
import type { DateRange } from '../types'
import { countUsedDays, findBlackout, invalidBlackouts, isCount, isPoolRule, latestRule, resolvePool, usageKey } from './rules'
import {
  ACCESS_STATUSES,
  ACCESS_STATUS_LABEL,
  UNCONFIRMED_ACCESS_MESSAGE,
  type AccessStatus,
  type AccessVerdict,
  type PassProductInput,
  type PassRuleInput,
  type PassUsageInput,
  type PoolInfo,
  type ResortCapInfo,
} from './types'

export interface EvaluateAccessInput {
  product: PassProductInput
  /** The current rule for (product, resort). Missing → 'unknown'. */
  rule: PassRuleInput | null | undefined
  resortId: string
  /** Resort-local date YYYY-MM-DD. */
  date: string
  /** Logged usage for this pass ownership (any resort). */
  usage?: readonly PassUsageInput[]
  /**
   * The product's other rules — needed to resolve shared pools. Without them a pool rule is 'unknown': days used
   * at the other member resorts could not be counted, so the balance would be overstated.
   */
  poolRules?: readonly PassRuleInput[]
  /** Home-local date, used only to flag past dates. */
  today?: string | null
  /** Optional display names for resorts, used in reasons. */
  names?: Readonly<Record<string, string>>
}

function rangeText(b: DateRange): string {
  const span = b.from === b.to ? b.from : `${b.from} – ${b.to}`
  return b.label ? `${b.label} (${span})` : span
}

function listNames(ids: readonly string[], names?: Readonly<Record<string, string>>): string {
  const labels = ids.map((id) => names?.[id] ?? id)
  if (labels.length <= 2) return labels.join(' and ')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

function reservationReason(required: boolean | null, notes: string | null): string {
  const tail = notes ? ` ${notes}` : ''
  if (required === true) return `Reservation required — book before you go.${tail}`
  if (required === false) return `No reservation required per the recorded rule.${tail}`
  return `Reservation requirement not recorded — check before you go.${tail}`
}

export function evaluateAccess(input: EvaluateAccessInput): AccessVerdict {
  const { product, resortId, date, names } = input
  if (!isLocalDate(date)) throw new Error(`evaluateAccess: invalid local date ${String(date)}`)
  const usage = input.usage ?? []
  const today = input.today ?? null
  const resortName = names?.[resortId] ?? resortId

  const passed = input.rule ?? null
  const rule = passed && passed.productId === product.id && passed.resortId === resortId ? passed : null

  const verification = rule?.prov?.verification ?? null
  // Missing provenance or a missing verification level is not evidence of verification.
  const confirmAtSource =
    !!rule && (!rule.prov || verification === null || verification === 'search-summary' || verification === 'unverified')

  const selfKey = usageKey({ resortId, date })
  const selfUsage = usage.find((u) => usageKey(u) === selfKey)
  const alreadyCounted: AccessVerdict['alreadyCounted'] = selfUsage ? (selfUsage.planned ? 'planned' : 'logged') : null

  const base: AccessVerdict = {
    productId: product.id,
    productName: product.name,
    familyId: product.familyId,
    resortId,
    date,
    status: 'unknown',
    canSki: false,
    headline: '',
    reasons: [],
    accessType: rule?.access ?? null,
    ruleVersion: rule?.version ?? null,
    remainingDays: null,
    remainingAfterVisit: null,
    resortCap: null,
    pool: null,
    blackout: null,
    reservationRequired: rule?.reservationRequired ?? null,
    reservationNotes: rule?.reservationNotes ?? product.reservationsSummary ?? null,
    discountText: rule?.discountText ?? null,
    eligibilityNotes: rule?.eligibilityNotes ?? null,
    confirmAtSource,
    alreadyCounted,
    isPast: !!today && isLocalDate(today) && date < today,
  }

  const finish = (status: AccessStatus, headline: string, reasons: string[], extra: Partial<AccessVerdict> = {}): AccessVerdict => {
    const v: AccessVerdict = { ...base, ...extra, status, headline, reasons: [...reasons] }
    v.canSki = (status === 'included' || status === 'included-limited') && !v.blackout
    if (v.canSki) {
      v.reasons.push(reservationReason(v.reservationRequired, v.reservationNotes))
      // Product-level blackout text may describe dates the per-resort rule does not record as ranges.
      if (product.blackoutsSummary) v.reasons.push(`Product blackout notes: ${product.blackoutsSummary}`)
      if (alreadyCounted === 'logged') v.reasons.push('Already logged as a pass day on this date — not counted twice.')
      if (alreadyCounted === 'planned') v.reasons.push('Already planned at this resort on this date — not counted twice.')
    }
    if (status !== 'unknown' && status !== 'season-mismatch') {
      if (v.eligibilityNotes) v.reasons.push(`Eligibility: ${v.eligibilityNotes}`)
      if (rule?.notes) v.reasons.push(rule.notes)
      if (confirmAtSource) {
        v.reasons.push(
          verification === 'search-summary'
            ? 'Researched — confirm at source.'
            : 'Rule source not verified — confirm on the official pass page.',
        )
      }
    }
    if (v.isPast) v.reasons.push('This date is in the past.')
    return v
  }

  // 1. Season
  const dateSeason = seasonIdFor(date)
  if (dateSeason !== product.seasonId) {
    return finish('season-mismatch', ACCESS_STATUS_LABEL['season-mismatch'], [
      `${product.name} is a ${product.seasonId} product; ${date} falls in the ${dateSeason} season.`,
    ])
  }

  // 2. Unknown / missing rule
  if (!rule) {
    const reasons = [UNCONFIRMED_ACCESS_MESSAGE]
    if (passed) reasons.push('The supplied rule belongs to a different product or resort and was ignored.')
    return finish('unknown', ACCESS_STATUS_LABEL.unknown, reasons, { accessType: null, ruleVersion: null })
  }
  if (rule.access === 'unknown') {
    return finish('unknown', ACCESS_STATUS_LABEL.unknown, [UNCONFIRMED_ACCESS_MESSAGE])
  }

  // 3. Not included
  if (rule.access === 'not-included') {
    return finish('not-included', ACCESS_STATUS_LABEL['not-included'], [`${product.name} does not include ${resortName}.`])
  }

  // 4. Blackout (inclusive). Unrecorded or unreadable blackouts are unknown, never "no blackout".
  if (rule.blackouts == null) {
    return finish('unknown', ACCESS_STATUS_LABEL.unknown, [
      `Blackout dates for ${product.name} at ${resortName} are not recorded, so ${date} cannot be confirmed.`,
      UNCONFIRMED_ACCESS_MESSAGE,
    ])
  }
  if (invalidBlackouts(rule.blackouts).length) {
    return finish('unknown', ACCESS_STATUS_LABEL.unknown, [
      `A recorded blackout range for ${product.name} at ${resortName} has an unreadable date, so ${date} cannot be confirmed.`,
      UNCONFIRMED_ACCESS_MESSAGE,
    ])
  }
  const blackout = findBlackout(rule.blackouts, date)
  if (blackout) {
    const what = rule.access === 'discount-only' ? 'The pass discount' : `${product.name}`
    return finish('blackout', ACCESS_STATUS_LABEL.blackout, [`${what} is blacked out at ${resortName} on ${date}: ${rangeText(blackout)}.`], {
      blackout,
    })
  }

  // 5. Discount only
  if (rule.access === 'discount-only') {
    return finish('discount-only', ACCESS_STATUS_LABEL['discount-only'], [
      rule.discountText
        ? `No included days at ${resortName} — discount only: ${rule.discountText}`
        : `No included days at ${resortName} — discount only; discount terms not recorded.`,
    ])
  }

  // 6. Unlimited
  if (rule.access === 'unlimited') {
    return finish('included', ACCESS_STATUS_LABEL.included, [`${product.name} includes ${resortName} with no day limit on this date.`])
  }

  // 7. Limited days and/or shared pool
  const seasonId = product.seasonId
  let resortCap: ResortCapInfo | null = null
  if (rule.access === 'limited-days') {
    if (!isCount(rule.days)) {
      return finish('unknown', ACCESS_STATUS_LABEL.unknown, [
        rule.days == null
          ? `Included with a day limit at ${resortName}, but the number of days is not recorded.`
          : `Included with a day limit at ${resortName}, but the recorded limit (${rule.days}) is not a whole number of days.`,
        UNCONFIRMED_ACCESS_MESSAGE,
      ])
    }
    const used = countUsedDays(usage, new Set([resortId]), seasonId, selfKey)
    resortCap = { total: rule.days, used, remaining: Math.max(0, rule.days - used) }
  }

  let pool: PoolInfo | null = null
  if (isPoolRule(rule)) {
    if (!rule.poolId) {
      return finish('unknown', ACCESS_STATUS_LABEL.unknown, [
        `Shared day pool at ${resortName}, but the resorts sharing it are not recorded.`,
        UNCONFIRMED_ACCESS_MESSAGE,
      ])
    }
    if (!input.poolRules) {
      return finish(
        'unknown',
        ACCESS_STATUS_LABEL.unknown,
        [
          `${resortName} shares a day pool, but the pool's other resorts were not supplied, so days used there cannot be counted.`,
          UNCONFIRMED_ACCESS_MESSAGE,
        ],
        { resortCap },
      )
    }
    const def = resolvePool(product.id, rule.poolId, input.poolRules, rule)
    const label = def.label ?? 'shared day pool'
    if (def.total == null) {
      return finish(
        'unknown',
        ACCESS_STATUS_LABEL.unknown,
        [`Part of the ${label}, but the pool's day count is not recorded.`, UNCONFIRMED_ACCESS_MESSAGE],
        { resortCap },
      )
    }
    const used = countUsedDays(usage, new Set(def.memberResortIds), seasonId, selfKey)
    pool = { ...def, used, remaining: Math.max(0, def.total - used) }
  }

  const remaining = Math.min(resortCap?.remaining ?? Infinity, pool?.remaining ?? Infinity)
  const remainingDays = Number.isFinite(remaining) ? remaining : null
  const extra: Partial<AccessVerdict> = { resortCap, pool, remainingDays }
  const conflictNote = pool?.conflictingTotals
    ? [`Pool records disagree on its size (${pool.conflictingTotals.join(' vs ')} days); using the smaller figure — confirm at source.`]
    : []

  if (remainingDays === null) {
    // limited access without either a cap or a pool cannot happen after the checks above; stay conservative.
    return finish('unknown', ACCESS_STATUS_LABEL.unknown, [UNCONFIRMED_ACCESS_MESSAGE], extra)
  }

  if (remainingDays <= 0) {
    const reasons: string[] = []
    if (resortCap && resortCap.remaining <= 0) {
      reasons.push(`All ${resortCap.total} day${resortCap.total === 1 ? '' : 's'} at ${resortName} have been used.`)
    }
    if (pool && (pool.remaining ?? 0) <= 0) {
      reasons.push(
        `All ${pool.total} days in the ${pool.label ?? 'shared pool'} (${listNames(pool.memberResortIds, names)}) have been used.`,
      )
    }
    return finish('days-exhausted', ACCESS_STATUS_LABEL['days-exhausted'], [...reasons, ...conflictNote], {
      ...extra,
      remainingAfterVisit: 0,
    })
  }

  const reasons: string[] = []
  if (pool) {
    const others = pool.memberResortIds.filter((id) => id !== resortId)
    reasons.push(
      `Included — ${pool.remaining} of ${pool.total} days left in the ${pool.label ?? 'shared pool'}` +
        (others.length ? `, shared with ${listNames(others, names)}.` : '.'),
    )
    if (resortCap) {
      reasons.push(`${resortName} also has its own cap: ${resortCap.remaining} of ${resortCap.total} days left here.`)
    }
  } else if (resortCap) {
    reasons.push(`Included — ${resortCap.remaining} of ${resortCap.total} days left at ${resortName}.`)
  }
  const headline = `Included — ${remainingDays} day${remainingDays === 1 ? '' : 's'} left`
  return finish('included-limited', headline, [...reasons, ...conflictNote], {
    ...extra,
    remainingAfterVisit: remainingDays - 1,
  })
}


// ---------------------------------------------------------------------------
// Planning a sequence of days

export interface PlannedVisit {
  resortId: string
  date: string
}

export interface PlannedAccessDay {
  /** Position in the caller's original list. */
  index: number
  resortId: string
  date: string
  verdict: AccessVerdict
}

export interface AccessPlan {
  productId: string
  /** Days in date order (ties keep the caller's order). */
  days: PlannedAccessDay[]
  /** Count of planned days that can use the pass. */
  covered: number
  /** Count of planned days that cannot (blackout, exhausted, not included, discount only, unknown, season). */
  notCovered: number
  byStatus: Record<AccessStatus, number>
}

/**
 * Evaluate planned visits in date order, consuming allotments as it goes: logged usage first, then each
 * earlier planned day that can use the pass. Blocked days (blackout, not included, unknown…) consume nothing.
 */
export function planAccess(
  product: PassProductInput,
  rules: readonly PassRuleInput[],
  visits: readonly PlannedVisit[],
  usage: readonly PassUsageInput[] = [],
  opts: { today?: string | null; names?: Readonly<Record<string, string>> } = {},
): AccessPlan {
  const productRules = rules.filter((r) => r.productId === product.id)
  const ordered = visits
    .map((v, index) => ({ ...v, index }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index))
  const running: PassUsageInput[] = [...usage]
  const byStatus = Object.fromEntries(ACCESS_STATUSES.map((s) => [s, 0])) as Record<AccessStatus, number>

  const days = ordered.map((v) => {
    const verdict = evaluateAccess({
      product,
      rule: latestRule(productRules, product.id, v.resortId),
      resortId: v.resortId,
      date: v.date,
      usage: running,
      poolRules: productRules,
      today: opts.today,
      names: opts.names,
    })
    if (verdict.canSki && !verdict.alreadyCounted) running.push({ resortId: v.resortId, date: v.date, planned: true })
    byStatus[verdict.status] += 1
    return { index: v.index, resortId: v.resortId, date: v.date, verdict }
  })

  const covered = days.filter((d) => d.verdict.canSki).length
  return { productId: product.id, days, covered, notCovered: days.length - covered, byStatus }
}
