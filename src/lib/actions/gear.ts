'use server'
/**
 * Gear locker and avatar mutations (My Season).
 *
 * - Gear is what I own: type, brand and model as plain text, size, bought on, notes, an avatar colour and an optional
 *   photo (a small data URL resized on this device; it stays in the local database and is never uploaded anywhere).
 * - Adding or removing skis, boots or a helmet keeps the matching "I own …" flag in my cost preferences in step
 *   (only the flag for that type; nothing else is assumed). The basket's rental option is never changed here.
 * - Avatar prefs are stylised looks only. A manual colour change in a slot clears the item "worn" there.
 * - Writes go to the database of the current mode only (getCtx picks live or demo).
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import { AVATAR_SLOTS, GEAR_TYPES, type AvatarPrefs, type GearPrefs, type GearType } from '@/lib/db/schema'
import { avatarOf, dataUrlBytes, GEAR_SLOT, GEAR_TYPE_LABEL, MAX_PHOTO_BYTES, unwearItem, wearItem } from '@/lib/domain/gear'
import { isLocalDate } from '@/lib/domain/time'

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }

const Id = z.number().int().positive()
const Hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour')
  .transform((v) => v.toLowerCase())
const text = (max: number) =>
  z
    .string()
    .max(max, `Keep it under ${max.toLocaleString('en-US')} characters`)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))
const Photo = z
  .string()
  .max(400_000, 'That photo is too large')
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, 'Use a JPEG, PNG or WebP photo')
  .refine((u) => dataUrlBytes(u) <= MAX_PHOTO_BYTES, 'Photos are kept under 200 KB — try another one')

const GearInput = z.object({
  id: Id.nullish(),
  type: z.enum(GEAR_TYPES, 'Choose a type'),
  brandModel: z.string().trim().min(1, 'Enter the brand and model').max(120, 'Keep it under 120 characters'),
  size: text(40),
  boughtOn: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .refine((v) => v === null || isLocalDate(v), 'Use a date (YYYY-MM-DD)'),
  notes: text(1000),
  color: Hex.nullish().transform((v) => v ?? null),
  photo: Photo.nullish().transform((v) => v ?? null),
  /** Put the item on my avatar (types with an avatar slot only). */
  wear: z.boolean().default(false),
})
export type GearInput = z.input<typeof GearInput>

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors }
}

function zodFail(e: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of e.issues) {
    const key = issue.path.join('.') || '_'
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fail(e.issues.length === 1 ? e.issues[0].message : 'Please check the highlighted fields', fieldErrors)
}

/** The locker feeds My Season, Today's avatar, trip packing and costs. */
function revalidate() {
  revalidatePath('/season')
  revalidatePath('/', 'layout')
}

const OWN_FLAG: Partial<Record<GearType, keyof Pick<GearPrefs, 'ownsSkis' | 'ownsBoots' | 'ownsHelmet'>>> = { skis: 'ownsSkis', boots: 'ownsBoots', helmet: 'ownsHelmet' }

/** Keep the cost prefs' "I own …" flag for these types in step with the locker. */
async function syncOwnFlags(types: GearType[]) {
  const flags = [...new Set(types)].map((t) => [t, OWN_FLAG[t]] as const).filter((x): x is [GearType, NonNullable<(typeof OWN_FLAG)[GearType]>] => !!x[1])
  if (!flags.length) return
  const { db, prefs, now } = await getCtx()
  const rows = await db.select({ type: s.gear.type }).from(s.gear)
  const gear: GearPrefs = { ...prefs.gear }
  let changed = false
  for (const [t, flag] of flags) {
    const owns = rows.some((r) => r.type === t)
    if (gear[flag] !== owns) {
      gear[flag] = owns
      changed = true
    }
  }
  if (changed) {
    await db.update(s.userPreferences).set({ gear, updatedAt: now }).where(eq(s.userPreferences.id, 1))
    prefs.gear = gear
  }
}

