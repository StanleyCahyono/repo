import { beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import { buildFixture, fixtureResort, insertRun, NOW, TODAY, type Fixture } from './fixtures.test-helpers'
import { listResortSummaries } from './resorts'
import { getForecast, getHistoryCalendar } from './forecast'
import { getRecommendation, getTodayView } from './today'

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
    expect(peak.passes).toEqual([expect.objectContaining({ familyId: 'indy', accessTypes: ['limited-days'], qualifiedOnly: false })])
    expect(peak.myPass.status).toBe('covered')
    expect(peak.eventsInWindow).toEqual([])
    expect(peak.fit.score).not.toBeNull()
    expect(peak.dataGaps).toContain('No official report adapter — manual entries only')

    const far = list.find((r) => r.id === 'far-west')!
    // Ikon's rule at far-west is recorded as 'unknown': not shown, so no badge and no "not confirmed" gap.
    expect(far.passes).toEqual([])
    expect(far.dataGaps).toContain('No pass access recorded for 2026–27')
    expect(far.dataGaps.join(' ')).not.toMatch(/unconfirmed|not confirmed|confirm at source/i)
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

  it('shows the requested point when it has a run (7-day summit run: no trend days)', async () => {
    const f = await getForecast(fx.ctx, ['test-peak'], { point: 'summit' })
    expect(f.resorts[0]).toMatchObject({ shownPoint: 'summit', fallbackFrom: null })
    expect(f.resorts[0].daily.every((d) => !d.trend)).toBe(true)
  })

  it('falls back to the other point with a note when the requested point has no run', async () => {
    const own = await buildFixture()
    // expert-bowl gets a base run only; asking for the summit must fall back to the base, and say so.
    const base = await insertRun(own.db, { resortId: 'expert-bowl', pointKey: 'base', fetchedAt: '2027-01-15T12:00:00.000Z', from: '2027-01-15T05:00:00.000Z', hours: 72 })
    const f = await getForecast(own.ctx, ['expert-bowl'], { point: 'summit' })
    const bowl = f.resorts[0]
    expect(bowl).toMatchObject({ point: 'summit', shownPoint: 'base', fallbackFrom: 'summit' })
    expect(bowl.run?.runId).toBe(base)
    expect(bowl.runs).toMatchObject({ base: { runId: base }, summit: null })
    expect(bowl.limitations).toContain('No summit forecast stored — showing the base point')
    expect(bowl.hourly.length).toBeGreaterThan(0)
  })
})

