import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import type { RefreshRunDetails } from '@/lib/db/schema'
import { lastSuccess } from '@/lib/jobs/runner'
import { buildFixture, TODAY, type Fixture } from './fixtures.test-helpers'
import { getResortName, getResortPageExtras } from './resort-page'

let fx: Fixture

const item = (target: string, point: string, ok: boolean, error: string | null = null) => ({ key: `${target}:${point}:open-meteo`, target, ok, written: ok ? 5 : 0, error })
const run = (
  startedAt: string,
  finishedAt: string,
  status: 'ok' | 'partial' | 'error',
  details: RefreshRunDetails | null,
  extra: { job?: string; target?: string | null; trigger?: 'schedule' | 'manual'; error?: string | null } = {},
) => ({
  job: extra.job ?? 'weather',
  target: extra.target ?? null,
  trigger: extra.trigger ?? ('schedule' as const),
  startedAt,
  finishedAt,
  status,
  attempts: 1,
  itemsWritten: details?.items.reduce((a, i) => a + i.written, 0) ?? 0,
  error: extra.error ?? null,
  details,
})

beforeAll(async () => {
  fx = await buildFixture()
  await fx.db.insert(s.refreshRuns).values([
    // 09:00 all-resort run: ok everywhere.
    run('2027-01-15T09:00:00.000Z', '2027-01-15T09:04:00.000Z', 'ok', { items: [item('test-peak', 'base', true), item('far-west', 'base', true)] }),
    // 12:00 all-resort run: test-peak failed at both points (the normal scheduled pass — no target), far-west ok.
    run(
      '2027-01-15T12:00:00.000Z',
      '2027-01-15T12:03:00.000Z',
      'partial',
      {
        items: [
          item('test-peak', 'base', false, 'http: Open-Meteo: HTTP 403 Forbidden'),
          item('test-peak', 'summit', false, 'http: Open-Meteo: HTTP 403 Forbidden'),
          item('far-west', 'base', true),
        ],
      },
      { error: 'test-peak:base:open-meteo: http: Open-Meteo: HTTP 403 Forbidden; test-peak:summit:open-meteo: http: Open-Meteo: HTTP 403 Forbidden' },
    ),
    // An older run targeted at expert-bowl only.
    run('2027-01-15T08:00:00.000Z', '2027-01-15T08:01:00.000Z', 'ok', { items: [item('expert-bowl', 'base', true)] }, { target: 'expert-bowl', trigger: 'manual' }),
    // A run from the simulated future (after the app clock) is never reported.
    run('2027-01-15T15:00:00.000Z', '2027-01-15T15:01:00.000Z', 'ok', { items: [item('quiet-hill', 'base', true)] }),
  ])
})

describe('getResortPageExtras — refresh health', () => {
  it('reports the normal all-resort run for a resort, with only that resort’s own errors', async () => {
    const x = await getResortPageExtras(fx.ctx, 'test-peak', { date: TODAY })
    expect(x.refresh.weather).toMatchObject({
      lastAttemptAt: '2027-01-15T12:03:00.000Z',
      lastAttemptOutcome: 'failed',
      lastAttemptScope: 'all',
      lastAttemptTrigger: 'schedule',
      // A failed attempt never advances "last success": it stays at the 09:00 run.
      lastSuccessAt: '2027-01-15T09:04:00.000Z',
    })
    expect(x.refresh.weather.lastAttemptErrors).toEqual([
      { source: 'base · open-meteo', message: 'Open-Meteo: HTTP 403 Forbidden' },
      { source: 'summit · open-meteo', message: 'Open-Meteo: HTTP 403 Forbidden' },
    ])
    // Same "last success" rule as the jobs module.
    expect(x.refresh.weather.lastSuccessAt).toBe(await lastSuccess(fx.db, 'weather', 'test-peak'))
  })

  it('a resort that succeeded in the same all-resort run shows it as ok, without other resorts’ errors', async () => {
    const x = await getResortPageExtras(fx.ctx, 'far-west', { date: TODAY })
    expect(x.refresh.weather).toMatchObject({ lastAttemptOutcome: 'ok', lastAttemptScope: 'all', lastSuccessAt: '2027-01-15T12:03:00.000Z', lastAttemptErrors: [] })
  })

  it('labels a run targeted at the resort as such, and never reports runs from after the app clock', async () => {
    const eb = await getResortPageExtras(fx.ctx, 'expert-bowl', { date: TODAY })
    expect(eb.refresh.weather).toMatchObject({ lastAttemptScope: 'resort', lastAttemptTrigger: 'manual', lastSuccessAt: '2027-01-15T08:01:00.000Z' })
    const quiet = await getResortPageExtras(fx.ctx, 'quiet-hill', { date: TODAY })
    expect(quiet.refresh.weather).toMatchObject({ lastAttemptAt: null, lastAttemptOutcome: null, lastSuccessAt: null })
  })

  it('has no report-feed health when the resort has no official report adapter', async () => {
    const x = await getResortPageExtras(fx.ctx, 'test-peak', { date: TODAY })
    expect(x.refresh.reportAdapter).toBeNull()
    expect(x.refresh.reports).toBeNull()
  })
})

