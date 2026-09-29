'use server'
/**
 * My Season mutations: the ski-day journal (add / edit / delete + undo, optional pass day, optional personal surface
 * report), the learning checklist (add, rename, reorder, remove + undo, status with confirmation date and note), the
 * lesson planner for lessons outside trips (trip lessons are edited in their trip, which mirrors them here), and the
 * season's expenses — the budget's "actual".
 *
 * Rules
 * - Every input is validated with zod; ids from the client are re-checked against the database.
 * - A ski day is logged only once it has started at the resort (resort-local date), and only in the active season,
 *   so it never disappears from the page it was logged on.
 * - Surface feedback saved as a report goes through the jobs module's `addPersonalReport`: kind 'manual' with the
 *   personal note — never an official report, never operations evidence.
 * - Skill status is what I say or what an instructor confirmed. Nothing here derives it from spending or travel.
 * - Money arrives as decimal strings and is stored as integer minor units; unknown is null, never 0.
 * - Pass purchases linked to a pass record belong to Passes (counted once there) and are not edited here.
 * - Writes go to the database of the current mode only (getCtx picks live or demo).
 */
import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { nowFor } from '@/lib/clock'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import type { ExpenseRow, LessonRow, SkiDayLogRow, SkillRow } from '@/lib/db/rows'
import { BUDGET_CATEGORIES } from '@/lib/domain/costs'
import { fromMajor } from '@/lib/domain/money'
import { evaluateAccess, latestRule } from '@/lib/domain/passes'
import { formatLocalDate, isLocalDate, localDateOf, seasonIdFor } from '@/lib/domain/time'
import { SURFACE_TAGS } from '@/lib/domain/types'
import { defaultDeps } from '@/lib/jobs/deps'
import { addPersonalReport } from '@/lib/jobs/reports'
import { runJob } from '@/lib/jobs/runner'

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }

// ---------------------------------------------------------------------------
// Validation building blocks

const Id = z.number().int().positive()
const ResortId = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Choose a resort from the list')
const TripId = z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, 'Unknown trip')
const LocalDate = z.string().refine(isLocalDate, 'Use a date (YYYY-MM-DD)')
const Amount = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount like 45 or 45.50')
const Currency = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code (e.g. USD)'))
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
const text = (max: number) =>
  z
    .string()
    .max(max, `Keep it under ${max.toLocaleString('en-US')} characters`)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))

const LESSON_KINDS = ['group', 'private', 'semi-private', 'clinic'] as const
const SKILL_STATUSES = ['not-started', 'practicing', 'self-confirmed', 'instructor-confirmed'] as const

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

/** My Season feeds Today, Trips (focus skills), Passes (pass days) and resort pages (personal reports). */
function revalidate() {
  revalidatePath('/season')
  revalidatePath('/', 'layout')
}

const seasonText = (id: string) => id.replace('-', '–')

async function resortInfo(id: string) {
  const { db } = await getCtx()
  const [r] = await db.select({ id: s.resorts.id, name: s.resorts.name, shortName: s.resorts.shortName, timezone: s.resorts.timezone }).from(s.resorts).where(eq(s.resorts.id, id))
  return r ?? null
}

async function knownSkillIds(ids: readonly number[]): Promise<number[]> {
  if (!ids.length) return []
  const { db } = await getCtx()
  const rows = await db.select({ id: s.skillChecklist.id }).from(s.skillChecklist).where(inArray(s.skillChecklist.id, [...new Set(ids)]))
  const ok = new Set(rows.map((r) => r.id))
  return [...new Set(ids)].filter((id) => ok.has(id))
}

async function tripIssue(tripId: string | null | undefined, date?: string | null): Promise<string | null> {
  if (!tripId) return null
  const { db } = await getCtx()
  const [t] = await db.select().from(s.trips).where(eq(s.trips.id, tripId))
  if (!t || t.status === 'cancelled') return 'That trip is not available'
  if (date && (date < t.startDate || date > t.endDate)) return `${t.name} runs ${t.startDate} to ${t.endDate}`
  return null
}

/** Recompute the resort's assessments and the alert feed after new personal feedback (local, nothing fetched). */
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
// Ski-day journal

