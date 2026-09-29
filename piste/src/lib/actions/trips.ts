'use server'
/**
 * Trip mutations: trips (create from dates + resorts, edit, status, duplicate, delete/restore), trip items (add,
 * update, status, remove/restore, reorder within a day), the lesson planner (kept in sync with the `lessons` table
 * that My Season reads), the checklist and its editable templates, companions, and on-demand flight offers when a
 * flight connector is configured.
 *
 * Rules
 * - Every input is validated with zod; ids from the client are never trusted — each write checks the row belongs to
 *   the trip it names.
 * - Money arrives as decimal strings and is stored as integer minor units via money.ts (never floats). A cost is
 *   either fully described (amount + currency + kind) or absent: unknown is null, never 0.
 * - User-entered prices are the user's own estimates/quotes/actuals; nothing here fetches or invents a price.
 * - Duplicating a trip never copies a booking: booked items become drafts, actual/quote costs become estimates and
 *   booking references are dropped.
 * - Demo mode writes only to the demo database (getCtx picks the file); flight offers are never fetched in demo mode.
 */
import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import type { LessonRow, TripItemRow, TripRow } from '@/lib/db/rows'
import { fromMajor } from '@/lib/domain/money'
import { addDays, dateRange, daysBetween, formatLocalDate, isLocalDate } from '@/lib/domain/time'
import { ABILITY_LEVELS } from '@/lib/domain/types'
import { travelProvider } from '@/lib/providers/registry'
import type { FlightOffer } from '@/lib/providers/types'

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }

const MAX_TRIP_DAYS = 30
const MAX_PARTY = 12

// ---------------------------------------------------------------------------
// Validation building blocks

const TripId = z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, 'Unknown trip')
const ItemId = z.number().int().positive()
const ResortId = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Unknown resort')
const LocalDate = z.string().refine(isLocalDate, 'Use a date (YYYY-MM-DD)')
const IATA = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code (e.g. ITH)'))
const Currency = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code (e.g. USD)'))
const Amount = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount like 120 or 120.50')
const Rate = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,10})?$/, 'Enter a rate like 0.73')
  .refine((v) => Number(v) > 0, 'The rate must be above 0')
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)')
const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Use a date and time')
const HttpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      const x = new URL(u)
      return x.protocol === 'https:' || x.protocol === 'http:'
    } catch {
      return false
    }
  }, 'Enter the full link, starting with https://')

/** Optional text: undefined = leave unchanged, '' or null = clear. */
const text = (max: number) =>
  z
    .string()
    .max(max, `Keep it under ${max} characters`)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v && v.trim() ? v.trim() : null))
const optInt = (min: number, max: number) => z.number().int('Whole numbers only').min(min).max(max).nullish()
const optUrl = HttpUrl.nullish().or(z.literal('').transform(() => null))

const Companion = z.object({
  name: z.string().trim().min(1, 'Add a name').max(60, 'Keep names under 60 characters'),
  ability: z.enum(ABILITY_LEVELS).nullable(),
})

const Segment = z.object({
  carrier: text(40),
  flightNumber: text(12),
  from: IATA.nullish(),
  to: IATA.nullish(),
  departLocal: LocalDateTime.nullish(),
  arriveLocal: LocalDateTime.nullish(),
})

/** Known per-type detail fields. Unknown keys are dropped. */
const Details = z.object({
  note: text(2000),
  // Flight (manual itinerary / quote)
  origin: IATA.nullish(),
  destination: IATA.nullish(),
  segments: z.array(Segment).max(8).optional(),
  ticketing: z.enum(['single', 'separate']).nullish(),
  overnightLayover: z.boolean().nullish(),
  skiBag: text(300),
  fareNotes: text(500),
  airportBufferMin: optInt(0, 360),
  arrivalBufferMin: optInt(0, 360),
  // Drive / transfer / parking
  transferType: z.enum(['bus', 'shuttle', 'rental-car', 'private', 'train', 'taxi', 'other']).nullish(),
  from: text(120),
  to: text(120),
  minutes: optInt(0, 48 * 60),
  km: z.number().min(0).max(20000).nullish(),
  where: text(160),
  reservationRequired: z.boolean().nullish(),
  // Lodging
  hotelId: text(160),
  nights: optInt(0, 60),
  occupancy: optInt(1, 30),
  room: text(200),
  fees: text(300),
  // Lesson planner
  lessonKind: z.enum(['group', 'private', 'semi-private', 'clinic']).nullish(),
  instructor: text(120),
  focusSkills: z.array(z.number().int().positive()).max(20).optional(),
  // Bookings and links
  bookingRef: text(80),
  bookingUrl: optUrl,
  url: optUrl,
  // Rental / ticket
  shop: text(120),
  package: text(120),
  days: optInt(1, 60),
  ticketType: text(80),
  // Event
  eventId: text(160),
  venue: text(160),
  startTime: HHMM.nullish(),
})

const CostInput = z
  .object({
    /** Decimal string in major units; null = no cost recorded (unknown, never 0). */
    min: Amount.nullable(),
    max: Amount.nullish(),
    currency: Currency.nullish(),
    kind: z.enum(['quote', 'estimate', 'actual']).nullish(),
    basis: z.enum(['per-person', 'shared']),
    /** Quotes only: the date the quoted price stops being valid. */
    quoteExpiresAt: LocalDate.nullish(),
    /** A rate you locked yourself: 1 `currency` = fxRate `fxQuote`. */
    fxRate: Rate.nullish(),
    fxDate: LocalDate.nullish(),
    fxQuote: Currency.nullish(),
  })
  .superRefine((c, x) => {
    if (c.min === null) {
      if (c.max) x.addIssue({ code: 'custom', path: ['min'], message: 'Enter the low end of the range too' })
      return
    }
    if (!c.currency) x.addIssue({ code: 'custom', path: ['currency'], message: 'Choose the currency of this price' })
    if (!c.kind) x.addIssue({ code: 'custom', path: ['kind'], message: 'Say whether this is an estimate, a quote or an actual' })
    if (c.max && Number(c.max) < Number(c.min)) x.addIssue({ code: 'custom', path: ['max'], message: 'The high end is below the low end' })
    if (c.quoteExpiresAt && c.kind !== 'quote') x.addIssue({ code: 'custom', path: ['quoteExpiresAt'], message: 'Only quotes expire' })
    if (c.fxRate && !c.fxQuote) x.addIssue({ code: 'custom', path: ['fxRate'], message: 'Say which currency the rate converts into' })
    if (c.fxRate && c.fxQuote && c.currency && c.fxQuote === c.currency) x.addIssue({ code: 'custom', path: ['fxRate'], message: 'No rate is needed for the same currency' })
  })
type CostIn = z.output<typeof CostInput>

// ---------------------------------------------------------------------------
// Helpers

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors }
}

function zodFail(e: z.ZodError, fallback = 'Please check the highlighted fields'): ActionResult<never> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of e.issues) {
    const key = issue.path.join('.') || '_'
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  const first = e.issues[0]
  return fail(e.issues.length === 1 && first && !first.path.length ? first.message : fallback, fieldErrors)
}

