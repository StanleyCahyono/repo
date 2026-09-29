import { describe, expect, it } from 'vitest'
import { computeFit, type FitInput } from './fit'
import { money } from './money'
import { classifyDay, confirmedClosure, describeNoWinner, recommend, type CandidateDay, type RecommendCandidate, type RecommendInput } from './recommend'

const NOW = '2027-01-15T14:00:00.000Z'
const TODAY = '2027-01-15'
const SAT = '2027-01-16'
const PREFS = { maxDriveHours: 4, willingToFly: true, winterBufferPct: 20 }

function fitFor(over: Partial<FitInput> = {}) {
  return computeFit({
    ability: 'beginner',
    terrain: { beginnerPct: 35, intermediatePct: 35, advancedPct: 30, verification: 'official-page' },
    learning: { lessons: true, rentals: true, beginnerArea: 'Carpet area', learningNotes: null },
    travel: { driveMinutes: 60, driveIsEstimate: false, airports: [] },
    travelPrefs: PREFS,
    cost: { total: money(10_000, 'USD'), tier: '$' },
    dayBudget: null,
    ...over,
  })
}

function day(date: string, over: Partial<CandidateDay> & { score?: number | null; powder?: number | null } = {}): CandidateDay {
  const { score = 70, powder = null, ...rest } = over
  return {
    date,
    conditions: {
      learning: score === null ? null : { score, scoreKind: 'conditions', descriptor: 'Good', confidence: 'high', computedAt: NOW, kind: 'derived' },
      powder: powder === null ? null : { score: powder, scoreKind: 'conditions', descriptor: 'Good', confidence: 'high', computedAt: NOW, kind: 'derived' },
    },
    cost: { total: money(10_000, 'USD'), tier: '$', missing: [] },
    pass: { status: 'no-pass', productName: null },
    events: [],
    ...rest,
  }
}

function cand(id: string, over: Partial<RecommendCandidate> = {}, fitOver: Partial<FitInput> = {}): RecommendCandidate {
  const fit = fitFor(fitOver)
  return {
    resortId: id,
    name: id.toUpperCase(),
    today: TODAY,
    ops: {
      status: 'open',
      statusDate: TODAY,
      statusAt: '2027-01-15T12:00:00.000Z',
      announcedOpening: '2026-11-27',
      estimatedOpenFrom: null,
      estimatedOpenTo: null,
      actualOpening: '2026-11-28',
      announcedClosing: null,
      actualClosing: null,
    },
    fit,
    travel: fit.travel,
    evidence: { reportAt: '2027-01-15T12:00:00.000Z', reportDate: TODAY, reportKind: 'official', weatherFetchedAt: '2027-01-15T12:00:00.000Z' },
    days: [day(TODAY), day(SAT)],
    ...over,
  }
}

const base = (candidates: RecommendCandidate[], over: Partial<RecommendInput> = {}): RecommendInput => ({
  candidates,
  dates: [TODAY],
  preset: 'learning',
  now: NOW,
  ...over,
})

