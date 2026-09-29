import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const ctxRef: { current: unknown } = { current: null }
vi.mock('@/lib/context', () => ({ getCtx: async () => ctxRef.current }))
const runJob = vi.fn(async () => ({ status: 'ok' }))
vi.mock('@/lib/jobs/runner', () => ({ runJob: (...args: unknown[]) => runJob(...(args as [])) }))

import { and, eq } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import { buildFixture, TODAY, type Fixture } from '@/lib/data/fixtures.test-helpers'
import { addResortDaysToTrip, saveMyRating, submitManualReport, submitPersonalReport, type ManualReportForm } from './resort'

let fx: Fixture

const form = (over: Partial<ManualReportForm> = {}): ManualReportForm => ({
  resortId: 'test-peak',
  localDate: TODAY,
  kind: 'manual',
  sourceUrl: 'https://example.org/report',
  sourceLabel: null,
  reportedTime: '07:30',
  status: null,
  snowUnit: 'in',
  snowfall: [],
  baseDepth: null,
  baseDepthLocation: null,
  summitDepth: null,
  surfaceTags: [],
  surfaceText: null,
  groomingText: null,
  groomedRuns: null,
  snowmakingText: null,
  openTrails: null,
  totalTrails: null,
  openLifts: null,
  totalLifts: null,
  openBeginnerTrails: null,
  totalBeginnerTrails: null,
  openAcres: null,
  notes: null,
  ...over,
})

beforeAll(async () => {
  fx = await buildFixture()
  ctxRef.current = fx.ctx
})

beforeEach(() => {
  runJob.mockClear()
})

