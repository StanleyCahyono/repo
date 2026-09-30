'use server'
/**
 * Passes & Costs mutations.
 *
 * - Owned passes: add (with the price paid recorded ONCE — as the ownership's price and as one linked 'pass' expense,
 *   so the season budget never counts it again as daily lift cash), remove with undo (snapshot → restore).
 * - Usage: log a skied day manually (season, not in the future, no duplicate resort-day), remove with undo.
 * - Access rules: the manual-edit route inserts a NEW version (never updates a stored rule) with provenance
 *   { kind: 'manual', provider: 'You', verification: 'user-confirmed' } and a required source link.
 * - Basket assumptions: rental option, lunch estimate and party size saved to preferences.
 * - Your price estimates (lift ticket, rental, parking, pass price) where nothing is on file: stored as
 *   quoteKind 'user-estimate' with provider 'You', labelled "Your estimate" everywhere, editable and removable with
 *   Undo — never shown as a published price or an observed quote, and outranked by one as soon as it is recorded.
 *
 * Every action validates with zod, re-reads ids from the database (never trusts the client) and revalidates.
 */
import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import type { BudgetPrefs, GearPrefs } from '@/lib/db/schema'
import type { ExpenseRow, PassOwnershipRow, PassUsageRow } from '@/lib/db/rows'
import { fromMajor, minorDigits } from '@/lib/domain/money'
import { ACCESS_STATUS_LABEL, evaluateAccess, latestRule } from '@/lib/domain/passes'
import { hemisphereOf, isLocalDate, seasonBounds, seasonIdForResort, seasonResolver } from '@/lib/domain/time'
import { PASS_ACCESS, provenance } from '@/lib/domain/types'

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }

const MAX_PARTY = 12
const Id = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Unknown id')
const LocalDate = z.string().refine((v) => isLocalDate(v), 'Enter a date (YYYY-MM-DD)')
const Currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code')
  .transform((v) => v.toUpperCase())
const text = (max: number) =>
  z
    .string()
    .max(max, `Keep it under ${max} characters`)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))
const Amount = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount like 369 or 369.00')

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

/** Pass ownership, usage, expenses and rules feed every screen (Today, Explore, resort pages, Trips, My Season). */
function revalidateAll() {
  revalidatePath('/', 'layout')
}

const seasonText = (id: string) => id.replace('-', '–')

// ---------------------------------------------------------------------------
// Owned passes

const AddPassInput = z.object({
  productId: Id,
  /** 'me' or someone else's name. */
  holder: z
    .string()
    .trim()
    .max(60, 'Keep the name under 60 characters')
    .nullish()
    .transform((v) => (!v || v.toLowerCase() === 'me' ? 'me' : v)),
  purchasedOn: LocalDate.nullish(),
  /** Price paid in major units ("369.00"); empty = not recorded (never 0). */
  price: Amount.nullish().or(z.literal('').transform(() => null)),
  currency: Currency.nullish(),
  notes: text(500),
})

export type AddPassForm = z.input<typeof AddPassInput>

export async function addOwnedPass(input: AddPassForm): Promise<ActionResult<{ ownershipId: number; expenseId: number | null; productName: string }>> {
  const parsed = AddPassInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now, today, prefs } = await getCtx()
  const [product] = await db.select().from(s.passProducts).where(eq(s.passProducts.id, v.productId))
  if (!product) return fail('Unknown pass product', { productId: 'Choose a pass from the list' })
  if (v.purchasedOn && v.purchasedOn > today) return fail('The purchase date is in the future', { purchasedOn: `Pick ${today} or earlier` })
  const currency = v.price != null ? (v.currency ?? prefs.currency).toUpperCase() : null
  if (v.price != null && currency && minorDigits(currency) === 0 && v.price.includes('.')) {
    return fail('This currency has no minor units', { price: 'Enter a whole amount' })
  }
  const holders = await db.select({ holder: s.passOwnership.holder }).from(s.passOwnership).where(eq(s.passOwnership.productId, product.id))
  if (holders.some((h) => h.holder.toLowerCase() === v.holder.toLowerCase())) {
    return fail(v.holder === 'me' ? 'You already have this pass recorded' : `${v.holder} already has this pass recorded`, { productId: 'Already recorded' })
  }
  const price = v.price != null && currency ? fromMajor(v.price, currency) : null
  const [row] = await db
    .insert(s.passOwnership)
    .values({ productId: product.id, holder: v.holder, purchasedOn: v.purchasedOn ?? null, pricePaidMinor: price?.amountMinor ?? null, currency: price?.currency ?? null, notes: v.notes, createdAt: now })
    .returning({ id: s.passOwnership.id })
  let expenseId: number | null = null
  if (price && price.amountMinor > 0) {
    // The purchase, recorded once and linked, so the season budget never counts it again as lift cash.
    const [e] = await db
      .insert(s.expenses)
      .values({
        date: v.purchasedOn ?? today,
        category: 'pass',
        label: `${product.name} ${seasonText(product.seasonId)}${v.holder === 'me' ? '' : ` (${v.holder})`}`,
        amountMinor: price.amountMinor,
        currency: price.currency,
        tripId: null,
        passOwnershipId: row.id,
        notes: 'Recorded with the pass in Passes & Costs',
        createdAt: now,
      })
      .returning({ id: s.expenses.id })
    expenseId = e.id
  }
  revalidateAll()
  return {
    ok: true,
    data: { ownershipId: row.id, expenseId, productName: product.name },
    message: `${product.name} added${v.holder === 'me' ? '' : ` for ${v.holder}`}${expenseId ? ' — purchase counted once in your season budget' : ''}`,
  }
}