const DayInput = z
  .object({
    /** Existing log to update; omitted = a new day. */
    id: Id.nullish(),
    date: LocalDate,
    resortId: ResortId,
    tripId: TripId.nullish(),
    hoursSkied: z.number().finite().gt(0, 'More than 0 hours').max(14, 'At most 14 hours').nullish(),
    rating: z.number().int().min(1, 'Choose 1–5').max(5, 'Choose 1–5').nullish(),
    surfaceFeedback: z.array(z.enum(SURFACE_TAGS)).max(9).default([]),
    preferredTime: text(80),
    crowdGuess: text(120),
    skillsPracticed: z.array(Id).max(60).default([]),
    /** Decimal string in major units; null = not recorded (never 0 by default). */
    spend: Amount.nullish(),
    currency: Currency.nullish(),
    notes: text(4000),
    /** Log the day on this pass of mine (pass usage); null = not a pass day. */
    passOwnershipId: Id.nullish(),
    /** Also save the surface feedback as my personal report for that resort and date. */
    saveReport: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    if (v.spend && !v.currency) c.addIssue({ code: 'custom', path: ['currency'], message: 'Choose the currency' })
    if (v.saveReport && !v.surfaceFeedback.length) c.addIssue({ code: 'custom', path: ['surfaceFeedback'], message: 'Pick at least one surface tag to save a report' })
  })
export type SkiDayInput = z.input<typeof DayInput>

type PassDayOutcome = { changed: boolean; warning: string | null; error: string | null }

/** Make the pass day match the form: logged on `ownershipId` at the new key, removed from the old key when unticked. */
async function syncPassDay(a: { ownershipId: number | null; resortId: string; date: string; old: { resortId: string; date: string } | null }): Promise<PassDayOutcome> {
  const { db, today } = await getCtx()
  const mine = await db.select().from(s.passOwnership).where(eq(s.passOwnership.holder, 'me'))
  const mineIds = mine.map((o) => o.id)
  if (!mineIds.length) return { changed: false, warning: null, error: a.ownershipId ? 'No pass of yours is recorded' : null }
  const usage = await db.select().from(s.passUsage).where(inArray(s.passUsage.ownershipId, mineIds))
  let changed = false

  const at = (resortId: string, date: string) => usage.filter((u) => u.resortId === resortId && u.date === date)
  const moved = a.old && (a.old.resortId !== a.resortId || a.old.date !== a.date)
  // Unticked, or the day moved: clear the old key (only for my passes; the new key is handled below).
  if (a.old && (!a.ownershipId || moved)) {
    const stale = at(a.old.resortId, a.old.date).filter((u) => !a.ownershipId || u.ownershipId === a.ownershipId || !moved)
    if (stale.length) {
      await db.delete(s.passUsage).where(inArray(s.passUsage.id, stale.map((u) => u.id)))
      changed = true
    }
  }
  if (!a.ownershipId) return { changed, warning: null, error: null }

  const own = mine.find((o) => o.id === a.ownershipId)
  if (!own) return { changed, warning: null, error: 'That pass is no longer recorded' }
  const [product] = await db.select().from(s.passProducts).where(eq(s.passProducts.id, own.productId))
  if (!product) return { changed, warning: null, error: 'Unknown pass product' }
  if (seasonIdFor(a.date) !== product.seasonId) return { changed, warning: null, error: `${product.name} is a ${seasonText(product.seasonId)} pass` }
  if (at(a.resortId, a.date).some((u) => u.ownershipId === own.id)) return { changed, warning: null, error: null }

  const rules = await db.select().from(s.passAccessRules).where(eq(s.passAccessRules.productId, product.id))
  const ownUsage = usage.filter((u) => u.ownershipId === own.id && !(a.old && u.resortId === a.old.resortId && u.date === a.old.date))
  const verdict = evaluateAccess({ product, rule: latestRule(rules, product.id, a.resortId), resortId: a.resortId, date: a.date, usage: ownUsage, poolRules: rules, today })
  const { now } = await getCtx()
  await db.insert(s.passUsage).values({ ownershipId: own.id, resortId: a.resortId, date: a.date, notes: 'Logged from My Season', createdAt: now })
  const warning = verdict.canSki
    ? null
    : verdict.status === 'unknown'
      ? `Access here is not confirmed for ${product.name} — the pass day is logged, but no allowance is known.`
      : `The recorded rule says "${verdict.headline}" for ${product.name} on this day — check the rule in Passes if you used the pass.`
  return { changed: true, warning, error: null }
}

