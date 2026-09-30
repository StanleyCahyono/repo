'use server'
/**
 * Manual corrections to catalog fields (resort_overrides), used from Settings and Sources & Sync.
 *
 * - A correction is a new row (resort, field, value, source link, note); the newest row per field is applied on read
 *   by `applyOverrides`, which also re-validates it. Rows are never edited in place, so history stays auditable.
 * - Every correction says where it comes from: a source link, a note, or both.
 * - Revert removes the field's rows for that resort (the catalog value returns); Undo puts the same rows back.
 * - Corrections survive catalog re-seeding (seeding never touches resort_overrides).
 */
import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import type { ResortRow, ResortSeasonRow } from '@/lib/db/rows'
import { applyOverrides } from '@/lib/data/core'
import { CORRECTION_FIELDS, correctionField, parseCorrectionValue } from '@/components/sources/correction-fields'

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }

type OverrideRow = typeof s.resortOverrides.$inferSelect

const ResortId = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Unknown resort')

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors }
}

function revalidateCatalog(resortId: string) {
  revalidatePath(`/resorts/${resortId}`)
  revalidatePath('/', 'layout')
}

async function resortAndSeason(resortId: string): Promise<{ resort: ResortRow; season: ResortSeasonRow | null } | null> {
  const { db, prefs } = await getCtx()
  const [resort] = await db.select().from(s.resorts).where(eq(s.resorts.id, resortId))
  if (!resort) return null
  const [season] = await db
    .select()
    .from(s.resortSeasons)
    .where(and(eq(s.resortSeasons.resortId, resortId), eq(s.resortSeasons.seasonId, prefs.activeSeasonId)))
  return { resort, season: season ?? null }
}

// ---------------------------------------------------------------------------

const AddInput = z.object({
  resortId: ResortId,
  field: z.string().min(1).max(60),
  /** As typed; null = set to unknown. */
  raw: z.string().max(5000).nullable(),
  /** Unit an elevation was typed in. */
  unit: z.enum(['ft', 'm']).default('m'),
  sourceUrl: z
    .string()
    .trim()
    .max(500, 'That link is too long')
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), 'Enter the full link, starting with https://'),
  note: z
    .string()
    .trim()
    .max(500, 'Keep the note under 500 characters')
    .nullable()
    .transform((v) => (v ? v : null)),
})
export type AddCorrectionInput = z.input<typeof AddInput>

export async function addCorrection(input: AddCorrectionInput): Promise<ActionResult<OverrideRow>> {
  const parsed = AddInput.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const i of parsed.error.issues) fieldErrors[i.path.join('.') || '_'] ??= i.message
    return fail('Please check the highlighted fields', fieldErrors)
  }
  const v = parsed.data
  const spec = correctionField(v.field)
  if (!spec) return fail('That field cannot be corrected here', { field: 'Choose a field from the list' })
  if (!v.sourceUrl && !v.note) return fail('Say where this comes from', { sourceUrl: 'Add the page you checked, or a note' })
  const value = parseCorrectionValue(spec.kind, v.raw, v.unit)
  if (!value.ok) return fail(value.error, { raw: value.error })

  const target = await resortAndSeason(v.resortId)
  if (!target) return fail('Unknown resort', { resortId: 'Choose a resort' })
  const { db, now } = await getCtx()
  const row = { resortId: v.resortId, field: v.field, value: value.value, note: v.note, sourceUrl: v.sourceUrl, createdAt: now }
  // Same validation as reading it back: refuse anything applyOverrides would reject instead of storing a dud.
  const check = applyOverrides(target.resort, target.season, [{ id: 0, ...row }]).corrections[0]
  if (!check?.applied) return fail(check?.reason ?? 'That value cannot be applied', { raw: check?.reason ?? 'That value cannot be applied' })

  const [saved] = await db.insert(s.resortOverrides).values(row).returning()
  revalidateCatalog(v.resortId)
  return { ok: true, data: saved, message: `${spec.label} corrected for ${target.resort.shortName || target.resort.name}` }
}

/** Undo for add: remove exactly the row just added (earlier corrections of the field stay, the newest applies). */
export async function deleteCorrectionRow(input: { id: number }): Promise<ActionResult<OverrideRow>> {
  const parsed = z.object({ id: z.number().int().positive() }).safeParse(input)
  if (!parsed.success) return fail('Unknown correction')
  const { db } = await getCtx()
  const [row] = await db.delete(s.resortOverrides).where(eq(s.resortOverrides.id, parsed.data.id)).returning()
  if (!row) return fail('That correction was already removed')
  revalidateCatalog(row.resortId)
  return { ok: true, data: row, message: 'Correction removed' }
}

