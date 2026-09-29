'use server'
/**
 * Today mutations, plus the weekend finder's re-rank.
 *
 * - `saveWeights`: the five "My weights" factor weights (weekend finder sliders) → preferences. Returns the previous
 *   weights so the toast can undo.
 * - `rankWindow`: re-rank a finder window with previewed (unsaved) weights. A read — nothing is written; it runs the
 *   same engine as the page (getRecommendation) against a copy of the preferences.
 * - `markAlertsRead`: mark in-app alerts read, or unread again (undo).
 * - `completeOnboarding` / `skipOnboarding`: the one-screen setup — home, ability, units, owned passes (exact
 *   products, or none), travel limits. Both set `onboardingDone`; Settings edits the full preferences later.
 *
 * "Save trip from recommendation" reuses `createTrip` / `deleteTrip` from ./trips (no second trip writer here).
 *
 * Every input is validated with zod; ids from the client are re-checked against the database. Writes go to the
 * database of the current mode only (getCtx picks live or demo), and revalidate the app layout (unread-alert count,
 * Today, and every screen that reads preferences).
 */
import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { IANAZone } from 'luxon'
import { z } from 'zod'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import { getRecommendation } from '@/lib/data/today'
import { FACTOR_KEYS, type FactorWeights } from '@/lib/domain/recommend'
import { ABILITY_LEVELS } from '@/lib/domain/types'
import { finderRange, FINDER_WINDOWS } from '@/components/today/params'
import { rankingView, type RankingView } from '@/components/today/rank-model'

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors }
}

function zodFail(e: z.ZodError, fallback = 'Please check the highlighted fields'): ActionResult<never> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of e.issues) {
    const key = issue.path.join('.') || '_'
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fail(e.issues.length === 1 && !e.issues[0].path.length ? e.issues[0].message : fallback, fieldErrors)
}

// ---------------------------------------------------------------------------
// Weights

const Weight = z.number().int('Whole numbers only').min(0, 'Use 0–100').max(100, 'Use 0–100')
const Weights = z
  .object(Object.fromEntries(FACTOR_KEYS.map((k) => [k, Weight])) as Record<(typeof FACTOR_KEYS)[number], typeof Weight>)
  .refine((w) => FACTOR_KEYS.some((k) => w[k] > 0), {
    message: 'Give at least one factor some weight',
  })

/** Save the weekend-finder / "My weights" factor weights. */
export async function saveWeights(input: FactorWeights): Promise<ActionResult<{ previous: FactorWeights; weights: FactorWeights }>> {
  const parsed = Weights.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const { db, now, prefs } = await getCtx()
  const previous = { ...prefs.weights }
  await db.update(s.userPreferences).set({ weights: parsed.data, updatedAt: now }).where(eq(s.userPreferences.id, 1))
  revalidatePath('/', 'layout')
  return {
    ok: true,
    data: { previous, weights: parsed.data },
    message: 'Weights saved',
  }
}

const RankInput = z.object({
  window: z.enum(FINDER_WINDOWS),
  /** Preview weights; omitted = the saved weights. */
  weights: Weights.nullish(),
})

/** Re-rank a finder window (read-only). */
export async function rankWindow(input: z.input<typeof RankInput>): Promise<ActionResult<RankingView>> {
  const parsed = RankInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'Those weights could not be used')
  const ctx = await getCtx()
  const range = finderRange(parsed.data.window, ctx.today)
  const weights = parsed.data.weights ?? ctx.prefs.weights
  const rec = await getRecommendation({ ...ctx, prefs: { ...ctx.prefs, weights } }, { range, preset: 'custom' })
  return { ok: true, data: rankingView(rec) }
}

// ---------------------------------------------------------------------------
// Alerts

const AlertIds = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  read: z.boolean().default(true),
})

/** Mark in-app alerts read (or unread again, for Undo). Returns the ids that changed. */
export async function markAlertsRead(input: z.input<typeof AlertIds>): Promise<ActionResult<{ ids: number[] }>> {
  const parsed = AlertIds.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'Unknown alert')
  const { ids, read } = parsed.data
  const { db, now } = await getCtx()
  const rows = await db
    .select({ id: s.alerts.id })
    .from(s.alerts)
    .where(and(inArray(s.alerts.id, ids), read ? isNull(s.alerts.readAt) : isNotNull(s.alerts.readAt)))
  const changed = rows.map((r) => r.id)
  if (changed.length)
    await db
      .update(s.alerts)
      .set({ readAt: read ? now : null })
      .where(inArray(s.alerts.id, changed))
  revalidatePath('/', 'layout')
  return {
    ok: true,
    data: { ids: changed },
    message: read ? (changed.length === 1 ? 'Alert marked read' : `${changed.length} alerts marked read`) : 'Marked unread',
  }
}

