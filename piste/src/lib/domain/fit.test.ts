import { describe, expect, it } from 'vitest'
import { computeFit, terrainMatch, travelVerdict, UNKNOWN_COMPONENT_VALUE, type FitInput } from './fit'
import { money } from './money'

const PREFS = { maxDriveHours: 4, willingToFly: true, winterBufferPct: 20 }

function input(over: Partial<FitInput> = {}): FitInput {
  return {
    ability: 'beginner',
    companion: null,
    terrain: { beginnerPct: 35, intermediatePct: 35, advancedPct: 30, verification: 'official-page' },
    learning: { lessons: true, rentals: true, beginnerArea: 'Learning area with carpet', learningNotes: null },
    travel: { driveMinutes: 60, driveIsEstimate: false, airports: [] },
    travelPrefs: PREFS,
    cost: { total: money(9_000, 'USD'), tier: '$' },
    dayBudget: null,
    ...over,
  }
}

describe('computeFit — ability vs terrain', () => {
  it('does not make an expert-only mountain a better fit for a beginner, however close or cheap', () => {
    const learning = computeFit(input({ travel: { driveMinutes: 200, driveIsEstimate: false, airports: [] }, cost: { total: money(16_000, 'USD'), tier: '$$' } }))
    const expert = computeFit(
      input({
        terrain: { beginnerPct: 5, intermediatePct: 25, advancedPct: 70, verification: 'official-page' },
        travel: { driveMinutes: 20, driveIsEstimate: false, airports: [] },
        cost: { total: money(5_000, 'USD'), tier: '$' },
      }),
    )
    expect(expert.rankValue).toBeLessThan(learning.rankValue)
    expect(expert.cappedBy).toMatch(/capped/)
    expect(expert.score).toBeLessThanOrEqual(55)
    expect(terrainMatch('beginner', { beginnerPct: 12, intermediatePct: 20, advancedPct: 68 }).note).toMatch(/mostly advanced/)
  })

  it('confirmed "no lessons" lowers a beginner fit; unknown lessons are listed, not assumed', () => {
    const none = computeFit(input({ learning: { lessons: false, rentals: true, beginnerArea: null, learningNotes: null } }))
    const yes = computeFit(input())
    expect(none.rankValue).toBeLessThan(yes.rankValue)
    const unknown = computeFit(input({ learning: { lessons: null, rentals: null, beginnerArea: null, learningNotes: null } }))
    const learning = unknown.components.find((c) => c.key === 'learning')!
    expect(learning.known).toBe(false)
    expect(learning.used).toBe(UNKNOWN_COMPONENT_VALUE)
    expect(unknown.unknowns.join(' ')).toMatch(/Lessons/)
  })
})

describe('computeFit — unknowns are never favourable', () => {
  it('scores unknown terrain and cost below the same resort with modest known values, with lower confidence', () => {
    const modest = computeFit(input({ terrain: { beginnerPct: 20, intermediatePct: 40, advancedPct: 40, verification: 'official-page' }, cost: { total: money(20_000, 'USD'), tier: '$$' } }))
    const unknown = computeFit(input({ terrain: null, cost: { total: null, tier: 'incomplete' } }))
    expect(unknown.rankValue).toBeLessThan(modest.rankValue)
    expect(unknown.coverage).toBeLessThan(modest.coverage)
    expect(unknown.confidence).not.toBe('high')
    expect(unknown.unknowns.length).toBe(2)
    expect(unknown.unknowns.join(' ')).toMatch(/Cost estimate incomplete/)
  })

  it('has no displayed score when most inputs are unknown', () => {
    const r = computeFit(input({ terrain: null, learning: null, cost: null, travel: null }))
    expect(r.score).toBeNull()
    expect(r.label).toBe('Not enough information')
    expect(r.rankValue).toBe(UNKNOWN_COMPONENT_VALUE)
    expect(r.confidence).toBe('low')
  })

  it('research-grade terrain caps confidence at medium', () => {
    const r = computeFit(input({ terrain: { beginnerPct: 35, intermediatePct: 35, advancedPct: 30, verification: 'search-summary' } }))
    expect(r.confidence).toBe('medium')
    expect(r.confidenceReasons.join(' ')).toMatch(/researched/)
  })
})

