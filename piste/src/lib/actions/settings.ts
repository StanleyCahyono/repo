'use server'
/**
 * Settings mutations: personal defaults (home, season, ability, units, currency, travel, gear, budget, lodging,
 * recommendation weights, theme) and in-app alert rules.
 *
 * Rules
 * - Every action validates with zod and writes only the preference fields it owns. JSON preference columns are merged
 *   with what is stored, so keys other screens keep there (e.g. the day-basket party size) survive.
 * - Units and currency are display choices: these actions change the preference and nothing else — no stored
 *   measurement, price, quote or budget amount is converted or rewritten (tested in settings.test.ts).
 * - Demo mode writes to the demo database only (getCtx picks it), like every other action.
 */
import { revalidatePath } from 'next/cache'
import { eq, inArray } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import { ALERT_TYPES, type AlertType, type BudgetPrefs, type GearPrefs, type RecommendationWeights, type TravelPrefs } from '@/lib/db/schema'
import type { AlertRuleRow, UserPreferencesRow } from '@/lib/db/rows'
import { fromMajor } from '@/lib/domain/money'
import { ABILITY_LEVELS, SCORING_MODES, type UnitPrefs } from '@/lib/domain/types'
import { ensureDefaultAlertRules, RULE_PARAMS } from '@/lib/jobs/alerts'
import { BUDGET_CURRENCIES, DISPLAY_CURRENCIES, LODGING_STYLES, THEMES } from '@/components/settings/options'
import { GLOBAL_ONLY_ALERTS } from '@/components/settings/alert-specs'

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
  return fail(fallback, fieldErrors)
}

/** Preferences feed every page (shell, scores, costs, travel). */
function revalidateAll() {
  revalidatePath('/', 'layout')
}

async function currentPrefs(): Promise<{ ctx: Awaited<ReturnType<typeof getCtx>>; prefs: UserPreferencesRow }> {
  const ctx = await getCtx()
  const [row] = await ctx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1))
  return { ctx, prefs: row ?? ctx.prefs }
}

async function writePrefs(patch: Partial<Omit<UserPreferencesRow, 'id'>>): Promise<UserPreferencesRow> {
  const { ctx, prefs } = await currentPrefs()
  const next = { ...prefs, ...patch, id: 1, updatedAt: ctx.now }
  await ctx.db.insert(s.userPreferences).values(next).onConflictDoUpdate({ target: s.userPreferences.id, set: { ...patch, updatedAt: ctx.now } })
  return next
}

const isZone = (v: string) => DateTime.local().setZone(v).isValid && v.includes('/')

// ---------------------------------------------------------------------------
// Home & season

const HomeInput = z.object({
  homeName: z.string().trim().min(1, 'Name your home base').max(80, 'Keep it under 80 characters'),
  homeLat: z.number({ error: 'Enter a latitude' }).min(-90, 'Latitude is between −90 and 90').max(90, 'Latitude is between −90 and 90'),
  homeLon: z.number({ error: 'Enter a longitude' }).min(-180, 'Longitude is between −180 and 180').max(180, 'Longitude is between −180 and 180'),
  homeTimezone: z.string().refine(isZone, 'Choose a time zone from the list'),
  activeSeasonId: z.string().regex(/^\d{4}-\d{2}$/, 'Choose a season'),
})
export type HomeInput = z.input<typeof HomeInput>

export async function saveHome(input: HomeInput): Promise<ActionResult<HomeInput>> {
  const parsed = HomeInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db } = await getCtx()
  const seasons = await db.select({ id: s.seasons.id }).from(s.seasons)
  if (seasons.length && !seasons.some((x) => x.id === v.activeSeasonId)) return fail('Unknown season', { activeSeasonId: 'Choose a season from the list' })
  const data = { homeName: v.homeName, homeLat: Math.round(v.homeLat * 1e5) / 1e5, homeLon: Math.round(v.homeLon * 1e5) / 1e5, homeTimezone: v.homeTimezone, activeSeasonId: v.activeSeasonId }
  await writePrefs(data)
  revalidateAll()
  return { ok: true, data, message: 'Home and season saved' }
}

// ---------------------------------------------------------------------------
// Ability & companion

