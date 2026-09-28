import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildFixture, NOW, TODAY, type Fixture } from './fixtures.test-helpers'
import { listResortSummaries } from './resorts'
import { getForecast, getHistoryCalendar } from './forecast'

let fx: Fixture
beforeAll(async () => {
  fx = await buildFixture()
})

describe('listResortSummaries', () => {
  it('reports unknown status as unknown, and an announced date that has passed is not "open"', async () => {
    const list = await listResortSummaries(fx.ctx, { date: TODAY })
    const quiet = list.find((r) => r.id === 'quiet-hill')!
    expect(quiet.status).toMatchObject({ status: 'unknown', basis: 'none', since: null })
    expect(quiet.opening).toMatchObject({ label: 'announced', date: '2027-01-10', text: 'Targeting Jan 10' })
    expect(quiet.opening.daysAway).toBe(-5)
    expect(quiet.dataGaps[0]).toMatch(/Operating status unavailable/)
  })

  it('applies manual corrections on read and reports rejected ones', async () => {
    const [peak] = await listResortSummaries(fx.ctx, { date: TODAY, ids: ['test-peak'] })
    expect(peak.id).toBe('test-peak')
    expect(peak.name).toBe('Test Peak (corrected)')
    expect(peak.beginner.beginnerPct).toBe(50)
    expect(peak.beginner.terrainProv).toMatchObject({ kind: 'manual', verification: 'user-confirmed', sourceUrl: 'https://example.org/map' })
    expect(peak.features?.lessons).toBe(true)
    const byField = Object.fromEntries(peak.corrections.map((c) => [c.field, c]))
    expect(byField['terrain.beginnerPct'].applied).toBe(true)
    expect(byField.id).toMatchObject({ applied: false, reason: 'Not a correctable field' })
    expect(byField['features.lessons']).toMatchObject({ applied: false, reason: 'Value has the wrong type' })
  })

  it('builds status, score, snow, weather, cost and pass facts from the latest evidence', async () => {
    const list = await listResortSummaries(fx.ctx, { date: TODAY })
    const peak = list.find((r) => r.id === 'test-peak')!
    expect(peak.status).toMatchObject({ status: 'open', basis: 'reported' })
    expect(peak.score).toMatchObject({ score: 78, scoreKind: 'conditions', mode: 'learning' })
    expect(peak.snow.report).toMatchObject({ localDate: TODAY, kind: 'official', reportedAt: '2027-01-15T12:10:00.000Z', baseDepthCm: 80 })
    // Latest ok run (C), not the newer error row; Jan 16 has 24 h × 1 cm inside the next 72 h.
    expect(peak.snow.forecast.base?.run.runId).toBe(fx.runs.c)
    expect(peak.snow.forecast.base?.next72h).toMatchObject({ sumCm: 24, complete: true })
    expect(peak.snow.forecast.summit?.next7d.complete).toBe(false)
    expect(peak.weather.base).toMatchObject({ date: TODAY, snowfallCm: 0, complete: true })
    expect(peak.expense).toMatchObject({ tier: '$', label: '$' })
    // The owned Indy pass covers lift access (1 of 2 days used): $0 lift + $45 rental + $25 lunch; parking unknown.
    expect(peak.expense.total).toEqual({ amountMinor: 7000, currency: 'USD' })
    expect(peak.expense.passCoveredBy).toBe('Indy Base Pass')
    expect(peak.expense.missing.join(' ')).toMatch(/Parking/)
    expect(peak.passes).toEqual([expect.objectContaining({ familyId: 'indy', confirmed: true })])
    expect(peak.myPass.status).toBe('covered')
    expect(peak.eventsInWindow).toEqual([])
    expect(peak.fit.score).not.toBeNull()
    expect(peak.dataGaps).toContain('No official report adapter — manual entries only')

    const far = list.find((r) => r.id === 'far-west')!
    expect(far.passes).toEqual([expect.objectContaining({ familyId: 'ikon', confirmed: false })])
    expect(far.dataGaps).toContain('Pass access unconfirmed for 2026–27')
    expect(far.status).toMatchObject({ status: 'open', lastConfirmedAt: '2027-01-15T13:00:00.000Z' })
    expect(far.weather.base).toBeNull()
    expect(far.dataGaps).toContain('Weather not fetched yet')
    expect(far.travel.verdict.mode).toBe('fly')
  })

  it('never uses personal feedback as the operations report', async () => {
    const [peak] = await listResortSummaries(fx.ctx, { date: TODAY, ids: ['test-peak'] })
    expect(peak.snow.report?.surfaceTags).toEqual(['packed-powder'])
  })
})