async function loadAvatar(): Promise<AvatarPrefs> {
  const { db } = await getCtx()
  const [row] = await db.select({ avatar: s.userPreferences.avatar }).from(s.userPreferences).where(eq(s.userPreferences.id, 1))
  return avatarOf(row?.avatar)
}

async function storeAvatar(a: AvatarPrefs) {
  const { db, now, prefs } = await getCtx()
  await db.update(s.userPreferences).set({ avatar: a, updatedAt: now }).where(eq(s.userPreferences.id, 1))
  prefs.avatar = a
}

/** Add or update a locker item. */
export async function saveGear(input: GearInput): Promise<ActionResult<{ id: number; created: boolean; avatar: AvatarPrefs }>> {
  const parsed = GearInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const { db, now, today } = await getCtx()
  if (v.boughtOn && v.boughtOn > today)
    return fail('Bought on a future date?', {
      boughtOn: `Pick ${today} or earlier`,
    })

  let oldType: GearType | null = null
  if (v.id) {
    const [old] = await db.select({ type: s.gear.type }).from(s.gear).where(eq(s.gear.id, v.id))
    if (!old) return fail('This item is no longer in your locker')
    oldType = old.type
  }
  const values = {
    type: v.type,
    brandModel: v.brandModel,
    size: v.size,
    boughtOn: v.boughtOn,
    notes: v.notes,
    color: v.color,
    photo: v.photo,
    updatedAt: now,
  }
  let id: number
  if (v.id) {
    await db.update(s.gear).set(values).where(eq(s.gear.id, v.id))
    id = v.id
  } else {
    const [row] = await db
      .insert(s.gear)
      .values({ ...values, createdAt: now })
      .returning({ id: s.gear.id })
    id = row.id
  }

  // Wearing: put it on, or (on edit) take it off / out of a slot its new type no longer fits.
  let avatar = await loadAvatar()
  const before = JSON.stringify(avatar)
  avatar = unwearItem(avatar, id)
  if (v.wear && GEAR_SLOT[v.type]) avatar = wearItem(avatar, { id, type: v.type, color: v.color })
  if (JSON.stringify(avatar) !== before) await storeAvatar(avatar)

  await syncOwnFlags([v.type, ...(oldType ? [oldType] : [])])
  revalidate()
  return {
    ok: true,
    data: { id, created: !v.id, avatar },
    message: `${v.id ? 'Updated' : 'Added'} ${GEAR_TYPE_LABEL[v.type].toLowerCase()} · ${v.brandModel}`,
  }
}

const GearSnapshot = z.object({
  id: Id,
  type: z.enum(GEAR_TYPES),
  brandModel: z.string().min(1).max(120),
  size: z.string().max(40).nullable(),
  boughtOn: z.string().max(10).nullable(),
  notes: z.string().max(1000).nullable(),
  color: z.string().max(7).nullable(),
  photo: Photo.nullable(),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  /** The slot it was worn in, if any (restored with it). */
  wornIn: z.enum(AVATAR_SLOTS).nullable().default(null),
})
export type GearSnapshot = z.output<typeof GearSnapshot>

/** Remove an item (and take it off the avatar). Returns a snapshot for Undo. */
export async function deleteGear(input: { id: number }): Promise<ActionResult<{ snapshot: GearSnapshot }>> {
  const id = Id.safeParse(input?.id)
  if (!id.success) return fail('Unknown item')
  const { db } = await getCtx()
  const [row] = await db.select().from(s.gear).where(eq(s.gear.id, id.data))
  if (!row) return fail('This item is no longer in your locker')
  const avatar = await loadAvatar()
  const wornIn = (Object.entries(avatar.wearing).find(([, v]) => v === row.id)?.[0] ?? null) as GearSnapshot['wornIn']
  await db.delete(s.gear).where(eq(s.gear.id, row.id))
  if (wornIn) await storeAvatar(unwearItem(avatar, row.id))
  await syncOwnFlags([row.type])
  revalidate()
  return {
    ok: true,
    data: { snapshot: { ...row, wornIn } },
    message: `Removed ${row.brandModel}`,
  }
}