export interface OwnershipSnapshot {
  ownership: PassOwnershipRow
  usage: PassUsageRow[]
  expenses: ExpenseRow[]
}

export async function removeOwnedPass(input: { ownershipId: number }): Promise<ActionResult<{ snapshot: OwnershipSnapshot; productName: string }>> {
  const id = z.number().int().positive().safeParse(input?.ownershipId)
  if (!id.success) return fail('Unknown pass')
  const { db } = await getCtx()
  const [ownership] = await db.select().from(s.passOwnership).where(eq(s.passOwnership.id, id.data))
  if (!ownership) return fail('This pass is no longer recorded')
  const [product] = await db.select({ name: s.passProducts.name }).from(s.passProducts).where(eq(s.passProducts.id, ownership.productId))
  const usage = await db.select().from(s.passUsage).where(eq(s.passUsage.ownershipId, ownership.id))
  const expenses = await db.select().from(s.expenses).where(eq(s.expenses.passOwnershipId, ownership.id))
  await db.delete(s.expenses).where(eq(s.expenses.passOwnershipId, ownership.id))
  await db.delete(s.passUsage).where(eq(s.passUsage.ownershipId, ownership.id))
  await db.delete(s.passOwnership).where(eq(s.passOwnership.id, ownership.id))
  revalidateAll()
  const name = product?.name ?? ownership.productId
  return {
    ok: true,
    data: { snapshot: { ownership, usage, expenses }, productName: name },
    message: `${name} removed${usage.length ? ` with ${usage.length} logged day${usage.length === 1 ? '' : 's'}` : ''}${expenses.length ? ' and its purchase expense' : ''}`,
  }
}

const Nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable()
const SnapshotInput = z.object({
  ownership: z.object({
    id: z.number().int().positive(),
    productId: Id,
    holder: z.string().min(1).max(60),
    purchasedOn: Nullable(LocalDate),
    pricePaidMinor: Nullable(z.number().int().min(0)),
    currency: Nullable(z.string().regex(/^[A-Z]{3}$/)),
    notes: Nullable(z.string().max(500)),
    createdAt: z.string().min(1).max(40),
  }),
  usage: z
    .array(
      z.object({
        id: z.number().int().positive(),
        ownershipId: z.number().int().positive(),
        resortId: Id,
        date: LocalDate,
        notes: Nullable(z.string().max(500)),
        createdAt: z.string().min(1).max(40),
      }),
    )
    .max(400),
  expenses: z
    .array(
      z.object({
        id: z.number().int().positive(),
        date: LocalDate,
        category: z.string().min(1).max(40),
        label: z.string().min(1).max(200),
        amountMinor: z.number().int(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        tripId: Nullable(z.string().max(100)),
        passOwnershipId: Nullable(z.number().int().positive()),
        notes: Nullable(z.string().max(1000)),
        createdAt: z.string().min(1).max(40),
      }),
    )
    .max(20),
})

/** Undo for removeOwnedPass: re-inserts the ownership, its logged days and its linked purchase with their ids. */
export async function restoreOwnedPass(input: { snapshot: OwnershipSnapshot }): Promise<ActionResult<{ ownershipId: number }>> {
  const parsed = SnapshotInput.safeParse(input?.snapshot)
  if (!parsed.success) return fail('Could not restore this pass')
  const snap = parsed.data
  const { db } = await getCtx()
  const [product] = await db.select({ id: s.passProducts.id }).from(s.passProducts).where(eq(s.passProducts.id, snap.ownership.productId))
  if (!product) return fail('The pass product no longer exists')
  const [taken] = await db.select({ id: s.passOwnership.id }).from(s.passOwnership).where(eq(s.passOwnership.id, snap.ownership.id))
  if (taken) return fail('This pass is already restored')
  await db.insert(s.passOwnership).values(snap.ownership)
  const ownershipId = snap.ownership.id
  if (snap.usage.length) {
    const ids = snap.usage.map((u) => u.id)
    const clash = new Set((await db.select({ id: s.passUsage.id }).from(s.passUsage).where(inArray(s.passUsage.id, ids))).map((r) => r.id))
    await db.insert(s.passUsage).values(snap.usage.map(({ id, ...u }) => ({ ...(clash.has(id) ? {} : { id }), ...u, ownershipId })))
  }
  if (snap.expenses.length) {
    const ids = snap.expenses.map((e) => e.id)
    const clash = new Set((await db.select({ id: s.expenses.id }).from(s.expenses).where(inArray(s.expenses.id, ids))).map((r) => r.id))
    await db.insert(s.expenses).values(snap.expenses.map(({ id, ...e }) => ({ ...(clash.has(id) ? {} : { id }), ...e, passOwnershipId: ownershipId })))
  }
  revalidateAll()
  return { ok: true, data: { ownershipId }, message: 'Pass restored' }
}

// ---------------------------------------------------------------------------
// Usage days

const LogDayInput = z.object({
  ownershipId: z.number().int().positive(),
  resortId: Id,
  date: LocalDate,
  notes: text(300),
})

export type LogDayForm = z.input<typeof LogDayInput>

export async function logPassDay(input: LogDayForm): Promise<ActionResult<{ usageId: number; warning: string | null }>> {
  const parsed = LogDayInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now, today } = await getCtx()
  const [ownership] = await db.select().from(s.passOwnership).where(eq(s.passOwnership.id, v.ownershipId))
  if (!ownership) return fail('This pass is no longer recorded')
  const [product] = await db.select().from(s.passProducts).where(eq(s.passProducts.id, ownership.productId))
  if (!product) return fail('Unknown pass product')
  const [resort] = await db.select({ id: s.resorts.id, name: s.resorts.name, shortName: s.resorts.shortName, lat: s.resorts.lat }).from(s.resorts).where(eq(s.resorts.id, v.resortId))
  if (!resort) return fail('Unknown resort', { resortId: 'Choose a resort from the list' })
  if (v.date > today) return fail('Log days you have skied — plan future days in Trips', { date: `Pick ${today} or earlier` })
  // The pass season of the day at that resort: a Southern Hemisphere winter (June–October 2027) is 2026–27.
  if (seasonIdForResort(v.date, resort) !== product.seasonId) {
    return fail(`${product.name} is a ${seasonText(product.seasonId)} pass`, { date: `Pick a date in the ${seasonText(product.seasonId)} season` })
  }
  const usage = await db.select().from(s.passUsage).where(eq(s.passUsage.ownershipId, ownership.id))
  if (usage.some((u) => u.resortId === resort.id && u.date === v.date)) return fail('This day is already logged', { date: 'Already logged at this resort' })

  // What the recorded rule said for this day before logging it (logging is a personal fact; the rule may be wrong).
  const rules = await db.select().from(s.passAccessRules).where(eq(s.passAccessRules.productId, product.id))
  const seasonOf = seasonResolver(await db.select({ id: s.resorts.id, lat: s.resorts.lat }).from(s.resorts))
  const verdict = evaluateAccess({ product, rule: latestRule(rules, product.id, resort.id), resortId: resort.id, date: v.date, usage, poolRules: rules, today, seasonOf })
  const name = resort.shortName || resort.name
  const warning = verdict.canSki
    ? null
    : verdict.status === 'unknown'
      ? `Access at ${name} is not confirmed for this pass — the day is logged but no allowance is known.`
      : `The recorded rule says “${ACCESS_STATUS_LABEL[verdict.status]}” at ${name} on this date — check the rule if you used the pass.`

  const [row] = await db.insert(s.passUsage).values({ ownershipId: ownership.id, resortId: resort.id, date: v.date, notes: v.notes, createdAt: now }).returning({ id: s.passUsage.id })
  revalidateAll()
  return { ok: true, data: { usageId: row.id, warning }, message: `Logged ${name} on ${v.date}` }
}

