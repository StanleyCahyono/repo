import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const ctxRef: { current: unknown } = { current: null }
vi.mock('@/lib/context', () => ({ getCtx: async () => ctxRef.current }))

import { eq } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import { buildFixture, type Fixture } from '@/lib/data/fixtures.test-helpers'
import { getGearLocker, ownedGearCoverage } from '@/lib/data/gear'
import { deleteGear, resetAvatar, restoreGear, saveAvatar, saveGear, setWearing } from './gear'

let fx: Fixture
const prefsRow = async () => (await fx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1)))[0]
// A 1×1 JPEG-ish payload: the action checks the data-URL shape and size, not the pixels.
const PHOTO = `data:image/jpeg;base64,${'A'.repeat(400)}`

beforeAll(async () => {
  fx = await buildFixture()
  ctxRef.current = fx.ctx
  // The app creates the preferences row on first load (loadPreferences); the fixture keeps it in memory only.
  await fx.db.insert(s.userPreferences).values(fx.ctx.prefs).onConflictDoNothing()
})

describe('gear locker', () => {
  it('starts empty: nothing owned, full rental, nothing to pack', async () => {
    const locker = await getGearLocker(fx.ctx)
    expect(locker.items).toEqual([])
    expect(locker.coverage).toMatchObject({ empty: true, suggestedRental: 'full-package', packing: [], toRent: ['Skis', 'Boots', 'Poles', 'Helmet'] })
    expect(locker.avatar.wearing).toEqual({})
  })

  it('validates input: brand and model required, real dates only, no future purchase, colours and photos checked', async () => {
    expect(await saveGear({ type: 'skis', brandModel: '  ' })).toMatchObject({ ok: false, fieldErrors: { brandModel: expect.any(String) } })
    expect(await saveGear({ type: 'skis', brandModel: 'X', boughtOn: '2027-13-40' })).toMatchObject({ ok: false, fieldErrors: { boughtOn: expect.any(String) } })
    expect(await saveGear({ type: 'skis', brandModel: 'X', boughtOn: '2027-02-01' })).toMatchObject({ ok: false, fieldErrors: { boughtOn: expect.stringMatching(/2027-01-15/) } })
    expect(await saveGear({ type: 'skis', brandModel: 'X', color: 'red' })).toMatchObject({ ok: false, fieldErrors: { color: expect.any(String) } })
    expect(await saveGear({ type: 'skis', brandModel: 'X', photo: 'https://example.com/a.jpg' })).toMatchObject({ ok: false, fieldErrors: { photo: expect.any(String) } })
    expect(await saveGear({ type: 'skis', brandModel: 'X', photo: `data:image/jpeg;base64,${'A'.repeat(300_000)}` })).toMatchObject({ ok: false })
    // @ts-expect-error — an unknown type is refused
    expect(await saveGear({ type: 'hoverboard', brandModel: 'X' })).toMatchObject({ ok: false })
  })

  it('adds an item, wears it (colour copied to the avatar) and keeps the cost "owns" flag in step', async () => {
    const r = await saveGear({ type: 'skis', brandModel: ' Example Carver 160 ', size: '160 cm', boughtOn: '2026-11-02', color: '#C8502A', photo: PHOTO, wear: true })
    expect(r).toMatchObject({ ok: true, data: { created: true } })
    if (!r.ok) return
    const [row] = await fx.db.select().from(s.gear).where(eq(s.gear.id, r.data.id))
    expect(row).toMatchObject({ type: 'skis', brandModel: 'Example Carver 160', size: '160 cm', boughtOn: '2026-11-02', color: '#c8502a', photo: PHOTO, notes: null })
    expect(r.data.avatar.colors.skis).toBe('#c8502a')
    expect(r.data.avatar.wearing.skis).toBe(r.data.id)
    expect((await prefsRow()).gear.ownsSkis).toBe(true)
    expect((await prefsRow()).gear.rentalOption).toBe('full-package') // a suggestion only — never changed silently

    const cov = await ownedGearCoverage(fx.db)
    expect(cov).toMatchObject({ empty: false, ownsSkis: true, ownsBoots: false, suggestedRental: 'boots-only', packing: [{ type: 'skis', label: 'Skis — Example Carver 160' }] })
  })

  it('a manual avatar colour clears the worn item in that slot; wearing it again restores it', async () => {
    const locker = await getGearLocker(fx.ctx)
    const skis = locker.items.find((i) => i.type === 'skis')!
    expect(skis.worn).toBe(true)
    const a = await saveAvatar({ colors: { skis: '#1c6c9c' }, look: 'holo' })
    expect(a).toMatchObject({ ok: true, data: { avatar: { look: 'holo', colors: { skis: '#1c6c9c' }, wearing: {} } } })
    const w = await setWearing({ id: skis.id, wear: true })
    expect(w).toMatchObject({ ok: true, data: { avatar: { colors: { skis: '#c8502a' }, wearing: { skis: skis.id } } } })
    expect(await saveAvatar({ colors: { jacket: 'orange' } })).toMatchObject({ ok: false })
  })

  it('refuses to wear an item the avatar does not draw', async () => {
    const r = await saveGear({ type: 'snowboard', brandModel: 'Example Board 152', wear: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.data.avatar.wearing).not.toHaveProperty('snowboard')
    expect(await setWearing({ id: r.data.id, wear: true })).toMatchObject({ ok: false })
  })

  it('removing takes it off the avatar and clears the owns flag; Undo restores both', async () => {
    const skis = (await getGearLocker(fx.ctx)).items.find((i) => i.type === 'skis')!
    const d = await deleteGear({ id: skis.id })
    expect(d).toMatchObject({ ok: true, data: { snapshot: { id: skis.id, wornIn: 'skis' } } })
    if (!d.ok) return
    expect((await prefsRow()).gear.ownsSkis).toBe(false)
    expect((await prefsRow()).avatar?.wearing.skis).toBeUndefined()
    const back = await restoreGear({ snapshot: d.data.snapshot })
    expect(back).toMatchObject({ ok: true, data: { id: skis.id } })
    expect((await prefsRow()).gear.ownsSkis).toBe(true)
    expect((await prefsRow()).avatar?.wearing.skis).toBe(skis.id)
  })

  it('editing an item to another type moves the owns flags and the worn slot', async () => {
    const skis = (await getGearLocker(fx.ctx)).items.find((i) => i.type === 'skis')!
    const r = await saveGear({ id: skis.id, type: 'boots', brandModel: 'Example Boot', color: '#1b2733', wear: true })
    expect(r).toMatchObject({ ok: true, data: { created: false } })
    const p = await prefsRow()
    expect(p.gear).toMatchObject({ ownsSkis: false, ownsBoots: true })
    expect(p.avatar?.wearing).toMatchObject({ boots: skis.id })
    expect(p.avatar?.wearing.skis).toBeUndefined()
    expect(await saveGear({ id: 99999, type: 'boots', brandModel: 'Gone' })).toMatchObject({ ok: false })
  })

  it('reset brings back the default look without touching the locker', async () => {
    const before = (await getGearLocker(fx.ctx)).items.length
    const r = await resetAvatar()
    expect(r).toMatchObject({ ok: true, data: { avatar: { look: 'suit', wearing: {}, backpack: false, poles: true } } })
    expect((await getGearLocker(fx.ctx)).items.length).toBe(before)
  })
})