describe('eligibility first', () => {
  it('never recommends a closed resort, however good its snow score', () => {
    const closed = cand('snowy', {
      ops: { ...cand('x').ops, status: 'temporarily-closed', statusDate: TODAY },
      days: [day(TODAY, { score: 98, powder: 99, snow: { forecast72hCm: 60, reported24hCm: 40 } })],
    })
    const seasonOver = cand('done', { ops: { ...cand('x').ops, status: 'closed-for-season', statusDate: '2027-01-10' }, days: [day(TODAY, { score: 95, powder: 97 })] })
    const open = cand('open', { days: [day(TODAY, { score: 50, powder: 45 })] })
    const r = recommend(base([closed, seasonOver, open], { preset: 'best-snow' }))
    expect(r.winner?.resortId).toBe('open')
    expect(r.ranked.map((o) => o.resortId)).toEqual(['open'])
    expect(r.excluded.map((e) => [e.resortId, e.kind])).toEqual([
      ['done', 'closed'],
      ['snowy', 'closed'],
    ])
  })

  it('puts unknown status in a separate group that is never the winner', () => {
    const unknown = cand('mystery', { ops: { ...cand('x').ops, status: 'unknown', statusDate: TODAY }, days: [day(TODAY, { score: 99 })] })
    const open = cand('open', { days: [day(TODAY, { score: 40 })] })
    const r = recommend(base([unknown, open]))
    expect(r.winner?.resortId).toBe('open')
    expect(r.statusUnknown.map((o) => o.resortId)).toEqual(['mystery'])
    expect(r.statusUnknown[0].total).toBeGreaterThan(r.winner!.total)

    const onlyUnknown = recommend(base([unknown]))
    expect(onlyUnknown.winner).toBeNull()
    expect(onlyUnknown.statusUnknown).toHaveLength(1)
    expect(onlyUnknown.noWinnerReason).toMatch(/unknown status/)
  })

  it('an announced opening date that has passed does not make a resort open', () => {
    const c = cand('target', { ops: { ...cand('x').ops, status: null, statusDate: null, statusAt: null, announcedOpening: '2027-01-10', actualOpening: null } })
    const cls = classifyDay(c, c.days[0], TODAY, NOW)
    expect(cls.kind).toBe('status-unknown')
    const other = cand('open')
    const r = recommend(base([c, other]))
    expect(r.winner?.resortId).toBe('open')
    expect(r.statusUnknown[0].statusNote).toMatch(/announced opening .* is a target/)
  })

  it('a future in-season date is "expected open" only after an actual opening, with the assumption and status age stated', () => {
    const c = cand('alta', { ops: { ...cand('x').ops, statusAt: '2027-01-14T18:00:00.000Z', statusDate: '2027-01-14' } })
    const r = recommend(base([c], { dates: [SAT] }))
    expect(r.winner?.eligibility).toBe('expected-open')
    expect(r.winner?.assumption).toMatch(/latest status Open reported 20 h ago/)
    expect(r.evidenceLimitations[0]).toMatch(/Assumes ALTA is still operating/)
  })

  it('excludes a resort outside the travel limits', () => {
    const far = cand('far', {}, { travel: { driveMinutes: 400, driveIsEstimate: true, airports: [] }, travelPrefs: { ...PREFS, willingToFly: false } })
    const r = recommend(base([far, cand('near')], { preset: 'best-snow' }))
    expect(r.excluded).toEqual([expect.objectContaining({ resortId: 'far', kind: 'travel' })])
  })
})

describe('presets', () => {
  it('changing the preset changes the ranking', () => {
    const powderFar = cand(
      'powder-far',
      { days: [day(TODAY, { score: 60, powder: 95 })] },
      { travel: { driveMinutes: 190, driveIsEstimate: false, airports: [] }, cost: { total: money(22_000, 'USD'), tier: '$$' } },
    )
    const nearCheap = cand(
      'near-cheap',
      { days: [day(TODAY, { score: 65, powder: 40 }), day(SAT)] },
      { travel: { driveMinutes: 30, driveIsEstimate: false, airports: [] }, cost: { total: money(7_000, 'USD'), tier: '$' } },
    )
    nearCheap.days[0].cost = { total: money(7_000, 'USD'), tier: '$', missing: [] }
    powderFar.days[0].cost = { total: money(22_000, 'USD'), tier: '$$', missing: [] }
    const snow = recommend(base([powderFar, nearCheap], { preset: 'best-snow' }))
    const drive = recommend(base([powderFar, nearCheap], { preset: 'short-drive' }))
    const cheap = recommend(base([powderFar, nearCheap], { preset: 'lowest-cost' }))
    expect(snow.winner?.resortId).toBe('powder-far')
    expect(snow.winner?.conditionsMode).toBe('powder')
    expect(drive.winner?.resortId).toBe('near-cheap')
    expect(cheap.winner?.resortId).toBe('near-cheap')
    expect(snow.explanation.benefits.join(' ')).toMatch(/Conditions 95/)
  })

  it('après weekend favours resorts with announced events', () => {
    const quiet = cand('quiet', { days: [day(TODAY, { score: 72 })] })
    const party = cand('party', { days: [day(TODAY, { score: 68, events: [{ title: 'Torchlight parade', status: 'announced' }, { title: 'Old event', status: 'cancelled' }] })] })
    expect(recommend(base([quiet, party], { preset: 'apres-weekend' })).winner?.resortId).toBe('party')
    expect(recommend(base([quiet, party], { preset: 'learning' })).winner?.resortId).toBe('quiet')
  })

  it('custom weights come from the user preferences', () => {
    const a = cand('a', { days: [day(TODAY, { score: 90 })] }, { travel: { driveMinutes: 200, driveIsEstimate: false, airports: [] } })
    const b = cand('b', { days: [day(TODAY, { score: 50 })] }, { travel: { driveMinutes: 20, driveIsEstimate: false, airports: [] } })
    const r1 = recommend(base([a, b], { preset: 'custom', weights: { conditions: 100, fit: 0, travel: 0, cost: 0, events: 0 } }))
    const r2 = recommend(base([a, b], { preset: 'custom', weights: { conditions: 0, fit: 0, travel: 100, cost: 0, events: 0 } }))
    expect(r1.winner?.resortId).toBe('a')
    expect(r2.winner?.resortId).toBe('b')
  })
})

