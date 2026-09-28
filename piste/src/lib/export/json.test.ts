import { describe, expect, it } from 'vitest'
import { operationalReports, trips } from '@/lib/db/schema'
import { addManualReport, addPersonalReport } from '@/lib/jobs/reports'
import { addPrefs, addResort, T0, testDb } from '@/lib/jobs/test-helpers'
import { provenance } from '@/lib/domain/types'
import { collectPersonalData } from './collect'
import { buildJsonExport, contentDisposition, exportFileName, PERSONAL_TABLES } from './json'

describe('personal JSON export', () => {
  it('includes every personal table and only user-entered reports', async () => {
    const db = await testDb()
    await addPrefs(db)
    await addResort(db, { id: 'alta' })
    await db.insert(trips).values({ id: 't1', name: 'Alta', startDate: '2027-02-12', endDate: '2027-02-15', companions: [], createdAt: T0, updatedAt: T0 })
    await addManualReport(db, { resortId: 'alta', localDate: '2027-01-15', sourceUrl: 'https://www.alta.com/conditions', baseDepthCm: 150 }, T0)
    await addPersonalReport(db, { resortId: 'alta', localDate: '2027-01-15', surfaceTags: ['firm'] }, T0)
    // An adapter report is catalog/source data, not a personal record.
    await db.insert(operationalReports).values({
      resortId: 'alta',
      localDate: '2027-01-15',
      kind: 'official',
      snowfall: [],
      surfaceTags: [],
      prov: provenance({ kind: 'official', provider: 'alta.com', verification: 'official-page' }),
      createdAt: T0,
    })
    const out = buildJsonExport(await collectPersonalData(db, 'live'), { now: T0, mode: 'live' })
    expect(Object.keys(out.tables)).toEqual([...PERSONAL_TABLES])
    expect(out.counts.trips).toBe(1)
    expect(out.counts.preferences).toBe(1)
    expect(out.counts['manual-reports']).toBe(2)
    expect(out.demo).toBe(false)
    expect(out.label).toBeNull()
  })

  it('labels demo exports in payload and filename', () => {
    const out = buildJsonExport({} as never, { now: T0, mode: 'demo' })
    expect(out.demo).toBe(true)
    expect(out.label).toMatch(/DEMO/)
    expect(exportFileName('export', 'json', { now: T0, mode: 'demo' })).toBe('piste-DEMO-export-20270115-1400.json')
    expect(exportFileName('Trip: Alta, Feb!', 'ics', { now: T0, mode: 'live' })).toBe('piste-trip-alta-feb-20270115-1400.ics')
    expect(contentDisposition('piste-Zürs.ics')).toBe(`attachment; filename="piste-Z_rs.ics"; filename*=UTF-8''piste-Z%C3%BCrs.ics`)
  })
})
