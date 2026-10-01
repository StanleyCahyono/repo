/**
 * A worldwide catalog: Southern Hemisphere seasons on resort pages and summaries, and Today's short-range answers
 * (long-haul resorts left out; openings and preseason judged in the home hemisphere).
 */
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import { applyStatusToSeason, recordStatus } from '@/lib/jobs/status'
import { bundleSeasonIds, loadBundle, resortSeasonId, winterUnderway } from './core'
import { buildFixture, fixtureResort, NOW, TODAY } from './fixtures.test-helpers'
import { getResortDetail } from './resort-detail'
import { listResortSummaries } from './resorts'
import { getRecommendation, getTodayView } from './today'

const official = (at: string) => provenance({ kind: 'official', provider: 'example.org', sourceUrl: 'https://example.org/report', publishedAt: at, fetchedAt: at, verification: 'official-page' })

/** An Australian resort: winter 2026 (season 2025-26) opened 6 Jun; the catalog describes the 2027 winter (2026-27). */
const southPeak = fixtureResort('south-peak', {
  country: 'AU',
  region: 'New South Wales',
  timezone: 'Australia/Sydney',
  priority: 0,
  location: { lat: -36.5, lon: 148.3 },
  weatherPoints: [{ key: 'base', label: 'Base', lat: -36.5, lon: 148.3, elevationM: 1365 }],
  season: { season: '2026-27', announcedOpening: {}, announcedClosing: {}, history: [{ season: '2025-26', opened: '2026-06-06', closed: null }] },
  hours: [],
  prices: [],
  travel: { driveFromIthaca: null, airports: [] },
})

/** An Alpine resort: Northern Hemisphere, but a long flight from Ithaca. */
const alpFar = fixtureResort('alp-far', {
  country: 'AT',
  region: 'Tyrol',
  timezone: 'Europe/Vienna',
  priority: 0,
  location: { lat: 47.13, lon: 10.26 },
  weatherPoints: [{ key: 'base', label: 'Base', lat: 47.13, lon: 10.26, elevationM: 1300 }],
  season: { season: '2026-27', announcedOpening: { date: '2026-12-03', source: { url: 'https://example.org/alp' } }, announcedClosing: {}, history: [] },
  travel: { driveFromIthaca: null, airports: [] },
})

const SEPT_NOW = '2026-09-30T02:00:00.000Z' // 12:00 in Sydney, 22:00 (29 Sep) in Ithaca
const sept = (ctx: Awaited<ReturnType<typeof buildFixture>>['ctx']) => ({ ...ctx, now: SEPT_NOW, today: '2026-09-29' })