function revalidate(tripId?: string) {
  if (tripId) revalidatePath(`/trips/${tripId}`)
  revalidatePath('/trips')
  // Trips feed Today's next trip, My Season's planned spending and pass planning.
  revalidatePath('/', 'layout')
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'trip'
  )
}

async function uniqueTripId(name: string): Promise<string> {
  const { db } = await getCtx()
  const base = slug(name)
  for (let i = 0; i < 8; i++) {
    const id = `${base}-${crypto.randomUUID().replace(/-/g, '').slice(0, 5)}`
    const exists = await db.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.id, id))
    if (!exists.length) return id
  }
  throw new Error('Could not allocate a trip id')
}

async function tripOrNull(tripId: string): Promise<TripRow | null> {
  const { db } = await getCtx()
  const [t] = await db.select().from(s.trips).where(eq(s.trips.id, tripId))
  return t ?? null
}

async function itemOf(tripId: string, itemId: number): Promise<TripItemRow | null> {
  const { db } = await getCtx()
  const [i] = await db
    .select()
    .from(s.tripItems)
    .where(and(eq(s.tripItems.tripId, tripId), eq(s.tripItems.id, itemId)))
  return i ?? null
}

async function nextSortOrder(tripId: string): Promise<number> {
  const { db } = await getCtx()
  const rows = await db.select({ o: s.tripItems.sortOrder }).from(s.tripItems).where(eq(s.tripItems.tripId, tripId))
  return rows.reduce((m, r) => Math.max(m, r.o), -1) + 1
}

async function touch(tripId: string) {
  const { db, now } = await getCtx()
  await db.update(s.trips).set({ updatedAt: now }).where(eq(s.trips.id, tripId))
}

function tripDatesIssue(start: string, end: string): string | null {
  if (!isLocalDate(start) || !isLocalDate(end)) return null
  const n = daysBetween(start, end)
  if (n < 0) return 'The trip ends before it starts'
  if (n >= MAX_TRIP_DAYS) return `Keep a trip under ${MAX_TRIP_DAYS} days`
  return null
}

/** Money columns from a validated cost (or all-null when no cost is recorded). */
function costColumns(c: CostIn | null | undefined) {
  if (!c || c.min === null || !c.currency) {
    return { costMinor: null, costMaxMinor: null, currency: null, costKind: null, costBasis: c?.basis ?? ('per-person' as const), fxRate: null, fxDate: null, quoteExpiresAt: null, fxQuote: null }
  }
  const min = fromMajor(c.min, c.currency)
  const max = c.max ? fromMajor(c.max, c.currency) : null
  const locked = c.fxRate && c.fxQuote && c.fxQuote !== c.currency
  return {
    costMinor: min.amountMinor,
    costMaxMinor: max && max.amountMinor !== min.amountMinor ? max.amountMinor : null,
    currency: c.currency,
    costKind: c.kind ?? null,
    costBasis: c.basis,
    fxRate: locked ? c.fxRate! : null,
    fxDate: locked ? (c.fxDate ?? null) : null,
    quoteExpiresAt: c.kind === 'quote' ? (c.quoteExpiresAt ?? null) : null,
    fxQuote: locked ? c.fxQuote! : null,
  }
}

/** Drop undefined keys so a patch never erases fields it did not mention. */
function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

const DEFAULT_BASIS: Record<string, 'per-person' | 'shared'> = {
  'resort-day': 'per-person',
  flight: 'per-person',
  drive: 'shared',
  transfer: 'shared',
  lodging: 'shared',
  lesson: 'per-person',
  rental: 'per-person',
  'lift-ticket': 'per-person',
  parking: 'shared',
  food: 'per-person',
  event: 'per-person',
  other: 'shared',
}

const RESORT_REF_TYPES = new Set(['resort-day', 'lift-ticket', 'lesson', 'rental', 'parking', 'food', 'drive', 'transfer'])

/** Validate a refId for its item type. Returns an error message, or null when fine. */
async function refIssue(type: TripItemRow['type'], refId: string | null): Promise<string | null> {
  if (!refId) return type === 'resort-day' ? 'Choose the resort for this ski day' : type === 'lesson' ? 'Choose where the lesson is' : null
  const { db } = await getCtx()
  if (RESORT_REF_TYPES.has(type)) {
    if (!/^[a-z0-9-]{1,100}$/.test(refId)) return 'Unknown resort'
    const [r] = await db.select({ id: s.resorts.id }).from(s.resorts).where(eq(s.resorts.id, refId))
    return r ? null : 'Unknown resort'
  }
  if (type === 'lodging') {
    const [h] = await db.select({ id: s.hotels.id }).from(s.hotels).where(eq(s.hotels.id, refId))
    return h ? null : 'Unknown hotel'
  }
  if (type === 'event') {
    const [e] = await db.select({ id: s.events.id }).from(s.events).where(eq(s.events.id, refId))
    return e ? null : 'Unknown event'
  }
  if (type === 'flight') return /^[A-Z]{3}$/.test(refId) ? null : 'Use the destination airport code'
  return null
}

// ---------------------------------------------------------------------------
// Lessons (the planner mirrors lesson items into the `lessons` table My Season reads)

async function linkedLesson(item: Pick<TripItemRow, 'tripId' | 'refId' | 'date' | 'details'>): Promise<LessonRow | null> {
  const { db } = await getCtx()
  const id = typeof item.details?.lessonId === 'number' ? item.details.lessonId : null
  if (id) {
    const [row] = await db.select().from(s.lessons).where(and(eq(s.lessons.id, id), eq(s.lessons.tripId, item.tripId)))
    if (row) return row
  }
  // Records created before the planner linked them: same trip, resort and date.
  if (!item.refId) return null
  const rows = await db
    .select()
    .from(s.lessons)
    .where(and(eq(s.lessons.tripId, item.tripId), eq(s.lessons.resortId, item.refId)))
  return rows.find((r) => r.date === item.date) ?? null
}

async function syncLesson(item: TripItemRow): Promise<number | null> {
  if (item.type !== 'lesson' || !item.refId) return null
  const { db, now } = await getCtx()
  const d = item.details ?? {}
  const values = {
    resortId: item.refId,
    tripId: item.tripId,
    date: item.date,
    kind: typeof d.lessonKind === 'string' ? d.lessonKind : null,
    instructor: typeof d.instructor === 'string' ? d.instructor : null,
    focusSkills: Array.isArray(d.focusSkills) ? (d.focusSkills as unknown[]).filter((x): x is number => typeof x === 'number') : [],
    bookingRef: typeof d.bookingRef === 'string' ? d.bookingRef : null,
    bookingUrl: typeof d.bookingUrl === 'string' ? d.bookingUrl : null,
    costMinor: item.costMinor,
    currency: item.currency,
    costKind: item.costKind,
    notes: typeof d.note === 'string' ? d.note : null,
  }
  const existing = await linkedLesson(item)
  if (existing) {
    await db.update(s.lessons).set(values).where(eq(s.lessons.id, existing.id))
    return existing.id
  }
  const [row] = await db
    .insert(s.lessons)
    .values({ ...values, createdAt: now })
    .returning({ id: s.lessons.id })
  return row.id
}

// ---------------------------------------------------------------------------
// Trips

