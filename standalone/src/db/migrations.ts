/**
 * Apply the embedded drizzle migrations exactly as drizzle's libsql migrator would (same bookkeeping table, same
 * hashes, same timestamps), so a database made here is interchangeable with one made by `npm run db:setup`.
 *
 * Stricter than drizzle on one point: the migrations already recorded in a database must be a prefix of the embedded
 * ones. Piste regenerates its single init migration when the schema changes, so data saved by an older build of this
 * file cannot be migrated in place — the caller shows a recovery screen instead of crashing.
 */
import { migrations } from 'virtual:piste/migrations'
import type { SqlJsClient } from './sqljs-client'

export type MigrationStatus =
  | { kind: 'fresh' | 'current' | 'upgraded' }
  | { kind: 'mismatch'; detail: string }

const TABLE = '"__drizzle_migrations"'

export async function migrateDatabase(client: SqlJsClient): Promise<MigrationStatus> {
  const existing = await client.execute(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`)
  const hasTable = Number(existing.rows[0]?.n ?? 0) > 0
  const applied = hasTable ? (await client.execute(`SELECT hash, created_at FROM ${TABLE} ORDER BY created_at ASC, id ASC`)).rows : []

  for (let i = 0; i < applied.length; i++) {
    const m = migrations[i]
    const row = applied[i]
    if (!m) return { kind: 'mismatch', detail: `the saved data has ${applied.length} schema migrations, this file knows ${migrations.length}` }
    if (m.hash !== row.hash || Number(row.created_at) !== m.when) {
      return { kind: 'mismatch', detail: `schema migration ${i + 1} differs (saved ${String(row.hash).slice(0, 8)}, this file ${m.hash.slice(0, 8)})` }
    }
  }

  if (!applied.length) {
    const tables = await client.execute(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`)
    if (Number(tables.rows[0]?.n ?? 0) > 0) return { kind: 'mismatch', detail: 'the saved data has tables but no migration record' }
  }

  const todo = migrations.slice(applied.length)
  if (!todo.length) return { kind: 'current' }
  await client.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`)
  await client.migrate(
    todo.flatMap((m) => [
      ...m.statements.map((sql) => ({ sql, args: [] })),
      { sql: `INSERT INTO ${TABLE} ("hash", "created_at") VALUES(?, ?)`, args: [m.hash, m.when] },
    ]),
  )
  return { kind: applied.length ? 'upgraded' : 'fresh' }
}

/** Check an imported file without touching the open databases. */
export async function inspectMigrations(client: SqlJsClient): Promise<{ ok: true } | { ok: false; reason: string }> {
  const t = await client.execute(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`)
  if (!Number(t.rows[0]?.n ?? 0)) return { ok: false, reason: 'This file is not a Piste database (no schema record).' }
  const rows = (await client.execute(`SELECT hash, created_at FROM ${TABLE} ORDER BY created_at ASC, id ASC`)).rows
  if (rows.length !== migrations.length || rows.some((r, i) => r.hash !== migrations[i].hash || Number(r.created_at) !== migrations[i].when)) {
    return { ok: false, reason: 'This Piste database was made by a different version (its schema differs from this file’s). It cannot be imported here.' }
  }
  return { ok: true }
}