export async function removePassDay(input: { usageId: number }): Promise<ActionResult<{ snapshot: PassUsageRow }>> {
  const id = z.number().int().positive().safeParse(input?.usageId)
  if (!id.success) return fail('Unknown day')
  const { db } = await getCtx()
  const [row] = await db.select().from(s.passUsage).where(eq(s.passUsage.id, id.data))
  if (!row) return fail('This day is no longer logged')
  await db.delete(s.passUsage).where(eq(s.passUsage.id, row.id))
  revalidateAll()
  return { ok: true, data: { snapshot: row }, message: `Removed the ${row.date} day` }
}

export async function restorePassDay(input: { snapshot: PassUsageRow }): Promise<ActionResult<{ usageId: number }>> {
  const parsed = SnapshotInput.shape.usage.element.safeParse(input?.snapshot)
  if (!parsed.success) return fail('Could not restore this day')
  const u = parsed.data
  const { db } = await getCtx()
  const [ownership] = await db.select({ id: s.passOwnership.id }).from(s.passOwnership).where(eq(s.passOwnership.id, u.ownershipId))
  if (!ownership) return fail('The pass is no longer recorded')
  const dup = await db
    .select({ id: s.passUsage.id })
    .from(s.passUsage)
    .where(and(eq(s.passUsage.ownershipId, u.ownershipId), eq(s.passUsage.resortId, u.resortId), eq(s.passUsage.date, u.date)))
  if (dup.length) return fail('This day is already logged')
  const [taken] = await db.select({ id: s.passUsage.id }).from(s.passUsage).where(eq(s.passUsage.id, u.id))
  const { id, ...rest } = u
  const [row] = await db
    .insert(s.passUsage)
    .values({ ...(taken ? {} : { id }), ...rest })
    .returning({ id: s.passUsage.id })
  revalidateAll()
  return { ok: true, data: { usageId: row.id }, message: 'Day restored' }
}

// ---------------------------------------------------------------------------
// Manual access rules (new versions only)

const SourceUrl = z
  .string()
  .trim()
  .min(1, 'A source link is required')
  .max(500, 'That link is too long')
  .refine((u) => {
    try {
      const url = new URL(u)
      return url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      return false
    }
  }, 'Enter the full link, starting with https://')

const RuleInput = z
  .object({
    productId: Id,
    resortId: Id,
    access: z.enum(PASS_ACCESS),
    /** limited-days: days at this resort. shared-pool: the pool's total days. */
    days: z.number().int('Whole days only').min(1, 'At least 1 day').max(365, 'That is more than a season').nullish(),
    /** Existing pool id of this product to join, or null to create one from `poolLabel`. */
    poolId: z
      .string()
      .max(160)
      .nullish()
      .transform((v) => v || null),
    poolLabel: text(80),
    blackouts: z
      .array(z.object({ from: LocalDate, to: LocalDate, label: text(60) }))
      .max(40, 'Up to 40 blackout ranges')
      .default([]),
    reservationRequired: z.boolean().nullable(),
    reservationNotes: text(500),
    discountText: text(300),
    eligibilityNotes: text(500),
    notes: text(1000),
    sourceUrl: SourceUrl,
    sourceLabel: text(120),
  })
  .superRefine((v, c) => {
    if ((v.access === 'limited-days' || v.access === 'shared-pool') && v.days == null) {
      c.addIssue({ code: 'custom', path: ['days'], message: v.access === 'shared-pool' ? 'Enter the number of days in the pool' : 'Enter the number of days' })
    }
    if (v.access === 'shared-pool' && !v.poolId && !v.poolLabel) c.addIssue({ code: 'custom', path: ['poolLabel'], message: 'Name the pool, e.g. “Alta + Snowbird”' })
    v.blackouts.forEach((b, i) => {
      if (b.from > b.to) c.addIssue({ code: 'custom', path: ['blackouts', i, 'to'], message: 'Ends before it starts' })
    })
  })

export type RuleForm = z.input<typeof RuleInput>

