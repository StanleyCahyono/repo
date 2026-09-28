import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openingDateHistory, operationalReports, resortSeasons, sourceRecords, statusEvents } from '@/lib/db/schema'
import { addHours } from '@/lib/domain/time'
import type { ParsedReport, ProviderResult } from '@/lib/providers/types'
import { addManualReport, addPersonalReport, isPersonalReport, refreshReports, reportContentHash, reportOrigin } from './reports'
import { runJob, lastSuccess } from './runner'
import { addResort, addSeason, deps, fail, fakeReports, parsedReport, reportResult, T0, testDb } from './test-helpers'

async function setup() {
  const db = await testDb()
  await addResort(db, { id: 'alta' })
  await addSeason(db, 'alta', { announcedOpening: '2026-11-20' })
  let next: ProviderResult<ParsedReport> = reportResult(parsedReport(), T0)
  const provider = fakeReports('alta', () => next)
  const refresh = (now: string) => runJob({ db, job: 'reports', target: 'alta', trigger: 'schedule', now, deps: deps({ reportProviders: [provider] }) })
  return { db, refresh, set: (r: ProviderResult<ParsedReport>) => (next = r) }
}

describe('official report ingestion', () => {
  it('re-fetching an unchanged report creates no revision and keeps its observation time', async () => {
    const { db, refresh, set } = await setup()
    await refresh(T0)
    const [first] = await db.select().from(operationalReports)
    expect(first.revision).toBe(1)
    expect(first.reportedAt).toBe('2027-01-15T13:00:00.000Z')

    // Three hours later the page re-renders its "updated" time but the content is identical.
    const later = addHours(T0, 3)
    set(reportResult(parsedReport({ reportedAt: '2027-01-15T16:00:00.000Z', surfaceText: '  Packed   powder ' }), later))
    const s = await refresh(later)
    expect(s.status).toBe('ok')
    expect(s.itemsWritten).toBe(0)

    const rows = await db.select().from(operationalReports)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(first) // reportedAt / fetchedAt untouched → observation age keeps growing
    // The fetch itself is still recorded.
    expect(await db.select().from(sourceRecords)).toHaveLength(2)
  })

  it('a stale page still showing yesterday’s report after midnight is not a new report for today', async () => {
    const { db, refresh, set } = await setup()
    await refresh(T0)
    set(reportResult(parsedReport({ localDate: '2027-01-16', reportedAt: null }), '2027-01-16T13:00:00.000Z'))
    await refresh('2027-01-16T13:00:00.000Z')
    expect(await db.select().from(operationalReports)).toHaveLength(1)
  })

  it('a changed report becomes revision 2 of the same local date', async () => {
    const { db, refresh, set } = await setup()
    await refresh(T0)
    set(reportResult(parsedReport({ baseDepthCm: 160, reportedAt: '2027-01-15T18:00:00.000Z' }), addHours(T0, 5)))
    await refresh(addHours(T0, 5))
    const rows = await db.select().from(operationalReports).orderBy(operationalReports.revision)
    expect(rows.map((r) => [r.localDate, r.revision, r.baseDepthCm])).toEqual([
      ['2027-01-15', 1, 150],
      ['2027-01-15', 2, 160],
    ])
    expect(rows[1].contentHash).not.toBe(rows[0].contentHash)
  })

  it('a failed parse is logged with parser errors and the last good report is kept', async () => {
    const { db, refresh, set } = await setup()
    await refresh(T0)
    set(fail('snow-depth label not found (page layout changed?)', 'schema-changed', 'https://www.alta.com/conditions'))
    const s = await refresh(addHours(T0, 1))
    expect(s.status).toBe('error')
    expect(await lastSuccess(db, 'reports', 'alta')).toBe(T0)
    const recs = await db.select().from(sourceRecords).orderBy(sourceRecords.id)
    expect(recs[1].ok).toBe(false)
    expect(recs[1].parserErrors).toEqual(['snow-depth label not found (page layout changed?)'])
    expect(await db.select().from(operationalReports)).toHaveLength(1)
  })

  it('an official "open" statement appends a status change and confirms the actual opening (logged)', async () => {
    const { db, refresh } = await setup()
    await refresh(T0)
    const events = await db.select().from(statusEvents)
    expect(events.map((e) => [e.status, e.localDate])).toEqual([['open', '2027-01-15']])
    const [season] = await db.select().from(resortSeasons)
    expect(season.actualOpening).toBe('2027-01-15')
    const hist = await db.select().from(openingDateHistory)
    expect(hist.map((h) => [h.field, h.previousValue, h.newValue])).toEqual([['actualOpening', null, '2027-01-15']])
  })

  it('isolates adapters: a throwing adapter does not stop other resorts', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    await addResort(db, { id: 'greek-peak', timezone: 'America/New_York' })
    const broken = fakeReports('alta', () => {
      throw new Error('boom')
    })
    const fine = fakeReports('greek-peak', () => reportResult(parsedReport(), T0))
    const res = await refreshReports({ db, now: T0, deps: deps({ reportProviders: [broken, fine] }), target: null, trigger: 'schedule' })
    expect(res.items.map((i) => [i.target, i.ok])).toEqual([
      ['alta', false],
      ['greek-peak', true],
    ])
  })

  it('the content hash ignores reportedAt/localDate and whitespace but not values', () => {
    const a = parsedReport()
    expect(reportContentHash({ ...a, reportedAt: null, localDate: '2027-01-16', notes: '  ' })).toBe(reportContentHash(a))
    expect(reportContentHash({ ...a, openTrails: 81 })).not.toBe(reportContentHash(a))
  })
})

