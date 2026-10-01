/**
 * Database access. Live and demo data live in separate SQLite files so demonstration records can never leak into
 * live recommendations, exports or alerts.
 */
import path from 'node:path'
import fs from 'node:fs'
import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import * as schema from './schema'
import type { AppMode } from '@/lib/domain/types'

export type Db = LibSQLDatabase<typeof schema>

interface Handle {
  client: Client
  db: Db
  ready: Promise<void>
}

const g = globalThis as unknown as { __pisteDb?: Map<string, Handle> }
const handles = (g.__pisteDb ??= new Map())

export function dataDir(): string {
  return process.env.PISTE_DATA_DIR ? path.resolve(process.env.PISTE_DATA_DIR) : path.join(process.cwd(), 'data')
}

export function dbFile(mode: AppMode): string {
  if (mode === 'live' && process.env.PISTE_DB_FILE) return path.resolve(process.env.PISTE_DB_FILE)
  return path.join(dataDir(), mode === 'demo' ? 'piste-demo.db' : 'piste.db')
}

export function migrationsDir(): string {
  return path.join(process.cwd(), 'drizzle')
}

async function prepare(client: Client, db: Db) {
  await client.execute('PRAGMA journal_mode = WAL')
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute('PRAGMA busy_timeout = 5000')
  await migrate(db, { migrationsFolder: migrationsDir() })
}

/** Open (and migrate on first use) the database for a mode. Safe to call repeatedly. */
export async function getDb(mode: AppMode = 'live'): Promise<Db> {
  const file = dbFile(mode)
  let h = handles.get(file)
  if (!h) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const client = createClient({ url: 'file:' + file })
    const db = drizzle(client, { schema })
    h = { client, db, ready: prepare(client, db) }
    handles.set(file, h)
    h.ready.catch(() => handles.delete(file))
  }
  await h.ready
  return h.db
}

/** Test helper: an isolated in-memory database with migrations applied. */
export async function createMemoryDb(): Promise<{ db: Db; client: Client }> {
  const client = createClient({ url: ':memory:' })
  const db = drizzle(client, { schema })
  await client.execute('PRAGMA foreign_keys = ON')
  await migrate(db, { migrationsFolder: migrationsDir() })
  return { db, client }
}

export async function closeAll() {
  for (const [key, h] of handles) {
    h.client.close()
    handles.delete(key)
  }
}

export { schema }