function slug(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function saveAccessRule(input: RuleForm): Promise<ActionResult<{ id: number; version: number }>> {
  const parsed = RuleInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now } = await getCtx()
  const [product] = await db.select().from(s.passProducts).where(eq(s.passProducts.id, v.productId))
  if (!product) return fail('Unknown pass product')
  const [resort] = await db.select({ id: s.resorts.id, name: s.resorts.name, lat: s.resorts.lat }).from(s.resorts).where(eq(s.resorts.id, v.resortId))
  if (!resort) return fail('Unknown resort')
  const season = product.seasonId
  // Blackouts fall in the pass season at this resort: 1 Jul → 30 Jun, or the calendar year of a Southern Hemisphere
  // winter (a 2026–27 pass covers June–October 2027 in Australia and New Zealand).
  const outside = v.blackouts.findIndex((b) => seasonIdForResort(b.from, resort) !== season || seasonIdForResort(b.to, resort) !== season)
  if (outside !== -1) {
    const span = seasonBounds(season, hemisphereOf(resort.lat))
    return fail('Blackout dates must fall in the pass season', { [`blackouts.${outside}.from`]: `Use ${seasonText(season)} dates (${span.from} to ${span.to} here)` })
  }

  const rules = await db.select().from(s.passAccessRules).where(eq(s.passAccessRules.productId, product.id))
  const usesPool = v.access === 'shared-pool' || (v.access === 'limited-days' && (v.poolId || v.poolLabel))
  let poolId: string | null = null
  let poolLabel: string | null = null
  if (usesPool) {
    if (v.poolId) {
      const member = rules.find((r) => r.poolId === v.poolId)
      if (!member) return fail('That pool is not defined for this pass', { poolId: 'Choose a pool from the list' })
      poolId = v.poolId
      poolLabel = v.poolLabel ?? member.poolLabel
    } else if (v.poolLabel) {
      poolId = `${product.id}:${slug(v.poolLabel) || 'pool'}`
      poolLabel = v.poolLabel
    }
  }

  const version = Math.max(0, ...rules.filter((r) => r.resortId === resort.id).map((r) => r.version)) + 1
  const [row] = await db
    .insert(s.passAccessRules)
    .values({
      productId: product.id,
      resortId: resort.id,
      version,
      access: v.access,
      days: v.access === 'limited-days' || v.access === 'shared-pool' ? (v.days ?? null) : null,
      poolId,
      poolLabel,
      blackouts: v.blackouts.map((b) => ({ from: b.from, to: b.to, label: b.label })),
      reservationRequired: v.reservationRequired,
      reservationNotes: v.reservationNotes,
      discountText: v.access === 'discount-only' ? v.discountText : null,
      eligibilityNotes: v.eligibilityNotes,
      notes: v.notes,
      prov: provenance({
        kind: 'manual',
        provider: 'You',
        sourceUrl: v.sourceUrl,
        season,
        fetchedAt: now,
        verification: 'user-confirmed',
        note: v.sourceLabel ? `Entered from ${v.sourceLabel}` : 'Entered in Passes & Costs',
      }),
      updatedAt: now,
    })
    .returning({ id: s.passAccessRules.id })
  revalidateAll()
  return { ok: true, data: { id: row.id, version }, message: `Saved as version ${version} for ${resort.name} — earlier versions are kept` }
}

// ---------------------------------------------------------------------------
// Basket assumptions

const AssumptionsInput = z.object({
  rentalOption: z.enum(['full-package', 'skis-only', 'boots-only', 'none']),
  /** Per-person lunch estimate in major units of the budget currency; 0 = you bring your own. */
  lunch: Amount,
  partySize: z.number().int('Whole people only').min(1, 'At least 1 person').max(MAX_PARTY, `Up to ${MAX_PARTY} people`),
})

export type AssumptionsForm = z.input<typeof AssumptionsInput>

export async function saveBasketAssumptions(input: AssumptionsForm): Promise<ActionResult<{ rentalOption: GearPrefs['rentalOption']; lunchMinor: number; partySize: number }>> {
  const parsed = AssumptionsInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now, prefs } = await getCtx()
  const cur = prefs.budget.currency
  if (minorDigits(cur) === 0 && v.lunch.includes('.')) return fail('This currency has no minor units', { lunch: 'Enter a whole amount' })
  const lunchMinor = fromMajor(v.lunch, cur).amountMinor
  const gear: GearPrefs = { ...prefs.gear, rentalOption: v.rentalOption }
  // Party size rides in the budget JSON (optional key); it only splits per-vehicle costs such as parking.
  const budget: BudgetPrefs & { basketPartySize: number } = { ...prefs.budget, lunchEstimateMinor: lunchMinor, basketPartySize: v.partySize }
  await db.update(s.userPreferences).set({ gear, budget, updatedAt: now }).where(eq(s.userPreferences.id, 1))
  revalidateAll()
  return { ok: true, data: { rentalOption: v.rentalOption, lunchMinor, partySize: v.partySize }, message: 'Basket assumptions saved — used for every resort' }
}