describe('evidence limitations', () => {
  it('surfaces stale reports, unconfirmed pass access and incomplete costs beside the winner', () => {
    const c = cand('greek-peak', {
      evidence: { reportAt: '2027-01-14T18:00:00.000Z', reportDate: '2027-01-14', reportKind: 'official', weatherFetchedAt: null, catalogResearched: true },
      days: [
        day(TODAY, {
          cost: { total: null, tier: 'incomplete', missing: ['No weekday lift ticket price'] },
          pass: { status: 'unconfirmed', productName: 'Indy Base Pass' },
        }),
      ],
    })
    const r = recommend(base([c]))
    const lim = r.evidenceLimitations.join(' | ')
    expect(lim).toMatch(/Snow report 20 h old/)
    expect(lim).toMatch(/Weather not fetched yet/)
    expect(lim).toMatch(/Pass access unconfirmed for Indy Base Pass/)
    expect(lim).toMatch(/Cost estimate incomplete \(No weekday lift ticket price\)/)
    expect(lim).toMatch(/researched — confirm at source/)
    const cost = r.winner!.factors.find((f) => f.key === 'cost')!
    expect(cost.known).toBe(false)
  })

  it('unknown factors never help: a missing conditions score ranks below a modest known one', () => {
    const known = cand('known', { days: [day(TODAY, { score: 50 })] })
    const missing = cand('missing', { days: [day(TODAY, { score: null })] })
    const r = recommend(base([missing, known], { preset: 'best-snow' }))
    expect(r.winner?.resortId).toBe('known')
    expect(r.ranked[1].limitations.join(' ')).toMatch(/No conditions score/)
  })

  it('ignores demo-kind conditions in live mode', () => {
    const d = day(TODAY, { score: null })
    d.conditions.learning = { score: 99, scoreKind: 'conditions', descriptor: 'Excellent', confidence: 'high', computedAt: NOW, kind: 'demo' }
    const r = recommend(base([cand('demo', { days: [d] })]))
    expect(r.winner?.factors.find((f) => f.key === 'conditions')!.known).toBe(false)
    const demo = recommend(base([cand('demo', { days: [d] })], { appMode: 'demo' }))
    expect(demo.winner?.factors.find((f) => f.key === 'conditions')!.value).toBe(99)
  })

  it('official alerts are shown as trade-offs without changing the score', () => {
    const quiet = recommend(base([cand('a')]))
    const warned = cand('a')
    warned.days = [day(TODAY, { warnings: ['Winter Storm Warning'] })]
    const r = recommend(base([warned]))
    expect(r.winner!.total).toBe(quiet.winner!.total)
    expect(r.explanation.tradeoffs[0]).toBe('Official alert: Winter Storm Warning')
  })
})

