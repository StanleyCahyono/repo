import { describe, expect, it } from 'vitest'
import { fxRates, linkChecks, priceSnapshots, refreshRuns, sourceRecords, type RefreshItemOutcome } from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import type { FxProvider } from '@/lib/providers/types'
import { pruneAll, refreshFx, refreshLinks } from './maintenance'
import { lastSuccess } from './runner'
import { addPrefs, addResort, deps, T0, testDb } from './test-helpers'
import type { JobContext } from './types'

const ctx = (db: JobContext['db'], over: Partial<JobContext> = {}): JobContext => ({ db, now: T0, deps: deps(), target: null, trigger: 'schedule', ...over })

describe('pruning bookkeeping', () => {
  it('never prunes away the last successful run, even when a source has failed for months', async () => {
    const db = await testDb()
    const run = (startedAt: string, status: 'ok' | 'error' | 'skipped') =>
      db.insert(refreshRuns).values({ job: 'reports', target: 'alta', trigger: 'schedule', startedAt, finishedAt: startedAt, status })
    await run('2026-09-01T12:00:00.000Z', 'ok')
    await run('2026-09-02T12:00:00.000Z', 'ok')
    await run('2026-10-01T12:00:00.000Z', 'error')
    await run('2027-01-01T12:00:00.000Z', 'skipped') // skipped rows go after 7 days
    await run('2027-01-14T12:00:00.000Z', 'error')
    await pruneAll(ctx(db))
    const left = await db.select().from(refreshRuns).orderBy(refreshRuns.startedAt)
    expect(left.map((r) => [r.startedAt.slice(0, 10), r.status])).toEqual([
      ['2026-09-02', 'ok'],
      ['2027-01-14', 'error'],
    ])
    expect(await lastSuccess(db, 'reports', 'alta')).toBe('2026-09-02T12:00:00.000Z')
  })

  it('keeps each resort’s last success recorded inside global runs, not just the newest run per job', async () => {
    const db = await testDb()
    const item = (target: string, okay: boolean): RefreshItemOutcome => ({ key: `${target}:base:open-meteo`, target, ok: okay, written: okay ? 10 : 0, error: okay ? null : 'timeout' })
    const run = (startedAt: string, status: 'ok' | 'partial', items: RefreshItemOutcome[], notes: string[] = []) =>
      db.insert(refreshRuns).values({ job: 'weather', target: null, trigger: 'schedule', startedAt, finishedAt: startedAt, status, details: { items, notes } })
    await run('2026-09-01T12:00:00.000Z', 'ok', [], ['No weather provider configured']) // fetched nothing: not a success
    await run('2026-10-01T12:00:00.000Z', 'ok', [item('alta', true), item('greek-peak', true)])
    await run('2026-10-02T12:00:00.000Z', 'partial', [item('alta', false), item('greek-peak', true)])
    await run('2027-01-14T12:00:00.000Z', 'partial', [item('alta', false), item('greek-peak', true)])
    expect(await lastSuccess(db, 'weather', 'alta')).toBe('2026-10-01T12:00:00.000Z')

    await pruneAll(ctx(db))
    // Alta has been failing since 2 Oct: its last success must not turn into "never".
    expect(await lastSuccess(db, 'weather', 'alta')).toBe('2026-10-01T12:00:00.000Z')
    expect(await lastSuccess(db, 'weather', 'greek-peak')).toBe('2027-01-14T12:00:00.000Z')
    expect(await lastSuccess(db, 'weather')).toBe('2027-01-14T12:00:00.000Z')
    const left = await db.select().from(refreshRuns).orderBy(refreshRuns.startedAt)
    expect(left.map((r) => r.startedAt.slice(0, 10))).toEqual(['2026-10-01', '2027-01-14'])
  })

  it('keeps the newest fetch record per source however old it is', async () => {
    const db = await testDb()
    const rec = (fetchedAt: string, url: string) =>
      db.insert(sourceRecords).values({ adapter: 'alta-official', resortId: 'alta', url, fetchedAt, ok: false, error: 'http: 403' })
    await rec('2026-10-01T00:00:00.000Z', 'https://a.test/report')
    await rec('2026-10-02T00:00:00.000Z', 'https://a.test/report')
    await rec('2026-10-02T00:00:00.000Z', 'https://a.test/robots.txt')
    await pruneAll(ctx(db))
    const left = await db.select().from(sourceRecords)
    expect(left.map((r) => [r.url, r.fetchedAt.slice(0, 10)]).sort()).toEqual([
      ['https://a.test/report', '2026-10-02'],
      ['https://a.test/robots.txt', '2026-10-02'],
    ])
  })
})

describe('fx and links', () => {
  it('fetches rates only for currencies in use and never invents missing ones', async () => {
    const db = await testDb()
    await addPrefs(db)
    await addResort(db, { id: 'ski-arlberg', timezone: 'Europe/Vienna', country: 'AT' })
    await db.insert(priceSnapshots).values({
      subjectType: 'lift-ticket',
      subjectId: 'ski-arlberg',
      item: 'Day ticket',
      amountMinor: 7900,
      currency: 'EUR',
      quoteKind: 'published',
      observedAt: T0,
      prov: provenance({ kind: 'official' }),
    })
    await db.insert(priceSnapshots).values({
      subjectType: 'lift-ticket',
      subjectId: 'whistler',
      item: 'Day ticket',
      amountMinor: 30000,
      currency: 'CAD',
      quoteKind: 'published',
      observedAt: T0,
      prov: provenance({ kind: 'official' }),
    })
    let asked: string[] = []
    const fx: FxProvider = {
      id: 'frankfurter',
      async fetchRates(base, quotes) {
        asked = [base, ...quotes]
        return {
          ok: true,
          data: [{ base: 'USD', quote: 'EUR', rate: '0.9123', rateDate: '2027-01-14' }],
          provenance: provenance({ kind: 'official', provider: 'ECB via Frankfurter' }),
          capabilities: { supplied: ['EUR'], missing: ['CAD'], limitations: [] },
          fetches: [],
        }
      },
    }
    const res = await refreshFx(ctx(db, { deps: deps({ fxProvider: fx }) }))
    expect(asked).toEqual(['USD', 'CAD', 'EUR'])
    expect(res.notes?.[0]).toMatch(/No rate supplied for CAD/)
    const rows = await db.select().from(fxRates)
    expect(rows.map((r) => [r.quote, r.rate])).toEqual([['EUR', '0.9123']])
    // Same date again → no duplicate row.
    await refreshFx(ctx(db, { deps: deps({ fxProvider: fx }) }))
    expect(await db.select().from(fxRates)).toHaveLength(1)
  })

  it('records a broken link as a finding, not as a job failure', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta', links: { official: 'https://www.alta.com/', trailMap: 'https://www.alta.com/map.pdf' } })
    const res = await refreshLinks(ctx(db, { deps: deps({ checkLink: async (url) => ({ url, ok: !url.endsWith('.pdf'), httpStatus: url.endsWith('.pdf') ? 404 : 200, finalUrl: url, embeddable: null, error: null, checkedAt: T0 }) }) }), { delayMs: 0 })
    expect(res.items.every((i) => i.ok)).toBe(true)
    expect(res.notes?.[0]).toMatch(/2 of 2 links checked, 1 broken/)
    expect((await db.select().from(linkChecks)).find((l) => l.url.endsWith('.pdf'))?.httpStatus).toBe(404)
  })
})