const Ability = z.enum(ABILITY_LEVELS)
const ProfileInput = z
  .object({
    ability: Ability,
    scoringMode: z.enum(SCORING_MODES),
    companionName: z
      .string()
      .trim()
      .max(60, 'Keep it under 60 characters')
      .nullable()
      .transform((v) => (v ? v : null)),
    companionAbility: Ability.nullable(),
  })
  .superRefine((v, c) => {
    if (v.companionName && !v.companionAbility) c.addIssue({ code: 'custom', path: ['companionAbility'], message: 'Choose their ability, or clear the name' })
  })
export type ProfileInput = z.input<typeof ProfileInput>

export async function saveProfile(input: ProfileInput): Promise<ActionResult<z.output<typeof ProfileInput>>> {
  const parsed = ProfileInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  await writePrefs({ ability: v.ability, scoringMode: v.scoringMode, companionName: v.companionAbility ? v.companionName : null, companionAbility: v.companionAbility })
  revalidateAll()
  return { ok: true, data: { ...v, companionName: v.companionAbility ? v.companionName : null }, message: 'Ability saved' }
}

// ---------------------------------------------------------------------------
// Units & currency (display only)

const UnitsInput = z.object({
  temperature: z.enum(['F', 'C']),
  snow: z.enum(['in', 'cm']),
  distance: z.enum(['mi', 'km']),
  elevation: z.enum(['ft', 'm']),
  speed: z.enum(['mph', 'kmh']),
})

export async function saveUnits(input: UnitPrefs): Promise<ActionResult<UnitPrefs>> {
  const parsed = UnitsInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'Unknown unit')
  await writePrefs({ units: parsed.data })
  revalidateAll()
  return { ok: true, data: parsed.data, message: 'Units updated — stored values are unchanged' }
}

export async function saveCurrency(input: { currency: string }): Promise<ActionResult<{ currency: string }>> {
  const parsed = z.object({ currency: z.enum(DISPLAY_CURRENCIES) }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'Choose USD, CAD or EUR')
  await writePrefs({ currency: parsed.data.currency })
  revalidateAll()
  return { ok: true, data: parsed.data, message: `Prices shown in ${parsed.data.currency} where a rate is stored — originals kept` }
}

// ---------------------------------------------------------------------------
// Travel

const TravelInput = z.object({
  maxDriveHours: z.number({ error: 'Enter hours, or choose no limit' }).min(0.5, 'At least 30 minutes').max(24, 'At most 24 hours').nullable(),
  willingToFly: z.boolean(),
  originAirports: z.array(z.string().regex(/^[A-Z]{3}$/, 'Unknown airport')).max(8, 'Keep up to 8 airports'),
  winterBufferPct: z.number({ error: 'Enter a percentage' }).int('Whole percent').min(0, '0 % or more').max(100, 'At most 100 %'),
})
export type TravelInput = z.input<typeof TravelInput>

export async function saveTravel(input: TravelInput): Promise<ActionResult<TravelPrefs>> {
  const parsed = TravelInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const codes = [...new Set(v.originAirports)]
  if (codes.length !== v.originAirports.length) return fail('Each airport once', { originAirports: 'Each airport once' })
  const { ctx, prefs } = await currentPrefs()
  if (codes.length) {
    const known = await ctx.db.select({ iata: s.airports.iata }).from(s.airports).where(inArray(s.airports.iata, codes))
    if (known.length !== codes.length) return fail('Unknown airport', { originAirports: 'Choose airports from the list' })
  }
  const travel: TravelPrefs = {
    ...prefs.travel,
    maxDriveHours: v.maxDriveHours === null ? null : Math.round(v.maxDriveHours * 4) / 4,
    willingToFly: v.willingToFly,
    originAirports: codes,
    winterBufferPct: v.winterBufferPct,
  }
  await writePrefs({ travel })
  revalidateAll()
  return { ok: true, data: travel, message: 'Travel preferences saved' }
}

// ---------------------------------------------------------------------------
// Gear, budget & lodging

