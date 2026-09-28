import { describe, expect, it } from 'vitest'
import type { PassAccessRuleRow, PassProductRow, PassUsageRow } from '@/lib/db/rows'
import { provenance } from '../types'
import { evaluateAccess, planAccess } from './access'
import { remainingByPool, remainingByResort } from './allowance'
import { familyBadges } from './badges'
import { UNCONFIRMED_ACCESS_MESSAGE, type PassProductInput, type PassRuleInput, type PassUsageInput } from './types'

// Compile-time guarantee that DB rows can be passed straight into the pure functions.
const _rowCompat: [PassProductInput, PassRuleInput, PassUsageInput] = [
  {} as PassProductRow,
  {} as PassAccessRuleRow,
  {} as PassUsageRow,
]
void _rowCompat

const official = provenance({ kind: 'official', verification: 'official-page', provider: 'pass site' })

const ikon: PassProductInput = { id: 'ikon-2026-27', familyId: 'ikon', seasonId: '2026-27', name: 'Ikon Pass' }

function rule(p: Partial<PassRuleInput> & Pick<PassRuleInput, 'resortId' | 'access'>): PassRuleInput {
  return {
    productId: ikon.id,
    version: 1,
    days: null,
    poolId: null,
    poolLabel: null,
    blackouts: [],
    reservationRequired: false,
    prov: official,
    ...p,
  }
}

const POOL = 'ikon-2026-27:alta-snowbird'
const rules: PassRuleInput[] = [
  rule({ resortId: 'alta', access: 'shared-pool', days: 7, poolId: POOL, poolLabel: 'Alta/Snowbird pool' }),
  rule({ resortId: 'snowbird', access: 'shared-pool', days: 7, poolId: POOL, poolLabel: 'Alta/Snowbird pool' }),
  rule({
    resortId: 'killington',
    access: 'unlimited',
    blackouts: [{ from: '2026-12-26', to: '2026-12-31', label: 'Holiday period' }],
  }),
  rule({ resortId: 'whistler', access: 'limited-days', days: 2, reservationRequired: true, reservationNotes: 'Book 7 days ahead.' }),
  rule({ resortId: 'mystery', access: 'unknown' }),
  rule({ resortId: 'vail', access: 'not-included' }),
  rule({ resortId: 'snowbasin', access: 'discount-only', discountText: '25% off window tickets' }),
]
const byResort = (id: string) => rules.find((r) => r.resortId === id)!

function evalAt(resortId: string, date: string, usage: PassUsageInput[] = [], extra: Partial<Parameters<typeof evaluateAccess>[0]> = {}) {
  return evaluateAccess({ product: ikon, rule: byResort(resortId), resortId, date, usage, poolRules: rules, ...extra })
}

describe('evaluateAccess — blackouts', () => {
  it('treats both ends of a blackout range as blacked out (inclusive local dates)', () => {
    for (const d of ['2026-12-26', '2026-12-28', '2026-12-31']) {
      const v = evalAt('killington', d)
      expect(v.status, d).toBe('blackout')
      expect(v.canSki).toBe(false)
      expect(v.blackout?.label).toBe('Holiday period')
    }
  })

  it('allows the days immediately outside the range', () => {
    expect(evalAt('killington', '2026-12-25').status).toBe('included')
    expect(evalAt('killington', '2027-01-01').status).toBe('included')
    expect(evalAt('killington', '2027-01-01').canSki).toBe(true)
  })

  it('blacks out discount-only benefits too', () => {
    const r = rule({ resortId: 'snowbasin', access: 'discount-only', blackouts: [{ from: '2027-02-13', to: '2027-02-15' }] })
    const v = evaluateAccess({ product: ikon, rule: r, resortId: 'snowbasin', date: '2027-02-15' })
    expect(v.status).toBe('blackout')
    expect(v.canSki).toBe(false)
  })
})

