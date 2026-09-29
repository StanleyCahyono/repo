'use server'
/**
 * Resort page mutations: my rating, manual report entry (the manual-edit route for unsupported official data),
 * my own surface observations, and adding the resort (or one of its hotels / events) to a trip.
 *
 * Every action validates with zod, never trusts ids from the client, and revalidates the affected pages.
 * Reports go through the jobs module (addManualReport / addPersonalReport) so revisions, status history and
 * season dates follow the same rules as adapter ingestion; the resort's assessments and alerts are recomputed after.
 */
import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { nowFor } from '@/lib/clock'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import { dateRange, daysBetween, isLocalDate, localDateOf, localTimeToInstant } from '@/lib/domain/time'
import { OPERATING_STATUSES, SNOW_WINDOWS, SURFACE_TAGS } from '@/lib/domain/types'
import { inToCm } from '@/lib/domain/units'
import { defaultDeps } from '@/lib/jobs/deps'
import { addManualReport, addPersonalReport } from '@/lib/jobs/reports'
import { runJob } from '@/lib/jobs/runner'

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }

const ResortId = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Unknown resort')
const LocalDate = z.string().refine(isLocalDate, 'Expected a date (YYYY-MM-DD)')
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors }
}

function zodFail(e: z.ZodError, fallback = 'Please check the highlighted fields'): ActionResult<never> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of e.issues) {
    const key = issue.path.join('.') || '_'
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fail(fallback, fieldErrors)
}

async function resortOrNull(id: string) {
  const { db } = await getCtx()
  const [r] = await db.select({ id: s.resorts.id, name: s.resorts.name, shortName: s.resorts.shortName, timezone: s.resorts.timezone }).from(s.resorts).where(eq(s.resorts.id, id))
  return r ?? null
}

function revalidateResort(id: string) {
  revalidatePath(`/resorts/${id}`)
  // Status, scores and trips feed Today, Explore, Forecast and Trips too.
  revalidatePath('/', 'layout')
}

/** Recompute this resort's assessments and the alert feed after new evidence (local computation, no fetching). */
async function followUps(resortId: string) {
  const ctx = await getCtx()
  const deps = defaultDeps({ demo: ctx.mode === 'demo' })
  const clock = () => nowFor(ctx.mode)
  try {
    await runJob({ db: ctx.db, job: 'assessments', target: resortId, trigger: 'manual', now: clock(), deps, clock, cooldownMinutes: 0 })
    await runJob({ db: ctx.db, job: 'alerts', target: null, trigger: 'manual', now: clock(), deps, clock, cooldownMinutes: 0 })
  } catch {
    // The report itself is saved; a failed recompute shows up as a stale score and on Sources & Sync.
  }
}

// ---------------------------------------------------------------------------
// My rating

const RatingInput = z.object({
  resortId: ResortId,
  rating: z.number().int().min(1, 'Choose 1–5').max(5, 'Choose 1–5').nullable(),
  review: z
    .string()
    .max(2000, 'Keep notes under 2,000 characters')
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
})

export async function saveMyRating(input: z.input<typeof RatingInput>): Promise<ActionResult<{ rating: number | null; review: string | null; updatedAt: string | null }>> {
  const parsed = RatingInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  if (!(await resortOrNull(v.resortId))) return fail('Unknown resort')
  const { db, now } = await getCtx()
  if (v.rating === null && v.review === null) {
    await db.delete(s.myRatings).where(eq(s.myRatings.resortId, v.resortId))
    revalidateResort(v.resortId)
    return { ok: true, data: { rating: null, review: null, updatedAt: null }, message: 'Rating cleared' }
  }
  await db
    .insert(s.myRatings)
    .values({ resortId: v.resortId, rating: v.rating, review: v.review, updatedAt: now })
    .onConflictDoUpdate({ target: s.myRatings.resortId, set: { rating: v.rating, review: v.review, updatedAt: now } })
  revalidateResort(v.resortId)
  return { ok: true, data: { rating: v.rating, review: v.review, updatedAt: now }, message: 'Your rating is saved' }
}

// ---------------------------------------------------------------------------
// Manual report entry (official figures, with a source)

