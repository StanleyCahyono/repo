'use server'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getCtx } from '@/lib/context'
import { favorites, resorts } from '@/lib/db/schema'

const Id = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/)

/** Toggle a favourite; returns the new state. */
export async function toggleFavorite(resortId: string, on: boolean): Promise<{ favorite: boolean }> {
  const id = Id.parse(resortId)
  const { db, now } = await getCtx()
  const exists = await db.select({ id: resorts.id }).from(resorts).where(eq(resorts.id, id))
  if (!exists.length) throw new Error('Unknown resort')
  if (on) {
    await db.insert(favorites).values({ resortId: id, addedAt: now }).onConflictDoNothing()
  } else {
    await db.delete(favorites).where(eq(favorites.resortId, id))
  }
  revalidatePath('/', 'layout')
  return { favorite: on }
}
