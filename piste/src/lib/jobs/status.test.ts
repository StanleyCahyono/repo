import { describe, expect, it } from 'vitest'
import { openingDateHistory, resortSeasons, statusEvents } from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import { deriveSeasonStatus, deriveStatuses, recordStatus, updateSeasonDates } from './status'
import { addResort, addSeason, deps, testDb } from './test-helpers'

const official = provenance({ kind: 'official', provider: 'alta.com' })

describe('status history', () => {
  it('appends only on change and never lets an older statement rewrite history', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    const rec = (status: 'not-yet-open' | 'open' | 'temporarily-closed', effectiveAt: string) =>
      recordStatus(db, { resortId: 'alta', status, localDate: effectiveAt.slice(0, 10), effectiveAt, prov: official })
    expect((await rec('not-yet-open', '2026-11-10T13:00:00.000Z')).appended).toBe(true)
    expect((await rec('not-yet-open', '2026-11-11T13:00:00.000Z')).appended).toBe(false)
    expect((await rec('open', '2026-11-22T13:00:00.000Z')).appended).toBe(true)
    expect((await rec('temporarily-closed', '2026-11-21T13:00:00.000Z')).appended).toBe(false) // older than latest
    expect((await rec('temporarily-closed', '2026-12-02T13:00:00.000Z')).appended).toBe(true)
    const rows = await db.select().from(statusEvents).orderBy(statusEvents.id)
    expect(rows.map((r) => r.status)).toEqual(['not-yet-open', 'open', 'temporarily-closed'])
  })
})

describe('announced opening dates', () => {
  it('reaching an announced opening date never produces "open" — it becomes unknown until confirmed', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    await addSeason(db, 'alta', { announcedOpening: '2026-11-20' })
    const run = (now: string) => deriveStatuses({ db, now, deps: deps(), target: null, trigger: 'schedule' })

    await run('2026-11-10T15:00:00.000Z')
    await run('2026-11-15T15:00:00.000Z') // no change → nothing appended
    await run('2026-11-20T15:00:00.000Z') // the announced day itself
    await run('2026-11-21T15:00:00.000Z')
    const rows = await db.select().from(statusEvents).orderBy(statusEvents.id)
    expect(rows.map((r) => r.status)).toEqual(['not-yet-open', 'unknown'])
    expect(rows.every((r) => r.status !== 'open')).toBe(true)
    expect(rows.every((r) => r.prov.kind === 'derived')).toBe(true)
  })

  it('derived statuses do not override a newer official statement', () => {
    const latest = { status: 'not-yet-open' as const, localDate: '2026-11-20', prov: official }
    // Official "not yet open" on the announced day (opening delayed) stands on that day.
    expect(deriveSeasonStatus({ announcedOpening: '2026-11-20', actualOpening: null, actualClosing: null }, '2026-11-20', latest)).toBeNull()
    // An official statement from before the announced date is superseded by "unknown" once the date passes.
    const older = { ...latest, localDate: '2026-11-01' }
    expect(deriveSeasonStatus({ announcedOpening: '2026-11-20', actualOpening: null, actualClosing: null }, '2026-11-21', older)?.status).toBe('unknown')
    // After an actual opening, operations come from reports only.
    expect(deriveSeasonStatus({ announcedOpening: '2026-11-20', actualOpening: '2026-11-22', actualClosing: null }, '2026-12-01', null)).toBeNull()
  })

  it('logs every opening-date change and leaves unchanged values alone', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    await addSeason(db, 'alta', { announcedOpening: '2026-11-20' })
    const prov = provenance({ kind: 'official', provider: 'alta.com', sourceUrl: 'https://www.alta.com/news' })
    expect(await updateSeasonDates(db, { resortId: 'alta', seasonId: '2026-27', changes: { announcedOpening: '2026-11-27' }, prov, now: '2026-11-01T12:00:00.000Z' })).toEqual([
      'announcedOpening',
    ])
    expect(await updateSeasonDates(db, { resortId: 'alta', seasonId: '2026-27', changes: { announcedOpening: '2026-11-27' }, prov, now: '2026-11-02T12:00:00.000Z' })).toEqual([])
    const hist = await db.select().from(openingDateHistory)
    expect(hist.map((h) => [h.previousValue, h.newValue])).toEqual([['2026-11-20', '2026-11-27']])
    const [season] = await db.select().from(resortSeasons)
    expect(season.announcedOpening).toBe('2026-11-27')
    expect(season.announcedOpeningProv?.sourceUrl).toBe('https://www.alta.com/news')
  })
})