describe('evaluateAccess — season and unknowns are never permission', () => {
  it('rejects a date outside the product season, even for an unlimited resort', () => {
    const v = evalAt('killington', '2027-11-28')
    expect(v.status).toBe('season-mismatch')
    expect(v.canSki).toBe(false)
    expect(v.reasons[0]).toContain('2027-28')
  })

  it('season boundary: 30 Jun belongs to the product season, 1 Jul does not', () => {
    expect(evalAt('killington', '2027-06-30').status).toBe('included')
    expect(evalAt('killington', '2027-07-01').status).toBe('season-mismatch')
  })

  it('no rule → unknown with the confirm-at-source message', () => {
    const v = evaluateAccess({ product: ikon, rule: undefined, resortId: 'greek-peak', date: '2027-01-16' })
    expect(v.status).toBe('unknown')
    expect(v.canSki).toBe(false)
    expect(v.reasons).toContain(UNCONFIRMED_ACCESS_MESSAGE)
  })

  it("rule access 'unknown' → unknown, not included", () => {
    const v = evalAt('mystery', '2027-01-16')
    expect(v.status).toBe('unknown')
    expect(v.canSki).toBe(false)
    expect(v.remainingDays).toBeNull()
  })

  it('a day limit with no recorded day count is unknown, not unlimited', () => {
    const r = rule({ resortId: 'jay', access: 'limited-days', days: null })
    const v = evaluateAccess({ product: ikon, rule: r, resortId: 'jay', date: '2027-01-16' })
    expect(v.status).toBe('unknown')
    expect(v.canSki).toBe(false)
  })

  it('a shared pool whose size is not recorded is unknown', () => {
    const a = rule({ resortId: 'a', access: 'shared-pool', days: null, poolId: 'p' })
    const b = rule({ resortId: 'b', access: 'shared-pool', days: null, poolId: 'p' })
    const v = evaluateAccess({ product: ikon, rule: a, resortId: 'a', date: '2027-01-16', poolRules: [a, b] })
    expect(v.status).toBe('unknown')
    expect(v.canSki).toBe(false)
  })

  it('a rule for another product is ignored rather than trusted', () => {
    const other = { ...byResort('killington'), productId: 'epic-2026-27' }
    const v = evaluateAccess({ product: ikon, rule: other, resortId: 'killington', date: '2027-01-16' })
    expect(v.status).toBe('unknown')
    expect(v.canSki).toBe(false)
  })

  it('not-included and discount-only cannot ski on the pass', () => {
    expect(evalAt('vail', '2027-01-16')).toMatchObject({ status: 'not-included', canSki: false })
    const d = evalAt('snowbasin', '2027-01-16')
    expect(d).toMatchObject({ status: 'discount-only', canSki: false, discountText: '25% off window tickets' })
    expect(d.reasons[0]).toContain('25% off')
  })

  it('unreadable or unrecorded blackouts are unknown, not "no blackout"', () => {
    // 30 Feb cannot be read, so we cannot tell whether 1 Mar is inside the range.
    const bad = rule({ resortId: 'killington', access: 'unlimited', blackouts: [{ from: '2027-02-30', to: '2027-03-02' }] })
    const v = evaluateAccess({ product: ikon, rule: bad, resortId: 'killington', date: '2027-03-01' })
    expect(v).toMatchObject({ status: 'unknown', canSki: false })
    expect(v.reasons).toContain(UNCONFIRMED_ACCESS_MESSAGE)
    const unrecorded = rule({ resortId: 'killington', access: 'unlimited', blackouts: null })
    expect(evaluateAccess({ product: ikon, rule: unrecorded, resortId: 'killington', date: '2027-03-01' })).toMatchObject({
      status: 'unknown',
      canSki: false,
    })
  })

  it('a day limit that is not a whole number of days is unknown, not "2.5 days left"', () => {
    for (const days of [2.5, -1]) {
      const r = rule({ resortId: 'jay', access: 'limited-days', days })
      expect(evaluateAccess({ product: ikon, rule: r, resortId: 'jay', date: '2027-01-16' }), String(days)).toMatchObject({
        status: 'unknown',
        canSki: false,
        remainingDays: null,
      })
      expect(remainingByResort(ikon, [r], [])[0]).toMatchObject({ status: 'unknown', remaining: null })
    }
  })

  it('surfaces product-level blackout notes on an included verdict', () => {
    const withSummary = { ...ikon, blackoutsSummary: 'Holiday blackouts apply at select resorts' }
    const v = evaluateAccess({ product: withSummary, rule: byResort('killington'), resortId: 'killington', date: '2027-01-16' })
    expect(v.canSki).toBe(true)
    expect(v.reasons).toContain('Product blackout notes: Holiday blackouts apply at select resorts')
  })

  it('a rule with no verification level still asks you to confirm at source', () => {
    const r = { ...byResort('killington'), prov: provenance({ kind: 'manual' }) }
    const v = evaluateAccess({ product: ikon, rule: r, resortId: 'killington', date: '2027-01-16' })
    expect(v.confirmAtSource).toBe(true)
    expect(v.reasons.some((x) => x.includes('confirm'))).toBe(true)
  })

  it('flags research-grade rules for confirmation', () => {
    const r = { ...byResort('killington'), prov: provenance({ kind: 'manual', verification: 'search-summary' }) }
    const v = evaluateAccess({ product: ikon, rule: r, resortId: 'killington', date: '2027-01-16' })
    expect(v.canSki).toBe(true)
    expect(v.confirmAtSource).toBe(true)
    expect(v.reasons).toContain('Researched — confirm at source.')
  })
})