const num = (max: number) => z.number().finite().min(0, 'Cannot be negative').max(max, 'That value looks too large').nullable()
const int = z.number().int('Whole numbers only').min(0, 'Cannot be negative').max(10_000).nullable()
const text = (max: number) =>
  z
    .string()
    .max(max, `Keep it under ${max} characters`)
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null))

const ManualForm = z
  .object({
    resortId: ResortId,
    localDate: LocalDate,
    kind: z.enum(['manual', 'official']),
    sourceUrl: z
      .string()
      .trim()
      .min(1, 'A source link is required for official figures')
      .url('Enter the full link, starting with https://')
      .refine((u) => /^https?:\/\//i.test(u), 'Enter the full link, starting with https://'),
    sourceLabel: text(120),
    /** Resort-local time the source says it published the report ('HH:mm'), or null when not stated. */
    reportedTime: z.string().regex(HHMM, 'Use HH:MM (24-hour)').nullable(),
    status: z.enum(OPERATING_STATUSES).nullable(),
    /** Unit the snow amounts were typed in. */
    snowUnit: z.enum(['in', 'cm']),
    snowfall: z.array(z.object({ window: z.enum(SNOW_WINDOWS), amount: num(1000), sourceText: text(200) })).max(10),
    baseDepth: num(2000),
    baseDepthLocation: text(120),
    summitDepth: num(2000),
    surfaceTags: z.array(z.enum(SURFACE_TAGS)).max(9),
    surfaceText: text(1000),
    groomingText: text(1000),
    groomedRuns: int,
    snowmakingText: text(1000),
    openTrails: int,
    totalTrails: int,
    openLifts: int,
    totalLifts: int,
    openBeginnerTrails: int,
    totalBeginnerTrails: int,
    openAcres: num(100_000),
    notes: text(2000),
  })
  .superRefine((v, c) => {
    const pairs: [keyof typeof v, keyof typeof v, string][] = [
      ['openTrails', 'totalTrails', 'trails'],
      ['openLifts', 'totalLifts', 'lifts'],
      ['openBeginnerTrails', 'totalBeginnerTrails', 'beginner trails'],
    ]
    for (const [open, total, label] of pairs) {
      const o = v[open] as number | null
      const t = v[total] as number | null
      if (o !== null && t !== null && o > t) c.addIssue({ code: 'custom', path: [open], message: `More open ${label} than the total` })
    }
    const seen = new Set<string>()
    v.snowfall.forEach((sf, i) => {
      if (seen.has(sf.window)) c.addIssue({ code: 'custom', path: ['snowfall', i, 'window'], message: 'Each window once' })
      seen.add(sf.window)
    })
  })

export type ManualReportForm = z.input<typeof ManualForm>

export async function submitManualReport(input: ManualReportForm): Promise<ActionResult<{ id: number; revision: number; statusAppended: boolean }>> {
  const parsed = ManualForm.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const resort = await resortOrNull(v.resortId)
  if (!resort) return fail('Unknown resort')
  const ctx = await getCtx()
  // A report describes a day that has started at the resort: never a future resort-local date.
  const resortToday = localDateOf(ctx.now, resort.timezone)
  if (v.localDate > resortToday) return fail('Reports are for today or earlier at the resort', { localDate: `Pick ${resortToday} or earlier (resort time)` })
  const toCm = (x: number | null) => (x === null ? null : v.snowUnit === 'in' ? Math.round(inToCm(x) * 10) / 10 : x)
  const reportedAt = v.reportedTime ? localTimeToInstant(v.localDate, v.reportedTime, resort.timezone) : null
  const hasContent =
    v.status !== null ||
    v.snowfall.some((x) => x.amount !== null || x.sourceText) ||
    [v.baseDepth, v.summitDepth, v.groomedRuns, v.openTrails, v.totalTrails, v.openLifts, v.totalLifts, v.openBeginnerTrails, v.totalBeginnerTrails, v.openAcres].some((x) => x !== null) ||
    v.surfaceTags.length > 0 ||
    [v.surfaceText, v.groomingText, v.snowmakingText, v.notes].some((x) => x !== null)
  if (!hasContent) return fail('Add at least one figure or statement from the source')
  try {
    const res = await addManualReport(
      ctx.db,
      {
        resortId: v.resortId,
        localDate: v.localDate,
        kind: v.kind,
        sourceUrl: v.sourceUrl,
        sourceLabel: v.sourceLabel,
        reportedAt,
        status: v.status,
        snowfall: v.snowfall.filter((x) => x.amount !== null || x.sourceText).map((x) => ({ window: x.window, amountCm: toCm(x.amount), sourceText: x.sourceText })),
        baseDepthCm: toCm(v.baseDepth),
        baseDepthLocation: v.baseDepthLocation,
        summitDepthCm: toCm(v.summitDepth),
        surfaceTags: v.surfaceTags,
        surfaceText: v.surfaceText,
        groomingText: v.groomingText,
        groomedRuns: v.groomedRuns,
        snowmakingText: v.snowmakingText,
        openTrails: v.openTrails,
        totalTrails: v.totalTrails,
        openLifts: v.openLifts,
        totalLifts: v.totalLifts,
        openBeginnerTrails: v.openBeginnerTrails,
        totalBeginnerTrails: v.totalBeginnerTrails,
        openAcres: v.openAcres,
        notes: v.notes,
      },
      ctx.now,
    )
    await followUps(v.resortId)
    revalidateResort(v.resortId)
    return {
      ok: true,
      data: res,
      message: `Report saved for ${resort.shortName || resort.name}${res.revision > 1 ? ` (revision ${res.revision})` : ''}`,
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      const mapped = zodFail(e)
      // reportedAt is derived from the local time field.
      if (!mapped.ok && mapped.fieldErrors?.reportedAt) mapped.fieldErrors.reportedTime = mapped.fieldErrors.reportedAt
      return mapped
    }
    return fail('The report could not be saved. Nothing was changed.')
  }
}

// ---------------------------------------------------------------------------
// My own observation (personal feedback — never operations evidence)

const PersonalForm = z.object({
  resortId: ResortId,
  localDate: LocalDate,
  surfaceTags: z.array(z.enum(SURFACE_TAGS)).max(9),
  surfaceText: text(1000),
  notes: text(2000),
})

export type PersonalReportForm = z.input<typeof PersonalForm>

export async function submitPersonalReport(input: PersonalReportForm): Promise<ActionResult<{ id: number }>> {
  const parsed = PersonalForm.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const resort = await resortOrNull(v.resortId)
  if (!resort) return fail('Unknown resort')
  if (!v.surfaceTags.length && !v.surfaceText && !v.notes) return fail('Pick at least one surface tag or write a note', { surfaceTags: 'Pick a tag or write a note' })
  const ctx = await getCtx()
  const resortToday = localDateOf(ctx.now, resort.timezone)
  if (v.localDate > resortToday) return fail('Observations are for today or earlier', { localDate: 'Pick today or an earlier day (resort time)' })
  try {
    const res = await addPersonalReport(ctx.db, { resortId: v.resortId, localDate: v.localDate, surfaceTags: v.surfaceTags, surfaceText: v.surfaceText, notes: v.notes }, ctx.now)
    await followUps(v.resortId)
    revalidateResort(v.resortId)
    return { ok: true, data: { id: res.id }, message: 'Your observation is saved' }
  } catch (e) {
    if (e instanceof z.ZodError) return zodFail(e)
    return fail('Your observation could not be saved.')
  }
}

// ---------------------------------------------------------------------------
// Trips

const MAX_TRIP_DAYS = 21

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'trip'
  )
}

