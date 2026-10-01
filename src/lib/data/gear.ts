/**
 * Gear locker read model: what I own (newest first), my avatar's look, and what the locker covers for packing and
 * own-vs-rent. `ownedGearCoverage` is the entry point for other screens (trip packing checklist, rental basket):
 * an empty locker means nothing is owned, so rental stays in every budget.
 */
import 'server-only'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import type { AvatarPrefs, AvatarSlot, GearType } from '@/lib/db/schema'
import { avatarOf, GEAR_CODE, GEAR_SLOT, GEAR_TYPE_LABEL, gearCoverage, type GearCoverage } from '@/lib/domain/gear'
import type { DataCtx } from './core'

export interface GearItemView {
  id: number
  type: GearType
  typeLabel: string
  code: string
  brandModel: string
  size: string | null
  boughtOn: string | null
  notes: string | null
  color: string | null
  photo: string | null
  /** Avatar slot it can be worn in (null: not drawn on the avatar). */
  slot: AvatarSlot | null
  worn: boolean
  createdAt: string
}

export interface GearLocker {
  items: GearItemView[]
  avatar: AvatarPrefs
  coverage: GearCoverage
}

export async function getGearLocker(ctx: Pick<DataCtx, 'db' | 'prefs'>): Promise<GearLocker> {
  const rows = await ctx.db.select().from(s.gear).orderBy(desc(s.gear.createdAt), desc(s.gear.id))
  const avatar = avatarOf(ctx.prefs.avatar)
  const worn = new Set(Object.values(avatar.wearing))
  // Forget worn ids whose item is gone (e.g. removed in another tab).
  const ids = new Set(rows.map((r) => r.id))
  avatar.wearing = Object.fromEntries(Object.entries(avatar.wearing).filter(([, id]) => ids.has(id as number))) as AvatarPrefs['wearing']
  const items: GearItemView[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    typeLabel: GEAR_TYPE_LABEL[r.type],
    code: GEAR_CODE[r.type],
    brandModel: r.brandModel,
    size: r.size,
    boughtOn: r.boughtOn,
    notes: r.notes,
    color: r.color,
    photo: r.photo,
    slot: GEAR_SLOT[r.type],
    worn: worn.has(r.id),
    createdAt: r.createdAt,
  }))
  return { items, avatar, coverage: gearCoverage(rows) }
}

/** What the gear locker covers — for trip packing lists and the own-vs-rent basket. */
export async function ownedGearCoverage(db: Db): Promise<GearCoverage> {
  const rows = await db.select({ type: s.gear.type, brandModel: s.gear.brandModel }).from(s.gear)
  return gearCoverage(rows)
}

/** My avatar prefs (defaults when never customised) — for Today's hero. */
export async function loadAvatar(db: Db): Promise<AvatarPrefs> {
  const [row] = await db.select({ avatar: s.userPreferences.avatar }).from(s.userPreferences).where(eq(s.userPreferences.id, 1))
  return avatarOf(row?.avatar)
}