const CreateTripInput = z
  .object({
    /** Optional: a name is suggested from the resorts and dates when empty. */
    name: z.string().trim().max(120, 'Keep the name under 120 characters').nullish(),
    startDate: LocalDate,
    endDate: LocalDate,
    partySize: z.number().int().min(1, 'At least one person').max(MAX_PARTY, `Up to ${MAX_PARTY} people`).default(1),
    status: z.enum(['draft', 'booked']).default('draft'),
    /** Ski days: each resort on the given dates (every trip day when `dates` is omitted). */
    resorts: z
      .array(z.object({ resortId: ResortId, dates: z.array(LocalDate).max(MAX_TRIP_DAYS).optional() }))
      .max(8)
      .default([]),
    originAirport: IATA.nullish(),
    companions: z.array(Companion).max(MAX_PARTY - 1).default([]),
    notes: text(4000),
    /** Start the checklist from your templates. */
    applyTemplates: z.boolean().default(true),
  })
  .superRefine((v, x) => {
    const issue = tripDatesIssue(v.startDate, v.endDate)
    if (issue) x.addIssue({ code: 'custom', path: ['endDate'], message: issue })
    v.resorts.forEach((r, k) =>
      (r.dates ?? []).forEach((d) => {
        if (isLocalDate(d) && (d < v.startDate || d > v.endDate)) x.addIssue({ code: 'custom', path: ['resorts', k, 'dates'], message: 'Ski days must fall within the trip dates' })
      }),
    )
  })
export type CreateTripInput = z.input<typeof CreateTripInput>

/** Start a trip from dates and resort(s): the trip, one ski-day item per resort day and (optionally) the checklist. */
export async function createTrip(input: CreateTripInput): Promise<ActionResult<{ tripId: string; name: string; itemIds: number[] }>> {
  const parsed = CreateTripInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now } = await getCtx()
  const ids = [...new Set(v.resorts.map((r) => r.resortId))]
  const resorts = ids.length ? await db.select({ id: s.resorts.id, name: s.resorts.name, shortName: s.resorts.shortName }).from(s.resorts).where(inArray(s.resorts.id, ids)) : []
  if (resorts.length !== ids.length) return fail('One of the resorts is not in the catalog', { resorts: 'Unknown resort' })
  const byId = new Map(resorts.map((r) => [r.id, r]))
  const label =
    v.startDate === v.endDate
      ? formatLocalDate(v.startDate, 'ccc d LLL')
      : v.startDate.slice(0, 7) === v.endDate.slice(0, 7)
        ? `${formatLocalDate(v.startDate, 'd')}–${formatLocalDate(v.endDate, 'd LLL')}`
        : `${formatLocalDate(v.startDate, 'd LLL')} – ${formatLocalDate(v.endDate, 'd LLL')}`
  const place = ids.map((id) => byId.get(id)!.shortName || byId.get(id)!.name)
  const name = v.name?.trim() || `${place.length ? (place.length > 2 ? `${place.slice(0, 2).join(', ')} +${place.length - 2}` : place.join(' & ')) : 'Ski trip'} — ${label}`
  const id = await uniqueTripId(name)

  const all = dateRange(v.startDate, v.endDate)
  const seen = new Set<string>()
  const days: { resortId: string; date: string }[] = []
  for (const r of v.resorts) {
    for (const date of [...new Set(r.dates ?? all)].sort()) {
      const key = `${r.resortId}|${date}`
      if (!seen.has(key)) {
        seen.add(key)
        days.push({ resortId: r.resortId, date })
      }
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date) || ids.indexOf(a.resortId) - ids.indexOf(b.resortId))

  await db.insert(s.trips).values({
    id,
    name,
    status: v.status,
    startDate: v.startDate,
    endDate: v.endDate,
    partySize: Math.max(v.partySize, v.companions.length + 1),
    originAirport: v.originAirport ?? null,
    companions: v.companions,
    notes: v.notes ?? null,
    createdAt: now,
    updatedAt: now,
  })
  const rows = days.length
    ? await db
        .insert(s.tripItems)
        .values(
          days.map((d, i) => {
            const r = byId.get(d.resortId)!
            return {
              tripId: id,
              type: 'resort-day' as const,
              refId: d.resortId,
              title: `Ski day at ${r.shortName || r.name}`,
              date: d.date,
              status: 'draft' as const,
              costBasis: 'per-person' as const,
              details: { addedFrom: 'trips' },
              sortOrder: i,
              createdAt: now,
            }
          }),
        )
        .returning({ id: s.tripItems.id })
    : []
  if (v.applyTemplates) {
    const templates = await db.select().from(s.checklistTemplates).orderBy(asc(s.checklistTemplates.sortOrder), asc(s.checklistTemplates.id))
    if (templates.length) {
      await db.insert(s.tripChecklist).values(templates.map((t, n) => ({ tripId: id, label: t.label, category: t.category, done: false, link: null, sortOrder: n })))
    }
  }
  revalidate(id)
  return { ok: true, data: { tripId: id, name, itemIds: rows.map((r) => r.id) }, message: `${name} created` }
}

const UpdateTripInput = z
  .object({
    tripId: TripId,
    name: z.string().trim().min(1, 'Give the trip a name').max(120, 'Keep the name under 120 characters').optional(),
    startDate: LocalDate.optional(),
    endDate: LocalDate.optional(),
    /** When the dates move, move every dated item by the same number of days. */
    shiftItems: z.boolean().optional(),
    partySize: z.number().int().min(1, 'At least one person').max(MAX_PARTY, `Up to ${MAX_PARTY} people`).optional(),
    status: z.enum(['draft', 'booked', 'done', 'cancelled']).optional(),
    notes: text(4000),
    originAirport: IATA.nullish(),
  })
  .refine((v) => (v.startDate === undefined) === (v.endDate === undefined), { message: 'Change both dates together', path: ['endDate'] })
export type UpdateTripInput = z.input<typeof UpdateTripInput>

/** Edit a trip's name, dates (optionally moving its items), party size, status, notes or origin airport. */
export async function updateTrip(input: UpdateTripInput): Promise<ActionResult<{ tripId: string; shifted: number }>> {
  const parsed = UpdateTripInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const trip = await tripOrNull(v.tripId)
  if (!trip) return fail('That trip no longer exists')
  const { db, now } = await getCtx()
  let shifted = 0
  if (v.startDate && v.endDate) {
    const issue = tripDatesIssue(v.startDate, v.endDate)
    if (issue) return fail(issue, { endDate: issue })
    const delta = daysBetween(trip.startDate, v.startDate)
    if (v.shiftItems && delta !== 0) {
      const items = await db.select().from(s.tripItems).where(eq(s.tripItems.tripId, trip.id))
      for (const i of items.filter((x) => x.date)) {
        await db
          .update(s.tripItems)
          .set({ date: addDays(i.date!, delta), endDate: i.endDate ? addDays(i.endDate, delta) : null })
          .where(eq(s.tripItems.id, i.id))
        shifted++
      }
      const lessons = await db.select().from(s.lessons).where(eq(s.lessons.tripId, trip.id))
      for (const l of lessons.filter((x) => x.date)) await db.update(s.lessons).set({ date: addDays(l.date!, delta) }).where(eq(s.lessons.id, l.id))
    }
  }
  await db
    .update(s.trips)
    .set({
      ...defined({ name: v.name, startDate: v.startDate, endDate: v.endDate, partySize: v.partySize, status: v.status, notes: v.notes, originAirport: v.originAirport === undefined ? undefined : (v.originAirport ?? null) }),
      updatedAt: now,
    })
    .where(eq(s.trips.id, trip.id))
  revalidate(trip.id)
  return { ok: true, data: { tripId: trip.id, shifted } }
}