/** Add or update a ski day. Returns the saved log id, and what else was written (pass day, personal report). */
export async function saveSkiDay(input: SkiDayInput): Promise<ActionResult<{ id: number; created: boolean; reportSaved: boolean; passWarning: string | null }>> {
  const parsed = DayInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const ctx = await getCtx()
  const { db, now, prefs } = ctx

  const resort = await resortInfo(v.resortId)
  if (!resort) return fail('Unknown resort', { resortId: 'Choose a resort from the list' })
  const resortToday = localDateOf(now, resort.timezone)
  if (v.date > resortToday) return fail('Log days you have skied — plan future days in Trips', { date: `Pick ${resortToday} or earlier (resort time)` })
  if (seasonIdFor(v.date) !== prefs.activeSeasonId) {
    return fail(`My Season shows ${seasonText(prefs.activeSeasonId)}`, { date: `Pick a day in the ${seasonText(prefs.activeSeasonId)} season` })
  }
  const trip = await tripIssue(v.tripId, v.date)
  if (trip) return fail(trip, { tripId: trip })

  let old: SkiDayLogRow | null = null
  if (v.id) {
    ;[old] = await db.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.id, v.id))
    if (!old) return fail('This day is no longer in your journal')
  }
  const dup = await db
    .select({ id: s.skiDayLogs.id })
    .from(s.skiDayLogs)
    .where(and(eq(s.skiDayLogs.date, v.date), eq(s.skiDayLogs.resortId, v.resortId)))
  if (dup.some((d) => d.id !== v.id)) return fail(`${resort.shortName || resort.name} on ${v.date} is already in your journal — edit that day instead`, { date: 'Already logged at this resort' })

  const spend = v.spend != null && v.currency ? fromMajor(v.spend, v.currency) : null
  const values = {
    date: v.date,
    resortId: v.resortId,
    tripId: v.tripId ?? null,
    rating: v.rating ?? null,
    surfaceFeedback: [...new Set(v.surfaceFeedback)].filter((t) => t !== 'unknown'),
    preferredTime: v.preferredTime,
    crowdGuess: v.crowdGuess,
    skillsPracticed: await knownSkillIds(v.skillsPracticed),
    hoursSkied: v.hoursSkied != null ? Math.round(v.hoursSkied * 4) / 4 : null,
    spendMinor: spend ? spend.amountMinor : null,
    currency: spend ? spend.currency : null,
    notes: v.notes,
  }

  let id: number
  if (old) {
    await db.update(s.skiDayLogs).set(values).where(eq(s.skiDayLogs.id, old.id))
    id = old.id
  } else {
    const [row] = await db
      .insert(s.skiDayLogs)
      .values({ ...values, createdAt: now })
      .returning({ id: s.skiDayLogs.id })
    id = row.id
  }

  const pass = await syncPassDay({ ownershipId: v.passOwnershipId ?? null, resortId: v.resortId, date: v.date, old: old ? { resortId: old.resortId, date: old.date } : null })

  let reportSaved = false
  if (v.saveReport && values.surfaceFeedback.length) {
    try {
      await addPersonalReport(db, { resortId: v.resortId, localDate: v.date, surfaceTags: values.surfaceFeedback, surfaceText: null, notes: null }, now)
      reportSaved = true
      await followUps(v.resortId)
    } catch {
      reportSaved = false
    }
  }

  revalidate()
  const name = resort.shortName || resort.name
  const extra = [reportSaved ? 'personal report saved' : null, pass.error ? `pass day not logged: ${pass.error}` : null].filter(Boolean).join(' · ')
  return {
    ok: true,
    data: { id, created: !old, reportSaved, passWarning: pass.error ?? pass.warning },
    message: `${old ? 'Updated' : 'Logged'} ${name}, ${formatLocalDate(v.date, 'ccc d LLL')}${extra ? ` · ${extra}` : ''}`,
  }
}

