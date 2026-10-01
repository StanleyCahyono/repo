/**
 * Per-request server context: which database (live vs demo), the app clock, and the user's preferences.
 * Every server component / action / route handler that touches data should start with `await getCtx()`.
 */
import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db/client'
import { userPreferences } from '@/lib/db/schema'
import type { UserPreferencesRow } from '@/lib/db/rows'
import type { AppMode } from '@/lib/domain/types'
import { nowFor } from '@/lib/clock'
import { localDateOf } from '@/lib/domain/time'
import { defaultPreferences } from '@/lib/domain/defaults'

export const MODE_COOKIE = 'piste-mode'

export interface Ctx {
  mode: AppMode
  db: Db
  /** ISO instant — real time in live mode, simulated in demo mode. */
  now: string
  /** Local date at the user's home location. */
  today: string
  prefs: UserPreferencesRow
}

export async function getMode(): Promise<AppMode> {
  const store = await cookies()
  return store.get(MODE_COOKIE)?.value === 'demo' ? 'demo' : 'live'
}

export async function loadPreferences(db: Db, now: string): Promise<UserPreferencesRow> {
  const rows = await db.select().from(userPreferences).where(eq(userPreferences.id, 1))
  if (rows[0]) return rows[0]
  const defaults = defaultPreferences(now)
  await db.insert(userPreferences).values(defaults).onConflictDoNothing()
  return defaults
}

/** Memoised per request. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const mode = await getMode()
  const db = await getDb(mode)
  const now = nowFor(mode)
  const prefs = await loadPreferences(db, now)
  return { mode, db, now, today: localDateOf(now, prefs.homeTimezone), prefs }
})
