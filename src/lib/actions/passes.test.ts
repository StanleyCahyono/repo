/**
 * Passes & Costs actions end to end against an in-memory database: your price estimates (stored as 'user-estimate',
 * labelled as yours, editable/removable with undo, outranked by published prices), owned passes with ONE linked
 * purchase expense, logged days, and manual access rules that always insert a new version.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/context', () => ({ getCtx: async () => state.ctx, MODE_COOKIE: 'piste-mode' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import * as s from '@/lib/db/schema'
import { buildFixture, fixtureResort, type Fixture } from '@/lib/data/fixtures.test-helpers'
import { getCheckerView, getDayCostsView, getPassCompareView } from '@/lib/data/passes-screen'
import {
  addOwnedPass,
  addPriceEstimate,
  logPassDay,
  removeOwnedPass,
  removePriceEstimate,
  restoreOwnedPass,
  restorePriceEstimate,
  saveAccessRule,
  updatePriceEstimate,
} from './passes'

let fx: Fixture

function ok<T>(r: { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> }): T {
  if (!r.ok) throw new Error(`${r.error} ${JSON.stringify(r.fieldErrors ?? {})}`)
  return r.data
}

const SAT = '2027-01-16'
const WED = '2027-01-20'

beforeAll(async () => {
  // 'bare-hill' has no prices on file at all — the gap your estimates fill.
  fx = await buildFixture({ extraResorts: [fixtureResort('bare-hill', { prices: [] })] })
  state.ctx = { ...fx.ctx, mode: 'live' }
})

const liftAt = async (resortId: string, date: string) => {
  const v = await getDayCostsView(fx.ctx, { date })
  const row = v.rows.find((r) => r.resort.id === resortId)!
  return { v, row, lift: row.basket.lines.find((l) => l.key === 'lift')! }
}

describe('your price estimates', () => {
  let estimateId = 0

  it('fills a missing lift price as "Your estimate" — stored as user-estimate, never published', async () => {
    const before = await liftAt('bare-hill', SAT)
    expect(before.lift.amount).toBeNull()
    expect(before.row.basket.complete).toBe(false)

    const res = ok(await addPriceEstimate({ subject: 'lift-ticket', subjectId: 'bare-hill', dayType: 'weekend', amount: '70', currency: 'usd', note: 'last season + 5%' }))
    estimateId = res.id
    const [row] = await fx.db.select().from(s.priceSnapshots).where(eq(s.priceSnapshots.id, estimateId))
    expect(row).toMatchObject({ quoteKind: 'user-estimate', subjectType: 'lift-ticket', subjectId: 'bare-hill', resortId: 'bare-hill', category: 'adult', dayType: 'weekend', seasonId: '2026-27', amountMinor: 7000, currency: 'USD' })
    expect(row.prov).toMatchObject({ kind: 'manual', provider: 'You', note: 'Your estimate — last season + 5%' })

    const after = await liftAt('bare-hill', SAT)
    expect(after.lift).toMatchObject({ kind: 'user-estimate', snapshotId: estimateId, amount: { amountMinor: 7000, currency: 'USD' } })
    expect(after.row.estimates).toEqual([expect.objectContaining({ id: estimateId, subject: 'lift-ticket', dayType: 'weekend', amountMajor: '70.00', note: 'last season + 5%' })])
    expect(after.v.withEstimates).toBe(1)
  })

  it('is day-type specific: a weekend estimate never prices a weekday', async () => {
    const { lift } = await liftAt('bare-hill', WED)
    expect(lift.amount).toBeNull()
  })

  it('refuses a second estimate for the same thing — edit the first instead', async () => {
    const res = await addPriceEstimate({ subject: 'lift-ticket', subjectId: 'bare-hill', dayType: 'weekend', amount: '75', currency: 'USD' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.fieldErrors?.dayType).toBeTruthy()
  })

  it('edits in place and undoes the edit', async () => {
    const res = ok(await updatePriceEstimate({ id: estimateId, dayType: 'any', amount: '72.50', amountMax: '80', currency: 'USD', note: null }))
    expect(res.previous).toMatchObject({ amountMinor: 7000, dayType: 'weekend' })
    const wed = await liftAt('bare-hill', WED)
    expect(wed.lift).toMatchObject({ kind: 'user-estimate', amount: { amountMinor: 7250 }, amountMax: { amountMinor: 8000 } })

    ok(await restorePriceEstimate({ snapshot: res.previous }))
    const [row] = await fx.db.select().from(s.priceSnapshots).where(eq(s.priceSnapshots.id, estimateId))
    expect(row).toMatchObject({ amountMinor: 7000, amountMaxMinor: null, dayType: 'weekend' })
    expect(row.prov.note).toBe('Your estimate — last season + 5%')
  })

  it('removes with undo (same id back)', async () => {
    const res = ok(await removePriceEstimate({ id: estimateId }))
    expect((await liftAt('bare-hill', SAT)).lift.amount).toBeNull()
    ok(await restorePriceEstimate({ snapshot: res.snapshot }))
    expect((await liftAt('bare-hill', SAT)).lift).toMatchObject({ kind: 'user-estimate', snapshotId: estimateId })
  })

  it('never edits or deletes a published price', async () => {
    const [published] = await fx.db.select().from(s.priceSnapshots).where(and(eq(s.priceSnapshots.subjectId, 'expert-bowl'), eq(s.priceSnapshots.quoteKind, 'published')))
    expect(published).toBeTruthy()
    expect((await removePriceEstimate({ id: published.id })).ok).toBe(false)
    expect((await updatePriceEstimate({ id: published.id, dayType: 'any', amount: '1', currency: 'USD' })).ok).toBe(false)
  })

  it('a published price outranks your estimate for the same day', async () => {
    // expert-bowl has a published weekday price (and no rule for my pass, so the lift is priced, not covered).
    ok(await addPriceEstimate({ subject: 'lift-ticket', subjectId: 'expert-bowl', dayType: 'weekday', amount: '50', currency: 'USD' }))
    const { lift } = await liftAt('expert-bowl', WED)
    expect(lift).toMatchObject({ kind: 'published', amount: { amountMinor: 6000 } })
  })

  it('rental estimates match the rental option; parking is per vehicle', async () => {
    ok(await addPriceEstimate({ subject: 'rental', subjectId: 'bare-hill', rentalOption: 'full-package', dayType: 'any', amount: '40', currency: 'USD' }))
    ok(await addPriceEstimate({ subject: 'parking', subjectId: 'bare-hill', dayType: 'any', amount: '10', currency: 'USD' }))
    const { row } = await liftAt('bare-hill', SAT)
    expect(row.basket.lines.find((l) => l.key === 'rental')).toMatchObject({ kind: 'user-estimate', amount: { amountMinor: 4000 } })
    expect(row.basket.lines.find((l) => l.key === 'parking')).toMatchObject({ kind: 'user-estimate', amount: { amountMinor: 1000 } })
    // Lift (weekend estimate) + rental + lunch + parking = $145: a complete basket, tier $$, built from your estimates.
    expect(row.basket).toMatchObject({ complete: true, total: { amountMinor: 7000 + 4000 + 2500 + 1000, currency: 'USD' }, label: '$$' })
    expect(row.estimates.map((e) => e.subject).sort()).toEqual(['lift-ticket', 'parking', 'rental'])
  })

  it('a pass price estimate feeds Pass vs tickets, labelled as yours (never "confirm at source")', async () => {
    const before = await getPassCompareView(fx.ctx, { added: [{ resortId: 'far-west', date: SAT }], includeTrips: false })
    expect(before.meta['ikon-base-2026-27']).toMatchObject({ priceEstimate: null, priceBasis: null })
    ok(await addPriceEstimate({ subject: 'pass-product', subjectId: 'ikon-base-2026-27', dayType: 'weekend', amount: '899', currency: 'USD' }))
    const [row] = await fx.db.select().from(s.priceSnapshots).where(and(eq(s.priceSnapshots.subjectType, 'pass-product'), eq(s.priceSnapshots.quoteKind, 'user-estimate')))
    // A pass price has no day type.
    expect(row).toMatchObject({ subjectId: 'ikon-base-2026-27', dayType: 'any', category: 'adult' })
    const v = await getPassCompareView(fx.ctx, { added: [{ resortId: 'far-west', date: SAT }], includeTrips: false })
    expect(v.meta['ikon-base-2026-27']).toMatchObject({ priceEstimate: expect.objectContaining({ amountMajor: '899.00' }), priceBasis: 'Your estimate — not a published price' })
    const ikon = v.result!.candidates.find((c) => c.productId === 'ikon-base-2026-27')!
    expect(ikon.passPrice).toEqual({ amountMinor: 89900, currency: 'USD' })
    // The rule at far-west is unknown: the day is priced as a ticket, never assumed covered.
    expect(ikon.days[0].verdict.status).toBe('unknown')
    expect(ikon.coveredDays).toBe(0)
  })
})

describe('owned passes', () => {
  it('records the price paid once, as the pass price and one linked "pass" expense', async () => {
    const res = ok(await addOwnedPass({ productId: 'ikon-base-2026-27', holder: 'me', purchasedOn: '2026-05-01', price: '729.00', currency: 'USD', notes: null }))
    expect(res.expenseId).not.toBeNull()
    const expenses = await fx.db.select().from(s.expenses).where(eq(s.expenses.passOwnershipId, res.ownershipId))
    expect(expenses).toEqual([expect.objectContaining({ category: 'pass', amountMinor: 72900, currency: 'USD', date: '2026-05-01' })])
    const [own] = await fx.db.select().from(s.passOwnership).where(eq(s.passOwnership.id, res.ownershipId))
    expect(own).toMatchObject({ holder: 'me', pricePaidMinor: 72900 })

    // Recording it again for the same holder is refused.
    expect((await addOwnedPass({ productId: 'ikon-base-2026-27', holder: 'me' })).ok).toBe(false)

    // Removing takes the linked expense and logged days with it; undo restores the exact rows.
    ok(await logPassDay({ ownershipId: res.ownershipId, resortId: 'far-west', date: '2027-01-10' }))
    const removed = ok(await removeOwnedPass({ ownershipId: res.ownershipId }))
    expect(removed.snapshot.usage).toHaveLength(1)
    expect(removed.snapshot.expenses).toHaveLength(1)
    expect(await fx.db.select().from(s.expenses).where(eq(s.expenses.passOwnershipId, res.ownershipId))).toEqual([])
    ok(await restoreOwnedPass({ snapshot: removed.snapshot }))
    expect(await fx.db.select().from(s.expenses).where(eq(s.expenses.passOwnershipId, res.ownershipId))).toHaveLength(1)
    expect(await fx.db.select().from(s.passUsage).where(eq(s.passUsage.ownershipId, res.ownershipId))).toHaveLength(1)
    ok(await removeOwnedPass({ ownershipId: res.ownershipId }))
  })

  it('an unknown price stays unknown: no price, no expense (never $0)', async () => {
    const res = ok(await addOwnedPass({ productId: 'ikon-base-2026-27', holder: 'Sam', price: '' }))
    expect(res.expenseId).toBeNull()
    const [own] = await fx.db.select().from(s.passOwnership).where(eq(s.passOwnership.id, res.ownershipId))
    expect(own).toMatchObject({ holder: 'Sam', pricePaidMinor: null, currency: null })
    ok(await removeOwnedPass({ ownershipId: res.ownershipId }))
  })

  it('logs only real, in-season, not-yet-logged days — and warns when no access is recorded', async () => {
    const future = await logPassDay({ ownershipId: fx.ownershipId, resortId: 'test-peak', date: '2027-01-16' })
    expect(future.ok).toBe(false)
    const dup = await logPassDay({ ownershipId: fx.ownershipId, resortId: 'test-peak', date: '2027-01-02' })
    expect(dup.ok).toBe(false)
    const otherSeason = await logPassDay({ ownershipId: fx.ownershipId, resortId: 'test-peak', date: '2026-03-01' })
    expect(otherSeason.ok).toBe(false)
    const unknown = ok(await logPassDay({ ownershipId: fx.ownershipId, resortId: 'far-west', date: '2027-01-09' }))
    expect(unknown.warning).toMatch(/No access is recorded/)
    await fx.db.delete(s.passUsage).where(eq(s.passUsage.id, unknown.usageId))
  })
})

describe('manual access rules', () => {
  it('requires a source link and inserts a NEW version — the researched one is kept', async () => {
    const base = { productId: 'ikon-base-2026-27', resortId: 'far-west', access: 'limited-days' as const, days: 5, blackouts: [], reservationRequired: true }
    const noSource = await saveAccessRule({ ...base, sourceUrl: '' })
    expect(noSource.ok).toBe(false)
    if (!noSource.ok) expect(noSource.fieldErrors?.sourceUrl).toBeTruthy()

    const saved = ok(await saveAccessRule({ ...base, sourceUrl: 'https://example.org/ikon/far-west', blackouts: [{ from: '2027-02-13', to: '2027-02-15', label: 'Presidents’ weekend' }] }))
    expect(saved.version).toBe(2)
    const rows = await fx.db.select().from(s.passAccessRules).where(and(eq(s.passAccessRules.productId, 'ikon-base-2026-27'), eq(s.passAccessRules.resortId, 'far-west')))
    expect(rows.map((r) => [r.version, r.access]).sort()).toEqual([
      [1, 'unknown'],
      [2, 'limited-days'],
    ])
    const v2 = rows.find((r) => r.version === 2)!
    expect(v2.prov).toMatchObject({ kind: 'manual', provider: 'You', verification: 'user-confirmed', sourceUrl: 'https://example.org/ikon/far-west' })

    // The checker answers from version 2, shown as "Manual — you entered", with every version in the history.
    const v = await getCheckerView(fx.ctx, { pass: 'ikon-base-2026-27', resort: 'far-west', from: '2027-02-12', to: '2027-02-16' })
    expect(v.result!.rule).toMatchObject({ version: 2, youEntered: true, verificationLabel: 'Manual — you entered' })
    expect(v.result!.history.map((h) => h.version)).toEqual([2, 1])
    // Blackouts are inclusive at both ends; the days around them are included and reservations are surfaced.
    expect(v.result!.days.map((d) => d.verdict.status)).toEqual(['included-limited', 'blackout', 'blackout', 'blackout', 'included-limited'])
    expect(v.result!.days[0].verdict.reasons.join(' ')).toMatch(/Reservation required/)

    // A second entry adds version 3; nothing is overwritten.
    ok(await saveAccessRule({ ...base, access: 'unlimited', days: null, sourceUrl: 'https://example.org/ikon/far-west-2' }))
    const all = await fx.db.select().from(s.passAccessRules).where(and(eq(s.passAccessRules.productId, 'ikon-base-2026-27'), eq(s.passAccessRules.resortId, 'far-west')))
    expect(all.map((r) => r.version).sort()).toEqual([1, 2, 3])
  })

  it('validates blackouts in the pass season at the resort: a 2026-27 pass covers June–October 2027 in the south', async () => {
    const southFx = await buildFixture({ extraResorts: [fixtureResort('south-peak', { country: 'AU', timezone: 'Australia/Sydney', location: { lat: -36.5, lon: 148.3 }, prices: [], hours: [] })] })
    const saved = state.ctx
    state.ctx = { ...southFx.ctx, mode: 'live' }
    try {
      const rule = { productId: 'ikon-base-2026-27', access: 'unlimited' as const, days: null, reservationRequired: false, sourceUrl: 'https://example.org/ikon/south' }
      const july = [{ from: '2027-07-03', to: '2027-07-11', label: 'School holidays' }]
      expect((await saveAccessRule({ ...rule, resortId: 'south-peak', blackouts: july })).ok).toBe(true)
      // The same July 2027 dates are next season at a northern resort.
      const north = await saveAccessRule({ ...rule, resortId: 'test-peak', blackouts: july })
      expect(north).toMatchObject({ ok: false, error: 'Blackout dates must fall in the pass season' })
      // And the 2026 southern winter (2025-26) is not this pass's season there.
      const lastWinter = await saveAccessRule({ ...rule, resortId: 'south-peak', blackouts: [{ from: '2026-07-04', to: '2026-07-12', label: null }] })
      expect(lastWinter).toMatchObject({ ok: false, fieldErrors: { 'blackouts.0.from': expect.stringMatching(/2027-01-01 to 2027-12-31/) } })
      // The checker offers the southern dates and answers from the rule.
      const v = await getCheckerView(southFx.ctx, { pass: 'ikon-base-2026-27', resort: 'south-peak', from: '2027-07-10', to: '2027-07-12' })
      expect(v.season.end).toBe('2027-12-31')
      expect(v.result!.days.map((d) => d.verdict.status)).toEqual(['blackout', 'blackout', 'included'])
    } finally {
      state.ctx = saved
    }
  })

  it('explains a shared day pool across its member resorts', async () => {
    const pool = { productId: 'ikon-base-2026-27', access: 'shared-pool' as const, days: 3, blackouts: [], reservationRequired: false, sourceUrl: 'https://example.org/ikon/pool' }
    const first = ok(await saveAccessRule({ ...pool, resortId: 'test-peak', poolLabel: 'Test Peak + Expert Bowl' }))
    expect(first.version).toBe(1)
    const rules = await fx.db.select().from(s.passAccessRules).where(and(eq(s.passAccessRules.productId, 'ikon-base-2026-27'), eq(s.passAccessRules.resortId, 'test-peak')))
    const poolId = rules[0].poolId!
    ok(await saveAccessRule({ ...pool, resortId: 'expert-bowl', poolId }))
    const v = await getCheckerView(fx.ctx, { pass: 'ikon-base-2026-27', resort: 'expert-bowl', from: '2027-01-16', to: '2027-01-19' })
    expect(v.result!.pool).toMatchObject({ label: 'Test Peak + Expert Bowl', total: 3, members: [expect.objectContaining({ id: 'expert-bowl' }), expect.objectContaining({ id: 'test-peak' })] })
    expect(v.result!.days[0].verdict.reasons[0]).toMatch(/3 of 3 days left in the Test Peak \+ Expert Bowl, shared with test-peak/)
    // Each covered day uses a pool day; the fourth day finds the pool empty.
    expect(v.result!.days.map((d) => d.verdict.status)).toEqual(['included-limited', 'included-limited', 'included-limited', 'days-exhausted'])
  })
})