const DaySnapshot = z.object({
  id: Id,
  date: LocalDate,
  resortId: ResortId,
  tripId: z.string().max(120).nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  surfaceFeedback: z.array(z.enum(SURFACE_TAGS)).max(9),
  preferredTime: z.string().max(80).nullable(),
  crowdGuess: z.string().max(120).nullable(),
  skillsPracticed: z.array(Id).max(60),
  hoursSkied: z.number().finite().nullable(),
  spendMinor: z.number().int().nullable(),
  currency: z.string().max(3).nullable(),
  notes: z.string().max(4000).nullable(),
  createdAt: z.string().max(40),
})
export type SkiDaySnapshot = z.output<typeof DaySnapshot>

/** Remove a day from the journal. A pass day logged for it stays (Passes owns pass usage). Snapshot for Undo. */
export async function deleteSkiDay(input: { id: number }): Promise<ActionResult<{ snapshot: SkiDaySnapshot; passDayKept: boolean }>> {
  const id = Id.safeParse(input?.id)
  if (!id.success) return fail('Unknown day')
  const { db } = await getCtx()
  const [row] = await db.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.id, id.data))
  if (!row) return fail('This day is no longer in your journal')
  await db.delete(s.skiDayLogs).where(eq(s.skiDayLogs.id, row.id))
  const mine = await db.select({ id: s.passOwnership.id }).from(s.passOwnership).where(eq(s.passOwnership.holder, 'me'))
  const kept = mine.length
    ? (
        await db
          .select({ id: s.passUsage.id })
          .from(s.passUsage)
          .where(and(inArray(s.passUsage.ownershipId, mine.map((m) => m.id)), eq(s.passUsage.resortId, row.resortId), eq(s.passUsage.date, row.date)))
      ).length > 0
    : false
  revalidate()
  return { ok: true, data: { snapshot: row, passDayKept: kept }, message: `Removed ${formatLocalDate(row.date, 'ccc d LLL')} from your journal${kept ? ' — the pass day stays in Passes' : ''}` }
}

export async function restoreSkiDay(input: { snapshot: SkiDaySnapshot }): Promise<ActionResult<{ id: number }>> {
  const parsed = DaySnapshot.safeParse(input?.snapshot)
  if (!parsed.success) return fail('Could not restore this day')
  const { id, ...rest } = parsed.data
  const { db } = await getCtx()
  const dup = await db
    .select({ id: s.skiDayLogs.id })
    .from(s.skiDayLogs)
    .where(and(eq(s.skiDayLogs.date, rest.date), eq(s.skiDayLogs.resortId, rest.resortId)))
  if (dup.length) return fail('That day is already back in your journal')
  const [taken] = await db.select({ id: s.skiDayLogs.id }).from(s.skiDayLogs).where(eq(s.skiDayLogs.id, id))
  const [row] = await db
    .insert(s.skiDayLogs)
    .values({ ...(taken ? {} : { id }), ...rest, skillsPracticed: await knownSkillIds(rest.skillsPracticed) })
    .returning({ id: s.skiDayLogs.id })
  revalidate()
  return { ok: true, data: { id: row.id }, message: 'Day restored' }
}

/** Save a logged day's surface feedback as my personal report for that resort and date (a new revision if one exists). */
export async function saveDayReport(input: { id: number }): Promise<ActionResult<{ reportId: number; revision: number }>> {
  const id = Id.safeParse(input?.id)
  if (!id.success) return fail('Unknown day')
  const { db, now } = await getCtx()
  const [row] = await db.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.id, id.data))
  if (!row) return fail('This day is no longer in your journal')
  const tags = row.surfaceFeedback.filter((t) => t !== 'unknown')
  if (!tags.length) return fail('Add surface feedback to this day first')
  const resort = await resortInfo(row.resortId)
  if (!resort) return fail('Unknown resort')
  try {
    const res = await addPersonalReport(db, { resortId: row.resortId, localDate: row.date, surfaceTags: tags, surfaceText: null, notes: null }, now)
    await followUps(row.resortId)
    revalidate()
    return { ok: true, data: { reportId: res.id, revision: res.revision }, message: `Personal report saved for ${resort.shortName || resort.name}` }
  } catch {
    return fail('The report could not be saved. Your journal entry is unchanged.')
  }
}