async function uniqueTripId(name: string): Promise<string> {
  const { db } = await getCtx()
  const base = slug(name)
  for (let i = 0; i < 6; i++) {
    const id = `${base}-${Math.random().toString(36).slice(2, 7)}`
    const exists = await db.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.id, id))
    if (!exists.length) return id
  }
  throw new Error('Could not allocate a trip id')
}

const AddDaysInput = z.object({
  tripId: z.string().min(1).max(120),
  resortId: ResortId,
  dates: z.array(LocalDate).min(1, 'Pick at least one day').max(MAX_TRIP_DAYS),
})

/** Add ski days at this resort to an existing trip (skips days already planned there). */
export async function addResortDaysToTrip(input: z.input<typeof AddDaysInput>): Promise<ActionResult<{ itemIds: number[]; tripName: string; skipped: number }>> {
  const parsed = AddDaysInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const resort = await resortOrNull(v.resortId)
  if (!resort) return fail('Unknown resort')
  const { db, now } = await getCtx()
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, v.tripId))
  if (!trip || trip.status === 'cancelled') return fail('That trip is not available')
  const outside = v.dates.filter((d) => d < trip.startDate || d > trip.endDate)
  if (outside.length) return fail(`Pick days between ${trip.startDate} and ${trip.endDate}`, { dates: 'Outside the trip dates' })
  const existing = await db
    .select({ date: s.tripItems.date, sortOrder: s.tripItems.sortOrder })
    .from(s.tripItems)
    .where(and(eq(s.tripItems.tripId, trip.id), eq(s.tripItems.type, 'resort-day'), eq(s.tripItems.refId, v.resortId)))
  const all = await db.select({ sortOrder: s.tripItems.sortOrder }).from(s.tripItems).where(eq(s.tripItems.tripId, trip.id))
  const taken = new Set(existing.map((e) => e.date))
  const fresh = [...new Set(v.dates)].filter((d) => !taken.has(d)).sort()
  if (!fresh.length) return fail(`${resort.shortName || resort.name} is already planned on ${v.dates.length === 1 ? 'that day' : 'those days'}`)
  let order = all.reduce((m, x) => Math.max(m, x.sortOrder), -1)
  const rows = await db
    .insert(s.tripItems)
    .values(
      fresh.map((date) => ({
        tripId: trip.id,
        type: 'resort-day' as const,
        refId: v.resortId,
        title: `Ski day at ${resort.shortName || resort.name}`,
        date,
        status: 'draft' as const,
        costBasis: 'per-person' as const,
        details: { addedFrom: 'resort-page' },
        sortOrder: ++order,
        createdAt: now,
      })),
    )
    .returning({ id: s.tripItems.id })
  await db.update(s.trips).set({ updatedAt: now }).where(eq(s.trips.id, trip.id))
  revalidatePath('/trips', 'layout')
  revalidatePath(`/resorts/${v.resortId}`)
  return { ok: true, data: { itemIds: rows.map((r) => r.id), tripName: trip.name, skipped: v.dates.length - fresh.length } }
}