// ---------------------------------------------------------------------------
// Your price estimates
//
// Stored as price snapshots with quoteKind 'user-estimate' and provenance { kind: 'manual', provider: 'You' } — kept
// apart from published prices and observed quotes, labelled "Your estimate" everywhere, and outranked by a published
// price or observed quote for the same day as soon as one is recorded (see selectPrice). One estimate per
// (subject, resort or product, rental option, day type, season): a second one is an edit, not a silent duplicate.

// ('use server' modules may only export async functions — these stay module-private.)
const ESTIMATE_SUBJECTS = ['lift-ticket', 'rental', 'parking', 'pass-product'] as const
export type EstimateSubject = (typeof ESTIMATE_SUBJECTS)[number]
const ESTIMATE_DAY_TYPES = ['weekday', 'weekend', 'holiday', 'any'] as const

const EstimateAmounts = {
  /** Day type the estimate applies to; pass prices are always 'any'. */
  dayType: z.enum(ESTIMATE_DAY_TYPES),
  /** Major units; parking is per vehicle, everything else per person. */
  amount: Amount,
  amountMax: Amount.nullish().or(z.literal('').transform(() => null)),
  currency: Currency,
  note: text(200),
}

const rangeCheck = (v: { amount: string; amountMax?: string | null }, c: z.RefinementCtx) => {
  if (v.amountMax != null && Number(v.amountMax) < Number(v.amount)) c.addIssue({ code: 'custom', path: ['amountMax'], message: 'The upper end is below the lower end' })
}

const EstimateInput = z
  .object({
    subject: z.enum(ESTIMATE_SUBJECTS),
    /** Resort id (lift ticket, rental, parking) or pass product id (pass-product). */
    subjectId: Id,
    /** Rental option the estimate is for (rental only). */
    rentalOption: z.enum(['full-package', 'skis-only', 'boots-only']).nullish(),
    ...EstimateAmounts,
  })
  .superRefine((v, c) => {
    if (v.subject === 'rental' && !v.rentalOption) c.addIssue({ code: 'custom', path: ['rentalOption'], message: 'Choose the rental option' })
    rangeCheck(v, c)
  })

export type EstimateForm = z.input<typeof EstimateInput>

const EstimateUpdateInput = z
  .object({ id: z.number().int().positive(), ...EstimateAmounts })
  .superRefine(rangeCheck)

export type EstimateUpdateForm = z.input<typeof EstimateUpdateInput>

type PriceRow = typeof s.priceSnapshots.$inferSelect

const SUBJECT_ITEM: Record<Exclude<EstimateSubject, 'rental'>, string> = {
  'lift-ticket': 'Your lift ticket estimate',
  parking: 'Your parking estimate (per vehicle)',
  'pass-product': 'Your pass price estimate',
}
const SUBJECT_TEXT: Record<EstimateSubject, string> = { 'lift-ticket': 'lift ticket', rental: 'rental', parking: 'parking', 'pass-product': 'pass price' }
const DAY_TYPE_TEXT: Record<(typeof ESTIMATE_DAY_TYPES)[number], string> = { weekday: 'weekday', weekend: 'weekend', holiday: 'holiday', any: 'any-day' }

/** Provenance of an estimate: manual, provider 'You', the user's note after "Your estimate — " (see estimateView). */
function estimateProv(season: string, now: string, note: string | null) {
  return provenance({ kind: 'manual', provider: 'You', season, fetchedAt: now, note: note ? `Your estimate — ${note}` : 'Your estimate' })
}

const isMine = (r: PriceRow) => r.quoteKind === 'user-estimate' && r.prov?.kind === 'manual' && r.prov?.provider === 'You'

/** Another of your estimates with the same key (subject, resort/product, item, day type, season). */
async function clashingEstimate(
  db: Awaited<ReturnType<typeof getCtx>>['db'],
  key: { subjectType: PriceRow['subjectType']; subjectId: string; item: string; dayType: string; seasonId: string },
  exceptId: number | null,
): Promise<PriceRow | null> {
  const rows = await db
    .select()
    .from(s.priceSnapshots)
    .where(
      and(
        eq(s.priceSnapshots.quoteKind, 'user-estimate'),
        eq(s.priceSnapshots.subjectType, key.subjectType),
        eq(s.priceSnapshots.subjectId, key.subjectId),
        eq(s.priceSnapshots.item, key.item),
        eq(s.priceSnapshots.dayType, key.dayType),
        eq(s.priceSnapshots.seasonId, key.seasonId),
      ),
    )
  return rows.find((r) => r.id !== exceptId) ?? null
}