// ---------------------------------------------------------------------------
// Learning checklist

const Label = z.string().trim().min(1, 'Name the skill').max(120, 'Keep it under 120 characters')
const Category = text(40)

async function orderedSkills(): Promise<SkillRow[]> {
  const { db } = await getCtx()
  const rows = await db.select().from(s.skillChecklist)
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
}

export async function addSkill(input: { label: string; category?: string | null }): Promise<ActionResult<{ id: number }>> {
  const parsed = z.object({ label: Label, category: Category }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const all = await orderedSkills()
  if (all.some((k) => k.label.toLowerCase() === v.label.toLowerCase())) return fail('That skill is already on your list', { label: 'Already on your list' })
  // New skills go to the end of their category (or the end of the list).
  const lastInCat = [...all].reverse().find((k) => (k.category ?? null) === v.category)
  const order = lastInCat ? lastInCat.sortOrder + 1 : all.reduce((m, k) => Math.max(m, k.sortOrder), -1) + 1
  const { db } = await getCtx()
  if (lastInCat) {
    for (const k of all.filter((x) => x.sortOrder >= order)) await db.update(s.skillChecklist).set({ sortOrder: k.sortOrder + 1 }).where(eq(s.skillChecklist.id, k.id))
  }
  const [row] = await db
    .insert(s.skillChecklist)
    .values({ label: v.label, category: v.category, sortOrder: order, status: 'not-started', confirmedOn: null, notes: null })
    .returning({ id: s.skillChecklist.id })
  revalidate()
  return { ok: true, data: { id: row.id }, message: `Added "${v.label}"` }
}

export async function renameSkill(input: { id: number; label: string; category?: string | null }): Promise<ActionResult<{ id: number }>> {
  const parsed = z.object({ id: Id, label: Label, category: Category }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const all = await orderedSkills()
  const row = all.find((k) => k.id === v.id)
  if (!row) return fail('This skill is no longer on your list')
  if (all.some((k) => k.id !== v.id && k.label.toLowerCase() === v.label.toLowerCase())) return fail('Another skill has that name', { label: 'Already on your list' })
  const { db } = await getCtx()
  await db.update(s.skillChecklist).set({ label: v.label, category: input.category === undefined ? row.category : v.category }).where(eq(s.skillChecklist.id, v.id))
  revalidate()
  return { ok: true, data: { id: v.id }, message: 'Skill updated' }
}

const StatusInput = z
  .object({
    id: Id,
    status: z.enum(SKILL_STATUSES),
    /** Required for the two confirmed statuses. */
    confirmedOn: LocalDate.nullish(),
    notes: text(1000),
  })
  .superRefine((v, c) => {
    const confirmed = v.status === 'self-confirmed' || v.status === 'instructor-confirmed'
    if (confirmed && !v.confirmedOn) c.addIssue({ code: 'custom', path: ['confirmedOn'], message: 'When was it confirmed?' })
  })

/** Set a skill's status — what I say, or what an instructor confirmed — with the date and an optional note. */
export async function setSkillStatus(input: z.input<typeof StatusInput>): Promise<ActionResult<{ previous: { status: SkillRow['status']; confirmedOn: string | null; notes: string | null } }>> {
  const parsed = StatusInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, today } = await getCtx()
  const [row] = await db.select().from(s.skillChecklist).where(eq(s.skillChecklist.id, v.id))
  if (!row) return fail('This skill is no longer on your list')
  const confirmed = v.status === 'self-confirmed' || v.status === 'instructor-confirmed'
  if (confirmed && v.confirmedOn && v.confirmedOn > today) return fail('A confirmation date cannot be in the future', { confirmedOn: `Pick ${today} or earlier` })
  await db
    .update(s.skillChecklist)
    .set({ status: v.status, confirmedOn: confirmed ? v.confirmedOn! : null, notes: v.notes })
    .where(eq(s.skillChecklist.id, v.id))
  revalidate()
  const words: Record<SkillRow['status'], string> = {
    'not-started': 'marked not started',
    practicing: 'marked as practising',
    'self-confirmed': 'confirmed by you',
    'instructor-confirmed': 'confirmed by an instructor',
  }
  return { ok: true, data: { previous: { status: row.status, confirmedOn: row.confirmedOn, notes: row.notes } }, message: `"${row.label}" ${words[v.status]}` }
}

/** Move a skill one place up or down within its category. */
export async function moveSkill(input: { id: number; direction: 'up' | 'down' }): Promise<ActionResult> {
  const parsed = z.object({ id: Id, direction: z.enum(['up', 'down']) }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const { id, direction } = parsed.data
  const all = await orderedSkills()
  const row = all.find((k) => k.id === id)
  if (!row) return fail('This skill is no longer on your list')
  const peers = all.filter((k) => (k.category ?? null) === (row.category ?? null))
  const i = peers.findIndex((k) => k.id === id)
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= peers.length) return { ok: true, data: null }
  // Swap positions in the full order, then renumber 0..n-1 so ties never linger.
  const order = all.map((k) => k.id)
  const a = order.indexOf(peers[i].id)
  const b = order.indexOf(peers[j].id)
  ;[order[a], order[b]] = [order[b], order[a]]
  const { db } = await getCtx()
  for (let k = 0; k < order.length; k++) {
    const cur = all.find((x) => x.id === order[k])!
    if (cur.sortOrder !== k) await db.update(s.skillChecklist).set({ sortOrder: k }).where(eq(s.skillChecklist.id, cur.id))
  }
  revalidate()
  return { ok: true, data: null }
}

const SkillSnapshot = z.object({
  id: Id,
  label: Label,
  category: z.string().max(40).nullable(),
  sortOrder: z.number().int(),
  status: z.enum(SKILL_STATUSES),
  confirmedOn: z.string().nullable(),
  notes: z.string().max(1000).nullable(),
})
export type SkillSnapshot = z.output<typeof SkillSnapshot>

/** Remove a skill from the checklist. Days and lessons that mention it keep the reference, so Undo restores it all. */
export async function removeSkill(input: { id: number }): Promise<ActionResult<{ snapshot: SkillSnapshot }>> {
  const id = Id.safeParse(input?.id)
  if (!id.success) return fail('Unknown skill')
  const { db } = await getCtx()
  const [row] = await db.select().from(s.skillChecklist).where(eq(s.skillChecklist.id, id.data))
  if (!row) return fail('This skill is no longer on your list')
  await db.delete(s.skillChecklist).where(eq(s.skillChecklist.id, row.id))
  revalidate()
  return { ok: true, data: { snapshot: row }, message: `Removed "${row.label}"` }
}

export async function restoreSkill(input: { snapshot: SkillSnapshot }): Promise<ActionResult<{ id: number }>> {
  const parsed = SkillSnapshot.safeParse(input?.snapshot)
  if (!parsed.success) return fail('Could not restore this skill')
  const { id, ...rest } = parsed.data
  const { db } = await getCtx()
  const [taken] = await db.select({ id: s.skillChecklist.id }).from(s.skillChecklist).where(eq(s.skillChecklist.id, id))
  const [row] = await db
    .insert(s.skillChecklist)
    .values({ ...(taken ? {} : { id }), ...rest })
    .returning({ id: s.skillChecklist.id })
  revalidate()
  return { ok: true, data: { id: row.id }, message: 'Skill restored' }
}

// ---------------------------------------------------------------------------
// Lesson planner (lessons outside trips)

const LessonInput = z
  .object({
    id: Id.nullish(),
    resortId: ResortId,
    /** null = not scheduled yet. */
    date: LocalDate.nullish(),
    kind: z.enum(LESSON_KINDS).nullish(),
    instructor: text(120),
    focusSkills: z.array(Id).max(20).default([]),
    bookingRef: text(80),
    bookingUrl: HttpUrl.nullish().or(z.literal('').transform(() => null)),
    cost: Amount.nullish(),
    currency: Currency.nullish(),
    costKind: z.enum(['quote', 'estimate', 'actual']).nullish(),
    notes: text(2000),
  })
  .superRefine((v, c) => {
    if (v.cost) {
      if (!v.currency) c.addIssue({ code: 'custom', path: ['currency'], message: 'Choose the currency' })
      if (!v.costKind) c.addIssue({ code: 'custom', path: ['costKind'], message: 'Estimate, quote or actual?' })
    }
  })
export type LessonInput = z.input<typeof LessonInput>

export async function saveLesson(input: LessonInput): Promise<ActionResult<{ id: number; created: boolean }>> {
  const parsed = LessonInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now, prefs } = await getCtx()
  const resort = await resortInfo(v.resortId)
  if (!resort) return fail('Unknown resort', { resortId: 'Choose a resort from the list' })
  if (v.date && seasonIdFor(v.date) !== prefs.activeSeasonId) return fail(`My Season shows ${seasonText(prefs.activeSeasonId)}`, { date: `Pick a day in the ${seasonText(prefs.activeSeasonId)} season` })
  let old: LessonRow | null = null
  if (v.id) {
    ;[old] = await db.select().from(s.lessons).where(eq(s.lessons.id, v.id))
    if (!old) return fail('This lesson is no longer recorded')
    if (old.tripId) return fail('This lesson is part of a trip — edit it in the trip so the itinerary and budget stay in step')
  }
  const cost = v.cost && v.currency ? fromMajor(v.cost, v.currency) : null
  const values = {
    resortId: v.resortId,
    tripId: null,
    date: v.date ?? null,
    kind: v.kind ?? null,
    instructor: v.instructor,
    focusSkills: await knownSkillIds(v.focusSkills),
    bookingRef: v.bookingRef,
    bookingUrl: v.bookingUrl ?? null,
    costMinor: cost ? cost.amountMinor : null,
    currency: cost ? cost.currency : null,
    costKind: cost ? (v.costKind ?? null) : null,
    notes: v.notes,
  }
  let id: number
  if (old) {
    await db.update(s.lessons).set(values).where(eq(s.lessons.id, old.id))
    id = old.id
  } else {
    const [row] = await db
      .insert(s.lessons)
      .values({ ...values, createdAt: now })
      .returning({ id: s.lessons.id })
    id = row.id
  }
  revalidate()
  return { ok: true, data: { id, created: !old }, message: `${old ? 'Lesson updated' : 'Lesson added'} · ${resort.shortName || resort.name}` }
}