export async function restoreGear(input: { snapshot: GearSnapshot }): Promise<ActionResult<{ id: number }>> {
  const parsed = GearSnapshot.safeParse(input?.snapshot)
  if (!parsed.success) return fail('Could not restore this item')
  const { id, wornIn, ...rest } = parsed.data
  const { db } = await getCtx()
  const [taken] = await db.select({ id: s.gear.id }).from(s.gear).where(eq(s.gear.id, id))
  const [row] = await db
    .insert(s.gear)
    .values({ ...(taken ? {} : { id }), ...rest })
    .returning({ id: s.gear.id })
  if (wornIn) {
    const avatar = await loadAvatar()
    if (avatar.wearing[wornIn] == null)
      await storeAvatar({
        ...avatar,
        wearing: { ...avatar.wearing, [wornIn]: row.id },
      })
  }
  await syncOwnFlags([rest.type])
  revalidate()
  return { ok: true, data: { id: row.id }, message: 'Item restored' }
}

/** Put a locker item on the avatar, or take it off. */
export async function setWearing(input: { id: number; wear: boolean }): Promise<ActionResult<{ avatar: AvatarPrefs }>> {
  const parsed = z.object({ id: Id, wear: z.boolean() }).safeParse(input)
  if (!parsed.success) return fail('Unknown item')
  const { db } = await getCtx()
  const [row] = await db.select().from(s.gear).where(eq(s.gear.id, parsed.data.id))
  if (!row) return fail('This item is no longer in your locker')
  if (!GEAR_SLOT[row.type]) return fail(`${GEAR_TYPE_LABEL[row.type]} is not drawn on the avatar`)
  let avatar = unwearItem(await loadAvatar(), row.id)
  if (parsed.data.wear) avatar = wearItem(avatar, row)
  await storeAvatar(avatar)
  revalidate()
  return {
    ok: true,
    data: { avatar },
    message: parsed.data.wear ? `Wearing ${row.brandModel}` : `Took off ${row.brandModel}`,
  }
}

const AvatarInput = z.object({
  look: z.enum(['suit', 'holo']).optional(),
  colors: z.partialRecord(z.enum(AVATAR_SLOTS), Hex).optional(),
  backpack: z.boolean().optional(),
  poles: z.boolean().optional(),
})
export type AvatarInput = z.input<typeof AvatarInput>

/** Change the avatar's look, colours or accessories. A manual colour clears the item worn in that slot. */
export async function saveAvatar(input: AvatarInput): Promise<ActionResult<{ avatar: AvatarPrefs }>> {
  const parsed = AvatarInput.safeParse(input)
  if (!parsed.success) return zodFail(parsed.error)
  const v = parsed.data
  const a = await loadAvatar()
  const wearing = { ...a.wearing }
  for (const slot of Object.keys(v.colors ?? {}) as (keyof typeof wearing)[]) delete wearing[slot]
  if (v.backpack === false) delete wearing.backpack
  if (v.poles === false) delete wearing.poles
  const next: AvatarPrefs = {
    look: v.look ?? a.look,
    colors: { ...a.colors, ...(v.colors ?? {}) },
    backpack: v.backpack ?? a.backpack,
    poles: v.poles ?? a.poles,
    wearing,
  }
  await storeAvatar(next)
  revalidate()
  return { ok: true, data: { avatar: next } }
}

/** Back to the default look (keeps the locker). */
export async function resetAvatar(): Promise<ActionResult<{ avatar: AvatarPrefs }>> {
  const avatar = avatarOf(null)
  await storeAvatar(avatar)
  revalidate()
  return { ok: true, data: { avatar }, message: 'Avatar reset' }
}
