import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import { buildFixture, NOW, TODAY, type Fixture } from './fixtures.test-helpers'
import { getForecastScreen, MAX_COMPARE, type ForecastScreenOptions } from './forecast-screen'

const opts = (over: Partial<ForecastScreenOptions> = {}): ForecastScreenOptions => ({
  resorts: null,
  focus: null,
  point: 'base',
  date: null,
  month: null,
  mode: null,
  ...over,
})

let fx: Fixture
beforeAll(async () => {
  fx = await buildFixture()
  await fx.db.insert(s.favorites).values([
    { resortId: 'expert-bowl', addedAt: NOW, sortOrder: 1 },
    { resortId: 'test-peak', addedAt: NOW, sortOrder: 0 },
  ])
  await fx.db.insert(s.weatherAlerts).values([
    {
      id: 'nws-1',
      resortId: 'test-peak',
      provider: 'nws',
      event: 'Winter Storm Warning',
      headline: 'Heavy snow',
      severity: 'Severe',
      onset: '2027-01-15T20:00:00.000Z',
      ends: '2027-01-16T20:00:00.000Z',
      url: 'https://alerts.weather.gov/x',
      fetchedAt: '2027-01-15T13:00:00.000Z',
    },
    {
      id: 'nws-old',
      resortId: 'test-peak',
      provider: 'nws',
      event: 'Wind Advisory',
      headline: null,
      severity: 'Moderate',
      onset: '2027-01-14T00:00:00.000Z',
      ends: '2027-01-15T00:00:00.000Z',
      url: null,
      fetchedAt: '2027-01-14T01:00:00.000Z',
    },
    {
      id: 'demo-1',
      resortId: 'test-peak',
      provider: 'demo',
      event: 'Demo alert',
      headline: null,
      severity: 'Minor',
      onset: null,
      ends: null,
      url: null,
      fetchedAt: NOW,
    },
  ])
  // A global alerts run that succeeded for test-peak and failed for expert-bowl: only test-peak counts as checked.
  await fx.db.insert(s.refreshRuns).values({
    job: 'nws-alerts',
    target: null,
    trigger: 'schedule',
    startedAt: '2027-01-15T12:00:00.000Z',
    finishedAt: '2027-01-15T12:00:05.000Z',
    status: 'partial',
    error: null,
    details: {
      items: [
        { key: 'test-peak:nws', target: 'test-peak', ok: true, written: 1 },
        { key: 'expert-bowl:nws', target: 'expert-bowl', ok: false, written: 0, error: 'http: 500' },
      ],
    },
  })
})

describe('getForecastScreen — selection', () => {
  it('preselects favourites in their order and focuses the first', async () => {
    const screen = await getForecastScreen(fx.ctx, opts())
    expect(screen.selectionBasis).toBe('favourites')
    expect(screen.selected).toEqual(['test-peak', 'expert-bowl'])
    expect(screen.focus).toBe('test-peak')
    expect(screen.catalog.slice(0, 2).map((r) => r.id)).toEqual(['test-peak', 'expert-bowl'])
    expect(screen.catalog.find((r) => r.id === 'test-peak')?.hasForecast).toBe(true)
    expect(screen.catalog.find((r) => r.id === 'far-west')?.hasForecast).toBe(false)
  })

  it('honours the URL selection (max four), reports unknown ids, and an explicit empty selection', async () => {
    const screen = await getForecastScreen(fx.ctx, opts({ resorts: ['far-west', 'nope', 'test-peak', 'expert-bowl', 'quiet-hill'], focus: 'expert-bowl' }))
    expect(screen.selected).toEqual(['far-west', 'test-peak', 'expert-bowl', 'quiet-hill'].slice(0, MAX_COMPARE))
    expect(screen.unknownIds).toEqual(['nope'])
    expect(screen.focus).toBe('expert-bowl')
    const none = await getForecastScreen(fx.ctx, opts({ resorts: [] }))
    expect(none).toMatchObject({ selected: [], selectionBasis: 'none', focus: null, history: null })
  })

  it('ignores a focus that is not in the selection', async () => {
    const screen = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak'], focus: 'far-west' }))
    expect(screen.focus).toBe('test-peak')
  })
})