const LessonSnapshot = z.object({
  id: Id,
  resortId: ResortId,
  tripId: z.null(),
  date: z.string().nullable(),
  kind: z.string().max(40).nullable(),
  instructor: z.string().max(120).nullable(),
  focusSkills: z.array(Id).max(20),
  bookingRef: z.string().max(80).nullable(),
  bookingUrl: z.string().max(2000).nullable(),
  costMinor: z.number().int().nullable(),
  currency: z.string().max(3).nullable(),
  costKind: z.enum(['quote', 'estimate', 'actual']).nullable(),
  notes: z.string().max(2000).nullable(),
  createdAt: z.string().max(40),
})
export type LessonSnapshot = z.output<typeof LessonSnapshot>

export async function deleteLesson(input: { id: number }): Promise<ActionResult<{ snapshot: LessonSnapshot }>> {
  const id = Id.safeParse(input?.id)
  if (!id.success) return fail('Unknown lesson')
  const { db } = await getCtx()
  const [row] = await db.select().from(s.lessons).where(eq(s.lessons.id, id.data))
  if (!row) return fail('This lesson is no longer recorded')
  if (row.tripId) return fail('This lesson is part of a trip — remove it from the trip')
  await db.delete(s.lessons).where(eq(s.lessons.id, row.id))
  revalidate()
  return { ok: true, data: { snapshot: { ...row, tripId: null } }, message: 'Lesson removed' }
}

