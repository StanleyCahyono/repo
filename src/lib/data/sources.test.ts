import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import type { RefreshRunDetails } from '@/lib/db/schema'
import { lastAttemptRun, lastSuccess } from '@/lib/jobs/runner'
import { buildFixture, NOW, type Fixture } from './fixtures.test-helpers'
import { getSourcesView, type SourcesView } from './sources'

let fx: Fixture

const item = (target: string, ok: boolean, error: string | null = null) => ({ key: `${target}:base:open-meteo`, target, ok, written: ok ? 5 : 0, error })
const run = (startedAt: string, finishedAt: string, status: 'ok' | 'partial' | 'error', details: RefreshRunDetails | null, error: string | null = null) => ({
  job: 'weather',
  target: null,
  trigger: 'schedule' as const,
  startedAt,
  finishedAt,
  status,
  attempts: 1,
  itemsWritten: details?.items.reduce((a, i) => a + i.written, 0) ?? 0,
  error,
  details,
})

beforeAll(async () => {
  fx = await buildFixture()
  // r1 ok for both resorts; r2 partial (test-peak failed); r3 "ok" but fetched nothing (no provider configured).
  await fx.db.insert(s.refreshRuns).values([
    run('2027-01-15T09:00:00.000Z', '2027-01-15T09:05:00.000Z', 'ok', { items: [item('test-peak', true), item('far-west', true)] }),
    run('2027-01-15T12:00:00.000Z', '2027-01-15T12:02:00.000Z', 'partial', { items: [item('test-peak', false, 'timeout'), item('far-west', true)] }, 'test-peak:base:open-meteo: timeout'),
    run('2027-01-15T13:00:00.000Z', '2027-01-15T13:00:00.000Z', 'ok', { items: [], notes: ['No weather provider configured'] }),
  ])
  const rec = (adapter: string, fetchedAt: string, ok: boolean, extra: Partial<typeof s.sourceRecords.$inferInsert> = {}) => ({
    adapter,
    resortId: extra.resortId ?? null,
    url: extra.url ?? `https://example.org/${adapter}`,
    fetchedAt,
    httpStatus: ok ? 200 : (extra.httpStatus ?? null),
    ok,
    error: ok ? null : (extra.error ?? 'failed'),
    parserErrors: extra.parserErrors ?? null,
  })
  await fx.db.insert(s.sourceRecords).values([
    rec('open-meteo', '2027-01-15T11:00:00.000Z', false, { resortId: 'test-peak', error: 'timeout: no response in 20 s' }),
    rec('open-meteo', '2027-01-15T12:00:00.000Z', true, { resortId: 'test-peak' }),
    rec('nws-grid', '2027-01-15T12:00:00.000Z', true, { resortId: 'test-peak' }),
    rec('alta-official', '2027-01-15T13:00:00.000Z', false, { resortId: 'alta', httpStatus: 200, error: 'schema-changed: labels not found', parserErrors: ['schema-changed: labels not found'] }),
    rec('alta-official', '2026-12-20T13:00:00.000Z', false, { resortId: 'alta', error: 'http: 503' }), // older than 14 days
  ])
  await fx.db.insert(s.linkChecks).values([
    { url: 'https://example.org/', checkedAt: '2027-01-15T06:00:00.000Z', httpStatus: 200, ok: true },
    { url: 'https://example.org/report', checkedAt: '2027-01-15T06:00:00.000Z', httpStatus: 404, ok: false, error: 'HTTP 404' },
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const job = (v: SourcesView, name: string) => v.jobs.find((j) => j.job === name)!
const addMinutes = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString()
const cellOf = (v: SourcesView, resortId: string, field: string) => v.coverage.rows.find((r) => r.resortId === resortId)!.cells.find((c) => c.field === field)!

describe('getSourcesView — last success', () => {
  it('a failed or fetched-nothing run never advances "last success" (same answer as the jobs module)', async () => {
    const v = await getSourcesView(fx.ctx)
    const weather = job(v, 'weather')
    // r2 (partial, far-west ok) is the job's last success; r3 fetched nothing and does not count.
    expect(weather.lastSuccessAt).toBe('2027-01-15T12:02:00.000Z')
    expect(weather).toMatchObject({ state: 'nothing-fetched', lastAttemptOutcome: 'nothing-fetched' })
    expect(weather.stateLabel).toMatch(/fetched nothing \(No weather provider configured\)/)
    expect(weather.lastAttempt).toMatchObject({ startedAt: '2027-01-15T13:00:00.000Z', status: 'ok', items: { ok: 0, failed: 0, skipped: 0 } })
    const target = (id: string) => weather.targets.find((t) => t.resortId === id)!
    // test-peak failed in r2: its last success stays at r1; r3 did not attempt it.
    expect(target('test-peak')).toMatchObject({ lastSuccessAt: '2027-01-15T09:05:00.000Z', state: 'failing', lastAttemptOutcome: 'failed', lastAttempt: { startedAt: '2027-01-15T12:00:00.000Z' } })
    expect(target('far-west')).toMatchObject({ lastSuccessAt: '2027-01-15T12:02:00.000Z', state: 'ok' })
    expect(target('expert-bowl')).toMatchObject({ lastSuccessAt: null, lastAttempt: null, state: 'never-run' })
    // Same answers as the jobs module's own rule.
    expect(weather.lastSuccessAt).toBe(await lastSuccess(fx.db, 'weather'))
    expect(target('test-peak').lastSuccessAt).toBe(await lastSuccess(fx.db, 'weather', 'test-peak'))
    expect(target('far-west').lastSuccessAt).toBe(await lastSuccess(fx.db, 'weather', 'far-west'))
    expect(weather.lastAttempt?.id).toBe((await lastAttemptRun(fx.db, 'weather'))?.id)
    // The resort's weather coverage says the refresh is failing — not "live".
    expect(cellOf(v, 'test-peak', 'weather')).toMatchObject({ state: 'failing' })
  })

  it('a later failed run still does not advance it, and marks the job and every resort failing', async () => {
    const own = await buildFixture()
    await own.db.insert(s.refreshRuns).values([
      run('2027-01-15T09:00:00.000Z', '2027-01-15T09:05:00.000Z', 'ok', { items: [item('test-peak', true)] }),
      run('2027-01-15T13:30:00.000Z', '2027-01-15T13:31:00.000Z', 'error', { items: [], notes: [] }, 'database is locked'),
    ])
    const v = await getSourcesView(own.ctx)
    const weather = job(v, 'weather')
    expect(weather).toMatchObject({ state: 'failing', lastSuccessAt: '2027-01-15T09:05:00.000Z', lastAttempt: { status: 'error', error: 'database is locked' } })
    expect(weather.targets.find((t) => t.resortId === 'test-peak')).toMatchObject({ state: 'failing', lastSuccessAt: '2027-01-15T09:05:00.000Z' })
    expect(weather.lastSuccessAt).toBe(await lastSuccess(own.db, 'weather'))
    expect(v.connectors.find((c) => c.id === 'open-meteo')).toMatchObject({ health: 'failing' })
  })
})

describe('getSourcesView — per-resort jobs', () => {
  it('summarises a job that only runs per resort (official reports) from its resorts, never as "never run"', async () => {
    const own = await buildFixture()
    const rep = (target: string, startedAt: string, ok: boolean) => ({
      ...run(startedAt, addMinutes(startedAt, 1), ok ? 'ok' : 'error', { items: [{ key: `${target}:${target}-official`, target, ok, written: ok ? 1 : 0, error: ok ? null : 'http: 503' }] }, ok ? null : 'http: 503'),
      job: 'reports',
      target,
    })
    await own.db.insert(s.refreshRuns).values([rep('alta', '2027-01-15T12:00:00.000Z', true), rep('greek-peak', '2027-01-15T11:00:00.000Z', true), rep('greek-peak', '2027-01-15T13:00:00.000Z', false)])
    const v = await getSourcesView(own.ctx)
    const reports = job(v, 'reports')
    expect(reports.targets.map((t) => [t.resortId, t.state, t.lastSuccessAt])).toEqual([
      ['greek-peak', 'failing', '2027-01-15T11:01:00.000Z'],
      ['alta', 'ok', '2027-01-15T12:01:00.000Z'],
    ])
    expect(reports).toMatchObject({ state: 'partial', stateLabel: 'Failing for 1 of 2 sources', lastSuccessAt: '2027-01-15T12:01:00.000Z', lastAttempt: { target: 'greek-peak', status: 'error' } })
    expect(reports.targets[0].lastSuccessAt).toBe(await lastSuccess(own.db, 'reports', 'greek-peak'))
    expect(v.connectors.find((c) => c.id === 'greek-peak-official')).toMatchObject({ health: 'failing', jobLastSuccessAt: '2027-01-15T11:01:00.000Z' })
    expect(v.connectors.find((c) => c.id === 'alta-official')).toMatchObject({ health: 'ok', jobLastSuccessAt: '2027-01-15T12:01:00.000Z' })
  })
})

describe('getSourcesView — connectors never look live when they are not', () => {
  it('unconfigured, disabled and on-demand connectors are labelled as such, whatever is on file', async () => {
    vi.stubEnv('DUFFEL_ACCESS_TOKEN', '')
    vi.stubEnv('PISTE_DISABLED_PROVIDERS', 'nws-grid')
    const v = await getSourcesView(fx.ctx)
    const c = (id: string) => v.connectors.find((x) => x.id === id)!
    expect(c('duffel')).toMatchObject({ state: 'needs-credentials', health: 'not-configured', job: null })
    // nws-grid fetched successfully 2 h ago, but it is switched off now: never shown as working.
    expect(c('nws-grid')).toMatchObject({ health: 'disabled', lastFetchOkAt: '2027-01-15T12:00:00.000Z' })
    expect(c('open-meteo')).toMatchObject({ health: 'ok', lastFetchOkAt: '2027-01-15T12:00:00.000Z', lastFetch: { ok: true } })
    expect(c('alta-official')).toMatchObject({ health: 'failing', lastFetch: { ok: false } })
    expect(c('greek-peak-official')).toMatchObject({ health: 'never-succeeded', jobLastSuccessAt: null })
    vi.stubEnv('DUFFEL_ACCESS_TOKEN', 'duffel_test_abc')
    const v2 = await getSourcesView(fx.ctx)
    expect(v2.connectors.find((x) => x.id === 'duffel')).toMatchObject({ health: 'on-demand', testMode: true })
    expect(v2.connectors.find((x) => x.id === 'duffel')!.healthLabel).toMatch(/test data/)
  })

  it('in demo mode nothing is live: connectors, jobs and the scheduler say demo', async () => {
    const v = await getSourcesView({ ...fx.ctx, mode: 'demo' })
    expect(v.demo).toBe(true)
    expect(new Set(v.connectors.map((c) => c.health))).toEqual(new Set(['demo']))
    expect(new Set(v.jobs.map((j) => j.state))).toEqual(new Set(['demo']))
    expect(v.scheduler).toMatchObject({ applicable: false, stale: false, running: false })
    expect(v.scheduler.note).toMatch(/Demo mode/)
  })
})

describe('getSourcesView — coverage, failures, links, corrections, scheduler', () => {
  it('classifies each fact by its source: official, researched, reference, yours, missing', async () => {
    const v = await getSourcesView(fx.ctx)
    expect(v.coverage.fields.map((f) => f.key)).toHaveLength(16)
    expect(cellOf(v, 'test-peak', 'liftPrices')).toMatchObject({ state: 'official', detail: '2 prices (weekday, weekend)', confirmAtSource: false })
    // A manual correction (beginner %) makes the terrain group "yours".
    expect(cellOf(v, 'test-peak', 'terrain')).toMatchObject({ state: 'manual' })
    expect(cellOf(v, 'test-peak', 'drive')).toMatchObject({ state: 'reference', confirmAtSource: true })
    expect(cellOf(v, 'test-peak', 'drive').detail).toMatch(/curated estimate, not live routing/)
    expect(cellOf(v, 'test-peak', 'events')).toMatchObject({ state: 'missing', detail: 'No events on file — not proof there are none' })
    expect(cellOf(v, 'test-peak', 'passes')).toMatchObject({ state: 'official', detail: '1 product with a rule' })
    // A fresh official report without a connected adapter is judged by its source, never "live".
    expect(cellOf(v, 'test-peak', 'report')).toMatchObject({ state: 'official' })
    expect(cellOf(v, 'test-peak', 'report').detail).toMatch(/no report adapter, manual entries only/)
    expect(cellOf(v, 'quiet-hill', 'opening')).toMatchObject({ state: 'researched', confirmAtSource: true, detail: 'Announced: 2027-01-10' })
    expect(cellOf(v, 'quiet-hill', 'status')).toMatchObject({ state: 'missing' })
    expect(cellOf(v, 'quiet-hill', 'report')).toMatchObject({ state: 'missing', detail: 'No official report adapter — manual entries only' })
    expect(cellOf(v, 'far-west', 'passes')).toMatchObject({ state: 'reference', detail: '1 product with a rule, 1 with access not confirmed' })
    expect(cellOf(v, 'far-west', 'airports')).toMatchObject({ detail: 'DEN (practical)' })
    expect(v.coverage.byField.events).toEqual({ missing: 4 })
  })

  it('lists recent fetch and parser failures (14 days), link checks and manual corrections', async () => {
    const v = await getSourcesView(fx.ctx)
    expect(v.failures.items.map((f) => [f.adapter, f.kind])).toEqual([
      ['alta-official', 'parser'],
      ['open-meteo', 'fetch'],
    ])
    expect(v.failures.items[0]).toMatchObject({ parserErrors: ['schema-changed: labels not found'], resortId: 'alta' })
    expect(v.failures.byAdapter).toEqual([
      { adapter: 'alta-official', parser: 1, fetch: 0, lastAt: '2027-01-15T13:00:00.000Z' },
      { adapter: 'open-meteo', parser: 0, fetch: 1, lastAt: '2027-01-15T11:00:00.000Z' },
    ])
    expect(v.links).toMatchObject({ total: 2, checked: 2, ok: 1, broken: 1, unchecked: 0, stale: 0 })
    expect(v.links.brokenLinks).toEqual([expect.objectContaining({ url: 'https://example.org/report', httpStatus: 404, resortIds: ['expert-bowl', 'far-west', 'quiet-hill', 'test-peak'] })])
    const byField = Object.fromEntries(v.corrections.map((c) => [c.field, c]))
    expect(v.corrections).toHaveLength(4)
    expect(byField.id).toMatchObject({ applied: false, reason: 'Not a correctable field', resortId: 'test-peak' })
    expect(byField['terrain.beginnerPct']).toMatchObject({ applied: true, value: 50 })
  })

  it('reports scheduler health from the heartbeat: never run, then a live worker', async () => {
    const own = await buildFixture()
    const before = await getSourcesView(own.ctx)
    expect(before.scheduler).toMatchObject({ applicable: true, heartbeat: null, stale: true, running: false, cadenceSource: 'default' })
    expect(before.scheduler.note).toMatch(/never run/)
    await own.db.insert(s.appMeta).values([
      { key: 'scheduler.heartbeat', value: '2027-01-15T13:58:00.000Z', updatedAt: NOW },
      { key: 'scheduler.mode', value: 'worker', updatedAt: NOW },
      { key: 'scheduler.startedAt', value: '2027-01-15T08:00:00.000Z', updatedAt: NOW },
      { key: 'scheduler.cadences', value: JSON.stringify({ weatherMin: 120, reportsDayMin: 30 }), updatedAt: NOW },
    ])
    const after = await getSourcesView(own.ctx)
    expect(after.scheduler).toMatchObject({ ageMinutes: 2, stale: false, running: true, mode: 'worker', cadenceSource: 'worker', note: null })
    expect(after.scheduler.cadences).toMatchObject({ weatherMin: 120, reportsDayMin: 30, fxMin: 1440 })
    expect(job(after, 'weather').cadence).toEqual({ minutes: 120, text: 'Every 2 h' })
  })
})