describe('manual and personal reports', () => {
  it('requires a source URL for transcribed reports and keeps personal feedback distinguishable', async () => {
    const db = await testDb()
    await addResort(db, { id: 'greek-peak', timezone: 'America/New_York' })
    await expect(addManualReport(db, { resortId: 'greek-peak', localDate: '2027-01-15', sourceUrl: '' } as never, T0)).rejects.toThrow()
    await expect(addManualReport(db, { resortId: 'greek-peak', localDate: '2027-01-15', sourceUrl: 'javascript:alert(1)' }, T0)).rejects.toThrow()

    const m = await addManualReport(
      db,
      { resortId: 'greek-peak', localDate: '2027-01-15', sourceUrl: 'https://www.greekpeak.net/mountain-report', baseDepthCm: 60, surfaceTags: ['firm'], status: 'partially-open' },
      T0,
    )
    const byUser = await addManualReport(db, { resortId: 'greek-peak', localDate: '2027-01-15', kind: 'official', sourceUrl: 'https://www.greekpeak.net/mountain-report' }, T0)
    const p = await addPersonalReport(db, { resortId: 'greek-peak', localDate: '2027-01-15', surfaceTags: ['icy-refrozen'], notes: 'Scraped off by noon' }, T0)
    expect(m.revision).toBe(1)
    expect(p.revision).toBe(2) // same kind ('manual') and date → next revision

    const rows = await db.select().from(operationalReports).orderBy(operationalReports.id)
    expect(rows.map(reportOrigin)).toEqual(['manual-transcribed', 'official-by-user', 'personal'])
    expect(rows.map(isPersonalReport)).toEqual([false, false, true])
    expect(rows[0].prov.sourceUrl).toBe('https://www.greekpeak.net/mountain-report')
    expect(rows[1].prov.verification).toBe('user-confirmed')
    expect(byUser.statusAppended).toBe(false)
    // Only the transcribed official status became a status event; personal feedback never sets status.
    const ev = await db.select().from(statusEvents).where(eq(statusEvents.resortId, 'greek-peak'))
    expect(ev.map((e) => e.status)).toEqual(['partially-open'])
    expect(rows[2].status).toBeNull()
  })
})