export async function restoreLesson(input: { snapshot: LessonSnapshot }): Promise<ActionResult<{ id: number }>> {
  const parsed = LessonSnapshot.safeParse(input?.snapshot)
  if (!parsed.success) return fail('Could not restore this lesson')
  const { id, ...rest } = parsed.data
  const { db } = await getCtx()
  const [taken] = await db.select({ id: s.lessons.id }).from(s.lessons).where(eq(s.lessons.id, id))
  const [row] = await db
    .insert(s.lessons)
    .values({ ...(taken ? {} : { id }), ...rest })
    .returning({ id: s.lessons.id })
  revalidate()
  return { ok: true, data: { id: row.id }, message: 'Lesson restored' }
}

// ---------------------------------------------------------------------------
// Expenses (the season budget's "actual")

const ExpenseInput = z.object({
  id: Id.nullish(),
  date: LocalDate,
  category: z.enum(BUDGET_CATEGORIES),
  label: z.string().trim().min(1, 'Say what it was for').max(120, 'Keep it under 120 characters'),
  amount: Amount,
  currency: Currency,
  tripId: TripId.nullish(),
  notes: text(1000),
})
export type ExpenseInput = z.input<typeof ExpenseInput>

export async function saveExpense(input: ExpenseInput): Promise<ActionResult<{ id: number; created: boolean }>> {
  const parsed = ExpenseInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now, prefs } = await getCtx()
  if (seasonIdFor(v.date) !== prefs.activeSeasonId) return fail(`My Season shows ${seasonText(prefs.activeSeasonId)}`, { date: `Pick a day in the ${seasonText(prefs.activeSeasonId)} season` })
  const trip = await tripIssue(v.tripId)
  if (trip) return fail(trip, { tripId: trip })
  let old: ExpenseRow | null = null
  if (v.id) {
    ;[old] = await db.select().from(s.expenses).where(eq(s.expenses.id, v.id))
    if (!old) return fail('This expense is no longer recorded')
    if (old.passOwnershipId != null) return fail('This is a pass purchase — edit it in Passes & Costs, where it is counted once')
  }
  const amount = fromMajor(v.amount, v.currency)
  const values = { date: v.date, category: v.category, label: v.label, amountMinor: amount.amountMinor, currency: amount.currency, tripId: v.tripId ?? null, notes: v.notes }
  let id: number
  if (old) {
    await db.update(s.expenses).set(values).where(eq(s.expenses.id, old.id))
    id = old.id
  } else {
    const [row] = await db
      .insert(s.expenses)
      .values({ ...values, passOwnershipId: null, createdAt: now })
      .returning({ id: s.expenses.id })
    id = row.id
  }
  revalidate()
  return { ok: true, data: { id, created: !old }, message: old ? 'Expense updated' : `Expense added · ${v.label}` }
}