/** Amount in major units as typed ("120", "1,250.50"); stored as integer minor units of the budget currency. */
const Major = z
  .string()
  .trim()
  .transform((v) => v.replace(/,/g, ''))
  .pipe(z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount like 120 or 120.50'))

const CostsInput = z.object({
  gear: z.object({
    ownsSkis: z.boolean(),
    ownsBoots: z.boolean(),
    ownsHelmet: z.boolean(),
    rentalOption: z.enum(['full-package', 'skis-only', 'boots-only', 'none']),
  }),
  budget: z.object({
    currency: z.enum(BUDGET_CURRENCIES),
    dayBudget: Major.nullable(),
    seasonBudget: Major.nullable(),
    lunchEstimate: Major,
  }),
  lodgingStyle: z.enum(LODGING_STYLES).nullable(),
})
export type CostsInput = z.input<typeof CostsInput>

export async function saveCosts(input: CostsInput): Promise<ActionResult<{ gear: GearPrefs; budget: BudgetPrefs; lodgingStyle: string | null }>> {
  const parsed = CostsInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { prefs } = await currentPrefs()
  const cur = v.budget.currency
  const gear: GearPrefs = { ...prefs.gear, ...v.gear }
  const budget: BudgetPrefs = {
    ...prefs.budget,
    currency: cur,
    dayBudgetMinor: v.budget.dayBudget === null ? null : fromMajor(v.budget.dayBudget, cur).amountMinor,
    seasonBudgetMinor: v.budget.seasonBudget === null ? null : fromMajor(v.budget.seasonBudget, cur).amountMinor,
    lunchEstimateMinor: fromMajor(v.budget.lunchEstimate, cur).amountMinor,
  }
  await writePrefs({ gear, budget, lodgingStyle: v.lodgingStyle })
  revalidateAll()
  return { ok: true, data: { gear, budget, lodgingStyle: v.lodgingStyle }, message: 'Gear, budget and lodging saved' }
}

// ---------------------------------------------------------------------------
// Recommendation weights

const Weight = z.number().int('Whole numbers').min(0, '0 or more').max(100, 'At most 100')
const WeightsInput = z
  .object({ conditions: Weight, fit: Weight, travel: Weight, cost: Weight, events: Weight })
  .refine((w) => w.conditions + w.fit + w.travel + w.cost + w.events > 0, { message: 'Give at least one factor some weight', path: ['conditions'] })

export async function saveWeights(input: RecommendationWeights): Promise<ActionResult<RecommendationWeights>> {
  const parsed = WeightsInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  await writePrefs({ weights: parsed.data })
  revalidateAll()
  return { ok: true, data: parsed.data, message: 'Recommendation weights saved' }
}

// ---------------------------------------------------------------------------
// Theme

export async function saveTheme(input: { theme: string }): Promise<ActionResult<{ theme: (typeof THEMES)[number] }>> {
  const parsed = z.object({ theme: z.enum(THEMES) }).safeParse(input)
  if (!parsed.success) return zodFail(parsed.error, 'Unknown theme')
  await writePrefs({ theme: parsed.data.theme })
  revalidateAll()
  return { ok: true, data: parsed.data, message: parsed.data.theme === 'system' ? 'Theme follows your system' : `Theme: ${parsed.data.theme}` }
}

// ---------------------------------------------------------------------------
// Alert rules (in-app only)

const RuleType = z.enum(ALERT_TYPES)
const ResortId = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Unknown resort')
const Cooldown = z.number().int('Whole hours').min(0, '0 hours or more').max(168, 'At most a week (168 h)')

function parseParams(type: AlertType, params: unknown): { ok: true; params: Record<string, unknown> } | { ok: false; fieldErrors: Record<string, string> } {
  const r = RULE_PARAMS[type].safeParse(params ?? {})
  if (r.success) return { ok: true, params: r.data as Record<string, unknown> }
  const fieldErrors: Record<string, string> = {}
  for (const i of r.error.issues) fieldErrors[`params.${i.path.join('.')}`] ??= i.message
  return { ok: false, fieldErrors }
}

async function checkScope(type: AlertType, resortId: string | null): Promise<string | null> {
  if (resortId === null) return null
  if (GLOBAL_ONLY_ALERTS.includes(type)) return 'This alert covers every pass product; it has no resort'
  const { db } = await getCtx()
  const [r] = await db.select({ id: s.resorts.id }).from(s.resorts).where(eq(s.resorts.id, resortId))
  return r ? null : 'Unknown resort'
}

const RuleInput = z.object({
  type: RuleType,
  resortId: ResortId.nullable(),
  params: z.record(z.string(), z.unknown()),
  cooldownHours: Cooldown,
  enabled: z.boolean(),
})
export type AlertRuleInput = z.input<typeof RuleInput>

export async function createAlertRule(input: AlertRuleInput): Promise<ActionResult<AlertRuleRow>> {
  const parsed = RuleInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const scope = await checkScope(v.type, v.resortId)
  if (scope) return fail(scope, { resortId: scope })
  const p = parseParams(v.type, v.params)
  if (!p.ok) return fail('Please check the highlighted fields', p.fieldErrors)
  const { db, now } = await getCtx()
  const [row] = await db.insert(s.alertRules).values({ type: v.type, resortId: v.resortId, params: p.params, enabled: v.enabled, cooldownHours: v.cooldownHours, createdAt: now }).returning()
  revalidatePath('/settings')
  return { ok: true, data: row, message: 'Alert rule added' }
}

const RulePatch = z.object({
  id: z.number().int().positive(),
  resortId: ResortId.nullable().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  cooldownHours: Cooldown.optional(),
  enabled: z.boolean().optional(),
})
export type AlertRulePatch = z.input<typeof RulePatch>

export async function updateAlertRule(input: AlertRulePatch): Promise<ActionResult<AlertRuleRow>> {
  const parsed = RulePatch.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db } = await getCtx()
  const [rule] = await db.select().from(s.alertRules).where(eq(s.alertRules.id, v.id))
  if (!rule) return fail('That alert rule no longer exists')
  const set: Partial<AlertRuleRow> = {}
  if (v.resortId !== undefined) {
    const scope = await checkScope(rule.type, v.resortId)
    if (scope) return fail(scope, { resortId: scope })
    set.resortId = v.resortId
  }
  if (v.params !== undefined) {
    const p = parseParams(rule.type, v.params)
    if (!p.ok) return fail('Please check the highlighted fields', p.fieldErrors)
    set.params = p.params
  }
  if (v.cooldownHours !== undefined) set.cooldownHours = v.cooldownHours
  if (v.enabled !== undefined) set.enabled = v.enabled
  if (!Object.keys(set).length) return { ok: true, data: rule }
  const [row] = await db.update(s.alertRules).set(set).where(eq(s.alertRules.id, v.id)).returning()
  revalidatePath('/settings')
  return { ok: true, data: row, message: v.enabled === undefined || Object.keys(set).length > 1 ? 'Alert rule saved' : v.enabled ? 'Alert rule on' : 'Alert rule paused' }
}

