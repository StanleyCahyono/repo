import { describe, expect, it } from 'vitest'
import type { ComponentResult } from '@/lib/db/schema'
import type { ConditionsAssessmentRow } from '@/lib/db/rows'
import { COMPONENT_KEYS } from '../types'
import { CONDITIONS_CONFIG_V1 as CFG } from './config.v1'
import { isValidCurve } from './curve'
import { assessDay, combineComponents, describeScore } from './score'
import { DAY, fairWeather, ops, perfectDay, point, report } from './test-fixtures'
import type { AssessDayInput, ConditionsComponent, DayAssessment } from './types'

const within = (t: string, from: string, to: string) => t >= from && t < to
const comp = (a: DayAssessment, key: ConditionsComponent['key']) => a.components.find((c) => c.key === key)!

// Overnight storm: 30 cm at −6 °C ending 05:00 EST on DAY.
const storm = fairWeather((_, t) => (within(t, '2027-01-14T15:00:00.000Z', '2027-01-15T11:00:00.000Z') ? { snowfallCm: 1.5, temperatureC: -6, precipitationMm: 1.5 } : {}))
const withWeather = (hours = fairWeather(), extra: Partial<AssessDayInput> = {}): Partial<AssessDayInput> => ({
  weather: { base: point('base', hours, { fetchedAt: '2027-01-15T12:00:00.000Z' }), summit: point('summit', hours, { fetchedAt: '2027-01-15T12:00:00.000Z' }) },
  ...extra,
})

