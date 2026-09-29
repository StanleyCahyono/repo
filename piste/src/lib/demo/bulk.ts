/**
 * Fast bulk inserts for the demo generator (~175k weather points). Drizzle's insert builder costs ~30 µs per row;
 * multi-row INSERTs sent through libsql's `batch` (one write transaction) are ~4× faster. Column names and value
 * encoding (JSON text, boolean integers) come from the Drizzle table definition, so this stays in sync with the
 * schema. Falls back to Drizzle when the raw client is not reachable.
 */
import type { Client, InStatement, InValue } from '@libsql/client'
import { getTableColumns, getTableName } from 'drizzle-orm'
import type { SQLiteInsertValue, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Db } from '@/lib/db/client'

function rawClient(db: Db): Client | null {
  const c = (db as unknown as { $client?: Client }).$client
  return c && typeof c.batch === 'function' ? c : null
}

/** Insert rows that all set the same keys (columns left out get their SQL default). */
export async function bulkInsert<T extends SQLiteTable>(db: Db, table: T, rows: readonly T['$inferInsert'][], opts: { rowsPerStatement?: number; statementsPerBatch?: number } = {}): Promise<number> {
  if (rows.length === 0) return 0
  const columns = getTableColumns(table) as Record<string, { name: string; mapToDriverValue(v: unknown): unknown }>
  const first = rows[0] as Record<string, unknown>
  const keys = Object.keys(first).filter((k) => first[k] !== undefined && columns[k])
  const client = rawClient(db)
  if (!client) {
    for (let i = 0; i < rows.length; i += 200) await db.insert(table).values(rows.slice(i, i + 200) as SQLiteInsertValue<T>[])
    return rows.length
  }
  const per = opts.rowsPerStatement ?? Math.max(1, Math.min(400, Math.floor(30000 / keys.length)))
  const perBatch = opts.statementsPerBatch ?? 100
  const colSql = keys.map((k) => `"${columns[k].name}"`).join(', ')
  const tuple = `(${keys.map(() => '?').join(', ')})`
  const encode = (row: Record<string, unknown>): InValue[] =>
    keys.map((k) => {
      const v = row[k]
      if (v === null || v === undefined) return null
      return columns[k].mapToDriverValue(v) as InValue
    })
  let stmts: InStatement[] = []
  const flush = async () => {
    if (stmts.length) await client.batch(stmts, 'write')
    stmts = []
  }
  for (let i = 0; i < rows.length; i += per) {
    const part = rows.slice(i, i + per) as Record<string, unknown>[]
    stmts.push({ sql: `insert into "${getTableName(table)}" (${colSql}) values ${part.map(() => tuple).join(', ')}`, args: part.flatMap(encode) })
    if (stmts.length >= perBatch) await flush()
  }
  await flush()
  return rows.length
}
