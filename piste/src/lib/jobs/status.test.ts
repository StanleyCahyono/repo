import { describe, expect, it } from 'vitest'
import { openingDateHistory, resortSeasons, statusEvents } from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import { refreshReports } from './reports'
import { deriveSeasonStatus, deriveStatuses, latestStatusEvent, recordStatus, updateSeasonDates } from './status'
import { addResort, addSeason, deps, fakeReports, parsedReport, reportResult, testDb } from './test-helpers'

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

  it('an official statement published earlier the same day outranks the derived status, even when fetched after it', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' }) // America/Denver
    await addSeason(db, 'alta', { announcedOpening: '2026-11-20' })
    const derive = (now: string) => deriveStatuses({ db, now, deps: deps(), target: null, trigger: 'schedule' })

    // The status job runs at 09:00 local on the announced day: no confirmation yet → unknown, for the whole day.
    await derive('2026-11-20T16:00:00.000Z')
    const derived = await latestStatusEvent(db, 'alta')
    expect([derived?.status, derived?.prov.kind, derived?.effectiveAt]).toEqual(['unknown', 'derived', '2026-11-20T07:00:00.000Z'])

    // The resort published "open" at 07:00 local (14:00Z); we fetch it at 17:00Z, after the status job ran.
    const provider = fakeReports('alta', () =>
      reportResult(parsedReport({ localDate: '2026-11-20', reportedAt: '2026-11-20T14:00:00.000Z', status: 'open' }), '2026-11-20T17:00:00.000Z'),
    )
    const now = '2026-11-20T17:00:00.000Z'
    await refreshReports({ db, now, deps: deps({ reportProviders: [provider] }), target: null, trigger: 'schedule' })
    const latest = await latestStatusEvent(db, 'alta')
    expect([latest?.status, latest?.prov.kind]).toEqual(['open', 'official'])

    // Later status runs leave the official statement alone.
    await derive('2026-11-20T18:00:00.000Z')
    expect((await latestStatusEvent(db, 'alta'))?.status).toBe('open')
  })

  it('supersedes an earlier-dated statement first recorded today without moving ahead of anything else', async () => {
    const db = await testDb()
    await addResort(db, { id: 'alta' })
    await addSeason(db, 'alta', { announcedOpening: '2026-11-20' })
    // Yesterday's "not yet open" report, without a publish time, first fetched this morning (08:00 local).
    await recordStatus(db, { resortId: 'alta', status: 'not-yet-open', localDate: '2026-11-19', effectiveAt: '2026-11-20T15:00:00.000Z', prov: official })
    await deriveStatuses({ db, now: '2026-11-20T16:00:00.000Z', deps: deps(), target: null, trigger: 'schedule' })
    const e = await latestStatusEvent(db, 'alta')
    expect([e?.status, e?.prov.kind, e?.localDate, e?.effectiveAt]).toEqual(['unknown', 'derived', '2026-11-20', '2026-11-20T15:00:00.000Z'])
  })

  it('a statement from last season does not block the new season\'s derived status', async () => {
    const lastSpring = { status: 'closed-for-season' as const, localDate: '2026-04-15', prov: official }
    const season = { announcedOpening: '2026-11-20', actualOpening: null, actualClosing: null }
    expect(deriveSeasonStatus(season, '2026-10-01', lastSpring)?.status).toBe('not-yet-open')
    expect(deriveSeasonStatus(season, '2026-11-21', lastSpring)?.status).toBe('unknown')

    const db = await testDb()
    await addResort(db, { id: 'alta' })
    await addSeason(db, 'alta', { announcedOpening: '2026-11-20' })
    await recordStatus(db, { resortId: 'alta', status: 'closed-for-season', localDate: '2026-04-15', effectiveAt: '2026-04-15T22:00:00.000Z', prov: official })
    await deriveStatuses({ db, now: '2026-10-01T16:00:00.000Z', deps: deps(), target: null, trigger: 'schedule' })
    const e = await latestStatusEvent(db, 'alta')
    expect([e?.status, e?.prov.kind, e?.localDate]).toEqual(['not-yet-open', 'derived', '2026-10-01'])
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
