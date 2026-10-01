/**
 * The Glass HUD forecast surfaces, in both states:
 * - pure geometry/total helpers (unknown values break lines and lower-bound totals — never read as 0);
 * - FILLED: real fixture weather rows → getForecastScreen → server-rendered strip, hero, 48 hours and calendar;
 * - EMPTY: no stored run → "Not fetched yet" with no invented numbers.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as s from '@/lib/db/schema'
import { buildFixture, TODAY, type Fixture } from '@/lib/data/fixtures.test-helpers'
import { getForecastScreen, seasonMarkers, type ForecastScreen } from '@/lib/data/forecast-screen'
import { ForecastHero } from './hero'
import { HistoryCalendarView } from './history'
import { HoursGlance } from './hours-glance'
import { monthCells, outlookTotal, seriesGeometry, tempGeometry } from './model'
import { OutlookStrip } from './outlook-strip'
import { SeasonCard } from './season-card'

describe('glass chart helpers', () => {
  it('sums modeled snow as a lower bound when a day is partial or unknown, and null when nothing is known', () => {
    const id = (v: number | null) => v
    expect(outlookTotal([{ snowfallCm: 2, partial: false }, { snowfallCm: 3, partial: false }], id)).toEqual({ total: 5, atLeast: false, days: 2 })
    expect(outlookTotal([{ snowfallCm: 2, partial: true }, { snowfallCm: null, partial: false }], id)).toMatchObject({ total: 2, atLeast: true })
    expect(outlookTotal([{ snowfallCm: null, partial: false }], id)).toBeNull()
  })

  it('breaks temperature lines at unknown values and only bands where both are known', () => {
    const g = tempGeometry([1, null, 3, 4], [-2, -1, null, 0], { w: 1000, top: 0, bottom: 100, freezing: 0 })!
    expect(g.hi.match(/M/g)?.length).toBe(2)
    expect(g.lo.match(/M/g)?.length).toBe(2)
    // Pairs known at 0 only, then 3 only → no band segment of length ≥ 2.
    expect(g.band).toBe('')
    expect(g.zeroY).not.toBeNull()
    expect(tempGeometry([null], [null], { w: 1, top: 0, bottom: 1, freezing: 0 })).toBeNull()
  })

  it('splits an hourly series at gaps', () => {
    const g = seriesGeometry([1, 2, null, 3, 4], { w: 100, top: 0, bottom: 50 })!
    expect(g.line.match(/M/g)?.length).toBe(2)
    expect(g.area.match(/Z/g)?.length).toBe(2)
  })

  it('lays a month out Monday-first in whole weeks', () => {
    const cells = monthCells('2026-11') // 1 Nov 2026 is a Sunday
    expect(cells.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01'])
    expect(cells.length % 7).toBe(0)
    expect(cells.filter(Boolean)).toHaveLength(30)
  })
})

describe('season markers', () => {
  const row = (over: Partial<typeof s.resortSeasons.$inferSelect>) =>
    ({
      id: 1,
      resortId: 'x',
      seasonId: '2026-27',
      announcedOpening: null,
      announcedOpeningText: null,
      announcedOpeningOn: null,
      announcedOpeningProv: null,
      estimatedOpenFrom: null,
      estimatedOpenTo: null,
      estimateBasis: null,
      actualOpening: null,
      actualOpeningProv: null,
      announcedClosing: null,
      announcedClosingText: null,
      announcedClosingProv: null,
      actualClosing: null,
      actualClosingProv: null,
      typicalOpeningText: null,
      notes: null,
      lastCheckedAt: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
      ...over,
    }) as typeof s.resortSeasons.$inferSelect

  it('never turns a passed announced opening into "Opened"', () => {
    const [m] = seasonMarkers([row({ announcedOpening: '2026-11-20' })], '2026-12-01')
    expect(m).toMatchObject({ basis: 'announced', label: 'Announced opening' })
    expect(seasonMarkers([row({ announcedOpening: '2026-11-20' })], '2026-10-01')[0].label).toBe('Opens')
    expect(seasonMarkers([row({ announcedOpening: '2026-11-20', actualOpening: '2026-11-22' })], '2026-12-01')[0]).toMatchObject({ basis: 'actual', label: 'Opened', date: '2026-11-22' })
  })

  it('labels a Piste estimate as an estimate, with its window', () => {
    const [m] = seasonMarkers([row({ estimatedOpenFrom: '2026-11-28', estimatedOpenTo: '2026-12-05', estimateBasis: 'Typical opening.' })], '2026-10-01')
    expect(m).toMatchObject({ basis: 'estimate', label: 'Est. opening', date: '2026-11-28', to: '2026-12-05' })
    expect(m.detail).toMatch(/Piste estimate/)
    expect(m.detail).toMatch(/Not announced/)
  })
})

describe('forecast surfaces with stored weather (fixture rows)', () => {
  let fx: Fixture
  let screen: ForecastScreen
  beforeAll(async () => {
    fx = await buildFixture()
    screen = await getForecastScreen(fx.ctx, { resorts: ['test-peak', 'far-west'], focus: 'test-peak', point: 'base', date: null, month: null, mode: null })
  })

  it('feeds the focus resort run and its season markers into the screen', () => {
    const f = screen.forecast.resorts.find((r) => r.resortId === 'test-peak')!
    expect(f.run).not.toBeNull()
    expect(f.daily.length).toBeGreaterThan(7)
    expect(f.daily.find((d) => d.date === '2027-01-16')?.snowfallCm).toBeGreaterThan(0)
    expect(screen.seasonMarkers).toContainEqual(expect.objectContaining({ basis: 'actual', label: 'Opened', date: '2026-11-28' }))
  })

  it('renders the strip with modeled bars, the fetch time and the table toggle — no "Not fetched"', () => {
    const f = screen.forecast.resorts.find((r) => r.resortId === 'test-peak')!
    const html = renderToStaticMarkup(
      createElement(OutlookStrip, {
        forecast: f,
        info: screen.resorts['test-peak'],
        point: 'base',
        units: screen.units,
        health: screen.health['test-peak'],
        now: screen.now,
        selectedDate: null,
        onSelect: () => {},
        empty: { title: 'x', body: 'x' },
      }),
    )
    expect(html).toContain(`${f.daily.length} days`)
    expect(html).toMatch(/Saturday 16 Jan: likely (at least )?[\d.]+/)
    expect(html).toMatch(/Modeled · Open-Meteo · fetched/)
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('Not fetched yet')
    // A newer failed fetch is disclosed, and the shown run is the last successful one.
    expect(html).toContain('this is the last successful one')
  })

  it('renders the hero answer and the 48 hours from the same run', () => {
    const f = screen.forecast.resorts.find((r) => r.resortId === 'test-peak')!
    const hero = renderToStaticMarkup(
      createElement(ForecastHero, { name: 'Test Peak', forecast: f, health: screen.health['test-peak'], units: screen.units, mode: 'live', now: screen.now }),
    )
    expect(hero).toMatch(/Test Peak: likely (at least )?<span[^>]*>\d/)
    expect(hero).toMatch(/over \d+ days/)
    expect(hero).toContain('Modeled · Open-Meteo · fetched')
    const glance = renderToStaticMarkup(createElement(HoursGlance, { forecast: f, info: screen.resorts['test-peak'], units: screen.units, now: screen.now }))
    expect(glance).toContain('role="slider"')
    expect(glance).toContain('Likely between')
  })

  it('shows modeled snow on upcoming calendar days and the season marker', () => {
    const f = screen.forecast.resorts.find((r) => r.resortId === 'test-peak')!
    const html = renderToStaticMarkup(
      createElement(HistoryCalendarView, {
        calendar: screen.history!,
        info: screen.resorts['test-peak'],
        month: screen.historyMonth!,
        openDate: null,
        units: screen.units,
        now: screen.now,
        appMode: 'live',
        stale: false,
        forecast: f,
        markers: screen.seasonMarkers,
        onOpenDay: () => {},
        onClose: () => {},
        onMonth: () => {},
      }),
    )
    expect(html).toMatch(/Saturday 16 January 2027: likely [\d.]+/)
    expect(html).toContain(`${TODAY.slice(8)}`)
    const card = renderToStaticMarkup(createElement(SeasonCard, { name: 'Test Peak', markers: screen.seasonMarkers, today: TODAY, onMonth: () => {} }))
    expect(card).toContain('Opened')
  })

  it('keeps the frame but invents nothing for a resort without a stored run', () => {
    const f = screen.forecast.resorts.find((r) => r.resortId === 'far-west')!
    expect(f.run).toBeNull()
    const html = renderToStaticMarkup(
      createElement(OutlookStrip, {
        forecast: f,
        info: screen.resorts['far-west'],
        point: 'base',
        units: screen.units,
        health: screen.health['far-west'],
        now: screen.now,
        selectedDate: null,
        onSelect: () => {},
        empty: { title: 'No forecast stored for Far West', body: 'Nothing is estimated in its place.' },
      }),
    )
    expect(html).toContain('Not fetched yet')
    expect(html).toContain('No forecast stored for Far West')
    expect(html).not.toMatch(/likely/i)
    const hero = renderToStaticMarkup(createElement(ForecastHero, { name: 'Far West', forecast: f, health: undefined, units: screen.units, mode: 'live', now: screen.now }))
    expect(hero).toContain('not fetched yet')
    expect(hero).not.toMatch(/likely/)
  })
})
