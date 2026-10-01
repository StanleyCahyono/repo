/** Small helpers shared by jobs. Server-side only (uses node:crypto). */
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { Db } from '@/lib/db/client'
import { appMeta, favorites, resorts } from '@/lib/db/schema'
import type { ResortRow } from '@/lib/db/rows'

/** JSON with object keys sorted recursively, so equal content always hashes equally. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined) out[k] = sortKeys(x)
    }
    return out
  }
  return v
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function hashJson(value: unknown): string {
  return sha256(stableStringify(value))
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : JSON.stringify(e)
}

export function truncate(s: string, max = 2000): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

export function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/** Canonical UTC ISO (`2027-01-15T14:00:00.000Z`) or null when unparseable. A string without offset is UTC. */
export function canonicalInstant(s: string): string | null {
  const dt = DateTime.fromISO(s, { zone: 'utc', setZone: true })
  return dt.isValid ? dt.toUTC().toISO() : null
}

export function minutesAfter(instant: string, minutes: number): string {
  return DateTime.fromISO(instant, { zone: 'utc' }).plus({ minutes }).toUTC().toISO()!
}

export function daysBefore(instant: string, days: number): string {
  return DateTime.fromISO(instant, { zone: 'utc' }).minus({ days }).toUTC().toISO()!
}

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const r = await db.select({ v: appMeta.value }).from(appMeta).where(eq(appMeta.key, key))
  return r[0]?.v ?? null
}

export async function setMeta(db: Db, key: string, value: string, now: string): Promise<void> {
  await db.insert(appMeta).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: now } })
}

/** Resorts to process: the requested ids (in that order) or all resorts, favorites first, then by priority. */
export async function selectResorts(db: Db, ids?: readonly string[] | null): Promise<ResortRow[]> {
  const all = await db.select().from(resorts)
  if (ids && ids.length > 0) {
    const byId = new Map(all.map((r) => [r.id, r]))
    return ids.map((id) => byId.get(id)).filter((r): r is ResortRow => !!r)
  }
  const favs = await db.select().from(favorites)
  const favOrder = new Map(favs.map((f) => [f.resortId, f.sortOrder]))
  return all.sort((a, b) => {
    const fa = favOrder.has(a.id) ? 0 : 1
    const fb = favOrder.has(b.id) ? 0 : 1
    if (fa !== fb) return fa - fb
    if (fa === 0) return (favOrder.get(a.id) ?? 0) - (favOrder.get(b.id) ?? 0)
    return b.priority - a.priority || a.id.localeCompare(b.id)
  })
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