describe('getResortPageExtras — page facts', () => {
  it('lists my own observations separately from operations reports', async () => {
    const x = await getResortPageExtras(fx.ctx, 'test-peak', { date: TODAY })
    expect(x.personalReports).toHaveLength(1)
    expect(x.personalReports[0]).toMatchObject({ origin: 'personal', surfaceTags: ['icy-refrozen'], status: null })
  })

  it('returns the catalog facts the summary leaves out, with manual corrections applied', async () => {
    const x = await getResortPageExtras(fx.ctx, 'test-peak', { date: TODAY })
    expect(x.catalog.weatherPoints.map((p) => [p.key, p.elevationM])).toEqual([
      ['base', 350],
      ['summit', 640],
    ])
    // The fixture corrects terrain.beginnerPct 40 → 50 with a source: the corrected value and provenance win.
    expect(x.catalog.terrain).toMatchObject({ beginnerPct: 50, prov: { kind: 'manual', verification: 'user-confirmed' } })
  })

  it('keeps status history newest first', async () => {
    const x = await getResortPageExtras(fx.ctx, 'expert-bowl', { date: TODAY })
    expect(x.statusHistory.map((e) => e.status)).toEqual(['temporarily-closed', 'open'])
    expect(x.statusHistory[0]).toMatchObject({ label: 'Temporarily closed', note: 'Wind hold' })
  })

  it('shows a 14-day history window ending on the planning date — never past the resort’s today', async () => {
    const past = await getResortPageExtras(fx.ctx, 'test-peak', { date: '2027-01-10' })
    expect(past.historyWindow.map((d) => d.date)).toHaveLength(14)
    expect(past.historyWindow[0].date).toBe('2026-12-28')
    expect(past.historyWindow.at(-1)!.date).toBe('2027-01-10')
    const future = await getResortPageExtras(fx.ctx, 'test-peak', { date: '2027-01-25' })
    expect(future.historyWindow.at(-1)!.date).toBe(TODAY)
    expect(future.historyWindow.every((d) => d.state !== 'future')).toBe(true)
  })

  it('offers upcoming trips and other resorts to compare (never this one)', async () => {
    const x = await getResortPageExtras(fx.ctx, 'test-peak', { date: TODAY })
    expect(x.compare.map((c) => c.id)).not.toContain('test-peak')
    expect(x.originAirports.every((a) => a.role === 'origin' || a.role === 'both')).toBe(true)
  })
})

describe('getResortName', () => {
  it('returns name, region and timezone, or null for an unknown id', async () => {
    expect(await getResortName(fx.ctx, 'far-west')).toMatchObject({ id: 'far-west', timezone: 'America/Denver', region: 'Colorado' })
    expect(await getResortName(fx.ctx, 'nope')).toBeNull()
  })
})
