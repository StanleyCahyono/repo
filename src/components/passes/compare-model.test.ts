import { describe, expect, it } from 'vitest'
import type { PassCompareView, ScenarioDay } from '@/lib/data/passes-screen'
import { comparePasses, type PassCandidate, type PlannedResortDay } from '@/lib/domain/costs'
import { fromMajor, type Money } from '@/lib/domain/money'
import type { PassProductInput, PassRuleInput } from '@/lib/domain/passes/types'
import { provenance } from '@/lib/domain/types'
import { compareModel } from './compare-model'

const usd = (major: string) => fromMajor(major, 'USD')
const prov = provenance({ kind: 'official', verification: 'official-page' })
const product = (id: string, familyId = 'ikon'): PassProductInput => ({ id, familyId, seasonId: '2026-27', name: id === 'ikon' ? 'Ikon Pass' : id === 'mc' ? 'Mountain Collective' : id === 'indy' ? 'Indy Pass' : id })
const rule = (productId: string, resortId: string, p: Partial<PassRuleInput> = {}): PassRuleInput => ({
  productId,
  resortId,
  access: 'unlimited',
  days: null,
  poolId: null,
  poolLabel: null,
  blackouts: [],
  reservationRequired: false,
  prov,
  ...p,
})

function view(days: PlannedResortDay[], candidates: PassCandidate[]): PassCompareView {
  const result = comparePasses({ days, candidates, currency: 'USD', rates: [] })
  const sd = days.map(
    (d): ScenarioDay => ({
      key: `added:${d.resortId}:${d.date}`,
      source: 'added',
      resortId: d.resortId,
      resortName: d.resortId === 'alta' ? 'Alta' : 'Greek Peak',
      date: d.date,
      dayType: 'weekend',
      tripId: null,
      tripName: null,
      ticket: d.ticket,
      ticketBasis: null,
      ticketKind: d.ticket ? 'published' : null,
      ticketEstimate: null,
      ticketProv: null,
    }),
  )
  return { result, days: sd, meta: {} } as unknown as PassCompareView
}

const alta = (date: string, ticket: Money | null = usd('199')): PlannedResortDay => ({ resortId: 'alta', date, ticket })
const gp = (date: string, ticket: Money | null = usd('89')): PlannedResortDay => ({ resortId: 'greek-peak', date, ticket })

describe('compareModel', () => {
  it('says plainly when lift tickets are cheapest, and ranks every option by one total', () => {
    const v = view([alta('2027-02-20'), alta('2027-02-21')], [{ product: product('ikon'), rules: [rule('ikon', 'alta')], price: usd('1399') }])
    const m = compareModel(v)!
    expect(m.answer).toMatchObject({ tone: 'tickets', headline: 'Lift tickets are cheapest for these 2 days', amount: usd('398') })
    expect(m.options.map((o) => [o.id, o.total?.amountMinor, o.best])).toEqual([
      ['tickets', 39800, true],
      ['ikon', 139900, false],
    ])
    expect(m.options[1].line).toBe('Covers all 2 days')
    expect(m.options[1].savings).toEqual(usd('-1001'))
  })

  it('names the pass that saves money, with the saving, and builds the payoff from the days it covers', () => {
    const days = [alta('2027-02-20'), alta('2027-02-21'), alta('2027-03-06'), alta('2027-03-07'), alta('2027-03-08'), alta('2027-03-09'), alta('2027-03-10'), gp('2027-01-23')]
    const v = view(days, [
      { product: product('ikon'), rules: [rule('ikon', 'alta')], price: usd('1000') },
      { product: product('mc', 'mountain-collective'), rules: [rule('mc', 'alta', { access: 'limited-days', days: 2 })], price: usd('659') },
    ])
    const m = compareModel(v)!
    // Tickets: 7 × 199 + 89 = 1482; Ikon: 1000 + 89 = 1089 → saves 393.
    expect(m.answer).toMatchObject({ tone: 'pass', headline: 'The Ikon Pass saves you $393', amount: usd('1089') })
    expect(m.options[0]).toMatchObject({ id: 'ikon', best: true, line: 'Covers 7 of 8 days + $89 in tickets' })
    const ikon = m.payoff.find((p) => p.id === 'ikon')!
    expect(ikon).toMatchObject({ avgTicket: usd('199'), breakEvenDays: 6, coveredDays: 7 })
  })

  it('never totals a day without a ticket price: tickets show what is known, and a pass is cheapest only below that', () => {
    const v = view(
      [gp('2027-01-16', null), alta('2027-02-20'), alta('2027-02-21')],
      [
        { product: product('ikon'), rules: [rule('ikon', 'alta')], price: usd('1399') },
        { product: product('indy', 'indy'), rules: [rule('indy', 'greek-peak')], price: null },
      ],
    )
    const m = compareModel(v)!
    const tickets = m.options.find((o) => o.id === 'tickets')!
    expect(tickets).toMatchObject({ total: null, knownSoFar: usd('398'), unknownDays: 1 })
    expect(m.answer.tone).toBe('unknown')
    expect(m.answer.headline).toBe('1 day has no ticket price yet')
    // Ikon can't be totalled (the Greek Peak day it doesn't cover has no price); Indy has no published price.
    expect(m.quiet.map((q) => [q.id, q.missing])).toEqual([
      ['ikon', 'tickets'],
      ['indy', 'price'],
    ])
    expect(m.options.every((o) => !o.best)).toBe(true)
  })

  it('a pass you hold counts only what is still to pay; one that covers nothing is a quiet note', () => {
    const v = view(
      [gp('2027-01-23'), gp('2027-01-24'), alta('2027-02-20')],
      [
        { product: product('indy', 'indy'), rules: [rule('indy', 'greek-peak')], price: usd('379'), owned: { usage: [] } },
        { product: product('epic', 'epic'), rules: [], price: usd('1051'), owned: { usage: [] } },
      ],
    )
    const m = compareModel(v)!
    expect(m.answer).toMatchObject({ tone: 'owned', headline: 'Your Indy Pass covers 2 of 3 days', amount: usd('199') })
    expect(m.options[0]).toMatchObject({ id: 'indy', kind: 'owned', passPart: usd('0'), alreadyPaid: usd('379') })
    expect(m.ownedUnused).toEqual(['epic'])
    expect(m.payoff).toEqual([])
  })
})
