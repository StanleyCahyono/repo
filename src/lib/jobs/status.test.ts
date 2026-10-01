import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openingDateHistory, resortSeasons, seasons, statusEvents } from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import { refreshReports } from './reports'
import { applyStatusToSeason, deriveSeasonStatus, deriveStatuses, latestStatusEvent, recordStatus, updateSeasonDates } from './status'
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

describe('status filing by hemisphere', () => {
  const at = (d: string) => `${d}T02:00:00.000Z`
  const seasonsOf = async (db: Awaited<ReturnType<typeof testDb>>, id: string) =>
    (await db.select().from(resortSeasons).where(eq(resortSeasons.resortId, id))).map((r) => [r.seasonId, r.actualOpening, r.actualClosing]).sort()

  it('files a Southern Hemisphere winter under one season across 1 July, creating the season rows it needs', async () => {
    const db = await testDb()
    await addResort(db, { id: 'thredbo', timezone: 'Australia/Sydney', lat: -36.5048, lon: 148.3, country: 'AU' })
    // Opens in June 2026, reported open in August, closes in September: all of it is the 2026 winter = 2025-26.
    expect(await applyStatusToSeason(db, { resortId: 'thredbo', status: 'open', localDate: '2026-06-06', prov: official, now: at('2026-06-06') })).toEqual(['actualOpening'])
    expect(await applyStatusToSeason(db, { resortId: 'thredbo', status: 'open', localDate: '2026-08-01', prov: official, now: at('2026-08-01') })).toEqual([])
    expect(await applyStatusToSeason(db, { resortId: 'thredbo', status: 'closed-for-season', localDate: '2026-09-21', prov: official, now: at('2026-09-21') })).toEqual(['actualClosing'])
    expect(await seasonsOf(db, 'thredbo')).toEqual([['2025-26', '2026-06-06', '2026-09-21']])
    const [row] = await db.select().from(seasons).where(eq(seasons.id, '2025-26'))
    expect(row).toMatchObject({ id: '2025-26', label: '2025–26' })
    // A northern resort splits the same dates at 1 July: the June opening is 2025-26, the August one 2026-27.
    await addResort(db, { id: 'alta' })
    await applyStatusToSeason(db, { resortId: 'alta', status: 'open', localDate: '2026-06-06', prov: official, now: at('2026-06-06') })
    await applyStatusToSeason(db, { resortId: 'alta', status: 'open', localDate: '2026-08-01', prov: official, now: at('2026-08-01') })
    expect(await seasonsOf(db, 'alta')).toEqual([
      ['2025-26', '2026-06-06', null],
      ['2026-27', '2026-08-01', null],
    ])
  })

  it('starts a new Southern Hemisphere season on 1 January', async () => {
    const db = await testDb()
    await addResort(db, { id: 'mt-hutt', timezone: 'Pacific/Auckland', lat: -43.471, lon: 171.53, country: 'NZ' })
    await applyStatusToSeason(db, { resortId: 'mt-hutt', status: 'open', localDate: '2026-12-31', prov: official, now: at('2026-12-31') })
    await applyStatusToSeason(db, { resortId: 'mt-hutt', status: 'open', localDate: '2027-01-01', prov: official, now: at('2027-01-01') })
    expect(await seasonsOf(db, 'mt-hutt')).toEqual([
      ['2025-26', '2026-12-31', null],
      ['2026-27', '2027-01-01', null],
    ])
    // The hemisphere can be passed explicitly (no lookup).
    await addResort(db, { id: 'cardrona', timezone: 'Pacific/Auckland', lat: -44.875, lon: 168.95, country: 'NZ' })
    await applyStatusToSeason(db, { resortId: 'cardrona', status: 'open', localDate: '2027-07-10', prov: official, now: at('2027-07-10'), hemisphere: 'south' })
    expect(await seasonsOf(db, 'cardrona')).toEqual([['2026-27', '2027-07-10', null]])
  })

  it('derives statuses from the resort’s own season: a September Southern Hemisphere day is not in next winter’s preseason', async () => {
    // Season 2026-27 at Thredbo is the 2027 winter; its announced June 2027 opening says nothing about September 2026.
    const next = { announcedOpening: '2027-06-12', actualOpening: null, actualClosing: null }
    const closedSept = { status: 'closed-for-season' as const, localDate: '2026-09-21', prov: official }
    // Same season (2025-26) as today → an official statement of this winter is not superseded.
    expect(deriveSeasonStatus(null, '2026-09-30', closedSept, 'south')).toBeNull()
    // In January the new southern season has begun: last September's closure no longer blocks "not yet open".
    expect(deriveSeasonStatus(next, '2027-01-05', closedSept, 'south')?.status).toBe('not-yet-open')
    // Read as northern, September and January would be the same season and the closure would stand.
    expect(deriveSeasonStatus(next, '2027-01-05', closedSept, 'north')).toBeNull()

    const db = await testDb()
    await addResort(db, { id: 'thredbo', timezone: 'Australia/Sydney', lat: -36.5048, lon: 148.3, country: 'AU' })
    await addSeason(db, 'thredbo', { announcedOpening: '2027-06-12' })
    await recordStatus(db, { resortId: 'thredbo', status: 'open', localDate: '2026-09-12', effectiveAt: '2026-09-11T22:00:00.000Z', prov: official })
    // 30 Sep 2026 in Sydney: the 2027 winter's announced opening must not turn today's winter into "not yet open".
    await deriveStatuses({ db, now: '2026-09-30T02:00:00.000Z', deps: deps(), target: null, trigger: 'schedule' })
    expect((await latestStatusEvent(db, 'thredbo'))?.status).toBe('open')
    // In January (2027 winter's season) the announced opening applies.
    await deriveStatuses({ db, now: '2027-01-05T02:00:00.000Z', deps: deps(), target: null, trigger: 'schedule' })
    expect((await latestStatusEvent(db, 'thredbo'))).toMatchObject({ status: 'not-yet-open', localDate: '2027-01-05' })
  })
})
