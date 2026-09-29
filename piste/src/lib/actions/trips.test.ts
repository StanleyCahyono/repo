/**
 * Trips actions + read model, end to end against an in-memory database (journey 6: a trip with a nearby
 * origin-airport alternative, a hotel option, an event and an itemised budget that survives a reload).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/context', () => ({ getCtx: async () => state.ctx, MODE_COOKIE: 'piste-mode' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import * as s from '@/lib/db/schema'
import { buildFixture, NOW, type Fixture } from '@/lib/data/fixtures.test-helpers'
import { getTripPage, getTripsPage, refineTripBudget } from '@/lib/data/trip-plan'
import { computeTripBudget } from '@/lib/domain/costs'
import { provenance } from '@/lib/domain/types'
import {
  addChecklistItem,
  addTripItem,
  applyChecklistTemplates,
  createTrip,
  deleteTrip,
  duplicateTrip,
  removeChecklistItem,
  removeTripItem,
  reorderTripItems,
  restoreChecklistItem,
  restoreTrip,
  restoreTripItem,
  setTripCompanions,
  updateChecklistItem,
  updateTrip,
  updateTripItem,
} from './trips'

let fx: Fixture

function ok<T>(r: { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> }): T {
  if (!r.ok) throw new Error(`${r.error} ${JSON.stringify(r.fieldErrors ?? {})}`)
  return r.data
}

beforeAll(async () => {
  fx = await buildFixture()
  state.ctx = { ...fx.ctx, mode: 'live' }
  const prov = provenance({ kind: 'manual', provider: 'test', verification: 'official-page' })
  await fx.db.insert(s.hotels).values({ id: 'far-west-inn', resortId: 'far-west', name: 'Far West Inn', tier: 'comfortable', officialUrl: 'https://example.org/inn', prov })
  await fx.db.insert(s.events).values({
    id: 'far-west-torchlight',
    resortId: 'far-west',
    title: 'Torchlight parade',
    category: 'night-event',
    venue: 'Base area',
    startLocal: '2027-02-14T18:30',
    endLocal: null,
    timezone: 'America/Denver',
    status: 'announced',
    dedupeKey: 'far-west-torchlight',
    officialUrl: 'https://example.org/events',
    prov,
  })
  await fx.db.insert(s.events).values({ id: 'far-west-festival', resortId: 'far-west', title: 'Spring festival', category: 'festival', startLocal: null, timezone: 'America/Denver', status: 'not-announced', dedupeKey: 'far-west-festival', prov })
})

describe('journey: build a trip, reload it', () => {
  let tripId = ''
  it('creates a trip from dates + a resort with a ski day on each date and the checklist templates', async () => {
    const res = ok(await createTrip({ startDate: '2027-02-13', endDate: '2027-02-15', partySize: 2, resorts: [{ resortId: 'far-west' }], originAirport: 'syr' }))
    tripId = res.tripId
    expect(res.name).toBe('far-west — 13–15 Feb')
    expect(res.itemIds).toHaveLength(3)
    const [trip] = await fx.db.select().from(s.trips).where(eq(s.trips.id, tripId))
    expect(trip).toMatchObject({ status: 'draft', partySize: 2, originAirport: 'SYR', startDate: '2027-02-13', endDate: '2027-02-15' })
    const checklist = await fx.db.select().from(s.tripChecklist).where(eq(s.tripChecklist.tripId, tripId))
    const templates = await fx.db.select().from(s.checklistTemplates)
    expect(checklist.length).toBe(templates.length)
    expect(checklist.every((c) => !c.done)).toBe(true)
  })

  it('rejects impossible input with field errors', async () => {
    const bad = await createTrip({ startDate: '2027-02-15', endDate: '2027-02-13' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.fieldErrors?.endDate).toMatch(/ends before/i)
    const cur = await addTripItem({ tripId, type: 'food', title: 'Lunch', cost: { min: '20', currency: 'dollars', kind: 'estimate', basis: 'per-person' } })
    expect(cur.ok).toBe(false)
    if (!cur.ok) expect(cur.fieldErrors?.['cost.currency']).toMatch(/3-letter/)
    const noKind = await addTripItem({ tripId, type: 'food', title: 'Lunch', cost: { min: '20', currency: 'USD', basis: 'per-person' } })
    expect(noKind.ok).toBe(false)
    const foreign = await updateTripItem({ tripId: 'nope-12345', itemId: 1, title: 'x' })
    expect(foreign.ok).toBe(false)
  })

  it('adds a flight from a nearby origin, a catalog hotel with my quote, an event and a lift ticket', async () => {
    ok(
      await addTripItem({
        tripId,
        type: 'flight',
        refId: 'den',
        date: '2027-02-13',
        endDate: '2027-02-15',
        cost: { min: '380', max: '560', currency: 'USD', kind: 'estimate', basis: 'per-person' },
        details: { origin: 'SYR', ticketing: 'single', segments: [{ carrier: 'XX', flightNumber: '123', from: 'SYR', to: 'DEN', departLocal: '2027-02-13T06:00', arriveLocal: '2027-02-13T11:10' }] },
      }),
    )
    const hotel = ok(await addTripItem({ tripId, type: 'lodging', refId: 'far-west-inn', status: 'idea', cost: { min: '900', currency: 'USD', kind: 'quote', basis: 'shared', quoteExpiresAt: '2027-01-20' } }))
    expect(hotel.title).toBe('Far West Inn')
    const dupHotel = await addTripItem({ tripId, type: 'lodging', refId: 'far-west-inn' })
    expect(dupHotel.ok).toBe(false)
    const ev = ok(await addTripItem({ tripId, type: 'event', refId: 'far-west-torchlight', status: 'idea' }))
    const [evRow] = await fx.db.select().from(s.tripItems).where(eq(s.tripItems.id, ev.itemId))
    expect(evRow).toMatchObject({ date: '2027-02-14', title: 'Torchlight parade' })
    expect(evRow.details).toMatchObject({ eventId: 'far-west-torchlight', startTime: '18:30', venue: 'Base area' })
    // An undated event stays unscheduled — no date is invented.
    const undated = ok(await addTripItem({ tripId, type: 'event', refId: 'far-west-festival', status: 'idea' }))
    const [unRow] = await fx.db.select().from(s.tripItems).where(eq(s.tripItems.id, undated.itemId))
    expect(unRow.date).toBeNull()
    ok(await addTripItem({ tripId, type: 'lift-ticket', refId: 'far-west', date: '2027-02-13', endDate: '2027-02-15', cost: { min: '240', currency: 'USD', kind: 'estimate', basis: 'per-person' } }))
  })

  it('itemises the budget: ski days priced by the lift ticket, unpriced events listed as missing', async () => {
    const page = (await getTripPage(fx.ctx, tripId))!
    expect(page.budget.accounted.map((a) => a.by)).toEqual(['lift-ticket', 'lift-ticket', 'lift-ticket'])
    expect(page.budget.missing.map((m) => m.title).sort()).toEqual(['Spring festival', 'Torchlight parade'])
    expect(page.budget.total).toBeNull()
    // Flight 380–560 pp × 2 + lodging 900 shared + lift 240 pp × 2.
    expect(page.budget.group.min.amountMinor).toBe(76000 + 90000 + 48000)
    expect(page.budget.group.max.amountMinor).toBe(112000 + 90000 + 48000)
    expect(page.budget.kinds).toEqual({ estimate: 2, quote: 1, actual: 0 })
    // The hotel quote expired before "today" (15 Jan 2027 fixture clock is before 20 Jan → still valid).
    expect(page.budget.expiredQuotes).toHaveLength(0)
    expect(page.events.map((e) => [e.id, e.when, e.savedItemId !== null])).toEqual([
      ['far-west-torchlight', 'during', true],
      ['far-west-festival', 'undated', true],
    ])
    expect(page.hotels.find((h) => h.id === 'far-west-inn')?.savedItemId).not.toBeNull()
  })

  it('prices free/known items and completes the budget; survives a reload', async () => {
    const page = (await getTripPage(fx.ctx, tripId))!
    for (const e of page.detail.items.filter((i) => i.type === 'event')) {
      ok(await updateTripItem({ tripId, itemId: e.id, cost: { min: '0', currency: 'USD', kind: 'actual', basis: 'per-person' } }))
    }
    const again = (await getTripPage(fx.ctx, tripId))!
    expect(again.budget.complete).toBe(true)
    expect(again.budget.total?.min.amountMinor).toBe(214000)
    expect(again.budget.perPersonTotal?.max.amountMinor).toBe(56000 + 45000 + 24000)
    const list = await getTripsPage(fx.ctx)
    const row = list.upcoming.find((t) => t.id === tripId)!
    expect(row.glance.complete).toBe(true)
    expect(row.skiDays).toBe(3)
    expect(row.nights).toBe(2)
  })

  it('reorders one day without touching the others', async () => {
    const page = (await getTripPage(fx.ctx, tripId))!
    const day = page.days[0]
    const before = day.items.map((i) => i.id)
    expect(before.length).toBeGreaterThanOrEqual(3)
    const reversed = [...before].reverse()
    ok(await reorderTripItems({ tripId, date: day.date, itemIds: reversed }))
    const after = (await getTripPage(fx.ctx, tripId))!
    expect(after.days[0].items.map((i) => i.id)).toEqual(reversed)
    expect(after.days[1].items.map((i) => i.id)).toEqual(page.days[1].items.map((i) => i.id))
    // A stale list (missing an item) is refused.
    const stale = await reorderTripItems({ tripId, date: day.date, itemIds: reversed.slice(1) })
    expect(stale.ok).toBe(false)
  })

  it('removes and restores an item, and deletes and restores the whole trip', async () => {
    const page = (await getTripPage(fx.ctx, tripId))!
    const flight = page.detail.items.find((i) => i.type === 'flight')!
    const removed = ok(await removeTripItem({ tripId, itemId: flight.id }))
    expect((await getTripPage(fx.ctx, tripId))!.detail.items.some((i) => i.id === flight.id)).toBe(false)
    ok(await restoreTripItem({ snapshot: removed.snapshot }))
    const restored = (await getTripPage(fx.ctx, tripId))!.detail.items.find((i) => i.id === flight.id)!
    expect(restored).toMatchObject({ costMinor: 38000, costMaxMinor: 56000, currency: 'USD', costKind: 'estimate' })

    const del = ok(await deleteTrip({ tripId }))
    expect(await getTripPage(fx.ctx, tripId)).toBeNull()
    ok(await restoreTrip({ snapshot: del.snapshot }))
    const back = (await getTripPage(fx.ctx, tripId))!
    expect(back.detail.items).toHaveLength(page.detail.items.length)
    expect(back.detail.checklist).toHaveLength(page.detail.checklist.length)
    expect(back.budget.total?.min.amountMinor).toBe(214000)
  })

  it('duplicates as an unbooked draft on new dates', async () => {
    const page = (await getTripPage(fx.ctx, tripId))!
    const lodging = page.detail.items.find((i) => i.type === 'lodging')!
    ok(await updateTripItem({ tripId, itemId: lodging.id, status: 'booked', details: { bookingRef: 'ABC123' } }))
    const copy = ok(await duplicateTrip({ tripId, startDate: '2027-03-06' }))
    const dup = (await getTripPage(fx.ctx, copy.tripId))!
    expect(dup.trip).toMatchObject({ status: 'draft', startDate: '2027-03-06', endDate: '2027-03-08' })
    const l = dup.detail.items.find((i) => i.type === 'lodging')!
    expect(l.status).toBe('draft')
    expect(l.costKind).toBe('estimate')
    expect(l.quoteExpiresAt).toBeNull()
    expect(l.details.bookingRef).toBeUndefined()
    expect(dup.detail.checklist.every((c) => !c.done)).toBe(true)
    expect(dup.days.map((d) => d.date)).toEqual(['2027-03-06', '2027-03-07', '2027-03-08'])
  })

  it('moves dated items when the trip dates move', async () => {
    const res = ok(await updateTrip({ tripId, startDate: '2027-02-20', endDate: '2027-02-22', shiftItems: true }))
    expect(res.shifted).toBeGreaterThan(0)
    const page = (await getTripPage(fx.ctx, tripId))!
    expect(page.outside).toHaveLength(0)
    expect(page.days[0].resorts).toHaveLength(1)
    expect(page.detail.items.find((i) => i.type === 'event' && i.refId === 'far-west-torchlight')?.date).toBe('2027-02-21')
  })

  it('grows the party to fit named companions', async () => {
    const r = ok(await setTripCompanions({ tripId, companions: [{ name: 'Jordan', ability: 'advanced' }, { name: 'Sam', ability: null }] }))
    expect(r.partySize).toBe(3)
  })

  it('keeps the checklist editable (add, check, remove with undo, top up from templates)', async () => {
    const added = ok(await addChecklistItem({ tripId, label: 'Print boarding passes', category: 'Travel' }))
    ok(await updateChecklistItem({ tripId, id: added.id, done: true }))
    const rm = ok(await removeChecklistItem({ tripId, id: added.id }))
    ok(await restoreChecklistItem({ snapshot: rm.snapshot }))
    const [row] = await fx.db
      .select()
      .from(s.tripChecklist)
      .where(and(eq(s.tripChecklist.tripId, tripId), eq(s.tripChecklist.id, added.id)))
    expect(row).toMatchObject({ label: 'Print boarding passes', done: true })
    const again = ok(await applyChecklistTemplates({ tripId }))
    expect(again.added).toBe(0)
  })
})

describe('lesson planner', () => {
  it('mirrors a lesson item into the lessons table and keeps it in sync', async () => {
    const trip = ok(await createTrip({ startDate: '2027-01-23', endDate: '2027-01-23', resorts: [{ resortId: 'test-peak' }] }))
    const skills = await fx.db.select().from(s.skillChecklist)
    const lesson = ok(
      await addTripItem({
        tripId: trip.tripId,
        type: 'lesson',
        refId: 'test-peak',
        date: '2027-01-23',
        title: 'Group lesson',
        details: { lessonKind: 'group', focusSkills: [skills[0].id, skills[3].id] },
        cost: { min: '79', currency: 'USD', kind: 'estimate', basis: 'per-person' },
      }),
    )
    const [row] = await fx.db.select().from(s.lessons).where(eq(s.lessons.tripId, trip.tripId))
    expect(row).toMatchObject({ resortId: 'test-peak', date: '2027-01-23', kind: 'group', costMinor: 7900, costKind: 'estimate' })
    expect(row.focusSkills).toEqual([skills[0].id, skills[3].id])
    ok(await updateTripItem({ tripId: trip.tripId, itemId: lesson.itemId, details: { instructor: 'Pat' } }))
    const [updated] = await fx.db.select().from(s.lessons).where(eq(s.lessons.id, row.id))
    expect(updated.instructor).toBe('Pat')
    const rm = ok(await removeTripItem({ tripId: trip.tripId, itemId: lesson.itemId }))
    expect(await fx.db.select().from(s.lessons).where(eq(s.lessons.tripId, trip.tripId))).toHaveLength(0)
    ok(await restoreTripItem({ snapshot: rm.snapshot }))
    expect(await fx.db.select().from(s.lessons).where(eq(s.lessons.tripId, trip.tripId))).toHaveLength(1)
  })
})

describe('pass access per day', () => {
  it('counts a pass-covered ski day as accounted, and the next day (allotment used up) as missing', async () => {
    // Indy Base: 2 days at test-peak, 1 already logged (2 Jan) → one covered day left.
    const trip = ok(await createTrip({ startDate: '2027-01-30', endDate: '2027-01-31', resorts: [{ resortId: 'test-peak' }] }))
    const page = (await getTripPage(fx.ctx, trip.tripId))!
    expect(page.days.map((d) => d.resorts[0].access.status)).toEqual(['covered', 'not-covered'])
    expect(page.budget.accounted).toMatchObject([{ by: 'pass', detail: 'Indy Base Pass', date: '2027-01-30' }])
    expect(page.budget.missing).toHaveLength(1)
    expect(page.budget.missing[0].reason).toMatch(/Lift access not priced/)
  })

  it('answers a chosen "what if" product without treating unknown rules as permission', async () => {
    const trip = ok(await createTrip({ startDate: '2027-02-27', endDate: '2027-02-27', resorts: [{ resortId: 'far-west' }] }))
    const page = (await getTripPage(fx.ctx, trip.tripId, { pass: 'ikon-base-2026-27' }))!
    expect(page.pass.chosen).toMatchObject({ id: 'ikon-base-2026-27', owned: false })
    const v = page.days[0].resorts[0].chosen!
    expect(v.status).toBe('unknown')
    expect(v.canSki).toBe(false)
    // An unknown product id is ignored rather than guessed.
    const none = (await getTripPage(fx.ctx, trip.tripId, { pass: 'no-such-pass' }))!
    expect(none.pass.chosen).toBeNull()
  })
})

describe('a trip with nothing priced', () => {
  it('has no total (never $0) in the list glance or the detail budget', async () => {
    const trip = ok(await createTrip({ startDate: '2027-03-13', endDate: '2027-03-14' }))
    const list = await getTripsPage(fx.ctx)
    const row = list.upcoming.find((t) => t.id === trip.tripId)!
    expect(row.itemCount).toBe(0)
    expect(row.glance.lines).toBe(0)
    expect(row.glance.total).toBeNull()
    expect(row.glance.perPerson).toBeNull()
    const page = (await getTripPage(fx.ctx, trip.tripId))!
    expect(page.budget.lines.some((l) => l.groupTotal)).toBe(false)
    expect(page.days.map((d) => d.kind)).toEqual(['free', 'free'])
  })
})

describe('refineTripBudget', () => {
  it('never turns an unpriced item into $0', () => {
    const items = [
      { id: 1, type: 'resort-day' as const, refId: 'a', date: '2027-01-10', endDate: null, costMinor: null, title: 'Ski day' },
      { id: 2, type: 'food' as const, refId: 'a', date: '2027-01-10', endDate: null, costMinor: null, title: 'Lunch' },
    ]
    const budget = computeTripBudget({
      items: items.map((i) => ({ ...i, costMaxMinor: null, currency: null, costKind: null, costBasis: 'per-person' as const, quoteExpiresAt: null })),
      partySize: 1,
      currency: 'USD',
      rates: [],
      now: NOW,
    })
    const refined = refineTripBudget(budget, items, () => null)
    expect(refined.complete).toBe(false)
    expect(refined.total).toBeNull()
    expect(refined.missing.map((m) => m.id)).toEqual([1, 2])
  })
})
