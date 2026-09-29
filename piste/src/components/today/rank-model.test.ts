import { describe, expect, it } from 'vitest'
import type { Recommendation, RankedOption } from '@/lib/domain/recommend'
import { explainPosition, factorDeltas, ordinal, rankingView, topContributions, weightPercents } from './rank-model'

function option(
  resortId: string,
  rank: number,
  total: number,
  values: Partial<Record<'conditions' | 'fit' | 'travel' | 'cost', number | null>>,
  extra: Partial<RankedOption> = {},
): RankedOption {
  const weights = {
    conditions: 0.25,
    fit: 0.45,
    travel: 0.15,
    cost: 0.15,
  } as const
  return {
    resortId,
    name: resortId.replace(/-/g, ' '),
    date: '2027-01-16',
    rank,
    total,
    eligibility: 'expected-open',
    statusNote: 'Expected open (assumption)',
    assumption: 'Assumes it is still operating',
    conditionsMode: 'learning',
    factors: (Object.keys(weights) as (keyof typeof weights)[]).map((k) => {
      const v = values[k] ?? null
      return {
        key: k,
        label: k === 'fit' ? 'Fit for me' : k[0].toUpperCase() + k.slice(1),
        weight: weights[k],
        value: v,
        used: v ?? 40,
        known: v !== null,
        note: '',
      }
    }),
    benefits: [],
    tradeoffs: [],
    limitations: [],
    warnings: [],
    otherDates: [
      {
        date: '2027-01-17',
        total: 70,
        eligibility: 'expected-open',
        note: 'Expected open',
      },
    ],
    ...extra,
  }
}

const rec = (ranked: RankedOption[], extra: Partial<Recommendation> = {}): Recommendation => ({
  preset: 'learning',
  presetLabel: 'Learning day',
  weights: { conditions: 25, fit: 45, travel: 15, cost: 15, events: 0 },
  dates: ['2027-01-16', '2027-01-17'],
  winner: ranked[0] ?? null,
  alternatives: ranked.slice(1, 4),
  ranked,
  excluded: [
    {
      resortId: 'jay-peak',
      name: 'Jay Peak',
      reason: 'Temporarily closed on Sat 16 Jan (reported)',
      kind: 'closed',
    },
  ],
  statusUnknown: [],
  explanation: { benefits: [], tradeoffs: [] },
  evidenceLimitations: [],
  preseason: false,
  noWinnerReason: null,
  weightsNote: null,
  ...extra,
})

describe('rankingView', () => {
  it('lays every window date out per option, marking the best and unranked days', () => {
    const v = rankingView(
      rec([
        option('greek-peak', 1, 81.6, {
          conditions: 88,
          fit: 87,
          travel: 96,
          cost: null,
        }),
      ]),
    )
    expect(v.options[0].days).toEqual([
      {
        date: '2027-01-16',
        total: 81.6,
        eligibility: 'expected-open',
        note: 'Expected open (assumption)',
        best: true,
      },
      {
        date: '2027-01-17',
        total: 70,
        eligibility: 'expected-open',
        note: 'Expected open',
        best: false,
      },
    ])
    expect(v.excluded[0]).toMatchObject({ name: 'Jay Peak', kind: 'closed' })
  })
  it('keeps the unknown fallback exactly as the engine counted it', () => {
    const [o] = rankingView(
      rec([
        option('greek-peak', 1, 81.6, {
          conditions: 88,
          fit: 87,
          travel: 96,
          cost: null,
        }),
      ]),
    ).options
    const cost = o.factors.find((f) => f.key === 'cost')!
    expect(cost).toMatchObject({
      known: false,
      value: null,
      used: 40,
      points: 6,
    })
    expect(topContributions(o, 2).map((f) => f.key)).toEqual(['fit', 'conditions'])
  })
})

describe('explainPosition', () => {
  const a = option('greek-peak', 1, 81.6, {
    conditions: 88,
    fit: 87,
    travel: 96,
    cost: null,
  })
  const b = option('bristol-mountain', 2, 77.4, {
    conditions: 90,
    fit: 80,
    travel: 85,
    cost: null,
  })
  const c = option('holiday-valley', 3, 65.7, {
    conditions: 70,
    fit: 70,
    travel: 60,
    cost: 65,
  })
  const list = rankingView(rec([a, b, c])).options

  it('attributes the gap to the factors that moved it most', () => {
    expect(factorDeltas(list[1], list[0]).map((d) => d.key)).toEqual(['conditions', 'fit', 'travel'])
    const [behind, ahead, unknown] = explainPosition(list, 1)
    expect(behind).toBe('4.2 behind greek peak — mostly fit for me (−3.1) and travel (−1.6); better on conditions (+0.5).')
    expect(ahead).toMatch(
      /^11\.7 ahead of holiday valley — mostly fit for me \(\+4\.5\) and conditions \(\+5\.0\)|^11\.7 ahead of holiday valley — mostly conditions/,
    )
    expect(unknown).toMatch(/Cost is unknown and counted at 40/)
  })
  it('explains the pick against the runner-up only', () => {
    const lines = explainPosition(list, 0)
    expect(lines[0]).toMatch(/^4\.2 ahead of bristol mountain/)
    expect(explainPosition(list, 2)[0]).toMatch(/^11\.7 behind bristol mountain/)
  })
})

describe('helpers', () => {
  it('rounds weights to whole percentages that sum to 100', () => {
    const p = weightPercents({
      conditions: 35,
      fit: 25,
      travel: 20,
      cost: 15,
      events: 5,
    })
    expect(p).toEqual({
      conditions: 35,
      fit: 25,
      travel: 20,
      cost: 15,
      events: 5,
    })
    const q = weightPercents({
      conditions: 1,
      fit: 1,
      travel: 1,
      cost: 0,
      events: 0,
    })
    expect(Object.values(q).reduce((s, x) => s + x, 0)).toBe(100)
    expect(weightPercents({ conditions: 0, fit: 0, travel: 0, cost: 0, events: 0 }).fit).toBe(0)
  })
  it('passes the engine sentences through unchanged (wording is fixed at the source, in recommend.ts)', () => {
    const lines = { benefits: ['Great fit (87)', 'Lessons offered'], tradeoffs: ['Not covered by your Indy Base Pass: No days left'], limitations: ['Snow report 20 h old'] }
    const [o] = rankingView(rec([option('a', 1, 70, { conditions: 80 }, lines)])).options
    expect({ benefits: o.benefits, tradeoffs: o.tradeoffs, limitations: o.limitations }).toEqual(lines)
  })
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
  })
})