describe('Southern Hemisphere seasons on the resort page', () => {
  it('loads both hemispheres’ season rows for a date', () => {
    expect(bundleSeasonIds('2026-27', ['2026-27'], '2026-09-29').sort()).toEqual(['2024-25', '2025-26', '2026-27'])
  })

  it('shows the winter under way while it is open, then the next one', async () => {
    const fx = await buildFixture({ extraResorts: [southPeak] })
    // The 2026 winter is reported open: filed under 2025-26 (the season row is created on the way).
    await recordStatus(fx.db, { resortId: 'south-peak', status: 'open', localDate: '2026-09-28', effectiveAt: '2026-09-27T22:00:00.000Z', prov: official('2026-09-27T22:00:00.000Z') })
    await applyStatusToSeason(fx.db, { resortId: 'south-peak', status: 'open', localDate: '2026-06-06', prov: official('2026-06-05T22:00:00.000Z'), now: SEPT_NOW })
    const rows = await fx.db.select().from(s.resortSeasons).where(eq(s.resortSeasons.resortId, 'south-peak'))
    expect(rows.map((r) => [r.seasonId, r.actualOpening]).sort()).toEqual([
      ['2025-26', '2026-06-06'],
      ['2026-27', null],
    ])

    const ctx = sept(fx.ctx)
    const [sum] = await listResortSummaries(ctx, { ids: ['south-peak'] })
    expect(sum.status.status).toBe('open')
    expect(sum.opening).toMatchObject({ seasonId: '2025-26', label: 'opened', date: '2026-06-06' })
    expect(sum.closure).toBeNull()
    const detail = await getResortDetail(ctx, 'south-peak')
    expect(detail?.season).toMatchObject({ seasonId: '2025-26', label: '2025–26', hemisphere: 'south' })
    expect(detail?.season.current?.actualOpening).toBe('2026-06-06')
    expect(detail?.season.others.map((r) => r.seasonId)).toEqual(['2026-27'])
    // Northern resorts keep the planning season.
    const [peak] = await listResortSummaries(ctx, { ids: ['test-peak'] })
    expect(peak.opening.seasonId).toBe('2026-27')

    // Closed for the season on 5 Oct: the page moves on to the 2027 winter (a Piste estimate from past openings).
    await recordStatus(fx.db, { resortId: 'south-peak', status: 'closed-for-season', localDate: '2026-10-05', effectiveAt: '2026-10-05T06:00:00.000Z', prov: official('2026-10-05T06:00:00.000Z') })
    await applyStatusToSeason(fx.db, { resortId: 'south-peak', status: 'closed-for-season', localDate: '2026-10-05', prov: official('2026-10-05T06:00:00.000Z'), now: '2026-10-10T02:00:00.000Z' })
    const later = { ...fx.ctx, now: '2026-10-10T02:00:00.000Z', today: '2026-10-09' }
    const [closed] = await listResortSummaries(later, { ids: ['south-peak'] })
    expect(closed.status.status).toBe('closed-for-season')
    expect(closed.opening).toMatchObject({ seasonId: '2026-27', label: 'estimated', date: '2027-05-30', to: '2027-06-13' })
    expect(closed.closure?.kind).toBe('season-ended')
    expect((await getResortDetail(later, 'south-peak'))?.season.seasonId).toBe('2026-27')
  })

  it('never reads a winter as under way without evidence, nor from a months-old "open"', async () => {
    const r = { lat: -36.5 }
    expect(winterUnderway(r, '2025-26', null, null, '2026-09-29')).toBe(false)
    expect(winterUnderway(r, '2025-26', { actualOpening: '2026-06-06', actualClosing: null }, null, '2026-09-29')).toBe(true)
    expect(winterUnderway(r, '2025-26', { actualOpening: '2026-06-06', actualClosing: '2026-09-21' }, null, '2026-09-29')).toBe(false)
    // An "open" from September is not evidence in December, after the southern winter months.
    const sepOpen = { status: 'open' as const, localDate: '2026-09-20' }
    expect(winterUnderway(r, '2025-26', null, sepOpen, '2026-09-29')).toBe(true)
    expect(winterUnderway(r, '2025-26', null, sepOpen, '2026-12-15')).toBe(false)
    // A closed-for-season statement in the season ends it.
    expect(winterUnderway(r, '2025-26', { actualOpening: '2026-06-06', actualClosing: null }, { status: 'closed-for-season', localDate: '2026-09-21' }, '2026-09-29')).toBe(false)

    // Without any statement or row for the 2026 winter, the page shows the planning season (the 2027 winter).
    const fx = await buildFixture({ extraResorts: [southPeak] })
    const b = await loadBundle(sept(fx.ctx), { ids: ['south-peak'] })
    expect(resortSeasonId(b, b.byId.get('south-peak')!.row, '2026-09-30')).toBe('2026-27')

    // An open statement alone (no actual opening on record) shows the winter under way as opened, date unknown.
    await recordStatus(fx.db, { resortId: 'south-peak', status: 'open', localDate: '2026-09-26', effectiveAt: '2026-09-26T02:00:00.000Z', prov: official('2026-09-26T02:00:00.000Z') })
    const [sum] = await listResortSummaries(sept(fx.ctx), { ids: ['south-peak'] })
    expect(sum.opening).toMatchObject({ seasonId: '2025-26', label: 'opened', date: null, daysAway: null })
    expect(sum.opening.prov?.provider).toBe('example.org')
  })
})

