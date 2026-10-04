/**
 * Display helpers for the Trips screens. Pure (no React, no DB), shared by server and client components.
 * Unknown stays null — callers render <Missing/> rather than a zero.
 */
import { formatMoney, formatMoneyRange, money, type Money } from '@/lib/domain/money'
import { addDays, daysBetween, formatLocalDate, isLocalDate } from '@/lib/domain/time'
import { formatDuration } from '@/lib/domain/units'
import type { MoneyRange } from '@/lib/domain/costs'
import type { TripItemRow, TripRow } from '@/lib/db/rows'
import type { TripItemType } from '@/lib/db/schema'

export const TRIP_STATUS_LABEL: Record<TripRow['status'], string> = { draft: 'Draft', booked: 'Booked', done: 'Done', cancelled: 'Cancelled' }
export const ITEM_STATUS_LABEL: Record<TripItemRow['status'], string> = { idea: 'Idea', draft: 'Draft', booked: 'Booked' }
export const COST_KIND_LABEL: Record<NonNullable<TripItemRow['costKind']>, string> = { estimate: 'Your estimate', quote: 'Quote', actual: 'Actual' }
export const BASIS_LABEL: Record<TripItemRow['costBasis'], string> = { 'per-person': 'per person', shared: 'shared' }

export const ITEM_LABEL: Record<TripItemType, string> = {
  'resort-day': 'Ski day',
  drive: 'Drive',
  flight: 'Flight',
  transfer: 'Transfer',
  lodging: 'Lodging',
  lesson: 'Lesson',
  rental: 'Rental',
  'lift-ticket': 'Lift ticket',
  parking: 'Parking',
  food: 'Food',
  event: 'Event',
  other: 'Other',
}

/** Budget categories for the breakdown (trip item type → category). */
export const CATEGORY_OF: Record<TripItemType, CategoryKey> = {
  flight: 'travel',
  drive: 'travel',
  transfer: 'travel',
  parking: 'travel',
  lodging: 'lodging',
  'resort-day': 'lift',
  'lift-ticket': 'lift',
  lesson: 'lessons',
  rental: 'rentals',
  food: 'food',
  event: 'events',
  other: 'other',
}
export type CategoryKey = 'travel' | 'lodging' | 'lift' | 'lessons' | 'rentals' | 'food' | 'events' | 'other'
export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  travel: 'Travel',
  lodging: 'Lodging',
  lift: 'Lift access',
  lessons: 'Lessons',
  rentals: 'Rentals',
  food: 'Food',
  events: 'Events',
  other: 'Other',
}
export const CATEGORY_ORDER: CategoryKey[] = ['travel', 'lodging', 'lift', 'lessons', 'rentals', 'food', 'events', 'other']

export const TRANSFER_LABEL: Record<string, string> = {
  bus: 'Bus',
  shuttle: 'Shuttle',
  'rental-car': 'Rental car',
  private: 'Private transfer',
  train: 'Train',
  taxi: 'Taxi',
  other: 'Other',
}
export const LESSON_KIND_LABEL: Record<string, string> = { group: 'Group lesson', private: 'Private lesson', 'semi-private': 'Semi-private lesson', clinic: 'Clinic' }
export const TIER_LABEL: Record<string, string> = { budget: 'Budget', comfortable: 'Comfortable', premium: 'Premium' }
export const ABILITY_LABEL: Record<string, string> = { beginner: 'Beginner', novice: 'Novice', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' }
export const SKILL_STATUS_LABEL: Record<string, string> = {
  'not-started': 'Not started',
  practicing: 'Practising',
  'self-confirmed': 'Self-confirmed',
  'instructor-confirmed': 'Instructor-confirmed',
}
export const EVENT_STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  tentative: 'Tentative',
  'not-announced': 'Date not announced',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
}

/** 'Sat 13 Feb' */
export const dayLabel = (date: string) => formatLocalDate(date, 'ccc d LLL')
/** 'Sat 13 Feb 2027' */
export const dayLabelYear = (date: string) => formatLocalDate(date, 'ccc d LLL yyyy')
/** 'Saturday 13 February 2027' */
export const dayLabelLong = (date: string) => formatLocalDate(date, 'cccc d LLLL yyyy')