describe('evaluateAccess — shared pools and caps', () => {
  it('usage at any member resort consumes the shared pool', () => {
    const usage = [
      { resortId: 'snowbird', date: '2027-01-02' },
      { resortId: 'snowbird', date: '2027-01-03' },
      { resortId: 'alta', date: '2027-01-04' },
    ]
    const v = evalAt('alta', '2027-02-10', usage)
    expect(v.status).toBe('included-limited')
    expect(v.pool).toMatchObject({ id: POOL, used: 3, total: 7, remaining: 4, memberResortIds: ['alta', 'snowbird'] })
    expect(v.remainingDays).toBe(4)
    expect(v.remainingAfterVisit).toBe(3)
  })

  it('a pool rule evaluated without the other pool rules is unknown — days used elsewhere would be missed', () => {
    // All 7 pool days were used at Snowbird. Given only Alta's rule, Piste cannot see that, so it must not say "7 left".
    const usage = Array.from({ length: 7 }, (_, i) => ({ resortId: 'snowbird', date: `2027-01-0${i + 1}` }))
    const v = evaluateAccess({ product: ikon, rule: byResort('alta'), resortId: 'alta', date: '2027-02-10', usage })
    expect(v).toMatchObject({ status: 'unknown', canSki: false, remainingDays: null })
    expect(v.reasons[0]).toContain('not supplied')
    // With the pool rules, the exhausted pool is detected.
    expect(evalAt('alta', '2027-02-10', usage).status).toBe('days-exhausted')
  })

  it('pool is exhausted by usage spread across members', () => {
    const usage = Array.from({ length: 7 }, (_, i) => ({
      resortId: i % 2 ? 'alta' : 'snowbird',
      date: `2027-01-0${i + 1}`,
    }))
    const v = evalAt('alta', '2027-02-10', usage)
    expect(v.status).toBe('days-exhausted')
    expect(v.canSki).toBe(false)
    expect(v.reasons[0]).toContain('Alta/Snowbird pool')
  })

  it('ignores usage from another season and duplicate log entries', () => {
    const usage = [
      { resortId: 'whistler', date: '2026-03-01' }, // 2025-26 season
      { resortId: 'whistler', date: '2027-01-05' },
      { resortId: 'whistler', date: '2027-01-05' }, // duplicate log
    ]
    const v = evalAt('whistler', '2027-02-10', usage)
    expect(v.status).toBe('included-limited')
    expect(v.remainingDays).toBe(1)
  })

  it('does not count the evaluated day twice when it is already logged', () => {
    const usage = [
      { resortId: 'whistler', date: '2027-01-05' },
      { resortId: 'whistler', date: '2027-01-06' },
    ]
    const v = evalAt('whistler', '2027-01-06', usage)
    expect(v.canSki).toBe(true)
    expect(v.alreadyCounted).toBe('logged')
    expect(v.remainingAfterVisit).toBe(0)
  })

  it('enforces a per-resort cap inside a pool as well as the pool total', () => {
    // Pool of 5 at Brighton + Jackson, with Jackson itself capped at 2.
    const brighton = rule({ resortId: 'brighton', access: 'shared-pool', days: 5, poolId: 'p5', poolLabel: 'Pool of 5' })
    const jackson = rule({ resortId: 'jackson', access: 'limited-days', days: 2, poolId: 'p5' })
    const pr = [brighton, jackson]
    const twoAtJackson = [
      { resortId: 'jackson', date: '2027-01-10' },
      { resortId: 'jackson', date: '2027-01-11' },
    ]
    const capHit = evaluateAccess({ product: ikon, rule: jackson, resortId: 'jackson', date: '2027-02-01', usage: twoAtJackson, poolRules: pr })
    expect(capHit.status).toBe('days-exhausted')
    expect(capHit.resortCap).toMatchObject({ total: 2, used: 2, remaining: 0 })
    expect(capHit.pool?.remaining).toBe(3)

    const brightonStill = evaluateAccess({ product: ikon, rule: brighton, resortId: 'brighton', date: '2027-02-01', usage: twoAtJackson, poolRules: pr })
    expect(brightonStill).toMatchObject({ status: 'included-limited', remainingDays: 3 })

    // Pool exhausted by Brighton days blocks Jackson even though its own cap is untouched.
    const fiveAtBrighton = ['2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05'].map((date) => ({ resortId: 'brighton', date }))
    const poolHit = evaluateAccess({ product: ikon, rule: jackson, resortId: 'jackson', date: '2027-02-01', usage: fiveAtBrighton, poolRules: pr })
    expect(poolHit.status).toBe('days-exhausted')
    expect(poolHit.resortCap?.remaining).toBe(2)
  })

  it('supports an explicit pool total when every member has its own cap', () => {
    const a = rule({ resortId: 'a', access: 'limited-days', days: 3, poolId: 'p', poolDays: 4 })
    const b = rule({ resortId: 'b', access: 'limited-days', days: 3, poolId: 'p', poolDays: 4 })
    const usage = ['2027-01-01', '2027-01-02', '2027-01-03'].map((date) => ({ resortId: 'b', date }))
    const v = evaluateAccess({ product: ikon, rule: a, resortId: 'a', date: '2027-02-01', usage, poolRules: [a, b] })
    expect(v).toMatchObject({ status: 'included-limited', remainingDays: 1 })
  })

  it('uses the smaller figure when pool members disagree, and says so', () => {
    const a = rule({ resortId: 'a', access: 'shared-pool', days: 7, poolId: 'p' })
    const b = rule({ resortId: 'b', access: 'shared-pool', days: 5, poolId: 'p' })
    const v = evaluateAccess({ product: ikon, rule: a, resortId: 'a', date: '2027-02-01', poolRules: [a, b] })
    expect(v.pool?.total).toBe(5)
    expect(v.pool?.conflictingTotals).toEqual([5, 7])
    expect(v.reasons.join(' ')).toContain('disagree')
  })
})