const DuplicateInput = z.object({
  tripId: TripId,
  name: z.string().trim().min(1, 'Give the copy a name').max(120).optional(),
  /** New start date; every dated item moves with it. Defaults to the same dates. */
  startDate: LocalDate.optional(),
})

/** Copy a trip as a new draft plan. Bookings are never copied (see the module note). */
export async function duplicateTrip(input: z.input<typeof DuplicateInput>): Promise<ActionResult<{ tripId: string; name: string }>> {
  const parsed = DuplicateInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const trip = await tripOrNull(v.tripId)
  if (!trip) return fail('That trip no longer exists')
  const { db, now } = await getCtx()
  const delta = v.startDate ? daysBetween(trip.startDate, v.startDate) : 0
  const move = (d: string | null) => (d ? addDays(d, delta) : null)
  const name = v.name ?? `${trip.name} (copy)`
  const id = await uniqueTripId(name)
  const [items, checklist, lessons] = await Promise.all([
    db.select().from(s.tripItems).where(eq(s.tripItems.tripId, trip.id)),
    db.select().from(s.tripChecklist).where(eq(s.tripChecklist.tripId, trip.id)),
    db.select().from(s.lessons).where(eq(s.lessons.tripId, trip.id)),
  ])
  await db.insert(s.trips).values({
    id,
    name: name.slice(0, 120),
    status: 'draft',
    startDate: move(trip.startDate)!,
    endDate: move(trip.endDate)!,
    partySize: trip.partySize,
    originAirport: trip.originAirport,
    companions: trip.companions,
    notes: trip.notes,
    createdAt: now,
    updatedAt: now,
  })
  for (const i of items) {
    const { bookingRef: _ref, lessonId: _lesson, offerId: _offer, ...rest } = (i.details ?? {}) as Record<string, unknown>
    const copied = i.costKind === 'actual' || i.costKind === 'quote'
    const [row] = await db
      .insert(s.tripItems)
      .values({
        tripId: id,
        type: i.type,
        refId: i.refId,
        title: i.title,
        date: move(i.date),
        endDate: move(i.endDate),
        status: i.status === 'booked' ? 'draft' : i.status,
        costMinor: i.costMinor,
        costMaxMinor: i.costMaxMinor,
        currency: i.currency,
        costKind: copied ? 'estimate' : i.costKind,
        costBasis: i.costBasis,
        fxRate: i.fxRate,
        fxDate: i.fxDate,
        quoteExpiresAt: null,
        details: { ...rest, copiedFrom: trip.id, ...(copied ? { copiedCostKind: i.costKind } : {}) },
        sortOrder: i.sortOrder,
        createdAt: now,
      })
      .returning()
    if (row.type === 'lesson') {
      const original = lessons.find((l) => (typeof i.details?.lessonId === 'number' && l.id === i.details.lessonId) || (l.resortId === i.refId && l.date === i.date))
      if (original) {
        const [copy] = await db
          .insert(s.lessons)
          .values({ ...original, id: undefined, tripId: id, date: move(original.date), bookingRef: null, costKind: original.costKind === 'actual' || original.costKind === 'quote' ? 'estimate' : original.costKind, createdAt: now })
          .returning({ id: s.lessons.id })
        await db.update(s.tripItems).set({ details: { ...row.details, lessonId: copy.id } }).where(eq(s.tripItems.id, row.id))
      }
    }
  }
  if (checklist.length) {
    await db.insert(s.tripChecklist).values(checklist.map((c) => ({ tripId: id, label: c.label, category: c.category, done: false, link: c.link, sortOrder: c.sortOrder })))
  }
  revalidate(id)
  return { ok: true, data: { tripId: id, name }, message: `Copied as ${name} — bookings were not copied` }
}

// Snapshots let "Delete" be undone from the toast. They round-trip rows exactly as stored.
const JsonRecord = z.record(z.string(), z.unknown())
const TripSnapshot = z.object({
  trip: z.object({
    id: TripId,
    name: z.string().min(1).max(120),
    status: z.enum(['draft', 'booked', 'done', 'cancelled']),
    startDate: LocalDate,
    endDate: LocalDate,
    partySize: z.number().int().min(1).max(MAX_PARTY),
    originAirport: z.string().regex(/^[A-Z]{3}$/).nullable(),
    companions: z.array(Companion),
    notes: z.string().max(4000).nullable(),
    createdAt: z.string().max(40),
    updatedAt: z.string().max(40),
  }),
  items: z
    .array(
      z.object({
        id: ItemId,
        type: z.enum(s.TRIP_ITEM_TYPES),
        refId: z.string().max(160).nullable(),
        title: z.string().min(1).max(200),
        date: LocalDate.nullable(),
        endDate: LocalDate.nullable(),
        status: z.enum(['idea', 'draft', 'booked']),
        costMinor: z.number().int().nullable(),
        costMaxMinor: z.number().int().nullable(),
        currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
        costKind: z.enum(['quote', 'estimate', 'actual']).nullable(),
        costBasis: z.enum(['per-person', 'shared']),
        fxRate: z.string().max(40).nullable(),
        fxDate: z.string().max(40).nullable(),
        quoteExpiresAt: z.string().max(40).nullable(),
        details: JsonRecord,
        sortOrder: z.number().int(),
        createdAt: z.string().max(40),
      }),
    )
    .max(500),
  checklist: z
    .array(z.object({ id: z.number().int().positive(), label: z.string().min(1).max(200), category: z.string().max(60).nullable(), done: z.boolean(), link: z.string().max(2000).nullable(), sortOrder: z.number().int() }))
    .max(300),
  lessons: z
    .array(
      z.object({
        id: z.number().int().positive(),
        resortId: z.string().max(100),
        date: LocalDate.nullable(),
        kind: z.string().max(40).nullable(),
        instructor: z.string().max(120).nullable(),
        focusSkills: z.array(z.number().int()),
        bookingRef: z.string().max(80).nullable(),
        bookingUrl: z.string().max(2000).nullable(),
        costMinor: z.number().int().nullable(),
        currency: z.string().max(3).nullable(),
        costKind: z.enum(['quote', 'estimate', 'actual']).nullable(),
        notes: z.string().max(2000).nullable(),
        createdAt: z.string().max(40),
      }),
    )
    .max(100),
})
export type TripSnapshot = z.output<typeof TripSnapshot>

