import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { eq } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import { buildFixture, NOW, type Fixture } from './fixtures.test-helpers'
import { getSeasonView } from './season'

let fx: Fixture
beforeAll(async () => {
  fx = await buildFixture()
  const { db, ownershipId } = fx
  // The Indy purchase, bought in the spring sale (dated in the previous season) and linked to the pass.
  await db.insert(s.expenses).values([
    { date: '2026-04-01', category: 'pass', label: 'Indy Base Pass purchase', amountMinor: 29900, currency: 'USD', passOwnershipId: ownershipId, createdAt: NOW },
    // A lift ticket logged on the pass day: real cash, kept, with a warning.
    { date: '2027-01-02', category: 'lift', label: 'Lift ticket', amountMinor: 6000, currency: 'USD', createdAt: NOW },
    { date: '2027-01-09', category: 'food', label: 'Lunch', amountMinor: 1800, currency: 'USD', createdAt: NOW },
  ])
  const skills = await db.select().from(s.skillChecklist)
  const stop = skills.find((k) => k.label.startsWith('Controlled stopping'))!
  await db.update(s.skillChecklist).set({ status: 'practicing' }).where(eq(s.skillChecklist.id, stop.id))
  await db.insert(s.skiDayLogs).values([
    { date: '2027-01-02', resortId: 'test-peak', rating: 4, surfaceFeedback: ['packed-powder'], skillsPracticed: [stop.id], hoursSkied: 3, crowdGuess: 'quiet', createdAt: NOW },
    { date: '2027-01-09', resortId: 'expert-bowl', rating: 2, surfaceFeedback: [], skillsPracticed: [stop.id], hoursSkied: null, spendMinor: 4500, currency: 'USD', createdAt: NOW },
    { date: '2026-03-01', resortId: 'test-peak', rating: 5, surfaceFeedback: [], skillsPracticed: [], createdAt: NOW }, // last season
  ])
  await db.insert(s.trips).values({ id: 'feb', name: 'February', status: 'draft', startDate: '2027-02-06', endDate: '2027-02-07', partySize: 2, companions: [], createdAt: NOW, updatedAt: NOW })
  await db.insert(s.tripItems).values([
    { tripId: 'feb', type: 'lodging', title: 'Motel', date: '2027-02-06', status: 'booked', costMinor: 20000, currency: 'USD', costBasis: 'shared', details: {}, createdAt: NOW },
    // A planned lift ticket on a day my Indy (1 day left) covers: flagged, not silently dropped.
    { tripId: 'feb', type: 'lift-ticket', refId: 'test-peak', title: 'Saturday ticket', date: '2027-02-06', status: 'draft', costMinor: 8000, currency: 'USD', details: {}, createdAt: NOW },
    { tripId: 'feb', type: 'lesson', title: 'Group lesson', date: '2027-02-07', status: 'draft', costMinor: null, currency: null, details: {}, createdAt: NOW },
    { tripId: 'feb', type: 'food', title: 'Fondue night', date: '2027-02-07', status: 'idea', costMinor: 9000, currency: 'USD', details: {}, createdAt: NOW },
  ])
  await db.insert(s.lessons).values([
    { resortId: 'test-peak', date: '2027-01-02', kind: 'group', focusSkills: [stop.id], costMinor: 7900, currency: 'USD', costKind: 'actual', createdAt: NOW },
    { resortId: 'test-peak', date: '2027-02-07', kind: 'private', focusSkills: [], costMinor: null, currency: null, createdAt: NOW },
  ])
})