const ExpenseSnapshot = z.object({
  id: Id,
  date: LocalDate,
  category: z.string().max(40),
  label: z.string().max(120),
  amountMinor: z.number().int(),
  currency: z.string().max(3),
  tripId: z.string().max(120).nullable(),
  passOwnershipId: z.null(),
  notes: z.string().max(1000).nullable(),
  createdAt: z.string().max(40),
})
export type ExpenseSnapshot = z.output<typeof ExpenseSnapshot>

export async function deleteExpense(input: { id: number }): Promise<ActionResult<{ snapshot: ExpenseSnapshot }>> {
  const id = Id.safeParse(input?.id)
  if (!id.success) return fail('Unknown expense')
  const { db } = await getCtx()
  const [row] = await db.select().from(s.expenses).where(eq(s.expenses.id, id.data))
  if (!row) return fail('This expense is no longer recorded')
  if (row.passOwnershipId != null) return fail('This is a pass purchase — remove it in Passes & Costs')
  await db.delete(s.expenses).where(eq(s.expenses.id, row.id))
  revalidate()
  return { ok: true, data: { snapshot: { ...row, passOwnershipId: null } }, message: `Removed "${row.label}"` }
}

export async function restoreExpense(input: { snapshot: ExpenseSnapshot }): Promise<ActionResult<{ id: number }>> {
  const parsed = ExpenseSnapshot.safeParse(input?.snapshot)
  if (!parsed.success) return fail('Could not restore this expense')
  const { id, ...rest } = parsed.data
  const { db } = await getCtx()
  const [taken] = await db.select({ id: s.expenses.id }).from(s.expenses).where(eq(s.expenses.id, id))
  const [row] = await db
    .insert(s.expenses)
    .values({ ...(taken ? {} : { id }), ...rest })
    .returning({ id: s.expenses.id })
  revalidate()
  return { ok: true, data: { id: row.id }, message: 'Expense restored' }
}