describe('getHistoryCalendar', () => {
  it('forecast-then uses the run fetched before the day started, never a later one', async () => {
    const cal = (await getHistoryCalendar(fx.ctx, 'test-peak', '2027-01'))!
    const jan14 = cal.days.find((d) => d.date === '2027-01-14')!
    expect(jan14.forecastThen.base?.runId).toBe(fx.runs.a)
    expect(jan14.forecastThen.base?.snowfallCm).toBe(12)
    expect(jan14.forecastThen.base?.leadHours).toBeGreaterThan(0)
    const jan15 = cal.days.find((d) => d.date === TODAY)!
    expect(jan15.forecastThen.base?.runId).toBe(fx.runs.b)
    expect(jan15.state).toBe('today')
  })

  it('shows the report as published that day, later revisions separately, and assessment-then from before the day', async () => {
    const cal = (await getHistoryCalendar(fx.ctx, 'test-peak', '2027-01'))!
    const jan14 = cal.days.find((d) => d.date === '2027-01-14')!
    expect(jan14.report?.revision).toBe(1)
    expect(jan14.revisions).toBe(2)
    expect(jan14.laterReported.map((l) => l.source)).toEqual(['later-revision', 'next-day-report'])
    expect(jan14.laterReported[1]).toMatchObject({ window: '24h', amountCm: 10 })
    expect(jan14.assessmentThen?.score).toBe(64)
  })

  it('never fabricates history before tracking started', async () => {
    const cal = (await getHistoryCalendar(fx.ctx, 'test-peak', '2027-01'))!
    expect(cal.trackingStart).toBe('2027-01-13')
    expect(cal.trackingStartBasis).toBe('first-data')
    const jan5 = cal.days.find((d) => d.date === '2027-01-05')!
    expect(jan5).toMatchObject({ state: 'before-tracking', report: null, assessmentThen: null, gap: false })
    expect(jan5.forecastThen).toEqual({ base: null, summit: null })
    expect(cal.days.find((d) => d.date === '2027-01-20')!.state).toBe('future')
  })
})

describe('getForecast', () => {
  it('returns 48 hourly values and a daily outlook with days 8–16 flagged as trend', async () => {
    const f = await getForecast(fx.ctx, ['test-peak', 'far-west'], { point: 'base' })
    const peak = f.resorts.find((r) => r.resortId === 'test-peak')!
    expect(peak.run?.runId).toBe(fx.runs.c)
    expect(peak.hourly).toHaveLength(49)
    expect(peak.hourly[0].validTime).toBe('2027-01-15T14:00:00.000Z')
    expect(peak.daily[0]).toMatchObject({ date: TODAY, dayIndex: 0, trend: false })
    expect(peak.daily.find((d) => d.dayIndex === 7)?.trend).toBe(true)
    expect(peak.daily.at(-1)!.dayIndex).toBeLessThanOrEqual(15)
    const far = f.resorts.find((r) => r.resortId === 'far-west')!
    expect(far.run).toBeNull()
    expect(far.limitations[0]).toMatch(/not fetched/)
    expect(NOW).toBe(f.now)
  })

  it('falls back to the other point with a note when the requested point has no run', async () => {
    const { db } = fx
    void db
    const f = await getForecast(fx.ctx, ['test-peak'], { point: 'summit' })
    expect(f.resorts[0].shownPoint).toBe('summit')
    expect(f.resorts[0].daily.every((d) => !d.trend)).toBe(true)
  })
})

describe('getTodayView', () => {
  it('recommends an open resort, excludes the closed one and keeps unknown status out of the winner slot', async () => {
    const { getTodayView } = await import('./today')
    const view = await getTodayView(fx.ctx, { date: TODAY, preset: 'learning' })
    const rec = view.recommendation
    expect(rec.preseason).toBe(false)
    expect(rec.winner?.resortId).toBe('test-peak')
    expect(rec.winner?.eligibility).toBe('confirmed-open')
    // expert-bowl has the best score (90) but is temporarily closed today.
    expect(rec.excluded).toEqual([expect.objectContaining({ resortId: 'expert-bowl', kind: 'closed' })])
    expect(rec.statusUnknown.map((o) => o.resortId)).toEqual(['quiet-hill'])
    expect(rec.statusUnknown[0].statusNote).toMatch(/announced opening .* is a target/)
    expect([rec.winner, ...rec.alternatives].map((o) => o?.resortId)).not.toContain('quiet-hill')
    expect(rec.alternatives.map((o) => o.resortId)).toEqual(['far-west'])
    expect(rec.evidenceLimitations.join(' | ')).toMatch(/Drive time is a curated estimate/)
    const far = rec.alternatives[0]
    expect(far.limitations.join(' | ')).toMatch(/Weather not fetched yet/)
  })

  it('assembles the watchlist, strip, opening timeline, deadlines and changes', async () => {
    const { getTodayView } = await import('./today')
    const view = await getTodayView(fx.ctx, { range: { from: TODAY, to: '2027-01-17' }, preset: 'best-snow' })
    expect(view.dates).toEqual([TODAY, '2027-01-16', '2027-01-17'])
    expect(view.strip).toHaveLength(7)
    expect(view.strip.filter((d) => d.selected).map((d) => d.date)).toEqual(view.dates)
    // Favourites are only seeded for greek-peak/alta, which the fixture does not have → strip follows the winner.
    expect(view.stripBasis).toBe('winner')
    expect(view.strip[1].cells[0]).toMatchObject({ resortId: 'test-peak', snowfallCm: { base: 24 } })
    expect(view.openingTimeline[0]).toMatchObject({ resortId: 'quiet-hill', label: 'announced' })
    expect(view.passDeadlines).toEqual([expect.objectContaining({ productId: 'indy-base-2026-27', daysLeft: 26, owned: true })])
    expect(view.recentChanges.some((c) => c.kind === 'status' && c.resortId === 'expert-bowl')).toBe(true)
    expect(view.newSnowWatch.items.map((i) => i.resortId)).toEqual(['test-peak'])
    expect(view.newSnowWatch.items[0].text).toMatch(/^Likely/)
  })
})