describe('submitManualReport — the manual-edit route for official figures', () => {
  it('requires a source link', async () => {
    const r = await submitManualReport(form({ sourceUrl: '', snowfall: [{ window: '24h', amount: 4, sourceText: '4"' }] }))
    expect(r).toMatchObject({ ok: false, fieldErrors: { sourceUrl: 'A source link is required for official figures' } })
  })

  it('refuses a publish time more than a few minutes in the future (the jobs module’s rule)', async () => {
    // App clock: 09:00 in New York.
    const r = await submitManualReport(form({ reportedTime: '23:00', baseDepth: 30 }))
    expect(r).toMatchObject({ ok: false, fieldErrors: { reportedTime: 'Reported time cannot be in the future' } })
  })

  it('refuses a report for a resort-local date that has not started', async () => {
    const r = await submitManualReport(form({ localDate: '2027-01-16', reportedTime: null, baseDepth: 30 }))
    expect(r).toMatchObject({ ok: false, fieldErrors: { localDate: expect.stringMatching(/or earlier/) } })
  })

  it('refuses more open trails than the total, and an empty report', async () => {
    expect(await submitManualReport(form({ openTrails: 60, totalTrails: 55 }))).toMatchObject({ ok: false, fieldErrors: { openTrails: 'More open trails than the total' } })
    expect(await submitManualReport(form())).toMatchObject({ ok: false, error: 'Add at least one figure or statement from the source' })
  })

  it('stores a transcribed report with its source, converting inches to cm, and recomputes the score', async () => {
    const r = await submitManualReport(
      form({ snowfall: [{ window: '24h', amount: 4, sourceText: '4" in 24 hrs' }], baseDepth: 30, surfaceTags: ['packed-powder'], groomingText: '20 trails groomed' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [row] = await fx.db.select().from(s.operationalReports).where(eq(s.operationalReports.id, r.data.id))
    expect(row).toMatchObject({ kind: 'manual', localDate: TODAY, reportedAt: '2027-01-15T12:30:00.000Z', baseDepthCm: 76.2, groomingText: '20 trails groomed' })
    expect(row.snowfall).toEqual([expect.objectContaining({ window: '24h', amountCm: 10.2, sourceText: '4" in 24 hrs' })])
    expect(row.prov).toMatchObject({ kind: 'manual', sourceUrl: 'https://example.org/report', verification: 'user-confirmed', note: 'transcribed' })
    expect(runJob).toHaveBeenCalledWith(expect.objectContaining({ job: 'assessments', target: 'test-peak' }))
  })

  it('an official report I verified can state the status, which is appended to the history', async () => {
    const before = await fx.db.select().from(s.statusEvents).where(eq(s.statusEvents.resortId, 'quiet-hill'))
    const r = await submitManualReport(form({ resortId: 'quiet-hill', kind: 'official', status: 'open', openTrails: 12, totalTrails: 40 }))
    expect(r).toMatchObject({ ok: true, data: { statusAppended: true } })
    const after = await fx.db.select().from(s.statusEvents).where(eq(s.statusEvents.resortId, 'quiet-hill'))
    expect(after.length).toBe(before.length + 1)
    expect(after.at(-1)).toMatchObject({ status: 'open', prov: { kind: 'official', verification: 'user-confirmed', note: 'entered-by-user' } })
  })
})

describe('submitPersonalReport — my own observation', () => {
  it('is stored as personal feedback and never touches the operating status', async () => {
    const statusBefore = await fx.db.select().from(s.statusEvents).where(eq(s.statusEvents.resortId, 'far-west'))
    const r = await submitPersonalReport({ resortId: 'far-west', localDate: TODAY, surfaceTags: ['icy-refrozen'], surfaceText: 'Icy by noon', notes: null })
    expect(r.ok).toBe(true)
    const rows = await fx.db
      .select()
      .from(s.operationalReports)
      .where(and(eq(s.operationalReports.resortId, 'far-west'), eq(s.operationalReports.kind, 'manual')))
    expect(rows.at(-1)).toMatchObject({ status: null, surfaceTags: ['icy-refrozen'], prov: { provider: 'You', note: 'personal' } })
    expect(await fx.db.select().from(s.statusEvents).where(eq(s.statusEvents.resortId, 'far-west'))).toHaveLength(statusBefore.length)
  })

  it('needs a tag or a note, and a day that has started at the resort', async () => {
    expect(await submitPersonalReport({ resortId: 'far-west', localDate: TODAY, surfaceTags: [], surfaceText: null, notes: null })).toMatchObject({ ok: false })
    expect(await submitPersonalReport({ resortId: 'far-west', localDate: '2027-01-16', surfaceTags: ['firm'], surfaceText: null, notes: null })).toMatchObject({
      ok: false,
      fieldErrors: { localDate: expect.any(String) },
    })
  })
})

describe('saveMyRating', () => {
  it('saves, updates and clears my rating', async () => {
    expect(await saveMyRating({ resortId: 'test-peak', rating: 4, review: '  Great learning area  ' })).toMatchObject({ ok: true, data: { rating: 4, review: 'Great learning area' } })
    expect(await saveMyRating({ resortId: 'test-peak', rating: 5, review: null })).toMatchObject({ ok: true, data: { rating: 5, review: null } })
    const [row] = await fx.db.select().from(s.myRatings).where(eq(s.myRatings.resortId, 'test-peak'))
    expect(row).toMatchObject({ rating: 5, review: null })
    expect(await saveMyRating({ resortId: 'test-peak', rating: null, review: null })).toMatchObject({ ok: true, data: { rating: null } })
    expect(await fx.db.select().from(s.myRatings).where(eq(s.myRatings.resortId, 'test-peak'))).toHaveLength(0)
  })

  it('rejects ratings outside 1–5 and unknown resorts', async () => {
    expect(await saveMyRating({ resortId: 'test-peak', rating: 6, review: null })).toMatchObject({ ok: false, fieldErrors: { rating: 'Choose 1–5' } })
    expect(await saveMyRating({ resortId: 'no-such-resort', rating: 3, review: null })).toMatchObject({ ok: false, error: 'Unknown resort' })
  })
})

describe('addResortDaysToTrip', () => {
  it('only adds days inside the trip, and never the same day twice', async () => {
    await fx.db.insert(s.trips).values({
      id: 'jan-trip',
      name: 'January trip',
      status: 'draft',
      startDate: '2027-01-20',
      endDate: '2027-01-22',
      partySize: 1,
      originAirport: null,
      companions: [],
      notes: null,
      createdAt: '2027-01-01T00:00:00.000Z',
      updatedAt: '2027-01-01T00:00:00.000Z',
    })
    expect(await addResortDaysToTrip({ tripId: 'jan-trip', resortId: 'test-peak', dates: ['2027-01-25'] })).toMatchObject({ ok: false, fieldErrors: { dates: 'Outside the trip dates' } })
    expect(await addResortDaysToTrip({ tripId: 'jan-trip', resortId: 'test-peak', dates: ['2027-01-20', '2027-01-21'] })).toMatchObject({ ok: true, data: { skipped: 0 } })
    expect(await addResortDaysToTrip({ tripId: 'jan-trip', resortId: 'test-peak', dates: ['2027-01-21'] })).toMatchObject({ ok: false })
  })
})