// ---------------------------------------------------------------------------

const FieldRef = z.object({ resortId: ResortId, field: z.string().min(1).max(60) })

/** Remove every correction of one field for one resort (the catalog value returns). Returns the rows for Undo. */
export async function revertCorrection(input: z.input<typeof FieldRef>): Promise<ActionResult<OverrideRow[]>> {
  const parsed = FieldRef.safeParse(input)
  if (!parsed.success) return fail('Unknown correction')
  const { resortId, field } = parsed.data
  const { db } = await getCtx()
  const rows = await db
    .delete(s.resortOverrides)
    .where(and(eq(s.resortOverrides.resortId, resortId), eq(s.resortOverrides.field, field)))
    .returning()
  if (!rows.length) return fail('That correction was already removed')
  revalidateCatalog(resortId)
  return { ok: true, data: rows, message: 'Correction reverted — the catalog value is back' }
}

const RestoreRow = z.object({
  id: z.number().int().positive(),
  resortId: ResortId,
  field: z.string().min(1).max(60),
  value: z.unknown(),
  note: z.string().max(500).nullable(),
  sourceUrl: z.string().max(500).nullable(),
  createdAt: z.string().min(10).max(40),
})

/** Undo for revert: the same rows back (same ids and times), so the history reads as before. */
export async function restoreCorrections(input: z.input<typeof RestoreRow>[]): Promise<ActionResult<number>> {
  const parsed = z.array(RestoreRow).min(1).max(200).safeParse(input)
  if (!parsed.success) return fail('Those corrections could not be restored')
  const rows = parsed.data
  const resortIds = [...new Set(rows.map((r) => r.resortId))]
  const { db } = await getCtx()
  const known = await db.select({ id: s.resorts.id }).from(s.resorts).where(inArray(s.resorts.id, resortIds))
  if (known.length !== resortIds.length) return fail('Unknown resort')
  const taken = new Set((await db.select({ id: s.resortOverrides.id }).from(s.resortOverrides).where(inArray(s.resortOverrides.id, rows.map((r) => r.id)))).map((r) => r.id))
  await db.insert(s.resortOverrides).values(
    rows.map((r) => {
      const base = { resortId: r.resortId, field: r.field, value: r.value ?? null, note: r.note, sourceUrl: r.sourceUrl, createdAt: r.createdAt }
      return taken.has(r.id) ? base : { id: r.id, ...base }
    }),
  )
  for (const id of resortIds) revalidateCatalog(id)
  return { ok: true, data: rows.length, message: 'Correction restored' }
}

// ---------------------------------------------------------------------------

export interface CorrectableValues {
  resortId: string
  name: string
  seasonId: string
  hasSeason: boolean
  /** Current values with corrections applied, keyed by field. */
  current: Record<string, unknown>
  /** Fields that carry a correction now. */
  corrected: string[]
}

/** Current values of every correctable field for one resort (for the correction form). Read-only. */
export async function loadCorrectableValues(input: { resortId: string }): Promise<ActionResult<CorrectableValues>> {
  const parsed = z.object({ resortId: ResortId }).safeParse(input)
  if (!parsed.success) return fail('Unknown resort')
  const target = await resortAndSeason(parsed.data.resortId)
  if (!target) return fail('Unknown resort')
  const { db, prefs } = await getCtx()
  const overrides = await db.select().from(s.resortOverrides).where(eq(s.resortOverrides.resortId, parsed.data.resortId))
  const { resort, season, corrections } = applyOverrides(target.resort, target.season, overrides)
  const groups: Record<string, unknown> = { terrain: resort.terrain, features: resort.features, links: resort.links, season }
  const current: Record<string, unknown> = {}
  for (const { field } of CORRECTION_FIELDS) {
    // 'terrain.liftsByType.gondolas' → group 'terrain', path liftsByType → gondolas.
    const dot = field.indexOf('.')
    const [group, path] = dot > 0 ? [field.slice(0, dot), field.slice(dot + 1)] : [null, field]
    let value: unknown = group === null ? resort : groups[group]
    for (const k of path.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[k] : undefined
    current[field] = value ?? null
  }
  return {
    ok: true,
    data: {
      resortId: resort.id,
      name: resort.name,
      seasonId: prefs.activeSeasonId,
      hasSeason: !!season,
      current,
      corrected: corrections.filter((c) => c.applied).map((c) => c.field),
    },
  }
}
