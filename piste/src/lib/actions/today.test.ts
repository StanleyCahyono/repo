import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// The actions read the per-request context; point it at the in-memory fixture.
const holder: { ctx: unknown } = { ctx: null }
vi.mock('@/lib/context', () => ({ getCtx: async () => holder.ctx }))

import * as s from '@/lib/db/schema'
import { buildFixture, NOW, type Fixture } from '@/lib/data/fixtures.test-helpers'
import { defaultPreferences } from '@/lib/domain/defaults'
import { completeOnboarding, markAlertsRead, rankWindow, saveWeights, skipOnboarding } from './today'

let fx: Fixture
const prefs = async () => (await fx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1)))[0]

beforeAll(async () => {
  fx = await buildFixture()
  holder.ctx = fx.ctx
  await fx.db.insert(s.userPreferences).values(defaultPreferences(NOW))
  await fx.db.insert(s.alerts).values([
    { type: 'pass-deadline', dedupeKey: 'a1', title: 'Deadline', body: 'Sales close soon', firedAt: NOW },
    { type: 'snow-threshold', dedupeKey: 'a2', title: 'Snow', body: 'Likely 8 in', firedAt: NOW },
  ])
})

describe('weights', () => {
  it('refuses weights that cannot rank anything, and saves valid ones with the previous set for Undo', async () => {
    expect(await saveWeights({ conditions: 0, fit: 0, travel: 0, cost: 0, events: 0 })).toMatchObject({ ok: false })
    expect(await saveWeights({ conditions: 12.5, fit: 0, travel: 0, cost: 0, events: 0 })).toMatchObject({ ok: false })
    const res = await saveWeights({ conditions: 60, fit: 10, travel: 10, cost: 20, events: 0 })
    expect(res).toMatchObject({ ok: true, data: { previous: { conditions: 35, fit: 25, travel: 20, cost: 15, events: 5 } } })
    expect((await prefs()).weights).toEqual({ conditions: 60, fit: 10, travel: 10, cost: 20, events: 0 })
  })

  it('previews a window with unsaved weights without writing them', async () => {
    const before = (await prefs()).weights
    const res = await rankWindow({ window: 'weekend', weights: { conditions: 0, fit: 0, travel: 100, cost: 0, events: 0 } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.dates).toEqual(['2027-01-16', '2027-01-17'])
    expect(res.data.weights).toMatchObject({ travel: 100 })
    // A confirmed closure or unknown status never lands among the feasible options.
    expect(res.data.options.every((o) => o.eligibility !== 'status-unknown')).toBe(true)
    expect((await prefs()).weights).toEqual(before)
    expect(await rankWindow({ window: 'someday' as never })).toMatchObject({ ok: false })
  })
})

describe('alerts', () => {
  it('marks alerts read once, and Undo marks them unread again', async () => {
    const rows = await fx.db.select({ id: s.alerts.id }).from(s.alerts)
    const ids = rows.map((r) => r.id)
    expect(await markAlertsRead({ ids })).toMatchObject({ ok: true, data: { ids } })
    expect(await markAlertsRead({ ids })).toMatchObject({ ok: true, data: { ids: [] } })
    expect((await fx.db.select().from(s.alerts)).every((a) => a.readAt === NOW)).toBe(true)
    expect(await markAlertsRead({ ids: [ids[0]], read: false })).toMatchObject({ ok: true, data: { ids: [ids[0]] } })
    expect((await fx.db.select().from(s.alerts).where(eq(s.alerts.id, ids[0])))[0].readAt).toBeNull()
    expect(await markAlertsRead({ ids: [] })).toMatchObject({ ok: false })
  })
})

describe('onboarding', () => {
  const base = {
    home: null,
    ability: 'novice' as const,
    units: { temperature: 'C' as const, snow: 'cm' as const, distance: 'km' as const, elevation: 'm' as const },
    passes: [] as string[],
    travel: { maxDriveHours: 3, willingToFly: false },
  }

  it('validates the home and refuses products that are not in the catalog', async () => {
    expect(await completeOnboarding({ ...base, home: { name: 'Burlington, VT', lat: 144, lon: -73.2, timezone: 'America/New_York' } })).toMatchObject({
      ok: false,
      fieldErrors: { 'home.lat': expect.any(String) },
    })
    expect(await completeOnboarding({ ...base, home: { name: 'Burlington, VT', lat: 44.5, lon: -73.2, timezone: 'Mars/Olympus' } })).toMatchObject({
      ok: false,
    })
    expect(await completeOnboarding({ ...base, passes: ['no-such-pass'] })).toMatchObject({ ok: false, fieldErrors: { passes: expect.any(String) } })
    expect((await prefs()).onboardingDone).toBe(false)
  })

  it('saves the five answers, records only new exact products (no price invented) and finishes setup', async () => {
    const res = await completeOnboarding({ ...base, passes: ['indy-base-2026-27', 'ikon-base-2026-27'] })
    expect(res).toMatchObject({ ok: true, data: { addedPasses: ['Ikon Base Pass'] } })
    const p = await prefs()
    expect(p).toMatchObject({ ability: 'novice', onboardingDone: true, homeName: 'Ithaca, NY' })
    expect(p.units).toEqual({ temperature: 'C', snow: 'cm', distance: 'km', elevation: 'm', speed: 'kmh' })
    expect(p.travel).toMatchObject({ maxDriveHours: 3, willingToFly: false, winterBufferPct: 20 })
    const mine = await fx.db.select().from(s.passOwnership).where(eq(s.passOwnership.holder, 'me'))
    expect(mine.map((m) => m.productId).sort()).toEqual(['ikon-base-2026-27', 'indy-base-2026-27'])
    expect(mine.find((m) => m.productId === 'ikon-base-2026-27')?.pricePaidMinor ?? null).toBeNull()
  })

  it('skipping keeps the defaults and hides the panel', async () => {
    await fx.db.update(s.userPreferences).set({ onboardingDone: false }).where(eq(s.userPreferences.id, 1))
    expect(await skipOnboarding()).toMatchObject({ ok: true })
    expect((await prefs()).onboardingDone).toBe(true)
  })
})