describe('getSeasonView', () => {
  it('counts the pass once — the linked purchase — and never as daily lift cash', async () => {
    const v = await getSeasonView(fx.ctx)
    const cat = (c: string) => v.budget.categories.find((x) => x.category === c)!
    expect(cat('pass').actual).toEqual({ amountMinor: 29900, currency: 'USD' })
    expect(cat('pass').planned).toEqual({ amountMinor: 29900, currency: 'USD' })
    expect(cat('lift').actual).toEqual({ amountMinor: 6000, currency: 'USD' })
    expect(v.budget.actualTotal).toEqual({ amountMinor: 29900 + 6000 + 1800, currency: 'USD' })
    expect(v.budget.warnings.join(' | ')).toMatch(/Lift expense "Lift ticket" on 2027-01-02, a logged pass day/)
    const indy = v.budget.passes[0]
    // 2027-01-02 is a Saturday: the pass day is valued at that day's own weekend ticket.
    expect(indy).toMatchObject({ costSource: 'linked-expenses', daysUsed: 1, cost: { amountMinor: 29900 }, ticketValue: { amountMinor: 8000 } })
    expect(v.passes[0]).toMatchObject({ holder: 'me', daysUsed: 1, value: { costSource: 'linked-expenses' } })
    expect(v.passes[0].byResort[0]).toMatchObject({ resortId: 'test-peak', remaining: 1 })
  })

  it('plans my share of priced trip items, flags a lift ticket on a pass day, and leaves ideas out', async () => {
    const v = await getSeasonView(fx.ctx)
    const cat = (c: string) => v.budget.categories.find((x) => x.category === c)!
    expect(cat('lodging').planned).toEqual({ amountMinor: 10000, currency: 'USD' }) // shared motel ÷ 2
    expect(cat('lift').planned).toEqual({ amountMinor: 8000, currency: 'USD' }) // kept: only an explicit pass link drops it
    expect(cat('food').planned).toEqual({ amountMinor: 0, currency: 'USD' }) // the fondue idea is not a plan
    const notes = v.budgetNotes.join(' | ')
    expect(notes).toMatch(/1 trip idea is not counted/)
    expect(notes).toMatch(/1 planned trip item has no cost yet/)
    // Resort names carry manual corrections (test-peak was renamed in the fixture).
    expect(notes).toMatch(/"Saturday ticket" \(2027-02-06, Test Peak \(corrected\)\) is a planned lift ticket on a day your Indy Base Pass covers/)
    expect(notes).toMatch(/Spend noted on ski-day logs \(\$45\) is not added to the budget/)
  })

  it('lists this season’s ski days, destinations, skills and lessons — nothing from last season', async () => {
    const v = await getSeasonView(fx.ctx)
    expect(v.season).toEqual({ id: '2026-27', label: '2026–27' })
    expect(v.skiDays.map((d) => [d.date, d.resortId])).toEqual([
      ['2027-01-09', 'expert-bowl'],
      ['2027-01-02', 'test-peak'],
    ])
    expect(v.skiDays[1]).toMatchObject({ passDay: { ownershipId: fx.ownershipId, productName: 'Indy Base Pass' }, crowdGuess: 'quiet', skillsPracticed: [expect.objectContaining({ label: expect.stringMatching(/^Controlled stopping/) })] })
    expect(v.skiDays[0]).toMatchObject({ passDay: null, spend: { amountMinor: 4500, currency: 'USD' } })
    // The pass day and the logged day on 2 Jan are the same ski day.
    expect(v.totals).toMatchObject({ skiDays: 2, loggedDays: 2, resorts: 2, hoursSkied: 3, daysWithHours: 1, dayLogSpend: [{ amountMinor: 4500, currency: 'USD' }] })
    expect(v.budget.skiDays).toBe(2)
    // Most days first; ties by the most recent visit.
    expect(v.destinations.map((d) => [d.resortId, d.days, d.passDays, d.avgDayRating])).toEqual([
      ['expert-bowl', 1, 0, 2],
      ['test-peak', 1, 1, 4],
    ])
    const practicing = v.skills.groups.find((g) => g.status === 'practicing')!
    expect(practicing.skills).toEqual([expect.objectContaining({ statusLabel: 'Practising', practicedDays: 2, lastPracticed: '2027-01-09', lessons: 1 })])
    expect(v.skills.note).toMatch(/never infers ability from spending or distance/)
    expect(v.lessons.past.map((l) => l.date)).toEqual(['2027-01-02'])
    expect(v.lessons.upcoming).toEqual([expect.objectContaining({ date: '2027-02-07', cost: null })])
  })
})