/** "13–17 Feb 2027" / "Sat 16 Jan 2027" / "30 Jan – 2 Feb 2027". */
export function tripDateLabel(start: string, end: string): string {
  if (!isLocalDate(start) || !isLocalDate(end)) return `${start} – ${end}`
  if (start === end) return formatLocalDate(start, 'ccc d LLL yyyy')
  if (start.slice(0, 7) === end.slice(0, 7)) return `${formatLocalDate(start, 'd')}–${formatLocalDate(end, 'd LLL yyyy')}`
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatLocalDate(start, 'd LLL')} – ${formatLocalDate(end, 'd LLL yyyy')}`
  return `${formatLocalDate(start, 'd LLL yyyy')} – ${formatLocalDate(end, 'd LLL yyyy')}`
}

/** Short item date range: "13 Feb" or "13–17 Feb". */
export function spanLabel(date: string | null, end: string | null): string | null {
  if (!date) return null
  if (!end || end === date) return formatLocalDate(date, 'd LLL')
  if (date.slice(0, 7) === end.slice(0, 7)) return `${formatLocalDate(date, 'd')}–${formatLocalDate(end, 'd LLL')}`
  return `${formatLocalDate(date, 'd LLL')} – ${formatLocalDate(end, 'd LLL')}`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "in 29 days" / "tomorrow" / "today" / "day 2 of 5" / "ended 3 days ago". */
export function countdown(t: { startDate: string; endDate: string; status: TripRow['status'] }, today: string): string {
  if (t.status === 'cancelled') return 'Cancelled'
  const until = daysBetween(today, t.startDate)
  if (until > 1) return `in ${until} days`
  if (until === 1) return 'tomorrow'
  if (t.endDate >= today) {
    if (t.startDate === t.endDate) return 'today'
    return `day ${daysBetween(t.startDate, today) + 1} of ${daysBetween(t.startDate, t.endDate) + 1}`
  }
  const ago = daysBetween(t.endDate, today)
  return ago === 1 ? 'ended yesterday' : `ended ${ago} days ago`
}

export const duration = (min: number | null | undefined) => formatDuration(min ?? null)

export function withWinter(minutes: number | null | undefined, pct: number): number | null {
  return typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes * (1 + pct / 100)) : null
}

export const rangeText = (r: MoneyRange | null | undefined) => (r ? formatMoneyRange(r.min, r.max) : null)
export const moneyText = (m: Money | null | undefined) => formatMoney(m ?? null)

/** An item's own cost as entered (original currency), or null when unpriced. */
export function itemCost(i: Pick<TripItemRow, 'costMinor' | 'costMaxMinor' | 'currency' | 'costKind' | 'costBasis'>): { range: MoneyRange; kind: TripItemRow['costKind']; basis: TripItemRow['costBasis'] } | null {
  if (i.costMinor == null || !i.currency) return null
  const min = money(i.costMinor, i.currency)
  const max = i.costMaxMinor != null && i.costMaxMinor >= i.costMinor ? money(i.costMaxMinor, i.currency) : min
  return { range: { min, max }, kind: i.costKind, basis: i.costBasis }
}

/** Decimal string (major units) for a form field. */
export function majorString(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null || !currency) return ''
  const digits = ['JPY', 'KRW', 'ISK', 'CLP'].includes(currency.toUpperCase()) ? 0 : 2
  const v = minor / 10 ** digits
  return Number.isInteger(v) ? String(v) : v.toFixed(digits)
}

/** Quote expiry state (quotes only; booked items and actuals never expire). */
export function quoteState(i: Pick<TripItemRow, 'costKind' | 'status' | 'quoteExpiresAt'>, today: string): { state: 'expired' | 'soon' | 'valid'; days: number; date: string } | null {
  if (i.costKind !== 'quote' || i.status === 'booked' || !i.quoteExpiresAt) return null
  const date = i.quoteExpiresAt.slice(0, 10)
  if (!isLocalDate(date)) return null
  const days = daysBetween(today, date)
  return { state: days < 0 ? 'expired' : days <= 3 ? 'soon' : 'valid', days, date }
}

/** Nights between check-in and check-out (null when unknown). */
export function nights(date: string | null, end: string | null): number | null {
  if (!date || !end || end <= date) return null
  return daysBetween(date, end)
}

/** The string/number/boolean detail fields, safely typed. */
export function detailString(d: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = d?.[key]
  return typeof v === 'string' && v.trim() ? v : null
}
export function detailNumber(d: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = d?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
export function detailBool(d: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const v = d?.[key]
  return typeof v === 'boolean' ? v : null
}
export function detailNumbers(d: Record<string, unknown> | null | undefined, key: string): number[] {
  const v = d?.[key]
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Dates of the trip as select options. */
export function tripDays(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end && out.length < 62; d = addDays(d, 1)) out.push(d)
  return out
}

export const icsUrl = (tripId: string) => `/api/export/ics?trip=${encodeURIComponent(tripId)}`
export const eventIcsUrl = (eventId: string) => `/api/export/ics?event=${encodeURIComponent(eventId)}`

/** Short, type-specific facts for an item row (only what you entered or the catalog states). */
export function itemFacts(i: Pick<TripItemRow, 'type' | 'refId' | 'date' | 'endDate' | 'details'>): string[] {
  const d = i.details ?? {}
  const out: string[] = []
  const add = (v: string | null | false | undefined) => {
    if (v) out.push(v)
  }
  switch (i.type) {
    case 'flight': {
      const segs = Array.isArray(d.segments) ? d.segments.length : 0
      const origin = detailString(d, 'origin')
      add(origin || i.refId ? `${origin ?? '—'} → ${i.refId ?? '—'}` : null)
      add(segs ? (segs === 1 ? 'Nonstop (as entered)' : `${segs - 1} connection${segs > 2 ? 's' : ''}`) : 'No itinerary entered')
      const t = detailString(d, 'ticketing')
      add(t === 'single' ? 'One ticket' : t === 'separate' ? 'Separate bookings' : null)
      add(detailString(d, 'skiBag') ? 'Ski bag noted' : null)
      break
    }
    case 'lodging': {
      const n = nights(i.date, i.endDate)
      add(n !== null ? plural(n, 'night') : null)
      const occ = detailNumber(d, 'occupancy')
      add(occ ? `for ${occ}` : null)
      add(detailString(d, 'room'))
      break
    }
    case 'transfer':
      add(TRANSFER_LABEL[detailString(d, 'transferType') ?? ''] ?? null)
      add(detailString(d, 'from') && detailString(d, 'to') ? `${detailString(d, 'from')} → ${detailString(d, 'to')}` : (detailString(d, 'from') ?? detailString(d, 'to')))
      add(duration(detailNumber(d, 'minutes')))
      break
    case 'drive':
      add(detailString(d, 'from') && detailString(d, 'to') ? `${detailString(d, 'from')} → ${detailString(d, 'to')}` : null)
      add(detailNumber(d, 'minutes') !== null ? `${duration(detailNumber(d, 'minutes'))} one way` : null)
      break
    case 'lesson': {
      add(LESSON_KIND_LABEL[detailString(d, 'lessonKind') ?? ''] ?? null)
      add(detailString(d, 'instructor') ? `with ${detailString(d, 'instructor')}` : null)
      const k = detailNumbers(d, 'focusSkills').length
      add(k ? plural(k, 'focus skill') : null)
      break
    }
    case 'rental':
      add(detailString(d, 'package'))
      add(detailString(d, 'shop'))
      break
    case 'lift-ticket': {
      add(detailString(d, 'ticketType'))
      const span = i.date && i.endDate && i.endDate > i.date ? daysBetween(i.date, i.endDate) + 1 : null
      add(span ? `${span} days` : null)
      break
    }
    case 'parking': {
      add(detailString(d, 'where'))
      const r = detailBool(d, 'reservationRequired')
      add(r === true ? 'Reservation required' : r === false ? 'No reservation needed' : null)
      break
    }
    case 'event':
      add(detailString(d, 'venue'))
      add(detailString(d, 'startTime') ? `starts ${detailString(d, 'startTime')} local` : null)
      break
  }
  add(detailString(d, 'bookingRef') ? `Ref ${detailString(d, 'bookingRef')}` : null)
  return out
}

/** A resort's town for a one-line list: "Union Dale (Herrick Township, …), PA, PA" → "Union Dale, PA" (no notes in brackets, no repeats). */
export function placeLine(place: string | null | undefined, region?: string | null): string {
  const parts: string[] = []
  for (const raw of (place ?? '').replace(/\s*\([^)]*\)/g, '').split(',')) {
    const x = raw.trim()
    if (x && !parts.some((p) => p.toLowerCase() === x.toLowerCase())) parts.push(x)
  }
  const town = parts.join(', ')
  return [town, region && !town.toLowerCase().includes(region.toLowerCase()) ? region : null].filter(Boolean).join(' · ')
}
