import { describe, expect, it } from 'vitest'
import { asc } from 'drizzle-orm'
import { createMemoryDb, type Db } from '@/lib/db/client'
import { alertRules } from '@/lib/db/schema'
import { bulkInsert } from './bulk'

// JSON, boolean, nullable and defaulted columns (cooldownHours and lastFiredAt are left out).
const rows = Array.from({ length: 1003 }, (_, i) => ({
  type: 'snow-threshold' as const,
  resortId: i % 3 === 0 ? null : `resort-${i}`,
  params: { thresholdCm: i % 40, nested: { list: [i, `x${i}`] } },
  enabled: i % 2 === 0,
  createdAt: `2026-12-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
}))

/** The same database without the raw libsql client, so bulkInsert takes its Drizzle fallback. */
const withoutRawClient = (db: Db): Db => Object.create(db, { $client: { value: undefined } }) as Db

describe('demo bulkInsert', () => {
  it('writes the same rows through raw multi-row batches and through the Drizzle fallback', async () => {
    const fast = (await createMemoryDb()).db
    const fallback = (await createMemoryDb()).db
    // Small statements and batches so several flushes happen.
    expect(await bulkInsert(fast, alertRules, rows, { rowsPerStatement: 7, statementsPerBatch: 3 })).toBe(rows.length)
    expect(await bulkInsert(withoutRawClient(fallback), alertRules, rows)).toBe(rows.length)
    const a = await fast.select().from(alertRules).orderBy(asc(alertRules.id))
    const b = await fallback.select().from(alertRules).orderBy(asc(alertRules.id))
    expect(a).toHaveLength(rows.length)
    expect(b).toEqual(a)
    expect(a[3]).toMatchObject({ resortId: null, enabled: false, params: rows[3].params })
    expect(a[4]).toMatchObject({ resortId: 'resort-4', enabled: true, params: rows[4].params, cooldownHours: 12, lastFiredAt: null })
  })

  it('does nothing for no rows', async () => {
    const db = (await createMemoryDb()).db
    expect(await bulkInsert(db, alertRules, [])).toBe(0)
    expect(await db.select().from(alertRules)).toEqual([])
  })
})