describe('config v1', () => {
  it('uses the brief weights exactly and every mode sums to 100', () => {
    expect(CFG.version).toBe('piste-conditions/1.0')
    expect(CFG.weights).toEqual({
      learning: { S: 25, T: 30, W: 20, V: 15, C: 10 },
      'all-mountain': { S: 35, T: 25, W: 20, V: 10, C: 10 },
      powder: { S: 45, T: 20, W: 20, V: 10, C: 5 },
    })
    for (const w of Object.values(CFG.weights)) expect(Object.values(w).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('maps scores to the brief descriptor bands', () => {
    expect([100, 85, 84, 70, 69, 55, 54, 0].map((s) => describeScore(s))).toEqual([
      'Excellent',
      'Excellent',
      'Good',
      'Good',
      'Mixed',
      'Mixed',
      'Challenging',
      'Challenging',
    ])
  })

  it('has well-formed curves and never lets fresh snow raise a learning surface', () => {
    const c = CFG.components
    const curves = [c.T.ratioCurve, c.T.beginnerCountCurve, c.W.curve, c.V.curve, c.V.proxy.cloudCurve, c.C.curve, ...Object.values(c.S.freshSnowAdjustment)]
    for (const curve of curves) expect(isValidCurve(curve)).toBe(true)
    expect(c.S.freshSnowAdjustment.learning.every(([, y]) => y <= 0)).toBe(true)
    expect(c.S.base.learning['fresh-snow']).toBeLessThan(c.S.base.learning['packed-powder'])
    for (const mode of ['learning', 'all-mountain', 'powder'] as const) {
      const base = c.S.base[mode]
      expect(Math.min(...Object.values(base))).toBe(base['icy-refrozen'])
    }
  })
})

describe('assessDay — complete operational day', () => {
  it('scores a fresh, open, fair day as a full conditions score', () => {
    const a = assessDay(perfectDay())
    expect(a.scoreKind).toBe('conditions')
    expect(a.eligibility).toBe('eligible')
    expect(a.gate.passed).toBe(true)
    expect(a.coverage).toBe(1)
    expect(a.score).toBe(93)
    expect(a.descriptor).toBe('Excellent')
    expect(a.confidence).toBe('high')
    expect(a.modelVersion).toBe('piste-conditions/1.0')
    expect(a.explanation).toContain('Beginner terrain: 6 of 8 trails open (reported 07:10)')
    expect(a.explanation[0]).toBe('Reported open (07:10)')
    expect([...a.explanation, a.surface.text].join(' ')).not.toMatch(/\bsafe/i)
  })

  it('never lets demo data feed a live assessment', () => {
    const demoReport = report({ kind: 'demo' })
    const live = assessDay(perfectDay({ report: demoReport }))
    expect(live.eligibility).not.toBe('eligible')
    expect(live.scoreKind).toBe('limited')
    expect(live.hardRuleNotes.join(' ')).toContain('demo data never feeds live assessments')
    const demo = assessDay(perfectDay({ report: demoReport, appMode: 'demo' }))
    expect(demo.kind).toBe('demo')
    expect(demo.scoreKind).toBe('conditions')

    const demoWx = { base: point('base', fairWeather(), { kind: 'demo' }), summit: point('summit', fairWeather(), { kind: 'demo' }) }
    const liveWithDemoWx = assessDay(perfectDay({ weather: demoWx }))
    for (const k of ['W', 'V', 'C'] as const) expect(comp(liveWithDemoWx, k).included).toBe(false)
    expect(liveWithDemoWx.scoreKind).toBe('limited')
    expect(liveWithDemoWx.hardRuleNotes.join(' ')).toContain('Demo weather for the base point ignored')
  })

  it('normalises weights over available components when V is missing (no neutral or zero substitution)', () => {
    const noVis = fairWeather(() => ({ visibilityM: null, cloudCoverPct: null }))
    const a = assessDay(perfectDay(withWeather(noVis)))
    const v = comp(a, 'V')
    expect(v.value).toBeNull()
    expect(v.included).toBe(false)
    expect(a.coverage).toBeCloseTo(0.85, 6)
    expect(a.scoreKind).toBe('conditions')
    const used = a.components.filter((c) => c.included)
    const expected = Math.round(used.reduce((s, c) => s + c.weight * c.value!, 0) / used.reduce((s, c) => s + c.weight, 0))
    expect(a.score).toBe(expected)
    expect(a.score).toBe(91) // 7770 / 85; zero-substitution would give 78, neutral-50 would give 85
    expect(a.explanation.some((e) => e.startsWith('Not scored — Visibility'))).toBe(true)
  })

  it('uses a clearly labelled cloud-cover proxy for V when visibility is missing but cloud data exist', () => {
    const cloudy = fairWeather(() => ({ visibilityM: null, cloudCoverPct: 90 }))
    const v = comp(assessDay(perfectDay(withWeather(cloudy))), 'V')
    expect(v.included).toBe(true)
    expect(v.proxy).toBe('Cloud cover and precipitation (no visibility data)')
    expect(v.weight).toBeCloseTo(15 * CFG.weightFactors.proxy, 6)
  })

  it('reads wind at the summit, and says so when it has to fall back to the base', () => {
    const a = assessDay(perfectDay())
    expect(comp(a, 'W').inputs.point).toBe('summit')
    const b = assessDay(perfectDay({ weather: { base: point('base', fairWeather()), summit: null } }))
    expect(comp(b, 'W').inputs.fallbackPoint).toBe(true)
    expect(comp(b, 'W').note).toContain('no summit data')
  })

  it('falls back to the base point when the summit run has hours but no wind values', () => {
    const noSummitWind = fairWeather(() => ({ windKmh: null, gustKmh: null, visibilityM: null, cloudCoverPct: null }))
    const a = assessDay(
      perfectDay({
        weather: {
          base: point('base', fairWeather(), { fetchedAt: '2027-01-15T12:00:00.000Z' }),
          summit: point('summit', noSummitWind, { fetchedAt: '2027-01-15T12:00:00.000Z' }),
        },
      }),
    )
    const w = comp(a, 'W')
    expect(w.included).toBe(true)
    expect(w.inputs.point).toBe('base')
    expect(w.note).toContain('no summit data')
    // Direct visibility at the base is used before any proxy, and the fallback is stated.
    expect(comp(a, 'V').proxy).toBeNull()
    expect(comp(a, 'V').note).toContain('base (no summit data)')
    expect(a.scoreKind).toBe('conditions')
  })

  it('stays DB-compatible: output maps onto conditions_assessments columns', () => {
    const a = assessDay(perfectDay())
    const components: ComponentResult[] = a.components
    type Cols = Pick<
      ConditionsAssessmentRow,
      'scoreKind' | 'score' | 'descriptor' | 'coverage' | 'components' | 'surface' | 'confidence' | 'confidenceReasons' | 'eligibility' | 'leadDays' | 'explanation' | 'modelVersion' | 'inputs' | 'kind' | 'mode' | 'localDate' | 'computedAt'
    >
    const row: Cols = a
    expect(row.components).toBe(components)
    expect(a.components.map((c) => c.key)).toEqual([...COMPONENT_KEYS])
  })
})

describe('mode differences — fresh snow and beginners', () => {
  const freshReport = report({ surfaceTags: ['fresh-snow'], surfaceText: '30 cm new snow', snowfall: [{ window: '24h', amountCm: 30 }] })

  it('30 cm of reported fresh snow: beginner S is not higher than powder S and not raised vs packed powder', () => {
    const learn = assessDay(perfectDay({ ...withWeather(storm), report: freshReport, mode: 'learning' }))
    const powder = assessDay(perfectDay({ ...withWeather(storm), report: freshReport, mode: 'powder' }))
    const packedLearn = assessDay(perfectDay({ mode: 'learning' }))
    const sLearn = comp(learn, 'S').value!
    expect(learn.surface.basis).toBe('reported')
    expect(sLearn).toBeLessThanOrEqual(comp(powder, 'S').value!)
    expect(sLearn).toBeLessThan(comp(packedLearn, 'S').value!)
    expect(comp(powder, 'S').value!).toBeGreaterThan(comp(assessDay(perfectDay({ mode: 'powder' })), 'S').value!)
    expect(learn.score!).toBeLessThan(packedLearn.score!)
    expect(learn.hardRuleNotes.join(' ')).toContain('learning-day surface score')
  })

  it('30 cm of model-inferred fresh snow: same ordering, with inferred S capped and down-weighted', () => {
    const inferred = { ...withWeather(storm), report: report({ surfaceTags: [], surfaceText: null }) }
    const learn = assessDay(perfectDay({ ...inferred, mode: 'learning' }))
    const powder = assessDay(perfectDay({ ...inferred, mode: 'powder' }))
    expect(learn.surface.basis).toBe('inferred')
    expect(comp(learn, 'S').value!).toBeLessThanOrEqual(comp(powder, 'S').value!)
    expect(comp(powder, 'S').value!).toBeLessThanOrEqual(CFG.components.S.inferredCap)
    expect(comp(powder, 'S').weight).toBeCloseTo(45 * CFG.weightFactors.inferredSurface, 6)
  })
})

describe('hard rules — closure, status, preseason, horizon', () => {
  it('a confirmed closure overrides everything, even perfect weather and an open-looking report', () => {
    const a = assessDay(perfectDay({ operations: ops({ status: 'temporarily-closed', statusDate: DAY, statusAt: '2027-01-15T13:00:00.000Z' }) }))
    expect(a.scoreKind).toBe('closed')
    expect(a.score).toBeNull()
    expect(a.eligibility).toBe('closed')
    expect(a.descriptor).toBe('Closed')
    expect(a.components).toEqual([])
    expect(a.hardRuleNotes[0]).toBe('A confirmed closure overrides any conditions score')
  })

  it('treats dates after the actual closing and before the actual opening as closed', () => {
    expect(assessDay(perfectDay({ operations: ops({ actualClosing: '2027-01-10' }) })).scoreKind).toBe('closed')
    expect(assessDay(perfectDay({ operations: ops({ actualOpening: '2027-01-20' }) })).eligibility).toBe('closed')
  })

  it('a same-day closure with an unknown time beats an open report (conservative)', () => {
    const a = assessDay(perfectDay({ operations: ops({ status: 'temporarily-closed', statusDate: DAY, statusAt: null }) }))
    expect(a.eligibility).toBe('closed')
  })

  it('unknown operating status is visible and never eligible, even when the data gate passes', () => {
    const noStatus = assessDay(perfectDay({ report: report({ status: null }) }))
    expect(noStatus.scoreKind).toBe('conditions')
    expect(noStatus.eligibility).toBe('status-unknown')
    expect(noStatus.hardRuleNotes).toContain('Operating status for this date is unknown and is not treated as open')

    const yesterdayOpen = assessDay(
      perfectDay({ report: report({ status: null }), operations: ops({ status: 'open', statusDate: '2027-01-14', statusAt: '2027-01-14T12:00:00.000Z' }) }),
    )
    expect(yesterdayOpen.eligibility).toBe('status-unknown')
    expect(yesterdayOpen.explanation[0]).toContain('status for this date unknown')

    const unavailable = assessDay(perfectDay({ report: report({ status: 'unknown' }) }))
    expect(unavailable.eligibility).toBe('status-unknown')
  })

  it('preseason: no actual opening and the date is before the announced opening', () => {
    const a = assessDay(
      perfectDay({
        now: '2026-10-01T14:00:00.000Z',
        date: '2026-10-03',
        report: null,
        operations: ops({ actualOpening: null, announcedOpening: '2026-12-05' }),
      }),
    )
    expect(a.eligibility).toBe('preseason')
    expect(a.score).toBeNull()
    expect(a.explanation[0]).toContain('a target, subject to operations and weather')
  })

  it('an announced opening date that has arrived does not make the resort open', () => {
    const a = assessDay(perfectDay({ report: null, operations: ops({ actualOpening: null, announcedOpening: '2027-01-10' }) }))
    expect(a.eligibility).toBe('status-unknown')
    expect(a.scoreKind).not.toBe('conditions')
  })

  it('a closure confirmed for a past date is not hidden by a later "open" report', () => {
    // 14 Jan: temporarily closed. The 15 Jan report says open. Assessing 14 Jan must still show Closed.
    const a = assessDay(
      perfectDay({
        date: '2027-01-14',
        report: report(), // localDate 2027-01-15, status open
        operations: ops({ status: 'temporarily-closed', statusDate: '2027-01-14', statusAt: '2027-01-14T12:00:00.000Z' }),
      }),
    )
    expect(a.eligibility).toBe('closed')
    expect(a.scoreKind).toBe('closed')
    expect(a.score).toBeNull()

    // Same, with the closure in the date's own report and the later "open" in a status event.
    const b = assessDay(
      perfectDay({
        date: '2027-01-14',
        report: report({ localDate: '2027-01-14', reportedAt: '2027-01-14T12:10:00.000Z', status: 'temporarily-closed' }),
        operations: ops({ status: 'open', statusDate: '2027-01-15', statusAt: '2027-01-15T12:00:00.000Z' }),
      }),
    )
    expect(b.eligibility).toBe('closed')
    expect(b.score).toBeNull()
  })

  it('later evidence never rewrites a past date: a later report is not its surface, terrain or status', () => {
    const a = assessDay(perfectDay({ date: '2027-01-14', report: report() })) // report is for 15 Jan
    expect(a.surface.basis).not.toBe('reported')
    expect(a.surface.text).not.toContain('Packed powder')
    expect(a.hardRuleNotes.join(' ')).toContain('Report for a later date')

    // The date's own "open" report is not overridden by a closure stated for a later date.
    const b = assessDay(
      perfectDay({
        date: '2027-01-14',
        report: report({ localDate: '2027-01-14', reportedAt: '2027-01-14T12:10:00.000Z' }),
        operations: ops({ status: 'temporarily-closed', statusDate: '2027-01-15', statusAt: '2027-01-15T12:00:00.000Z' }),
      }),
    )
    expect(b.eligibility).toBe('eligible')
  })

  it('beyond the forecast horizon: out-of-horizon, no score', () => {
    const a = assessDay(perfectDay({ date: '2027-02-15' }))
    expect(a.eligibility).toBe('out-of-horizon')
    expect(a.scoreKind).toBe('none')
    expect(a.score).toBeNull()
    expect(a.components).toEqual([])
  })
})

describe('data gate', () => {
  it('fails to "limited" without a same-day report: coverage < 0.8, excluded components listed, no invented values', () => {
    const a = assessDay(perfectDay({ report: null }))
    expect(a.scoreKind).toBe('limited')
    expect(a.descriptor).toBe('Limited data')
    expect(a.coverage).toBeLessThan(0.8)
    expect(a.gate.passed).toBe(false)
    expect(a.gate.excluded).toEqual(expect.arrayContaining(['S', 'T']))
    expect(comp(a, 'T').value).toBeNull()
    expect(a.explanation.some((e) => e.startsWith('Not scored — Terrain availability'))).toBe(true)
    expect(a.score).toBeNull() // 45% coverage is below the estimate threshold
  })

  it('shows a limited estimate when enough weighted inputs exist, with an inferred surface', () => {
    const stale = report({ localDate: '2027-01-14', reportedAt: '2027-01-14T12:10:00.000Z' }) // yesterday's
    const a = assessDay(perfectDay({ ...withWeather(storm), report: stale }))
    expect(a.scoreKind).toBe('limited')
    expect(a.surface.basis).toBe('inferred')
    expect(a.gate.reasons).toContain('surface is inferred from weather, not reported')
    expect(a.gate.reasons).toContain('terrain status not reported for this date')
    expect(a.coverage).toBeCloseTo(0.575, 6)
    expect(a.score).not.toBeNull()
  })

  it('never assumes terrain is open from an "open" status without counts', () => {
    const a = assessDay(perfectDay({ report: report({ openTrails: null, totalTrails: null, openBeginnerTrails: null, totalBeginnerTrails: null, openLifts: null, totalLifts: null }) }))
    expect(comp(a, 'T').value).toBeNull()
    expect(a.scoreKind).toBe('limited')
  })

  it('labels the whole-mountain proxy when beginner trail counts are missing (learning mode)', () => {
    const a = assessDay(perfectDay({ report: report({ openBeginnerTrails: null, totalBeginnerTrails: null }) }))
    expect(comp(a, 'T').proxy).toBe('Whole-mountain open-trail share (beginner trail counts not reported)')
  })
})

describe('future dates — weather potential', () => {
  it('scores a future date from weather-derived components only, with assumptions stated', () => {
    const a = assessDay(perfectDay({ date: '2027-01-18' }))
    expect(a.scoreKind).toBe('weather-potential')
    expect(a.eligibility).toBe('status-unknown')
    expect(a.leadDays).toBe(3)
    const t = comp(a, 'T')
    expect(t.included).toBe(false)
    expect(t.value).toBeNull()
    expect(a.surface.basis).not.toBe('reported')
    expect(a.surface.text.startsWith('Likely')).toBe(true)
    for (const k of ['W', 'V', 'C'] as const) expect(comp(a, k).included).toBe(true)
    expect(a.explanation.join(' ')).toContain('open terrain and operating status for this date are unknown')
    expect(a.confidence).not.toBe('high')
    expect(a.score).toBe(combineComponents(a.components, 'learning').score)
  })
})

describe('warnings and confidence', () => {
  it('passes official alerts through without changing the score', () => {
    const alert = { id: 'nws-1', event: 'Winter Storm Warning', headline: 'Heavy snow', severity: 'Severe', onset: '2027-01-15T10:00:00.000Z', ends: '2027-01-16T12:00:00.000Z', url: null }
    const other = { ...alert, id: 'nws-2', onset: '2027-01-20T10:00:00.000Z', ends: '2027-01-21T10:00:00.000Z' }
    const without = assessDay(perfectDay())
    const withAlert = assessDay(perfectDay({ alerts: [alert, other] }))
    expect(withAlert.score).toBe(without.score)
    expect(withAlert.scoreKind).toBe(without.scoreKind)
    expect(withAlert.warnings).toEqual([alert])
    expect(withAlert.hardRuleNotes).toContain('Official alerts are shown separately and are not offset by the score')
  })

  it('never hides an official alert because its timestamps cannot be read', () => {
    const odd = { id: 'nws-3', event: 'Wind Chill Warning', headline: null, severity: 'Severe', onset: 'not-a-date', ends: 'also-bad', url: null }
    expect(assessDay(perfectDay({ alerts: [odd] })).warnings).toEqual([odd])
  })

  it('does not compare a partial day of primary snowfall with an alternate model’s daily total', () => {
    // Primary data stop at 11:00 EST on DAY, so its "daily" snowfall covers only half the day.
    const partial = fairWeather().filter((h) => h.validTime <= '2027-01-15T16:00:00.000Z')
    const a = assessDay(
      perfectDay({
        weather: { base: point('base', partial, { fetchedAt: '2027-01-15T12:00:00.000Z' }), summit: point('summit', partial, { fetchedAt: '2027-01-15T12:00:00.000Z' }) },
        alternateModel: { label: 'GFS', snowfallCm: 20 },
      }),
    )
    expect(a.confidenceReasons.join(' ')).not.toMatch(/Models disagree|broadly agrees/)
  })

  it('lowers confidence when an alternate model genuinely disagrees on snowfall', () => {
    const agree = assessDay(perfectDay({ alternateModel: { label: 'GFS', snowfallCm: 0 } }))
    const disagree = assessDay(perfectDay({ alternateModel: { label: 'GFS', snowfallCm: 20 } }))
    expect(agree.confidence).toBe('high')
    expect(disagree.confidence).toBe('medium')
    expect(disagree.confidenceReasons.join(' ')).toContain('Models disagree on snowfall')
  })

  it('lowers confidence for stale weather and personal-only surface evidence', () => {
    const staleWx = assessDay(perfectDay(withWeather(fairWeather(), {})))
    expect(staleWx.confidence).toBe('high')
    const old = assessDay(
      perfectDay({
        weather: { base: point('base', fairWeather(), { fetchedAt: '2027-01-14T00:00:00.000Z' }), summit: point('summit', fairWeather(), { fetchedAt: '2027-01-14T00:00:00.000Z' }) },
      }),
    )
    expect(old.confidence).toBe('medium')
    expect(old.confidenceReasons.join(' ')).toContain('Weather data')

    const personalOnly = assessDay(
      perfectDay({
        report: report({ surfaceTags: [], surfaceText: null }),
        personalFeedback: [{ date: '2027-01-14', surfaceTags: ['firm'], recordedAt: '2027-01-14T22:00:00.000Z' }],
      }),
    )
    expect(personalOnly.surface.basis).toBe('personal')
    expect(personalOnly.confidence).toBe('medium')
    expect(personalOnly.confidenceReasons).toContain('Surface from my own feedback, not an official report')
  })
})