describe('travel feasibility', () => {
  it('applies the explicit winter buffer against the drive limit', () => {
    expect(travelVerdict({ driveMinutes: 200, driveIsEstimate: true, airports: [] }, PREFS)).toMatchObject({ feasible: true, winterMinutes: 240, mode: 'drive' })
    const over = travelVerdict({ driveMinutes: 210, driveIsEstimate: true, airports: [] }, PREFS)
    expect(over).toMatchObject({ feasible: false, winterMinutes: 252 })
    expect(over.note).toMatch(/20% winter buffer/)
  })

  it('switches to flying when the drive is too long and flying is acceptable; infeasible when not', () => {
    const t = { driveMinutes: 435, driveIsEstimate: true, airports: ['BTV'] }
    expect(travelVerdict(t, PREFS)).toMatchObject({ mode: 'fly', feasible: true })
    expect(travelVerdict(t, { ...PREFS, willingToFly: false })).toMatchObject({ feasible: false })
    expect(travelVerdict({ driveMinutes: null, driveIsEstimate: true, airports: ['SLC'] }, { ...PREFS, willingToFly: false }).feasible).toBe(false)
    expect(travelVerdict(null, PREFS).feasible).toBeNull()
  })

  it('an infeasible trip scores travel 0, lower than a feasible flight', () => {
    const fly = computeFit(input({ travel: { driveMinutes: null, driveIsEstimate: true, airports: ['SLC'] } }))
    const no = computeFit(input({ travel: { driveMinutes: null, driveIsEstimate: true, airports: ['SLC'] }, travelPrefs: { ...PREFS, willingToFly: false } }))
    expect(no.components.find((c) => c.key === 'travel')!.value).toBe(0)
    expect(no.rankValue).toBeLessThan(fly.rankValue)
  })
})

describe('budget', () => {
  it('compares the basket with the day budget, and an over-budget day scores lower', () => {
    const within = computeFit(input({ dayBudget: money(15_000, 'USD'), cost: { total: money(12_000, 'USD'), tier: '$' } }))
    const over = computeFit(input({ dayBudget: money(15_000, 'USD'), cost: { total: money(24_000, 'USD'), tier: '$$' } }))
    expect(over.components.find((c) => c.key === 'budget')!.value).toBeLessThan(within.components.find((c) => c.key === 'budget')!.value!)
    expect(over.components.find((c) => c.key === 'budget')!.note).toMatch(/over your \$150 day budget/)
  })
})

describe('companion', () => {
  const beginnerHill = { beginnerPct: 60, intermediatePct: 35, advancedPct: 5, verification: 'official-page' as const }
  const balanced = { beginnerPct: 30, intermediatePct: 35, advancedPct: 35, verification: 'official-page' as const }

  it('with an advanced companion, a resort with terrain for both scores higher than a beginner-only hill', () => {
    const companion = { name: 'Sam', ability: 'advanced' as const }
    const hill = computeFit(input({ terrain: beginnerHill, companion }))
    const both = computeFit(input({ terrain: balanced, companion }))
    expect(both.rankValue).toBeGreaterThan(hill.rankValue)
    expect(both.components.find((c) => c.key === 'companion')!.note).toMatch(/both you and Sam/)
    expect(hill.components.find((c) => c.key === 'companion')!.note).toMatch(/Limited terrain for Sam/)
  })

  it('without a companion there is no companion component', () => {
    const r = computeFit(input({ terrain: beginnerHill }))
    expect(r.components.some((c) => c.key === 'companion')).toBe(false)
  })
})