// ---------------------------------------------------------------------------
// Onboarding

const Home = z.object({
  name: z.string().trim().min(2, 'Name your home, e.g. "Burlington, VT"').max(80, 'Keep it under 80 characters'),
  lat: z.number().min(-90, 'Latitude runs −90 to 90').max(90, 'Latitude runs −90 to 90'),
  lon: z.number().min(-180, 'Longitude runs −180 to 180').max(180, 'Longitude runs −180 to 180'),
  timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), 'Choose a time zone'),
})

const Onboarding = z.object({
  /** null keeps the current home. */
  home: Home.nullable(),
  ability: z.enum(ABILITY_LEVELS),
  units: z.object({
    temperature: z.enum(['F', 'C']),
    snow: z.enum(['in', 'cm']),
    distance: z.enum(['mi', 'km']),
    elevation: z.enum(['ft', 'm']),
  }),
  /** Exact products you own for the season (empty = no pass). Already-recorded products are left as they are. */
  passes: z
    .array(
      z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-z0-9-]+$/, 'Unknown pass'),
    )
    .max(12),
  travel: z.object({
    /** null = no limit. */
    maxDriveHours: z.number().min(0.5, 'At least half an hour').max(16, 'Up to 16 hours').nullable(),
    willingToFly: z.boolean(),
  }),
})
export type OnboardingInput = z.input<typeof Onboarding>

/** Save the one-screen setup and hide the panel. */
export async function completeOnboarding(input: OnboardingInput): Promise<ActionResult<{ addedPasses: string[] }>> {
  const parsed = Onboarding.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now, prefs } = await getCtx()

  const ids = [...new Set(v.passes)]
  const products = ids.length
    ? await db
        .select({
          id: s.passProducts.id,
          name: s.passProducts.name,
          seasonId: s.passProducts.seasonId,
        })
        .from(s.passProducts)
        .where(inArray(s.passProducts.id, ids))
    : []
  if (products.length !== ids.length)
    return fail('One of the passes is not in the catalog', {
      passes: 'Choose passes from the list',
    })
  const mine = ids.length
    ? await db
        .select({ productId: s.passOwnership.productId })
        .from(s.passOwnership)
        .where(and(inArray(s.passOwnership.productId, ids), eq(s.passOwnership.holder, 'me')))
    : []
  const already = new Set(mine.map((m) => m.productId))
  const toAdd = products.filter((p) => !already.has(p.id))

  await db
    .update(s.userPreferences)
    .set({
      ...(v.home
        ? {
            homeName: v.home.name,
            homeLat: v.home.lat,
            homeLon: v.home.lon,
            homeTimezone: v.home.timezone,
          }
        : {}),
      ability: v.ability,
      // Wind speed follows the distance unit; Settings can switch it on its own.
      units: { ...v.units, speed: v.units.distance === 'mi' ? 'mph' : 'kmh' },
      travel: {
        ...prefs.travel,
        maxDriveHours: v.travel.maxDriveHours,
        willingToFly: v.travel.willingToFly,
      },
      onboardingDone: true,
      updatedAt: now,
    })
    .where(eq(s.userPreferences.id, 1))
  if (toAdd.length) {
    // No price is recorded here (unknown, never 0) — Passes & Costs records what you paid, once.
    await db.insert(s.passOwnership).values(toAdd.map((p) => ({ productId: p.id, holder: 'me', createdAt: now })))
  }
  revalidatePath('/', 'layout')
  return {
    ok: true,
    data: { addedPasses: toAdd.map((p) => p.name) },
    message: toAdd.length ? `Preferences saved · ${toAdd.map((p) => p.name).join(', ')} recorded as yours` : 'Preferences saved',
  }
}

/** Skip setup: keep the defaults and hide the panel. */
export async function skipOnboarding(): Promise<ActionResult> {
  const { db, now } = await getCtx()
  await db.update(s.userPreferences).set({ onboardingDone: true, updatedAt: now }).where(eq(s.userPreferences.id, 1))
  revalidatePath('/', 'layout')
  return {
    ok: true,
    data: null,
    message: 'Setup skipped — change anything later in Settings',
  }
}