describe('evaluateAccess — reservations', () => {
  it('surfaces a reservation requirement without blocking', () => {
    const v = evalAt('whistler', '2027-01-16')
    expect(v.canSki).toBe(true)
    expect(v.reservationRequired).toBe(true)
    expect(v.reservationNotes).toBe('Book 7 days ahead.')
    expect(v.reasons.some((r) => r.startsWith('Reservation required'))).toBe(true)
  })

  it('keeps an unknown reservation requirement as null and says so', () => {
    const r = { ...byResort('killington'), reservationRequired: null }
    const v = evaluateAccess({ product: ikon, rule: r, resortId: 'killington', date: '2027-01-16' })
    expect(v.reservationRequired).toBeNull()
    expect(v.reasons.some((x) => x.includes('not recorded'))).toBe(true)
  })
})

describe('planAccess', () => {
  it('consumes a per-resort cap in date order: the 3rd planned day at a 2-day resort is exhausted', () => {
    const plan = planAccess(ikon, rules, [
      { resortId: 'whistler', date: '2027-02-03' },
      { resortId: 'whistler', date: '2027-02-01' },
      { resortId: 'whistler', date: '2027-02-02' },
    ])
    expect(plan.days.map((d) => d.date)).toEqual(['2027-02-01', '2027-02-02', '2027-02-03'])
    expect(plan.days.map((d) => d.verdict.status)).toEqual(['included-limited', 'included-limited', 'days-exhausted'])
    expect(plan.days[2].index).toBe(0)
    expect(plan.covered).toBe(2)
    expect(plan.notCovered).toBe(1)
  })

  it('starts from logged usage and shares the pool across planned member resorts', () => {
    const logged = Array.from({ length: 5 }, (_, i) => ({ resortId: 'alta', date: `2027-01-1${i}` }))
    const plan = planAccess(
      ikon,
      rules,
      [
        { resortId: 'snowbird', date: '2027-03-01' },
        { resortId: 'alta', date: '2027-03-02' },
        { resortId: 'snowbird', date: '2027-03-03' },
      ],
      logged,
    )
    expect(plan.days.map((d) => d.verdict.status)).toEqual(['included-limited', 'included-limited', 'days-exhausted'])
  })

  it('blocked days do not consume the allotment', () => {
    const r = rule({ resortId: 'x', access: 'limited-days', days: 1, blackouts: [{ from: '2027-02-13', to: '2027-02-15' }] })
    const plan = planAccess(ikon, [r], [
      { resortId: 'x', date: '2027-02-14' },
      { resortId: 'x', date: '2027-02-20' },
    ])
    expect(plan.days.map((d) => d.verdict.status)).toEqual(['blackout', 'included-limited'])
  })

  it('a duplicated planned day is not counted twice', () => {
    const plan = planAccess(ikon, rules, [
      { resortId: 'whistler', date: '2027-02-01' },
      { resortId: 'whistler', date: '2027-02-01' },
      { resortId: 'whistler', date: '2027-02-02' },
    ])
    expect(plan.days.every((d) => d.verdict.canSki)).toBe(true)
    expect(plan.days[1].verdict.alreadyCounted).toBe('planned')
  })

  it('uses the latest rule version', () => {
    const v1 = rule({ resortId: 'x', access: 'unlimited', version: 1 })
    const v2 = rule({ resortId: 'x', access: 'not-included', version: 2 })
    const plan = planAccess(ikon, [v2, v1], [{ resortId: 'x', date: '2027-01-20' }])
    expect(plan.days[0].verdict.status).toBe('not-included')
  })
})

