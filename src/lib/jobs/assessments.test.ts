import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { conditionsAssessments } from '@/lib/db/schema'
import { addHours } from '@/lib/domain/time'
import { provenance } from '@/lib/domain/types'
import type { WeatherPointRequest } from '@/lib/providers/types'
import { assessmentFingerprint, refreshAssessments } from './assessments'
import { addManualReport, addPersonalReport } from './reports'
import { addPrefs, addResort, addSeason, deps, hours, series, T0, testDb } from './test-helpers'
import type { JobContext } from './types'
import { persistWeatherSeries, weatherRequests } from './weather'

async function setup() {
  const db = await testDb()
  await addPrefs(db)
  const resort = await addResort(db, { id: 'alta' }, { favorite: true })
  await addSeason(db, 'alta', { announcedOpening: '2026-11-20', actualOpening: '2026-11-22' })
  const persistRun = async (fetchedAt: string) => {
    for (const req of weatherRequests(resort) as WeatherPointRequest[]) {
      await persistWeatherSeries(db, {
        resort,
        request: req,
        providerId: 'open-meteo',
        series: series(req, hours('2027-01-12T00:00:00Z', 24 * 11), { horizonDays: 7 }),
        provenance: provenance({ kind: 'modeled', provider: 'Open-Meteo', fetchedAt }),
        capabilities: { supplied: [], missing: [], limitations: [] },
        now: fetchedAt,
      })
    }
  }
  const run = (now: string, demo = false) =>
    refreshAssessments({ db, now, deps: deps({ demo }), target: null, trigger: 'schedule' } satisfies JobContext)
  const count = async () => (await db.select().from(conditionsAssessments)).length
  return { db, persistRun, run, count }
}

describe('assessments history', () => {
  it('covers today−1 … horizon in every mode, and re-inserts only when the result changes', async () => {
    const { db, persistRun, run, count } = await setup()
    await persistRun(T0)
    const first = await run(T0)
    // 15 Jan (Denver) − 1 → 14 Jan … 21 Jan (7-day horizon) = 8 dates × 3 modes.
    expect(first.items[0].written).toBe(24)
    const dates = new Set((await db.select().from(conditionsAssessments)).map((r) => r.localDate))
    expect([...dates].sort()[0]).toBe('2027-01-14')
    expect([...dates].sort().at(-1)).toBe('2027-01-21')

    // Same evidence → nothing new.
    expect((await run(T0)).items[0].written).toBe(0)
    // A newer weather run with the same values changes nothing either (run ids are not part of the fingerprint).
    await persistRun(addHours(T0, 1))
    expect((await run(addHours(T0, 1))).items[0].written).toBe(0)
    expect(await count()).toBe(24)

    // New official evidence for today changes the result: new rows are appended, earlier ones are preserved.
    const rep = await addManualReport(
      db,
      {
        resortId: 'alta',
        localDate: '2027-01-15',
        sourceUrl: 'https://www.alta.com/conditions',
        reportedAt: '2027-01-15T13:30:00.000Z',
        status: 'open',
        surfaceTags: ['packed-powder'],
        openTrails: 100,
        totalTrails: 116,
        openBeginnerTrails: 10,
        totalBeginnerTrails: 12,
      },
      addHours(T0, 1),
    )
    const after = await run(addHours(T0, 1))
    expect(after.items[0].written).toBeGreaterThan(0)
    expect(await count()).toBe(24 + after.items[0].written)
    const today = await db
      .select()
      .from(conditionsAssessments)
      .where(and(eq(conditionsAssessments.localDate, '2027-01-15'), eq(conditionsAssessments.mode, 'all-mountain')))
      .orderBy(conditionsAssessments.id)
    expect(today).toHaveLength(2)
    expect(today[0].inputs.reportId).toBeNull() // what the app estimated then
    expect(today[1].inputs.reportId).toBe(rep.id)
    expect(assessmentFingerprint(today[0])).not.toBe(assessmentFingerprint(today[1]))
  })

  it('reads personal feedback as feedback, never as the operations report', async () => {
    const { db, persistRun, run } = await setup()
    await persistRun(T0)
    await addPersonalReport(db, { resortId: 'alta', localDate: '2027-01-15', surfaceTags: ['icy-refrozen'] }, T0)
    await run(T0)
    const rows = await db.select().from(conditionsAssessments).where(eq(conditionsAssessments.localDate, '2027-01-15'))
    expect(rows.every((r) => r.inputs.reportId === null)).toBe(true)
  })

  it('marks rows computed in the demo database as demo', async () => {
    const { db, persistRun, run } = await setup()
    await persistRun(T0)
    await run(T0, true)
    const rows = await db.select().from(conditionsAssessments)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.kind === 'demo')).toBe(true)
  })
})