export async function deleteAlertRule(input: { id: number }): Promise<ActionResult<AlertRuleRow>> {
  const parsed = z.object({ id: z.number().int().positive() }).safeParse(input)
  if (!parsed.success) return fail('Unknown alert rule')
  const { db } = await getCtx()
  const [row] = await db.delete(s.alertRules).where(eq(s.alertRules.id, parsed.data.id)).returning()
  if (!row) return fail('That alert rule no longer exists')
  revalidatePath('/settings')
  return { ok: true, data: row, message: 'Alert rule deleted' }
}

/** Undo for delete: the same rule back under its old id, so alerts it fired stay linked to it. */
export async function restoreAlertRule(input: AlertRuleRow): Promise<ActionResult<AlertRuleRow>> {
  const parsed = RuleInput.extend({ id: z.number().int().positive(), lastFiredAt: z.string().nullable(), createdAt: z.string() }).safeParse(input)
  if (!parsed.success) return fail('That rule could not be restored')
  const v = parsed.data
  const p = parseParams(v.type, v.params)
  if (!p.ok) return fail('That rule could not be restored')
  const { db } = await getCtx()
  const [taken] = await db.select({ id: s.alertRules.id }).from(s.alertRules).where(eq(s.alertRules.id, v.id))
  const values = { type: v.type, resortId: v.resortId, params: p.params, enabled: v.enabled, cooldownHours: v.cooldownHours, lastFiredAt: v.lastFiredAt, createdAt: v.createdAt }
  const [row] = await db
    .insert(s.alertRules)
    .values(taken ? values : { id: v.id, ...values })
    .returning()
  revalidatePath('/settings')
  return { ok: true, data: row, message: 'Alert rule restored' }
}

/** Create the default rules (per favourite and global) now instead of waiting for the next alerts run. */
export async function addDefaultAlertRules(): Promise<ActionResult<{ created: number }>> {
  const { db, now } = await getCtx()
  const created = await ensureDefaultAlertRules(db, now)
  revalidatePath('/settings')
  return created
    ? { ok: true, data: { created }, message: `${created} default alert rule${created === 1 ? '' : 's'} added` }
    : { ok: true, data: { created }, message: 'Default rules already exist for your favourites — nothing added' }
}
