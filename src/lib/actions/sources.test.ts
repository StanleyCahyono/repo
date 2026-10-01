import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const ctxRef: { current: unknown } = { current: null }
vi.mock('@/lib/context', () => ({ getCtx: async () => ctxRef.current }))

import { and, eq } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import { buildFixture, NOW, type Fixture } from '@/lib/data/fixtures.test-helpers'
import { loadCorrections } from '@/lib/data/settings-screen'
import { addCorrection, deleteCorrectionRow, loadCorrectableValues, restoreCorrections, revertCorrection } from './sources'

let fx: Fixture
let clock = 0

beforeAll(async () => {
  fx = await buildFixture()
  ctxRef.current = fx.ctx
})

/** Each action call gets a later app clock, so "newest correction wins" is deterministic. */
function tick() {
  clock += 1
  ctxRef.current = { ...fx.ctx, now: new Date(Date.parse(NOW) + clock * 60_000).toISOString() }
}

const rowsFor = (resortId: string, field: string) =>
  fx.db
    .select()
    .from(s.resortOverrides)
    .where(and(eq(s.resortOverrides.resortId, resortId), eq(s.resortOverrides.field, field)))

describe('manual catalog corrections', () => {
  it('needs a source link or a note, a known field and a value applyOverrides accepts', async () => {
    tick()
    expect(await addCorrection({ resortId: 'test-peak', field: 'terrain.trails', raw: '40', sourceUrl: null, note: null })).toMatchObject({
      ok: false,
      fieldErrors: { sourceUrl: expect.any(String) },
    })
    expect(await addCorrection({ resortId: 'test-peak', field: 'photo', raw: 'x', sourceUrl: 'https://example.org', note: null })).toMatchObject({ ok: false, fieldErrors: { field: expect.any(String) } })
    expect(await addCorrection({ resortId: 'test-peak', field: 'terrain.trails', raw: 'forty', sourceUrl: 'https://example.org', note: null })).toMatchObject({
      ok: false,
      fieldErrors: { raw: expect.any(String) },
    })
    expect(await addCorrection({ resortId: 'test-peak', field: 'terrain.trails', raw: '40', sourceUrl: 'ftp://example.org', note: null })).toMatchObject({
      ok: false,
      fieldErrors: { sourceUrl: expect.any(String) },
    })
    expect(await addCorrection({ resortId: 'nowhere', field: 'terrain.trails', raw: '40', sourceUrl: null, note: 'Phoned them' })).toMatchObject({ ok: false })
  })

  it('stores elevations in metres, applies the newest correction, and lists what it replaced', async () => {
    tick()
    const first = await addCorrection({ resortId: 'test-peak', field: 'summitElevationM', raw: '2,000', unit: 'ft', sourceUrl: 'https://example.org/stats', note: null })
    expect(first).toMatchObject({ ok: true, data: { value: 609.6 } })
    tick()
    const second = await addCorrection({ resortId: 'test-peak', field: 'summitElevationM', raw: '650', unit: 'm', sourceUrl: null, note: 'Trail map 2026-27' })
    expect(second).toMatchObject({ ok: true })

    const list = await loadCorrections(fx.ctx)
    const item = list.find((c) => c.resortId === 'test-peak' && c.field === 'summitElevationM')
    expect(item).toMatchObject({ value: 650, catalogValue: 640, applied: true, revisions: 2, note: 'Trail map 2026-27' })

    const current = await loadCorrectableValues({ resortId: 'test-peak' })
    expect(current).toMatchObject({ ok: true, data: { current: { summitElevationM: 650 }, corrected: expect.arrayContaining(['summitElevationM']) } })
  })

  it('Undo of an add removes only that row; the earlier correction applies again', async () => {
    tick()
    const added = await addCorrection({ resortId: 'test-peak', field: 'features.nightSkiing', raw: 'yes', sourceUrl: 'https://example.org/night', note: null })
    tick()
    const newer = await addCorrection({ resortId: 'test-peak', field: 'features.nightSkiing', raw: 'no', sourceUrl: 'https://example.org/night', note: 'Night skiing ended' })
    if (!added.ok || !newer.ok) throw new Error('expected both corrections to save')
    expect(await deleteCorrectionRow({ id: newer.data.id })).toMatchObject({ ok: true })
    const rows = await rowsFor('test-peak', 'features.nightSkiing')
    expect(rows.map((r) => r.id)).toEqual([added.data.id])
    expect(await deleteCorrectionRow({ id: newer.data.id })).toMatchObject({ ok: false })
  })

  it('revert removes every row for the field (the catalog value returns); restore puts the same rows back', async () => {
    const before = await rowsFor('test-peak', 'summitElevationM')
    expect(before).toHaveLength(2)
    const reverted = await revertCorrection({ resortId: 'test-peak', field: 'summitElevationM' })
    if (!reverted.ok) throw new Error(reverted.error)
    expect(await rowsFor('test-peak', 'summitElevationM')).toEqual([])
    expect((await loadCorrectableValues({ resortId: 'test-peak' })).ok && (await loadCorrectableValues({ resortId: 'test-peak' }))).toMatchObject({ data: { current: { summitElevationM: 640 } } })
    expect(await revertCorrection({ resortId: 'test-peak', field: 'summitElevationM' })).toMatchObject({ ok: false })

    expect(await restoreCorrections(reverted.data)).toMatchObject({ ok: true, data: 2 })
    expect(await rowsFor('test-peak', 'summitElevationM')).toEqual(before)
  })
})
