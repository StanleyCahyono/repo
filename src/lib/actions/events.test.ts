import { beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// The action reads the per-request context; point it at the in-memory fixture.
const holder: { ctx: unknown } = { ctx: null }
vi.mock('@/lib/context', () => ({ getCtx: async () => holder.ctx }))

import * as s from '@/lib/db/schema'
import { buildFixture, TODAY, type Fixture } from '@/lib/data/fixtures.test-helpers'
import { addEventToTrip, removeEventFromTrip } from './events'

let fx: Fixture
beforeAll(async () => {
  fx = await buildFixture()
  holder.ctx = fx.ctx
  const base = { resortId: 'test-peak', category: 'festival', venue: 'Base lodge', timezone: 'America/New_York', prov: null }
  await fx.db.insert(s.events).values([
    { ...base, id: 'fest', title: 'Fest', startLocal: '2027-01-16', endLocal: '2027-01-17', status: 'tentative', priceMinor: 2500, currency: 'USD', dedupeKey: 'fest' },
    { ...base, id: 'later', title: 'Later', startLocal: '2027-03-06T19:00', endLocal: null, status: 'announced', dedupeKey: 'later' },
    { ...base, id: 'undated', title: 'Undated', startLocal: null, endLocal: null, status: 'not-announced', dedupeKey: 'undated' },
    { ...base, id: 'off', title: 'Off', startLocal: '2027-01-20', endLocal: null, status: 'cancelled', dedupeKey: 'off' },
    { ...base, id: 'gone', title: 'Gone', startLocal: '2027-01-02', endLocal: null, status: 'announced', dedupeKey: 'gone' },
  ])
  await fx.db.insert(s.trips).values([
    { id: 'wkd', name: 'Weekend', status: 'draft', startDate: '2027-01-16', endDate: '2027-01-17', partySize: 1, companions: [], createdAt: TODAY, updatedAt: TODAY },
    { id: 'done', name: 'Done', status: 'done', startDate: '2027-01-16', endDate: '2027-01-17', partySize: 1, companions: [], createdAt: TODAY, updatedAt: TODAY },
  ])
})

describe('addEventToTrip', () => {
  it('saves a dated event as an idea item with no invented cost', async () => {
    const res = await addEventToTrip({ tripId: 'wkd', eventId: 'fest' })
    expect(res).toMatchObject({ ok: true, data: { tripId: 'wkd', tripName: 'Weekend', outsideTrip: false } })
    if (!res.ok) return
    const [item] = await fx.db.select().from(s.tripItems).where(eq(s.tripItems.id, res.data.itemId))
    expect(item).toMatchObject({ type: 'event', refId: 'fest', title: 'Fest', date: '2027-01-16', endDate: '2027-01-17', status: 'idea', costMinor: null })
    expect(item.details).toMatchObject({ addedFrom: 'explore-events', eventStatus: 'tentative', publishedPrice: { amountMinor: 2500, currency: 'USD' } })
  })

  it('refuses duplicates, undated, cancelled and past events, and unavailable trips', async () => {
    expect(await addEventToTrip({ tripId: 'wkd', eventId: 'fest' })).toMatchObject({ ok: false, error: expect.stringMatching(/already saved/) })
    expect(await addEventToTrip({ tripId: 'wkd', eventId: 'undated' })).toMatchObject({ ok: false, error: expect.stringMatching(/no announced date/) })
    expect(await addEventToTrip({ tripId: 'wkd', eventId: 'off' })).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) })
    expect(await addEventToTrip({ tripId: 'wkd', eventId: 'gone' })).toMatchObject({ ok: false, error: expect.stringMatching(/already taken place/) })
    expect(await addEventToTrip({ tripId: 'done', eventId: 'later' })).toMatchObject({ ok: false, error: 'That trip is not available' })
    expect(await addEventToTrip({ tripId: 'nope', eventId: 'later' })).toMatchObject({ ok: false })
    expect(await addEventToTrip({ tripId: '../x', eventId: 'later' })).toMatchObject({ ok: false, error: 'Unknown trip or event' })
  })

  it('reports an event outside the trip dates, and Undo removes only that item', async () => {
    const res = await addEventToTrip({ tripId: 'wkd', eventId: 'later' })
    expect(res).toMatchObject({ ok: true, data: { outsideTrip: true } })
    if (!res.ok) return
    const undo = await removeEventFromTrip({ tripId: 'wkd', itemId: res.data.itemId })
    expect(undo.ok).toBe(true)
    const left = await fx.db
      .select({ refId: s.tripItems.refId })
      .from(s.tripItems)
      .where(and(eq(s.tripItems.tripId, 'wkd'), eq(s.tripItems.type, 'event')))
    expect(left.map((x) => x.refId)).toEqual(['fest'])
  })
})