describe('getForecastScreen — evidence', () => {
  it('uses stored assessments for weather potential and lets a confirmed closure replace the score', async () => {
    const screen = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak', 'expert-bowl'] }))
    const peak = screen.potentials['test-peak'].find((p) => p.date === TODAY)!
    expect(peak).toMatchObject({ score: 78, scoreKind: 'conditions', closure: null })
    const bowl = screen.potentials['expert-bowl'].find((p) => p.date === TODAY)!
    expect(bowl).toMatchObject({ score: null, scoreKind: 'closed' })
    expect(bowl.closure?.reason).toMatch(/closed/i)
  })

  it('reports a failed fetch newer than the last success without counting it as an update', async () => {
    const screen = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak', 'far-west'] }))
    expect(screen.health['test-peak']).toEqual({
      lastOkAt: '2027-01-15T12:00:00.000Z',
      lastFailure: { at: '2027-01-15T13:00:00.000Z', provider: 'open-meteo', pointKey: 'base', error: 'timeout' },
    })
    expect(screen.health['far-west']).toEqual({ lastOkAt: null, lastFailure: null })
  })

  it('lists active official alerts only — never expired ones, never demo alerts in live mode', async () => {
    const screen = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak'] }))
    expect(screen.alerts.map((a) => a.id)).toEqual(['nws-1'])
    expect(screen.alerts[0]).toMatchObject({ event: 'Winter Storm Warning', upcoming: true, prov: { kind: 'official' } })
    expect(screen.resorts['test-peak'].alerts).toEqual({ covered: true, checkedAt: '2027-01-15T12:00:05.000Z' })
    const both = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak', 'expert-bowl'] }))
    expect(both.resorts['expert-bowl'].alerts).toEqual({ covered: true, checkedAt: null })
    expect(both.alertsJob).toMatchObject({ lastAttemptStatus: 'partial', lastSuccessAt: '2027-01-15T12:00:05.000Z' })
  })

  it('carries the configured weather points and links for each selected resort', async () => {
    const screen = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak'] }))
    expect(screen.resorts['test-peak']).toMatchObject({
      today: TODAY,
      country: 'US',
      points: [
        { key: 'base', elevationM: 350 },
        { key: 'summit', elevationM: 640 },
      ],
      links: { snowReport: 'https://example.org/report' },
    })
  })
})

describe('getForecastScreen — dates', () => {
  it('opens the history month of a past date unless a month is given', async () => {
    const past = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak'], date: '2026-12-20' }))
    expect(past.historyMonth).toBe('2026-12')
    expect(past.history?.month).toBe('2026-12')
    const explicit = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak'], date: '2026-12-20', month: '2027-01' }))
    expect(explicit.historyMonth).toBe('2027-01')
    const future = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak'], date: '2027-03-13' }))
    expect(future.historyMonth).toBe('2027-01')
  })

  it('computes planning facts for a date beyond the forecast without inventing weather', async () => {
    const screen = await getForecastScreen(fx.ctx, opts({ resorts: ['test-peak', 'quiet-hill'], date: '2027-03-13' }))
    expect(screen.selectedDate).toBe('2027-03-13')
    expect(screen.planning['test-peak']).toMatchObject({ date: '2027-03-13', seasonId: '2026-27', opening: { label: 'opened' }, closure: null })
    expect(screen.planning['test-peak'].myPass.status).not.toBe('no-pass')
    expect(screen.planning['quiet-hill'].status.status).toBe('unknown')
    // Nothing in the forecast reaches that far.
    const peak = screen.forecast.resorts.find((f) => f.resortId === 'test-peak')!
    expect(peak.daily.every((d) => d.date < '2027-03-13')).toBe(true)
  })
})