describe('getTodayView', () => {
  it('recommends an open resort, excludes the closed one and keeps unknown status out of the winner slot', async () => {
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

describe('confirmed closures supersede the ski-day score', () => {
  it('shows Closed (no score) for a resort temporarily closed on the date, keeping the model value aside', async () => {
    const [bowl] = await listResortSummaries(fx.ctx, { date: TODAY, ids: ['expert-bowl'] })
    expect(bowl.closure).toMatchObject({ kind: 'temporarily-closed', reason: 'Temporarily closed on Fri 15 Jan (reported)', statedAt: '2027-01-15T11:00:00.000Z' })
    expect(bowl.score).toMatchObject({ score: null, descriptor: null, scoreKind: 'closed' })
    expect(bowl.score?.supersededByClosure).toMatchObject({ kind: 'temporarily-closed', modelScore: 90, modelScoreKind: 'conditions', modelDescriptor: 'Good' })
    expect(bowl.dataGaps[0]).toMatch(/^Temporarily closed on Fri 15 Jan \(reported\) — no ski-day score/)
    // A temporary closure applies to its own date only.
    const [sat] = await listResortSummaries(fx.ctx, { date: '2027-01-16', ids: ['expert-bowl'] })
    expect(sat.closure).toBeNull()
    // An open resort keeps its score.
    const [peak] = await listResortSummaries(fx.ctx, { date: TODAY, ids: ['test-peak'] })
    expect(peak.closure).toBeNull()
    expect(peak.score).toMatchObject({ score: 78, scoreKind: 'conditions', supersededByClosure: null })
  })

  it('applies the same rule to the Today strip, and reports partial model coverage honestly', async () => {
    const own = await buildFixture()
    await own.db.insert(s.favorites).values({ resortId: 'expert-bowl', addedAt: NOW, sortOrder: 0 })
    // 60 hours of base weather from local midnight: Fri and Sat complete, Sun half covered, then nothing.
    await insertRun(own.db, { resortId: 'expert-bowl', pointKey: 'base', fetchedAt: '2027-01-15T12:00:00.000Z', from: '2027-01-15T05:00:00.000Z', hours: 60, snow: () => 1 })
    const view = await getTodayView(own.ctx, { date: TODAY, preset: 'learning' })
    expect(view.stripBasis).toBe('favourites')
    const cell = (date: string) => view.strip.find((d) => d.date === date)!.cells.find((c) => c.resortId === 'expert-bowl')!
    expect(cell(TODAY)).toMatchObject({ closed: { kind: 'temporarily-closed' }, score: null, scoreKind: 'closed', descriptor: null })
    expect(cell('2027-01-16').closed).toBeNull()
    expect(cell(TODAY)).toMatchObject({ partial: false, coverage: { base: 1, summit: null } })
    expect(cell('2027-01-17')).toMatchObject({ partial: true, coverage: { base: 0.5 }, snowfallCm: { base: 12 } })
    expect(cell('2027-01-19')).toMatchObject({ partial: false, coverage: { base: null }, snowfallCm: { base: null } })
    // New snow watch: 51 of the next 72 hours are covered → "at least", never a full total.
    const watch = view.newSnowWatch.items.find((i) => i.resortId === 'expert-bowl')!
    expect(watch).toMatchObject({ complete: false, hoursCovered: 51, next72hCm: 51 })
    expect(watch.text).toMatch(/^Likely at least .* \(weather model; the forecast covers 51 of 72 h\)$/)
    const peak = view.newSnowWatch.items.find((i) => i.resortId === 'test-peak')!
    expect(peak.complete).toBe(true)
    expect(peak.text).not.toMatch(/at least/)
  })
})

describe('report age without a publish time', () => {
  it('runs from resort-local midnight, not UTC midnight', async () => {
    const own = await buildFixture()
    await own.db.insert(s.operationalReports).values({
      resortId: 'far-west',
      localDate: TODAY,
      revision: 2,
      kind: 'manual',
      reportedAt: null,
      fetchedAt: null,
      status: 'open',
      snowfall: [],
      surfaceTags: [],
      contentHash: 'far-west-2',
      prov: provenance({ kind: 'manual', provider: 'You', sourceUrl: 'https://example.org/report', note: 'transcribed' }),
      createdAt: NOW,
    })
    const [far] = await listResortSummaries(own.ctx, { date: TODAY, ids: ['far-west'] })
    // Denver midnight is 07:00Z; NOW is 14:00Z → 7 h (UTC midnight would claim 14 h).
    expect(far.snow.report).toMatchObject({ revision: 2, reportedAt: null, ageHours: 7, ageBasis: 'local-day-start' })
    const [peak] = await listResortSummaries(own.ctx, { date: TODAY, ids: ['test-peak'] })
    expect(peak.snow.report).toMatchObject({ ageBasis: 'published', ageHours: 1.8 })
  })
})

describe("each resort's own local today", () => {
  it('uses the current-day report of a resort east of home during the home evening', async () => {
    const alp = fixtureResort('alp-east', {
      timezone: 'Europe/Vienna',
      country: 'AT',
      region: 'Tyrol',
      priority: 0,
      travel: { driveFromIthaca: null, airports: [{ iata: 'INN', role: 'practical', minutes: 60, km: 60, basis: 'estimate' }] },
    })
    const own = await buildFixture({ extraResorts: [alp] })
    await own.db.update(s.resortSeasons).set({ actualOpening: '2026-12-05' }).where(eqSeason('alp-east'))
    // 21:00 in Ithaca on Fri 15 Jan = 03:00 on Sat 16 Jan in Vienna. The Vienna report for Sat is already out.
    const now = '2027-01-16T02:00:00.000Z'
    await own.db.insert(s.operationalReports).values({
      resortId: 'alp-east',
      localDate: '2027-01-16',
      revision: 1,
      kind: 'official',
      reportedAt: '2027-01-16T01:30:00.000Z',
      fetchedAt: '2027-01-16T01:35:00.000Z',
      status: 'open',
      snowfall: [],
      surfaceTags: [],
      contentHash: 'alp-east-1',
      prov: provenance({ kind: 'official', provider: 'example.at', verification: 'official-page' }),
      createdAt: '2027-01-16T01:35:00.000Z',
    })
    const rec = await getRecommendation({ ...own.ctx, now, today: TODAY }, { date: '2027-01-16', preset: 'learning' })
    const option = [...rec.ranked, ...rec.statusUnknown].find((o) => o.resortId === 'alp-east')!
    expect(option.eligibility).toBe('confirmed-open')
    expect(option.statusNote).toBe('Reported open for Sat 16 Jan')
  })
})

describe('history tracking start', () => {
  it('ignores personal feedback and anything published after now', async () => {
    const own = await buildFixture()
    const base = { resortId: 'quiet-hill', revision: 1, fetchedAt: null, status: null, snowfall: [], surfaceTags: [] as never[] }
    await own.db.insert(s.operationalReports).values([
      { ...base, localDate: '2027-01-03', kind: 'manual', reportedAt: null, contentHash: 'q1', prov: provenance({ kind: 'manual', provider: 'You', note: 'personal' }), createdAt: '2027-01-03T20:00:00.000Z' },
      { ...base, localDate: '2027-01-04', kind: 'official', reportedAt: '2027-01-20T12:00:00.000Z', contentHash: 'q2', prov: provenance({ kind: 'official', provider: 'x' }), createdAt: '2027-01-20T12:00:00.000Z' },
    ])
    const cal = (await getHistoryCalendar(own.ctx, 'quiet-hill', '2027-01'))!
    expect(cal).toMatchObject({ trackingStart: null, trackingStartBasis: 'none' })
    expect(cal.days.find((d) => d.date === '2027-01-04')!.report).toBeNull()
  })
})

describe('second-line demo filters', () => {
  it('keeps demo events and demo alerts out of live summaries (but shows them in demo mode)', async () => {
    const own = await buildFixture()
    await own.db.insert(s.events).values({
      id: 'demo-party',
      resortId: 'test-peak',
      title: 'Demo torchlight parade',
      category: 'festival',
      startLocal: '2027-01-16T18:00',
      timezone: 'America/New_York',
      status: 'announced',
      dedupeKey: 'demo-party',
      origin: 'feed',
      prov: provenance({ kind: 'demo', provider: 'Piste demo' }),
    })
    await own.db.insert(s.weatherAlerts).values({ id: 'demo-1', resortId: 'test-peak', provider: 'demo', event: 'Demo Winter Storm Warning', fetchedAt: NOW })
    const [live] = await listResortSummaries(own.ctx, { date: TODAY, ids: ['test-peak'] })
    expect(live.eventsInWindow).toEqual([])
    expect(live.officialAlerts).toEqual([])
    const [demo] = await listResortSummaries({ ...own.ctx, mode: 'demo' }, { date: TODAY, ids: ['test-peak'] })
    expect(demo.eventsInWindow.map((e) => e.id)).toEqual(['demo-party'])
    expect(demo.officialAlerts.map((a) => a.id)).toEqual(['demo-1'])
  })
})

function eqSeason(resortId: string) {
  return sql`${s.resortSeasons.resortId} = ${resortId}`
}