function wholeAmountCheck(v: { currency: string; amount: string; amountMax?: string | null }): ActionResult<never> | null {
  if (minorDigits(v.currency) === 0 && (v.amount.includes('.') || v.amountMax?.includes('.'))) return fail('This currency has no minor units', { amount: 'Enter a whole amount' })
  return null
}

function amounts(v: { currency: string; amount: string; amountMax?: string | null }) {
  const amount = fromMajor(v.amount, v.currency)
  const max = v.amountMax != null ? fromMajor(v.amountMax, v.currency) : null
  return { amountMinor: amount.amountMinor, amountMaxMinor: max && max.amountMinor > amount.amountMinor ? max.amountMinor : null, currency: amount.currency }
}

export async function addPriceEstimate(input: EstimateForm): Promise<ActionResult<{ id: number }>> {
  const parsed = EstimateInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const whole = wholeAmountCheck(v)
  if (whole) return whole
  const { db, now, prefs } = await getCtx()

  let subjectId: string
  let resortId: string | null
  let name: string
  let season = prefs.activeSeasonId
  if (v.subject === 'pass-product') {
    const [product] = await db.select().from(s.passProducts).where(eq(s.passProducts.id, v.subjectId))
    if (!product) return fail('Unknown pass product')
    subjectId = product.id
    resortId = product.resortId
    name = product.name
    season = product.seasonId
  } else {
    const [resort] = await db.select({ id: s.resorts.id, name: s.resorts.name }).from(s.resorts).where(eq(s.resorts.id, v.subjectId))
    if (!resort) return fail('Unknown resort')
    subjectId = resort.id
    resortId = resort.id
    name = resort.name
  }
  // A pass price has no day type.
  const dayType = v.subject === 'pass-product' ? 'any' : v.dayType
  const item = v.subject === 'rental' ? v.rentalOption! : SUBJECT_ITEM[v.subject]
  const clash = await clashingEstimate(db, { subjectType: v.subject, subjectId, item, dayType, seasonId: season }, null)
  if (clash) {
    return fail(`You already have a${dayType === 'any' ? 'n' : ''} ${DAY_TYPE_TEXT[dayType]} ${SUBJECT_TEXT[v.subject]} estimate for ${name} — edit that one instead`, {
      dayType: 'Already estimated',
    })
  }

  const [row] = await db
    .insert(s.priceSnapshots)
    .values({
      subjectType: v.subject,
      subjectId,
      resortId,
      item,
      category: v.subject === 'parking' ? null : 'adult',
      ...amounts(v),
      seasonId: season,
      dayType,
      appliesFrom: null,
      appliesTo: null,
      purchaseBy: null,
      includesTax: null,
      feesText: null,
      quoteKind: 'user-estimate',
      observedAt: now,
      expiresAt: null,
      prov: estimateProv(season, now, v.note),
    })
    .returning({ id: s.priceSnapshots.id })
  revalidateAll()
  return { ok: true, data: { id: row.id }, message: `Your ${SUBJECT_TEXT[v.subject]} estimate for ${name} is saved — labelled as your estimate` }
}

/** Edit one of YOUR estimates in place (amount, range, currency, day type, note). Returns the previous row for Undo. */
export async function updatePriceEstimate(input: EstimateUpdateForm): Promise<ActionResult<{ id: number; previous: PriceRow }>> {
  const parsed = EstimateUpdateInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const whole = wholeAmountCheck(v)
  if (whole) return whole
  const { db, now, prefs } = await getCtx()
  const [row] = await db.select().from(s.priceSnapshots).where(eq(s.priceSnapshots.id, v.id))
  if (!row) return fail('This estimate no longer exists')
  if (!isMine(row)) return fail('Only your own estimates can be edited here — published prices and observed quotes are never changed')
  const dayType = row.subjectType === 'pass-product' ? 'any' : v.dayType
  const season = row.seasonId ?? prefs.activeSeasonId
  const clash = await clashingEstimate(db, { subjectType: row.subjectType, subjectId: row.subjectId, item: row.item, dayType, seasonId: season }, row.id)
  if (clash) return fail(`You already have a${dayType === 'any' ? 'n' : ''} ${DAY_TYPE_TEXT[dayType]} estimate for this — edit that one instead`, { dayType: 'Already estimated' })
  await db
    .update(s.priceSnapshots)
    .set({ ...amounts(v), dayType, seasonId: season, observedAt: now, prov: estimateProv(season, now, v.note) })
    .where(eq(s.priceSnapshots.id, row.id))
  revalidateAll()
  return { ok: true, data: { id: row.id, previous: row }, message: 'Your estimate is updated' }
}

