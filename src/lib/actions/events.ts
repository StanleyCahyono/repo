'use server'
/**
 * Events → trips. Save a dated catalog event to one of your trips as an 'idea' item (type 'event', refId = event id,
 * so the trip's ICS export includes it with the venue's time zone), and undo that.
 *
 * Rules: ids are validated with zod and re-read from the database (never trusted from the client); an event without
 * an announced date cannot be planned around, and a cancelled or past one is refused; the same event is saved to a
 * trip only once. No price is copied into the trip budget — a published ticket price is kept in the item details for reference
 * and the cost stays unknown until you enter it. Adding an event outside the trip's dates is allowed but reported.
 */
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'

export type EventActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string }

const TripId = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Unknown trip')
const EventId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Unknown event')

const AddInput = z.object({ tripId: TripId, eventId: EventId })

function fail(error: string): EventActionResult<never> {
  return { ok: false, error }
}

function revalidate() {
  revalidatePath('/trips', 'layout')
  revalidatePath('/explore/events')
}

/** Save a dated event to a trip. Returns the new item id (for Undo) and whether it falls outside the trip dates. */
export async function addEventToTrip(
  input: z.input<typeof AddInput>,
): Promise<EventActionResult<{ itemId: number; tripId: string; tripName: string; outsideTrip: boolean }>> {
  const parsed = AddInput.safeParse(input)
  if (!parsed.success) return fail('Unknown trip or event')
  const { tripId, eventId } = parsed.data
  const { db, now, today } = await getCtx()
  const [[trip], [event]] = await Promise.all([
    db.select().from(s.trips).where(eq(s.trips.id, tripId)),
    db.select().from(s.events).where(eq(s.events.id, eventId)),
  ])
  if (!trip || trip.status === 'cancelled' || trip.status === 'done') return fail('That trip is not available')
  if (!event) return fail('Unknown event')
  if (!event.startLocal) return fail('This event has no announced date yet — there is nothing to plan around. It stays on the watch list.')
  if (event.status === 'cancelled') return fail('This event is cancelled')

  const startDate = event.startLocal.slice(0, 10)
  const endDate = (event.endLocal ?? event.startLocal).slice(0, 10)
  if (endDate < today) return fail('This event has already taken place')
  const existing = await db
    .select({ id: s.tripItems.id, sortOrder: s.tripItems.sortOrder, type: s.tripItems.type, refId: s.tripItems.refId })
    .from(s.tripItems)
    .where(eq(s.tripItems.tripId, trip.id))
  if (existing.some((i) => i.type === 'event' && i.refId === event.id)) return fail(`${event.title} is already saved to ${trip.name}`)

  const outsideTrip = startDate > trip.endDate || endDate < trip.startDate
  const [row] = await db
    .insert(s.tripItems)
    .values({
      tripId: trip.id,
      type: 'event',
      refId: event.id,
      title: event.title,
      date: startDate,
      endDate: endDate !== startDate ? endDate : null,
      status: 'idea',
      costBasis: 'per-person',
      details: {
        addedFrom: 'explore-events',
        resortId: event.resortId,
        venue: event.venue,
        timezone: event.timezone,
        startLocal: event.startLocal,
        endLocal: event.endLocal,
        eventStatus: event.status,
        officialUrl: event.officialUrl,
        ticketUrl: event.ticketUrl,
        publishedPrice: event.priceMinor != null && event.currency ? { amountMinor: event.priceMinor, currency: event.currency } : null,
        note:
          event.status === 'tentative'
            ? 'Tentative dates — confirm with the organiser.'
            : event.status === 'postponed'
              ? 'Postponed — check the organiser for the new date.'
              : null,
      },
      sortOrder: existing.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1,
      createdAt: now,
    })
    .returning({ id: s.tripItems.id })
  await db.update(s.trips).set({ updatedAt: now }).where(eq(s.trips.id, trip.id))
  revalidate()
  return {
    ok: true,
    data: { itemId: row.id, tripId: trip.id, tripName: trip.name, outsideTrip },
    message: outsideTrip ? `Saved to ${trip.name} — note it falls outside the trip dates` : `Saved to ${trip.name}`,
  }
}

const RemoveInput = z.object({ tripId: TripId, itemId: z.number().int().positive() })

/** Undo for "Add to trip": removes only that event item from that trip. */
export async function removeEventFromTrip(input: z.input<typeof RemoveInput>): Promise<EventActionResult> {
  const parsed = RemoveInput.safeParse(input)
  if (!parsed.success) return fail('Nothing to undo')
  const { db } = await getCtx()
  await db.delete(s.tripItems).where(and(eq(s.tripItems.id, parsed.data.itemId), eq(s.tripItems.tripId, parsed.data.tripId), eq(s.tripItems.type, 'event')))
  revalidate()
  return { ok: true, data: null }
}
