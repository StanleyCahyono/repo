/**
 * GET /api/export/ics?trip=<id>   — a trip: all-day span + one event per dated item.
 * GET /api/export/ics?event=<id>  — one event (timed events keep the venue time zone via TZID + VTIMEZONE).
 * An event without an announced date cannot be exported (422) — no date is invented.
 * Demo exports are prefixed [DEMO] and use demo-* UIDs.
 */
import type { NextRequest } from 'next/server'
import { getCtx } from '@/lib/context'
import { loadEventForIcs, loadTripForIcs } from '@/lib/export/collect'
import { buildIcs, eventToIcs, tripToIcs } from '@/lib/export/ics'
import { contentDisposition, exportFileName } from '@/lib/export/json'
import { download, jsonError } from '../../_shared'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const tripId = params.get('trip')
  const eventId = params.get('event')
  if (!tripId === !eventId) return jsonError(400, 'Pass exactly one of ?trip=<id> or ?event=<id>')
  const ctx = await getCtx()
  const demo = ctx.mode === 'demo'
  const calName = (title: string) => `Piste${demo ? ' DEMO' : ''} — ${title}`

  if (tripId) {
    const data = await loadTripForIcs(ctx.db, tripId)
    if (!data) return jsonError(404, `Unknown trip: ${tripId}`)
    const ics = buildIcs({ name: calName(data.trip.name), events: tripToIcs(data.trip, data.items, data.events, { demo }), now: ctx.now })
    return download(ics, 'text/calendar; charset=utf-8', contentDisposition(exportFileName(`trip ${data.trip.name}`, 'ics', { now: ctx.now, mode: ctx.mode })))
  }

  const event = await loadEventForIcs(ctx.db, eventId!)
  if (!event) return jsonError(404, `Unknown event: ${eventId}`)
  const ev = eventToIcs(event, { demo })
  if (!ev) return jsonError(422, 'This event has no announced date yet — nothing to add to a calendar.')
  const ics = buildIcs({ name: calName(event.title), events: [ev], now: ctx.now })
  return download(ics, 'text/calendar; charset=utf-8', contentDisposition(exportFileName(`event ${event.title}`, 'ics', { now: ctx.now, mode: ctx.mode })))
}