const NewTripInput = z
  .object({
    resortId: ResortId,
    name: z.string().trim().min(1, 'Give the trip a name').max(120, 'Keep the name under 120 characters'),
    startDate: LocalDate,
    endDate: LocalDate,
    partySize: z.number().int().min(1).max(20),
    /** Plan a ski day at this resort on each day of the trip (else only the first day). */
    everyDay: z.boolean(),
  })
  .superRefine((v, c) => {
    if (isLocalDate(v.startDate) && isLocalDate(v.endDate)) {
      const n = daysBetween(v.startDate, v.endDate)
      if (n < 0) c.addIssue({ code: 'custom', path: ['endDate'], message: 'Ends before it starts' })
      else if (n >= MAX_TRIP_DAYS) c.addIssue({ code: 'custom', path: ['endDate'], message: `Keep it under ${MAX_TRIP_DAYS} days` })
    }
  })

/** Start a draft trip from this resort (dates + resort), with ski days planned. */
export async function createTripFromResort(input: z.input<typeof NewTripInput>): Promise<ActionResult<{ tripId: string; tripName: string }>> {
  const parsed = NewTripInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const resort = await resortOrNull(v.resortId)
  if (!resort) return fail('Unknown resort')
  const { db, now } = await getCtx()
  const id = await uniqueTripId(v.name)
  const days = v.everyDay ? dateRange(v.startDate, v.endDate) : [v.startDate]
  await db.insert(s.trips).values({
    id,
    name: v.name,
    status: 'draft',
    startDate: v.startDate,
    endDate: v.endDate,
    partySize: v.partySize,
    originAirport: null,
    companions: [],
    notes: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(s.tripItems).values(
    days.map((date, i) => ({
      tripId: id,
      type: 'resort-day' as const,
      refId: v.resortId,
      title: `Ski day at ${resort.shortName || resort.name}`,
      date,
      status: 'draft' as const,
      costBasis: 'per-person' as const,
      details: { addedFrom: 'resort-page' },
      sortOrder: i,
      createdAt: now,
    })),
  )
  revalidatePath('/trips', 'layout')
  revalidatePath('/', 'layout')
  return { ok: true, data: { tripId: id, tripName: v.name } }
}

const AddHotelInput = z.object({ tripId: z.string().min(1).max(120), hotelId: z.string().min(1).max(160) })

/** Save a catalog hotel to a trip as a lodging idea for the trip's nights (no price — "Check rates"). */
export async function addHotelToTrip(input: z.input<typeof AddHotelInput>): Promise<ActionResult<{ itemIds: number[]; tripName: string }>> {
  const parsed = AddHotelInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now } = await getCtx()
  const [[trip], [hotel]] = await Promise.all([db.select().from(s.trips).where(eq(s.trips.id, v.tripId)), db.select().from(s.hotels).where(eq(s.hotels.id, v.hotelId))])
  if (!trip || trip.status === 'cancelled') return fail('That trip is not available')
  if (!hotel) return fail('Unknown hotel')
  const dup = await db
    .select({ id: s.tripItems.id })
    .from(s.tripItems)
    .where(and(eq(s.tripItems.tripId, trip.id), eq(s.tripItems.type, 'lodging'), eq(s.tripItems.refId, hotel.id)))
  if (dup.length) return fail(`${hotel.name} is already saved to ${trip.name}`)
  const all = await db.select({ sortOrder: s.tripItems.sortOrder }).from(s.tripItems).where(eq(s.tripItems.tripId, trip.id))
  const [row] = await db
    .insert(s.tripItems)
    .values({
      tripId: trip.id,
      type: 'lodging',
      refId: hotel.id,
      title: hotel.name,
      date: trip.startDate,
      endDate: trip.endDate,
      status: 'idea',
      costBasis: 'shared',
      details: { resortId: hotel.resortId, officialUrl: hotel.officialUrl, addedFrom: 'resort-page', note: 'Check rates with the property — no price recorded.' },
      sortOrder: all.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1,
      createdAt: now,
    })
    .returning({ id: s.tripItems.id })
  await db.update(s.trips).set({ updatedAt: now }).where(eq(s.trips.id, trip.id))
  revalidatePath('/trips', 'layout')
  revalidatePath(`/resorts/${hotel.resortId}`)
  return { ok: true, data: { itemIds: [row.id], tripName: trip.name } }
}

/** Undo for the add-to-trip toasts: remove only the items this page just created. */
export async function undoTripItems(input: { tripId: string; itemIds: number[] }): Promise<ActionResult> {
  const parsed = z.object({ tripId: z.string().min(1).max(120), itemIds: z.array(z.number().int().positive()).min(1).max(MAX_TRIP_DAYS) }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const { db } = await getCtx()
  await db.delete(s.tripItems).where(and(eq(s.tripItems.tripId, parsed.data.tripId), inArray(s.tripItems.id, parsed.data.itemIds)))
  revalidatePath('/trips', 'layout')
  revalidatePath('/', 'layout')
  return { ok: true, data: null }
}

/** Undo for "Start a trip": delete the draft trip just created (only if nothing else was added since). */
export async function undoNewTrip(input: { tripId: string }): Promise<ActionResult> {
  const parsed = z.object({ tripId: z.string().min(1).max(120) }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const { db } = await getCtx()
  const items = await db.select({ type: s.tripItems.type, details: s.tripItems.details }).from(s.tripItems).where(eq(s.tripItems.tripId, parsed.data.tripId))
  if (items.some((i) => i.details?.addedFrom !== 'resort-page')) return fail('The trip has changed since — delete it from Trips instead')
  await db.delete(s.trips).where(eq(s.trips.id, parsed.data.tripId))
  revalidatePath('/trips', 'layout')
  revalidatePath('/', 'layout')
  return { ok: true, data: null }
}