describe('preseason', () => {
  it('has no winner when nothing has opened yet, with opening reasons for each resort', () => {
    const today = '2026-09-28'
    const pre = (id: string, announced: string | null): RecommendCandidate =>
      cand(id, {
        today,
        ops: {
          status: null,
          statusDate: null,
          statusAt: null,
          announcedOpening: announced,
          estimatedOpenFrom: announced ? null : '2026-11-28',
          estimatedOpenTo: announced ? null : '2026-12-05',
          actualOpening: null,
          announcedClosing: null,
          actualClosing: null,
        },
        days: [day('2026-10-03')],
      })
    const r = recommend(base([pre('greek-peak', null), pre('killington', '2026-11-06')], { dates: ['2026-10-03'], now: '2026-09-28T14:00:00.000Z' }))
    expect(r.preseason).toBe(true)
    expect(r.winner).toBeNull()
    expect(r.alternatives).toEqual([])
    expect(r.excluded.find((e) => e.resortId === 'killington')?.reason).toMatch(/Not open yet — opens Fri 6 Nov/)
    expect(r.excluded.find((e) => e.resortId === 'greek-peak')?.reason).toMatch(/Not open yet — opening not announced \(Piste estimate/)
    expect(r.noWinnerReason).toMatch(/Preseason/)
  })

  it('a status from last season is not an opening this season', () => {
    const c = cand('x', {
      today: '2026-10-10',
      ops: { ...cand('x').ops, status: 'open', statusDate: '2026-04-01', actualOpening: null, announcedOpening: '2026-11-20' },
      days: [day('2026-10-12')],
    })
    const r = recommend(base([c], { dates: ['2026-10-12'], now: '2026-10-10T14:00:00.000Z' }))
    expect(r.preseason).toBe(true)
    expect(r.excluded[0].kind).toBe('preseason')
  })

  it("last season's closed-for-season does not close the new season: preseason before the announced date, unknown after", () => {
    const lastApril = (today: string, date: string) =>
      cand('alta', {
        today,
        ops: { ...cand('x').ops, status: 'closed-for-season', statusDate: '2026-04-12', statusAt: '2026-04-12T16:00:00.000Z', actualOpening: null, announcedOpening: '2026-11-20' },
        days: [day(date)],
      })
    const before = lastApril('2026-10-10', '2026-10-12')
    expect(classifyDay(before, before.days[0], '2026-10-12', '2026-10-10T14:00:00.000Z')).toMatchObject({ kind: 'preseason', reason: expect.stringMatching(/Not open yet — opens Fri 20 Nov/) })
    const r = recommend(base([before], { dates: ['2026-10-12'], now: '2026-10-10T14:00:00.000Z' }))
    expect(r.excluded).toEqual([expect.objectContaining({ resortId: 'alta', kind: 'preseason' })])
    expect(r.excluded[0].reason).not.toMatch(/Closed for the season/)

    const after = lastApril('2026-11-24', '2026-11-25')
    const cls = classifyDay(after, after.days[0], '2026-11-25', '2026-11-24T14:00:00.000Z')
    expect(cls.kind).toBe('status-unknown')
    const r2 = recommend(base([after, cand('open', { today: '2026-11-24', ops: { ...cand('x').ops, statusDate: '2026-11-25', actualOpening: '2026-11-21' }, days: [day('2026-11-25')] })], { dates: ['2026-11-25'], now: '2026-11-24T14:00:00.000Z' }))
    expect(r2.statusUnknown.map((o) => o.resortId)).toEqual(['alta'])
    expect(r2.excluded).toEqual([])
  })

  it('a summer "closed for the season" page before this season\'s announced opening is not a closure of this season', () => {
    const c = cand('alta', {
      today: '2026-10-10',
      ops: { ...cand('x').ops, status: 'closed-for-season', statusDate: '2026-07-15', actualOpening: null, announcedOpening: '2026-11-20' },
      days: [day('2026-10-12')],
    })
    expect(confirmedClosure(c.ops, '2026-10-12')).toBeNull()
    expect(classifyDay(c, c.days[0], '2026-10-12', '2026-10-10T14:00:00.000Z').kind).toBe('preseason')
    // …while a closure reported after this season's opening still closes it.
    const closedInApril = { ...c.ops, statusDate: '2027-04-05', actualOpening: '2026-11-21' }
    expect(confirmedClosure(closedInApril, '2027-04-10')).toMatchObject({ kind: 'closed-for-season', reason: 'Closed for the season (reported Mon 5 Apr)' })
    expect(confirmedClosure(closedInApril, '2027-04-01')).toBeNull()
  })
})

describe('confirmedClosure', () => {
  const ops = cand('x').ops
  it('a temporary closure applies to its own date only; season dates bound the season', () => {
    const temp = { ...ops, status: 'temporarily-closed' as const, statusDate: TODAY }
    expect(confirmedClosure(temp, TODAY)).toMatchObject({ kind: 'temporarily-closed' })
    expect(confirmedClosure(temp, SAT)).toBeNull()
    expect(confirmedClosure({ ...ops, actualClosing: '2027-04-11' }, '2027-04-12')).toMatchObject({ kind: 'season-ended' })
    expect(confirmedClosure({ ...ops, actualClosing: '2027-04-11' }, '2027-04-11')).toBeNull()
    expect(confirmedClosure(ops, '2026-11-20')).toMatchObject({ kind: 'before-opening' })
    expect(confirmedClosure(ops, TODAY)).toBeNull()
  })
})

describe('no-winner reasons', () => {
  it('says the resorts are outside the travel limits rather than "nothing is open"', () => {
    const far = cand('far', {}, { travel: { driveMinutes: 400, driveIsEstimate: true, airports: [] }, travelPrefs: { ...PREFS, willingToFly: false } })
    const r = recommend(base([far]))
    expect(r.winner).toBeNull()
    expect(r.noWinnerReason).toMatch(/within your travel limits/)
    expect(r.noWinnerReason).not.toMatch(/No resort is open on these dates/)
  })

  it('lists the counts when exclusions are mixed, and mentions unknown-status resorts', () => {
    const far = cand('far', {}, { travel: { driveMinutes: 400, driveIsEstimate: true, airports: [] }, travelPrefs: { ...PREFS, willingToFly: false } })
    const closed = cand('shut', { ops: { ...cand('x').ops, status: 'temporarily-closed', statusDate: TODAY } })
    const unknown = cand('mystery', { ops: { ...cand('x').ops, status: 'unknown', statusDate: TODAY } })
    const r = recommend(base([far, closed, unknown]))
    expect(r.winner).toBeNull()
    expect(r.noWinnerReason).toMatch(/1 outside your travel limits, 1 closed/)
    expect(r.noWinnerReason).toMatch(/1 resort with unknown status is listed separately/)
    expect(describeNoWinner({ candidates: 1, preseason: false, excluded: [{ resortId: 'a', name: 'A', kind: 'closed', reason: 'x' }], statusUnknown: 0 })).toMatch(/confirmed closure/)
  })

  it('custom weights that are all zero fall back to Learning day weights, and say so', () => {
    const r = recommend(base([cand('a')], { preset: 'custom', weights: { conditions: 0, fit: 0, travel: 0, cost: 0, events: 0 } }))
    expect(r.weights).toEqual({ conditions: 25, fit: 45, travel: 15, cost: 15, events: 0 })
    expect(r.weightsNote).toMatch(/all zero/)
    expect(recommend(base([cand('a')])).weightsNote).toBeNull()
  })
})

describe('modeled snow wording', () => {
  it('an incomplete 72 h sum reads "at least …", and display units are respected', () => {
    const partial = cand('a', { days: [day(TODAY, { snow: { forecast72hCm: 20, forecast72hComplete: false, reported24hCm: null } })] })
    const full = cand('b', { days: [day(TODAY, { snow: { forecast72hCm: 20, forecast72hComplete: true, reported24hCm: null } })] })
    const r = recommend(base([partial, full]))
    const a = r.ranked.find((o) => o.resortId === 'a')!
    const b = r.ranked.find((o) => o.resortId === 'b')!
    expect(a.benefits.join(' | ')).toMatch(/Likely at least 20 cm new snow in the next 72 h/)
    expect(b.benefits.join(' | ')).toMatch(/Likely 20 cm new snow in the next 72 h \(weather model\)/)
    const inches = recommend(base([full], { units: { temperature: 'F', snow: 'in', distance: 'mi', elevation: 'ft', speed: 'mph' } }))
    expect(inches.winner!.benefits.join(' | ')).toMatch(/Likely 7.9″ new snow/)
  })
})

describe('determinism and ranges', () => {
  it('breaks exact ties by resort id regardless of input order', () => {
    const r1 = recommend(base([cand('b'), cand('a'), cand('c')]))
    const r2 = recommend(base([cand('c'), cand('a'), cand('b')]))
    expect(r1.ranked.map((o) => o.resortId)).toEqual(['a', 'b', 'c'])
    expect(r2.ranked.map((o) => o.resortId)).toEqual(['a', 'b', 'c'])
    expect(r1.alternatives.map((o) => o.resortId)).toEqual(['b', 'c'])
  })

  it('limits alternatives to three', () => {
    const r = recommend(base(['a', 'b', 'c', 'd', 'e'].map((id) => cand(id))))
    expect(r.winner?.resortId).toBe('a')
    expect(r.alternatives).toHaveLength(3)
  })

  it('for a range picks each resort’s best date and lists the others', () => {
    const c = cand('a', { ops: { ...cand('x').ops, statusDate: SAT, statusAt: '2027-01-15T12:00:00.000Z' }, days: [day(TODAY, { score: 40 }), day(SAT, { score: 90 })] })
    const r = recommend(base([c], { dates: [TODAY, SAT] }))
    expect(r.winner?.date).toBe(SAT)
    expect(r.winner?.eligibility).toBe('confirmed-open')
    expect(r.winner?.otherDates).toEqual([expect.objectContaining({ date: TODAY })])
  })
})