describe('Today with a worldwide catalog', () => {
  it('leaves long-haul resorts out of the ranking and the strip, but keeps favourites in the watchlist', async () => {
    const fx = await buildFixture({ extraResorts: [southPeak, alpFar] })
    // alp-far is open with the best score of all, and a favourite.
    await fx.db.update(s.resortSeasons).set({ actualOpening: '2026-12-03' }).where(eq(s.resortSeasons.resortId, 'alp-far'))
    await fx.db.insert(s.statusEvents).values({ resortId: 'alp-far', status: 'open', effectiveAt: '2027-01-15T07:00:00.000Z', localDate: TODAY, prov: official('2027-01-15T07:00:00.000Z') })
    await fx.db.insert(s.favorites).values([
      { resortId: 'alp-far', addedAt: NOW, sortOrder: 0 },
      { resortId: 'test-peak', addedAt: NOW, sortOrder: 1 },
    ])

    const view = await getTodayView(fx.ctx, { date: TODAY, preset: 'learning' })
    const rec = view.recommendation
    const ranked = [...rec.ranked, ...rec.statusUnknown, ...rec.excluded].map((o) => o.resortId)
    expect(ranked).not.toContain('alp-far')
    expect(ranked).not.toContain('south-peak')
    expect(rec.longHaulExcluded).toBe(2)
    expect(rec.winner?.resortId).toBe('test-peak')
    // Favourites: every one, however far away.
    expect(view.watchlist.map((w) => w.summary.id)).toEqual(['alp-far', 'test-peak'])
    // The strip shows only the near favourite, and names the long-haul one.
    expect(view.stripBasis).toBe('favourites')
    expect(view.strip[0].cells.map((c) => c.resortId)).toEqual(['test-peak'])
    expect(view.stripLongHaul).toEqual([{ resortId: 'alp-far', name: 'alp-far' }])
    // Openings: home hemisphere only (the Alps, not Australia).
    const openings = view.openingTimeline.map((o) => o.resortId)
    expect(openings).toContain('alp-far')
    expect(openings).not.toContain('south-peak')

    // The weekend finder uses the same rule.
    const finder = await getRecommendation(fx.ctx, { range: { from: '2027-01-16', to: '2027-01-17' }, preset: 'custom' })
    expect([...finder.ranked, ...finder.statusUnknown, ...finder.excluded].map((o) => o.resortId)).not.toContain('alp-far')
    expect(finder.longHaulExcluded).toBe(2)
  })

  it('judges preseason in the home hemisphere: a southern winter does not end a northern preseason', async () => {
    const fx = await buildFixture({ extraResorts: [southPeak] })
    await recordStatus(fx.db, { resortId: 'south-peak', status: 'open', localDate: '2026-09-28', effectiveAt: '2026-09-27T22:00:00.000Z', prov: official('2026-09-27T22:00:00.000Z') })
    await applyStatusToSeason(fx.db, { resortId: 'south-peak', status: 'open', localDate: '2026-06-06', prov: official('2026-06-05T22:00:00.000Z'), now: SEPT_NOW })

    // Home in Ithaca, late September: nothing near home has opened → preseason; the open Australian resort is a trip.
    const north = await getTodayView(sept(fx.ctx), { preset: 'learning' })
    expect(north.preseason).toBe(true)
    expect(north.recommendation.longHaulExcluded).toBe(1)
    expect(north.openingTimeline.map((o) => o.resortId)).not.toContain('south-peak')

    // Home in Sydney: the southern winter is in season, the New York resorts are the long-haul ones.
    const sydney = { ...fx.ctx.prefs, homeName: 'Sydney', homeLat: -33.87, homeLon: 151.21, homeTimezone: 'Australia/Sydney' }
    const south = await getTodayView({ ...sept(fx.ctx), prefs: sydney, today: '2026-09-30' }, { preset: 'learning' })
    expect(south.preseason).toBe(false)
    expect(south.recommendation.longHaulExcluded).toBe(4)
    expect([...south.recommendation.ranked, ...south.recommendation.statusUnknown].map((o) => o.resortId)).toEqual(['south-peak'])
    expect(south.openingTimeline.map((o) => o.resortId)).toEqual(['south-peak'])
  })
})