describe('remaining-day trackers', () => {
  const usage = [
    { resortId: 'alta', date: '2027-01-02' },
    { resortId: 'snowbird', date: '2027-01-03' },
    { resortId: 'whistler', date: '2027-01-20' },
    { resortId: 'whistler', date: '2027-01-21' },
  ]

  it('reports pool balance with per-member usage', () => {
    const [pool] = remainingByPool(ikon, rules, usage)
    expect(pool).toMatchObject({ id: POOL, total: 7, used: 2, remaining: 5 })
    expect(pool.usedByResort).toEqual([
      { resortId: 'alta', used: 1, cap: null },
      { resortId: 'snowbird', used: 1, cap: null },
    ])
  })

  it('reports per-resort status without inventing numbers for unknown rules', () => {
    const rows = Object.fromEntries(remainingByResort(ikon, rules, usage).map((r) => [r.resortId, r]))
    expect(rows.alta).toMatchObject({ status: 'available', remaining: 5, poolRemaining: 5 })
    expect(rows.whistler).toMatchObject({ status: 'exhausted', cap: 2, remaining: 0 })
    expect(rows.killington).toMatchObject({ status: 'unlimited', remaining: null })
    expect(rows.mystery).toMatchObject({ status: 'unknown', remaining: null })
  })
})

describe('familyBadges', () => {
  const epic: PassProductInput = { id: 'epic-2026-27', familyId: 'epic', seasonId: '2026-27', name: 'Epic Pass' }
  const indy: PassProductInput = { id: 'indy-2026-27', familyId: 'indy', seasonId: '2026-27', name: 'Indy Pass' }
  const mcOld: PassProductInput = { id: 'mc-2025-26', familyId: 'mountain-collective', seasonId: '2025-26', name: 'MC' }

  it('lists distinct families with at least one rule that is not "not-included"', () => {
    const resortRules: PassRuleInput[] = [
      rule({ resortId: 'r', access: 'limited-days', days: 7 }),
      { ...rule({ resortId: 'r', access: 'not-included' }), productId: epic.id },
      { ...rule({ resortId: 'r', access: 'unknown' }), productId: indy.id },
      { ...rule({ resortId: 'r', access: 'unlimited' }), productId: mcOld.id },
    ]
    const badges = familyBadges(resortRules, [ikon, epic, indy, mcOld], { seasonId: '2026-27' })
    expect(badges.map((b) => b.familyId)).toEqual(['ikon', 'indy'])
    expect(badges.find((b) => b.familyId === 'indy')?.qualifiedOnly).toBe(true)
    expect(badges.every((b) => b.discoveryOnly)).toBe(true)
  })
})