/** Delete a trip with its items, checklist and planned lessons. Returns a snapshot for Undo. */
export async function deleteTrip(input: { tripId: string }): Promise<ActionResult<{ snapshot: TripSnapshot; name: string }>> {
  const parsed = z.object({ tripId: TripId }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const trip = await tripOrNull(parsed.data.tripId)
  if (!trip) return fail('That trip no longer exists')
  const { db } = await getCtx()
  const [items, checklist, lessons] = await Promise.all([
    db.select().from(s.tripItems).where(eq(s.tripItems.tripId, trip.id)),
    db.select().from(s.tripChecklist).where(eq(s.tripChecklist.tripId, trip.id)),
    db.select().from(s.lessons).where(eq(s.lessons.tripId, trip.id)),
  ])
  const snapshot: TripSnapshot = {
    trip: {
      id: trip.id,
      name: trip.name,
      status: trip.status,
      startDate: trip.startDate,
      endDate: trip.endDate,
      partySize: trip.partySize,
      originAirport: trip.originAirport,
      companions: trip.companions,
      notes: trip.notes,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
    },
    items: items.map(({ tripId: _t, ...i }) => i),
    checklist: checklist.map(({ tripId: _t, ...c }) => c),
    lessons: lessons.map(({ tripId: _t, ...l }) => l),
  }
  if (lessons.length) await db.delete(s.lessons).where(eq(s.lessons.tripId, trip.id))
  // Items and checklist rows cascade with the trip.
  await db.delete(s.trips).where(eq(s.trips.id, trip.id))
  revalidate(trip.id)
  return { ok: true, data: { snapshot, name: trip.name }, message: `${trip.name} deleted` }
}

/** Undo a delete: put the trip back exactly as it was (ids kept when still free). */
export async function restoreTrip(input: { snapshot: TripSnapshot }): Promise<ActionResult<{ tripId: string }>> {
  const parsed = z.object({ snapshot: TripSnapshot }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'That trip could not be restored')
  const { trip, items, checklist, lessons } = parsed.data.snapshot
  const { db } = await getCtx()
  if (await tripOrNull(trip.id)) return fail('That trip already exists')
  await db.insert(s.trips).values(trip)
  const lessonIds = new Map<number, number>()
  for (const l of lessons) {
    const [taken] = await db.select({ id: s.lessons.id }).from(s.lessons).where(eq(s.lessons.id, l.id))
    const [row] = await db
      .insert(s.lessons)
      .values({ ...l, id: taken ? undefined : l.id, tripId: trip.id })
      .returning({ id: s.lessons.id })
    lessonIds.set(l.id, row.id)
  }
  for (const i of items) {
    const [taken] = await db.select({ id: s.tripItems.id }).from(s.tripItems).where(eq(s.tripItems.id, i.id))
    const lessonId = typeof i.details.lessonId === 'number' ? lessonIds.get(i.details.lessonId) : undefined
    await db.insert(s.tripItems).values({ ...i, id: taken ? undefined : i.id, tripId: trip.id, details: lessonId ? { ...i.details, lessonId } : i.details })
  }
  for (const c of checklist) {
    const [taken] = await db.select({ id: s.tripChecklist.id }).from(s.tripChecklist).where(eq(s.tripChecklist.id, c.id))
    await db.insert(s.tripChecklist).values({ ...c, id: taken ? undefined : c.id, tripId: trip.id })
  }
  revalidate(trip.id)
  return { ok: true, data: { tripId: trip.id }, message: `${trip.name} restored` }
}

// ---------------------------------------------------------------------------
// Trip items

const AddItemInput = z
  .object({
    tripId: TripId,
    type: z.enum(s.TRIP_ITEM_TYPES),
    /** Resort id (days, tickets, lessons, rentals, parking, food, drives, transfers), hotel id, event id or destination IATA. */
    refId: z.string().trim().max(160).nullish(),
    title: z.string().trim().max(200, 'Keep the title under 200 characters').optional(),
    date: LocalDate.nullish(),
    endDate: LocalDate.nullish(),
    status: z.enum(['idea', 'draft', 'booked']).default('draft'),
    cost: CostInput.nullish(),
    details: Details.optional(),
  })
  .superRefine((v, x) => {
    if (v.date && v.endDate && v.endDate < v.date) x.addIssue({ code: 'custom', path: ['endDate'], message: 'Ends before it starts' })
    if (v.endDate && !v.date) x.addIssue({ code: 'custom', path: ['date'], message: 'Add the start date too' })
    if (v.type === 'resort-day' && !v.date) x.addIssue({ code: 'custom', path: ['date'], message: 'A ski day needs its date' })
  })
export type AddTripItemInput = z.input<typeof AddItemInput>

/** Add a component to a trip. Catalog hotels/events fill their title, dates and links; prices are only ever yours. */
export async function addTripItem(input: AddTripItemInput): Promise<ActionResult<{ itemId: number; title: string }>> {
  const parsed = AddItemInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const trip = await tripOrNull(v.tripId)
  if (!trip) return fail('That trip no longer exists')
  if (trip.status === 'cancelled') return fail('This trip is cancelled — reopen it before adding to it')
  const refId = v.refId?.trim() || null
  const refProblem = await refIssue(v.type, v.type === 'flight' && refId ? refId.toUpperCase() : refId)
  if (refProblem) return fail(refProblem, { refId: refProblem })
  const { db, now } = await getCtx()

  let title = v.title?.trim() || ''
  let date = v.date ?? null
  let endDate = v.endDate ?? null
  const extra: Record<string, unknown> = {}
  if (v.type === 'lodging' && refId) {
    const [h] = await db.select().from(s.hotels).where(eq(s.hotels.id, refId))
    title ||= h.name
    date ??= trip.startDate
    endDate ??= trip.endDate > trip.startDate ? trip.endDate : addDays(trip.startDate, 1)
    extra.hotelId = h.id
    extra.resortId = h.resortId
    if (h.officialUrl) extra.url = h.officialUrl
  }
  if (v.type === 'event' && refId) {
    const [e] = await db.select().from(s.events).where(eq(s.events.id, refId))
    const dup = await db
      .select({ id: s.tripItems.id })
      .from(s.tripItems)
      .where(and(eq(s.tripItems.tripId, trip.id), eq(s.tripItems.type, 'event'), eq(s.tripItems.refId, refId)))
    if (dup.length) return fail(`${e.title} is already on this trip`)
    title ||= e.title
    // Only an announced date is used — an undated event stays unscheduled (never assumed).
    date ??= e.startLocal ? e.startLocal.slice(0, 10) : null
    endDate ??= e.endLocal && e.endLocal.slice(0, 10) !== date ? e.endLocal.slice(0, 10) : null
    extra.eventId = e.id
    if (e.startLocal && e.startLocal.length > 10) extra.startTime = e.startLocal.slice(11, 16)
    if (e.venue) extra.venue = e.venue
    if (e.officialUrl ?? e.ticketUrl) extra.url = e.officialUrl ?? e.ticketUrl
  }
  if (v.type === 'lodging' && refId) {
    const dup = await db
      .select({ id: s.tripItems.id })
      .from(s.tripItems)
      .where(and(eq(s.tripItems.tripId, trip.id), eq(s.tripItems.type, 'lodging'), eq(s.tripItems.refId, refId)))
    if (dup.length) return fail(`${title} is already saved to this trip`)
  }
  if (v.type === 'resort-day' && refId && date) {
    const dup = await db
      .select({ id: s.tripItems.id })
      .from(s.tripItems)
      .where(and(eq(s.tripItems.tripId, trip.id), eq(s.tripItems.type, 'resort-day'), eq(s.tripItems.refId, refId), eq(s.tripItems.date, date)))
    if (dup.length) return fail('That ski day is already planned')
  }
  if (!title && RESORT_REF_TYPES.has(v.type) && refId) {
    const [r] = await db.select({ name: s.resorts.name, shortName: s.resorts.shortName }).from(s.resorts).where(eq(s.resorts.id, refId))
    const at = r ? r.shortName || r.name : ''
    title = v.type === 'resort-day' ? `Ski day at ${at}` : `${TYPE_NOUN[v.type]} at ${at}`
  }
  if (!title && v.type === 'flight') title = `Flight${v.details?.origin && refId ? ` ${v.details.origin} → ${refId.toUpperCase()}` : ''}`
  if (!title) return fail('Give this item a title', { title: 'Add a short title' })

  const cost = costColumns(v.cost ? { ...v.cost, basis: v.cost.basis } : { min: null, basis: DEFAULT_BASIS[v.type] ?? 'per-person' })
  const { fxQuote, ...money } = cost
  const details = {
    ...extra,
    ...defined((v.details ?? {}) as Record<string, unknown>),
    ...(fxQuote ? { fxQuote } : {}),
    addedFrom: 'trips',
    userEntered: v.cost?.min != null ? true : undefined,
  }
  const [row] = await db
    .insert(s.tripItems)
    .values({
      tripId: trip.id,
      type: v.type,
      refId: v.type === 'flight' && refId ? refId.toUpperCase() : refId,
      title: title.slice(0, 200),
      date,
      endDate,
      status: v.status,
      ...money,
      details: defined(details),
      sortOrder: await nextSortOrder(trip.id),
      createdAt: now,
    })
    .returning()
  if (row.type === 'lesson') {
    const lessonId = await syncLesson(row)
    if (lessonId) await db.update(s.tripItems).set({ details: { ...row.details, lessonId } }).where(eq(s.tripItems.id, row.id))
  }
  await touch(trip.id)
  revalidate(trip.id)
  return { ok: true, data: { itemId: row.id, title: row.title }, message: `${row.title} added` }
}

const TYPE_NOUN: Record<string, string> = {
  'lift-ticket': 'Lift ticket',
  lesson: 'Lesson',
  rental: 'Rental',
  parking: 'Parking',
  food: 'Food',
  drive: 'Drive',
  transfer: 'Transfer',
}

/** Add a catalog event to a trip (its announced date, venue and links; never an invented date). */
export async function addEventToTrip(input: { tripId: string; eventId: string }): Promise<ActionResult<{ itemId: number; title: string }>> {
  const parsed = z.object({ tripId: TripId, eventId: z.string().min(1).max(160) }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  return addTripItem({ tripId: parsed.data.tripId, type: 'event', refId: parsed.data.eventId, status: 'idea' })
}

const UpdateItemInput = z
  .object({
    tripId: TripId,
    itemId: ItemId,
    refId: z.string().trim().max(160).nullish(),
    title: z.string().trim().min(1, 'Add a short title').max(200, 'Keep the title under 200 characters').optional(),
    date: LocalDate.nullish(),
    endDate: LocalDate.nullish(),
    status: z.enum(['idea', 'draft', 'booked']).optional(),
    /** Replaces the cost (null clears it — the item becomes unpriced, never $0). */
    cost: CostInput.nullish(),
    /** Merged into the stored details (keys not mentioned are kept). */
    details: Details.optional(),
  })
  .superRefine((v, x) => {
    if (v.date && v.endDate && v.endDate < v.date) x.addIssue({ code: 'custom', path: ['endDate'], message: 'Ends before it starts' })
  })
export type UpdateTripItemInput = z.input<typeof UpdateItemInput>

/** Edit a trip item (partial patch). */
export async function updateTripItem(input: UpdateTripItemInput): Promise<ActionResult<{ itemId: number }>> {
  const parsed = UpdateItemInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const item = await itemOf(v.tripId, v.itemId)
  if (!item) return fail('That item is no longer on this trip')
  if (v.refId !== undefined) {
    const ref = v.refId?.trim() || null
    const problem = await refIssue(item.type, item.type === 'flight' && ref ? ref.toUpperCase() : ref)
    if (problem) return fail(problem, { refId: problem })
  }
  const date = v.date === undefined ? item.date : v.date
  const endDate = v.endDate === undefined ? item.endDate : v.endDate
  if (date && endDate && endDate < date) return fail('Ends before it starts', { endDate: 'Ends before it starts' })
  if (item.type === 'resort-day' && !date) return fail('A ski day needs its date', { date: 'A ski day needs its date' })
  const { db } = await getCtx()
  const patch: Partial<typeof s.tripItems.$inferInsert> = defined({
    refId: v.refId === undefined ? undefined : v.refId?.trim() ? (item.type === 'flight' ? v.refId.trim().toUpperCase() : v.refId.trim()) : null,
    title: v.title,
    date: v.date === undefined ? undefined : v.date,
    endDate: v.endDate === undefined ? undefined : v.endDate,
    status: v.status,
  })
  let details: Record<string, unknown> = { ...(item.details ?? {}), ...defined((v.details ?? {}) as Record<string, unknown>) }
  if (v.cost !== undefined) {
    const { fxQuote, ...money } = costColumns(v.cost)
    Object.assign(patch, money)
    const { fxQuote: _old, ...rest } = details
    details = { ...rest, ...(fxQuote ? { fxQuote } : {}), ...(money.costMinor != null ? { userEntered: true } : {}) }
  }
  patch.details = details
  await db.update(s.tripItems).set(patch).where(eq(s.tripItems.id, item.id))
  if (item.type === 'lesson') {
    const [fresh] = await db.select().from(s.tripItems).where(eq(s.tripItems.id, item.id))
    const lessonId = await syncLesson(fresh)
    if (lessonId && fresh.details?.lessonId !== lessonId) await db.update(s.tripItems).set({ details: { ...fresh.details, lessonId } }).where(eq(s.tripItems.id, item.id))
  }
  await touch(item.tripId)
  revalidate(item.tripId)
  return { ok: true, data: { itemId: item.id } }
}

/** Quick status change for one item (idea → draft → booked). */
export async function setTripItemStatus(input: { tripId: string; itemId: number; status: 'idea' | 'draft' | 'booked' }): Promise<ActionResult<{ itemId: number }>> {
  const parsed = z.object({ tripId: TripId, itemId: ItemId, status: z.enum(['idea', 'draft', 'booked']) }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  return updateTripItem(parsed.data)
}

const ItemSnapshot = z.object({
  tripId: TripId,
  item: TripSnapshot.shape.items.element,
  lesson: TripSnapshot.shape.lessons.element.nullable(),
})
export type TripItemSnapshot = z.output<typeof ItemSnapshot>

/** Remove an item (and its planned lesson record). Returns a snapshot for Undo. */
export async function removeTripItem(input: { tripId: string; itemId: number }): Promise<ActionResult<{ snapshot: TripItemSnapshot; title: string }>> {
  const parsed = z.object({ tripId: TripId, itemId: ItemId }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const item = await itemOf(parsed.data.tripId, parsed.data.itemId)
  if (!item) return fail('That item is no longer on this trip')
  const { db } = await getCtx()
  const lesson = item.type === 'lesson' ? await linkedLesson(item) : null
  if (lesson) await db.delete(s.lessons).where(eq(s.lessons.id, lesson.id))
  await db.delete(s.tripItems).where(eq(s.tripItems.id, item.id))
  await touch(item.tripId)
  revalidate(item.tripId)
  const { tripId: _t, ...rest } = item
  const lessonSnap = lesson ? (({ tripId: _lt, ...l }) => l)(lesson) : null
  return { ok: true, data: { snapshot: { tripId: item.tripId, item: rest, lesson: lessonSnap }, title: item.title }, message: `${item.title} removed` }
}

/** Undo a removal. */
export async function restoreTripItem(input: { snapshot: TripItemSnapshot }): Promise<ActionResult<{ itemId: number }>> {
  const parsed = z.object({ snapshot: ItemSnapshot }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'That item could not be restored')
  const { tripId, item, lesson } = parsed.data.snapshot
  const trip = await tripOrNull(tripId)
  if (!trip) return fail('That trip no longer exists')
  const { db } = await getCtx()
  let lessonId: number | null = null
  if (lesson) {
    const [taken] = await db.select({ id: s.lessons.id }).from(s.lessons).where(eq(s.lessons.id, lesson.id))
    const [row] = await db
      .insert(s.lessons)
      .values({ ...lesson, id: taken ? undefined : lesson.id, tripId })
      .returning({ id: s.lessons.id })
    lessonId = row.id
  }
  const [taken] = await db.select({ id: s.tripItems.id }).from(s.tripItems).where(eq(s.tripItems.id, item.id))
  const [row] = await db
    .insert(s.tripItems)
    .values({ ...item, id: taken ? undefined : item.id, tripId, details: lessonId ? { ...item.details, lessonId } : item.details })
    .returning({ id: s.tripItems.id })
  await touch(tripId)
  revalidate(tripId)
  return { ok: true, data: { itemId: row.id }, message: `${item.title} restored` }
}

const ReorderInput = z.object({
  tripId: TripId,
  /** The day being reordered (null = unscheduled items). */
  date: LocalDate.nullable(),
  /** Every item of that day, in the new order. */
  itemIds: z.array(ItemId).min(1).max(200),
})

/** Reorder the items of one day. The day's existing order slots are reused, so other days are untouched. */
export async function reorderTripItems(input: z.input<typeof ReorderInput>): Promise<ActionResult> {
  const parsed = ReorderInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db } = await getCtx()
  const items = await db.select({ id: s.tripItems.id, date: s.tripItems.date, sortOrder: s.tripItems.sortOrder }).from(s.tripItems).where(eq(s.tripItems.tripId, v.tripId))
  const day = items.filter((i) => i.date === v.date)
  const ids = new Set(day.map((i) => i.id))
  if (new Set(v.itemIds).size !== v.itemIds.length || v.itemIds.length !== day.length || v.itemIds.some((id) => !ids.has(id))) {
    return fail('The day changed while you were reordering — reload and try again')
  }
  const slots = day.map((i) => i.sortOrder).sort((a, b) => a - b)
  // Duplicate slots (older data) would not keep an order: spread them from the lowest.
  const distinct = new Set(slots).size === slots.length ? slots : slots.map((_, k) => slots[0] + k)
  for (let k = 0; k < v.itemIds.length; k++) {
    await db
      .update(s.tripItems)
      .set({ sortOrder: distinct[k] })
      .where(and(eq(s.tripItems.id, v.itemIds[k]), eq(s.tripItems.tripId, v.tripId)))
  }
  await touch(v.tripId)
  revalidate(v.tripId)
  return { ok: true, data: null }
}

// ---------------------------------------------------------------------------
// Companions

const CompanionsInput = z.object({
  tripId: TripId,
  companions: z.array(Companion).max(MAX_PARTY - 1),
  partySize: z.number().int().min(1).max(MAX_PARTY).optional(),
})

/** Replace the named companions (name + ability). Party size grows to fit them; it can be larger than the names. */
export async function setTripCompanions(input: z.input<typeof CompanionsInput>): Promise<ActionResult<{ partySize: number }>> {
  const parsed = CompanionsInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const trip = await tripOrNull(v.tripId)
  if (!trip) return fail('That trip no longer exists')
  const { db, now } = await getCtx()
  const partySize = Math.max(v.partySize ?? trip.partySize, v.companions.length + 1)
  await db.update(s.trips).set({ companions: v.companions, partySize, updatedAt: now }).where(eq(s.trips.id, trip.id))
  revalidate(trip.id)
  return { ok: true, data: { partySize }, message: partySize !== trip.partySize ? `Party size is now ${partySize}` : undefined }
}

// ---------------------------------------------------------------------------
// Checklist and templates

const Label = z.string().trim().min(1, 'Write the item').max(200, 'Keep it under 200 characters')
const Category = z.string().trim().max(60).nullish().transform((v) => (v ? v : null))

export async function addChecklistItem(input: { tripId: string; label: string; category?: string | null; link?: string | null }): Promise<ActionResult<{ id: number }>> {
  const parsed = z.object({ tripId: TripId, label: Label, category: Category, link: optUrl }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  if (!(await tripOrNull(v.tripId))) return fail('That trip no longer exists')
  const { db } = await getCtx()
  const rows = await db.select({ o: s.tripChecklist.sortOrder }).from(s.tripChecklist).where(eq(s.tripChecklist.tripId, v.tripId))
  const [row] = await db
    .insert(s.tripChecklist)
    .values({ tripId: v.tripId, label: v.label, category: v.category, done: false, link: v.link ?? null, sortOrder: rows.reduce((m, r) => Math.max(m, r.o), -1) + 1 })
    .returning({ id: s.tripChecklist.id })
  await touch(v.tripId)
  revalidate(v.tripId)
  return { ok: true, data: { id: row.id } }
}

export async function updateChecklistItem(input: { tripId: string; id: number; label?: string; category?: string | null; done?: boolean; link?: string | null }): Promise<ActionResult<{ id: number }>> {
  const parsed = z.object({ tripId: TripId, id: z.number().int().positive(), label: Label.optional(), category: Category.optional(), done: z.boolean().optional(), link: optUrl }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db } = await getCtx()
  const [row] = await db
    .select()
    .from(s.tripChecklist)
    .where(and(eq(s.tripChecklist.id, v.id), eq(s.tripChecklist.tripId, v.tripId)))
  if (!row) return fail('That checklist item is gone')
  const patch = defined({ label: v.label, category: v.category, done: v.done, link: v.link })
  if (Object.keys(patch).length) await db.update(s.tripChecklist).set(patch).where(eq(s.tripChecklist.id, row.id))
  await touch(v.tripId)
  revalidate(v.tripId)
  return { ok: true, data: { id: row.id } }
}

const ChecklistSnapshot = z.object({ tripId: TripId, row: TripSnapshot.shape.checklist.element })
export type ChecklistSnapshot = z.output<typeof ChecklistSnapshot>

export async function removeChecklistItem(input: { tripId: string; id: number }): Promise<ActionResult<{ snapshot: ChecklistSnapshot }>> {
  const parsed = z.object({ tripId: TripId, id: z.number().int().positive() }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const { db } = await getCtx()
  const [row] = await db
    .select()
    .from(s.tripChecklist)
    .where(and(eq(s.tripChecklist.id, parsed.data.id), eq(s.tripChecklist.tripId, parsed.data.tripId)))
  if (!row) return fail('That checklist item is gone')
  await db.delete(s.tripChecklist).where(eq(s.tripChecklist.id, row.id))
  await touch(row.tripId)
  revalidate(row.tripId)
  const { tripId: _t, ...rest } = row
  return { ok: true, data: { snapshot: { tripId: row.tripId, row: rest } }, message: `Removed “${row.label}”` }
}

export async function restoreChecklistItem(input: { snapshot: ChecklistSnapshot }): Promise<ActionResult<{ id: number }>> {
  const parsed = z.object({ snapshot: ChecklistSnapshot }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'That item could not be restored')
  const { tripId, row } = parsed.data.snapshot
  if (!(await tripOrNull(tripId))) return fail('That trip no longer exists')
  const { db } = await getCtx()
  const [taken] = await db.select({ id: s.tripChecklist.id }).from(s.tripChecklist).where(eq(s.tripChecklist.id, row.id))
  const [ins] = await db
    .insert(s.tripChecklist)
    .values({ ...row, id: taken ? undefined : row.id, tripId })
    .returning({ id: s.tripChecklist.id })
  revalidate(tripId)
  return { ok: true, data: { id: ins.id } }
}

/** Add the template items this trip's checklist does not have yet (matched by label). */
export async function applyChecklistTemplates(input: { tripId: string }): Promise<ActionResult<{ added: number }>> {
  const parsed = z.object({ tripId: TripId }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  if (!(await tripOrNull(parsed.data.tripId))) return fail('That trip no longer exists')
  const { db } = await getCtx()
  const [templates, rows] = await Promise.all([
    db.select().from(s.checklistTemplates).orderBy(asc(s.checklistTemplates.sortOrder), asc(s.checklistTemplates.id)),
    db.select().from(s.tripChecklist).where(eq(s.tripChecklist.tripId, parsed.data.tripId)),
  ])
  const have = new Set(rows.map((r) => r.label.trim().toLowerCase()))
  const fresh = templates.filter((t) => !have.has(t.label.trim().toLowerCase()))
  let order = rows.reduce((m, r) => Math.max(m, r.sortOrder), -1)
  if (fresh.length) {
    await db.insert(s.tripChecklist).values(fresh.map((t) => ({ tripId: parsed.data.tripId, label: t.label, category: t.category, done: false, link: null, sortOrder: ++order })))
    await touch(parsed.data.tripId)
  }
  revalidate(parsed.data.tripId)
  return { ok: true, data: { added: fresh.length }, message: fresh.length ? `Added ${fresh.length} item${fresh.length === 1 ? '' : 's'} from your templates` : 'Everything from your templates is already here' }
}

export async function saveChecklistTemplate(input: { id?: number | null; label: string; category?: string | null }): Promise<ActionResult<{ id: number }>> {
  const parsed = z.object({ id: z.number().int().positive().nullish(), label: Label, category: Category }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db } = await getCtx()
  if (v.id) {
    const [row] = await db.select().from(s.checklistTemplates).where(eq(s.checklistTemplates.id, v.id))
    if (!row) return fail('That template item is gone')
    await db.update(s.checklistTemplates).set({ label: v.label, category: v.category }).where(eq(s.checklistTemplates.id, v.id))
    revalidatePath('/trips', 'layout')
    return { ok: true, data: { id: v.id } }
  }
  const rows = await db.select({ o: s.checklistTemplates.sortOrder }).from(s.checklistTemplates)
  const [row] = await db
    .insert(s.checklistTemplates)
    .values({ label: v.label, category: v.category, sortOrder: rows.reduce((m, r) => Math.max(m, r.o), -1) + 1 })
    .returning({ id: s.checklistTemplates.id })
  revalidatePath('/trips', 'layout')
  return { ok: true, data: { id: row.id } }
}

const TemplateSnapshot = z.object({ id: z.number().int().positive(), label: z.string().min(1).max(200), category: z.string().max(60).nullable(), sortOrder: z.number().int() })
export type TemplateSnapshot = z.output<typeof TemplateSnapshot>

export async function removeChecklistTemplate(input: { id: number }): Promise<ActionResult<{ snapshot: TemplateSnapshot }>> {
  const parsed = z.object({ id: z.number().int().positive() }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const { db } = await getCtx()
  const [row] = await db.select().from(s.checklistTemplates).where(eq(s.checklistTemplates.id, parsed.data.id))
  if (!row) return fail('That template item is gone')
  await db.delete(s.checklistTemplates).where(eq(s.checklistTemplates.id, row.id))
  revalidatePath('/trips', 'layout')
  return { ok: true, data: { snapshot: row }, message: `Removed “${row.label}” from your templates` }
}

export async function restoreChecklistTemplate(input: { snapshot: TemplateSnapshot }): Promise<ActionResult<{ id: number }>> {
  const parsed = z.object({ snapshot: TemplateSnapshot }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'That template could not be restored')
  const { db } = await getCtx()
  const t = parsed.data.snapshot
  const [taken] = await db.select({ id: s.checklistTemplates.id }).from(s.checklistTemplates).where(eq(s.checklistTemplates.id, t.id))
  const [row] = await db
    .insert(s.checklistTemplates)
    .values({ ...t, id: taken ? undefined : t.id })
    .returning({ id: s.checklistTemplates.id })
  revalidatePath('/trips', 'layout')
  return { ok: true, data: { id: row.id } }
}

// ---------------------------------------------------------------------------
// Flight offers (optional connector; never in demo mode)

export interface FlightOffersResult {
  offers: FlightOffer[]
  limitations: string[]
  fetchedAt: string | null
  testMode: boolean
  provider: string
}

const OffersInput = z.object({
  tripId: TripId,
  origin: IATA,
  destination: IATA,
  departDate: LocalDate,
  returnDate: LocalDate.nullish(),
  adults: z.number().int().min(1).max(9),
})

/**
 * Ask the configured flight connector for offers. Quotes are returned, not stored: saving one is an explicit
 * addTripItem with kind 'quote' and the offer's expiry. Test-mode offers are labelled and never saved as quotes.
 */
export async function fetchFlightOffers(input: z.input<typeof OffersInput>): Promise<ActionResult<FlightOffersResult>> {
  const parsed = OffersInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const ctx = await getCtx()
  if (ctx.mode === 'demo') return fail('Flight offers are not fetched in demo mode')
  if (!travelProvider.configured()) return fail('No flight-offers connector is configured — use the search links and enter a quote yourself')
  if (!(await tripOrNull(v.tripId))) return fail('That trip no longer exists')
  const res = await travelProvider.searchOffers({ origin: v.origin, destination: v.destination, departDate: v.departDate, returnDate: v.returnDate ?? null, adults: v.adults, cabin: 'economy' })
  if (!res.ok) return fail(res.errorKind === 'timeout' ? 'The flight connector timed out — try again later' : `Flight offers unavailable: ${res.error}`)
  const testMode = res.provenance.kind === 'demo'
  return {
    ok: true,
    data: { offers: res.data.slice(0, 12), limitations: res.capabilities.limitations ?? [], fetchedAt: res.provenance.fetchedAt ?? null, testMode, provider: res.provenance.provider ?? travelProvider.id },
  }
}