/** Removes one of YOUR estimates (published prices and observed quotes are never deleted here). */
export async function removePriceEstimate(input: { id: number }): Promise<ActionResult<{ snapshot: PriceRow }>> {
  const id = z.number().int().positive().safeParse(input?.id)
  if (!id.success) return fail('Unknown estimate')
  const { db } = await getCtx()
  const [row] = await db.select().from(s.priceSnapshots).where(eq(s.priceSnapshots.id, id.data))
  if (!row) return fail('This estimate is already gone')
  if (!isMine(row)) return fail('Only your own estimates can be removed here')
  await db.delete(s.priceSnapshots).where(eq(s.priceSnapshots.id, row.id))
  revalidateAll()
  return { ok: true, data: { snapshot: row }, message: 'Your estimate was removed' }
}

const EstimateSnapshot = z.object({
  id: z.number().int().positive(),
  subjectType: z.enum(ESTIMATE_SUBJECTS),
  subjectId: Id,
  resortId: Id.nullable(),
  item: z.string().min(1).max(120),
  category: z.string().max(40).nullable(),
  amountMinor: z.number().int().min(0),
  amountMaxMinor: z.number().int().min(0).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  seasonId: z.string().regex(/^\d{4}-\d{2}$/),
  dayType: z.enum(ESTIMATE_DAY_TYPES),
  quoteKind: z.literal('user-estimate'),
  observedAt: z.string().min(1).max(40),
  prov: z.object({ kind: z.literal('manual'), provider: z.literal('You'), note: z.string().max(260).nullish(), fetchedAt: z.string().max(40).nullish() }).passthrough(),
})

/**
 * Undo for removePriceEstimate (re-inserts the row, with its id when free) and for updatePriceEstimate (writes the
 * previous values back onto the same row).
 */
export async function restorePriceEstimate(input: { snapshot: PriceRow }): Promise<ActionResult<{ id: number }>> {
  const parsed = EstimateSnapshot.safeParse(input?.snapshot)
  if (!parsed.success) return fail('Could not restore this estimate')
  const e = parsed.data
  const { db } = await getCtx()
  const { id, prov, ...rest } = e
  const values = {
    ...rest,
    appliesFrom: null,
    appliesTo: null,
    purchaseBy: null,
    includesTax: null,
    feesText: null,
    expiresAt: null,
    prov: provenance({ season: e.seasonId, note: prov.note ?? 'Your estimate', fetchedAt: prov.fetchedAt ?? null, kind: 'manual', provider: 'You' }),
  }
  const [existing] = await db.select().from(s.priceSnapshots).where(eq(s.priceSnapshots.id, id))
  if (existing) {
    // Undo of an edit: the row is still there — put the previous values back.
    if (!isMine(existing) || existing.subjectType !== e.subjectType || existing.subjectId !== e.subjectId) return fail('Could not restore this estimate')
    const clash = await clashingEstimate(db, { subjectType: e.subjectType, subjectId: e.subjectId, item: e.item, dayType: e.dayType, seasonId: e.seasonId }, id)
    if (clash) return fail('Another estimate now covers the same day type — edit that one instead')
    await db.update(s.priceSnapshots).set(values).where(eq(s.priceSnapshots.id, id))
    revalidateAll()
    return { ok: true, data: { id }, message: 'Previous estimate restored' }
  }
  const clash = await clashingEstimate(db, { subjectType: e.subjectType, subjectId: e.subjectId, item: e.item, dayType: e.dayType, seasonId: e.seasonId }, null)
  if (clash) return fail('You have since added an estimate for the same day type — it was kept')
  const [row] = await db.insert(s.priceSnapshots).values({ id, ...values }).returning({ id: s.priceSnapshots.id })
  revalidateAll()
  return { ok: true, data: { id: row.id }, message: 'Estimate restored' }
}
