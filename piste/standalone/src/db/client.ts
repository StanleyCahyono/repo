/**
 * Browser replacement for src/lib/db/client.ts (the bundler redirects every import of that file here).
 *
 * Same exports and the same contract — `getDb(mode)` returns a Drizzle libsql database, live and demo are two separate
 * databases that never share a row — but each database is SQLite in WebAssembly (sql.js), kept in memory and saved to
 * IndexedDB about a second after each write (and when the page is hidden). Standalone-only helpers (export, import,
 * reset, hold) are exported for the runtime.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmBytes from 'sql.js/dist/sql-wasm-browser.wasm'
import * as driverCore from 'drizzle-orm/libsql/driver-core'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { BUILD_INFO } from 'virtual:piste/build-info'
import * as schema from '@/lib/db/schema'
import type { AppMode } from '@/lib/domain/types'
import { inspectMigrations, migrateDatabase } from './migrations'
import { SqlJsClient } from './sqljs-client'
import { canWrite } from '../runtime/tab-owner'
import { databaseExists, deleteDatabase, loadDatabase, saveDatabase, storageAvailable } from './storage'

export type Db = LibSQLDatabase<typeof schema>

/**
 * drizzle's libsql driver without @libsql/client: driver-core.js exports `construct(client, config)` (drizzle() in
 * driver.js is a thin wrapper over it), but driver-core.d.ts only declares LibSQLDatabase — hence the typed cast.
 */
const construct = (driverCore as unknown as { construct: (client: unknown, config: { schema: typeof schema }) => Db }).construct

/** Thrown by getDb when saved data was written by a build with a different schema. */
export class SchemaMismatchError extends Error {
  constructor(
    readonly mode: AppMode,
    readonly detail: string,
    readonly savedBytes: Uint8Array | null,
  ) {
    super(`The ${mode} data saved in this browser has a different schema: ${detail}`)
    this.name = 'SchemaMismatchError'
  }
}

interface Handle {
  mode: AppMode
  client: SqlJsClient
  db: Db
  dirty: boolean
  /** While true, writes do not schedule saves (demo generation saves once at the end). */
  hold: boolean
  timer: ReturnType<typeof setTimeout> | null
  saving: Promise<void> | null
  savedAt: string | null
  size: number
}

let sqlPromise: Promise<SqlJsStatic> | null = null
export function sqlite(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ wasmBinary: wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer })
  return sqlPromise
}

const handles = new Map<AppMode, Promise<Handle>>()
const opened = new Map<AppMode, Handle>()
type SaveListener = (e: { mode: AppMode; ok: boolean; error?: string }) => void
const saveListeners = new Set<SaveListener>()
export function onSave(fn: SaveListener) {
  saveListeners.add(fn)
  return () => saveListeners.delete(fn)
}

/** Saves trail the last write by this much (a burst of statements from one action becomes one save). */
const SAVE_DELAY_MS = 300

function markDirty(h: Handle) {
  h.dirty = true
  if (h.hold) return
  if (h.timer) clearTimeout(h.timer)
  h.timer = setTimeout(() => {
    h.timer = null
    void save(h)
  }, SAVE_DELAY_MS)
}

async function exportRaw(client: SqlJsClient): Promise<Uint8Array> {
  return client.exclusive((db) => {
    const bytes = db.export()
    // export() closes and reopens the connection: connection settings are back to defaults.
    db.run('PRAGMA foreign_keys = ON')
    return bytes
  })
}

async function save(h: Handle): Promise<void> {
  if (h.saving) {
    await h.saving
    if (!h.dirty) return
  }
  // Another tab owns the data now: never overwrite its saves with this tab's copy.
  if (!canWrite() || !(await storageAvailable())) return
  h.dirty = false
  h.saving = (async () => {
    try {
      const bytes = await exportRaw(h.client)
      const savedAt = new Date().toISOString()
      await saveDatabase(h.mode, { bytes, schemaId: BUILD_INFO.schemaId, savedAt, size: bytes.byteLength })
      h.savedAt = savedAt
      h.size = bytes.byteLength
      for (const l of saveListeners) l({ mode: h.mode, ok: true })
    } catch (e) {
      h.dirty = true
      for (const l of saveListeners) l({ mode: h.mode, ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      h.saving = null
    }
  })()
  await h.saving
}

async function wrap(mode: AppMode, raw: Database, fresh: boolean): Promise<Handle> {
  const client = new SqlJsClient(raw)
  const db = construct(client as never, { schema }) as unknown as Db
  raw.run('PRAGMA foreign_keys = ON')
  const status = await migrateDatabase(client)
  if (status.kind === 'mismatch') {
    const bytes = fresh ? null : raw.export()
    client.close()
    throw new SchemaMismatchError(mode, status.detail, bytes)
  }
  const h: Handle = { mode, client, db, dirty: false, hold: false, timer: null, saving: null, savedAt: null, size: 0 }
  client.hooks.onWrite = () => markDirty(h)
  // A fresh demo database is not worth saving until the generator has filled it.
  if (status.kind === 'upgraded' || (status.kind === 'fresh' && mode === 'live')) markDirty(h)
  else h.dirty = false
  return h
}

async function openHandle(mode: AppMode): Promise<Handle> {
  const SQL = await sqlite()
  const stored = await loadDatabase(mode)
  const h = await wrap(mode, stored ? new SQL.Database(stored.bytes) : new SQL.Database(), !stored)
  if (stored) {
    h.savedAt = stored.savedAt
    h.size = stored.size
  }
  opened.set(mode, h)
  return h
}

function handle(mode: AppMode): Promise<Handle> {
  let p = handles.get(mode)
  if (!p) {
    p = openHandle(mode)
    handles.set(mode, p)
    p.catch(() => handles.delete(mode))
  }
  return p
}

// ---------------------------------------------------------------------------------------------------------------------
// The exports src/lib/db/client.ts has

export async function getDb(mode: AppMode = 'live'): Promise<Db> {
  return (await handle(mode)).db
}

export async function createMemoryDb(): Promise<{ db: Db; client: SqlJsClient }> {
  const SQL = await sqlite()
  const h = await wrap('live', new SQL.Database(), true)
  return { db: h.db, client: h.client }
}

export async function closeAll() {
  await flushAll()
  for (const mode of [...handles.keys()]) await closeHandle(mode)
}

export function dataDir(): string {
  return 'IndexedDB (this browser)'
}

export function dbFile(mode: AppMode): string {
  return `IndexedDB: piste-standalone/${mode}`
}

export function migrationsDir(): string {
  return '(embedded)'
}

export { schema }

// ---------------------------------------------------------------------------------------------------------------------
// Standalone-only helpers

export async function getClient(mode: AppMode): Promise<SqlJsClient> {
  return (await handle(mode)).client
}

export function isOpen(mode: AppMode): boolean {
  return opened.has(mode)
}

/** Save now (used on pagehide, before downloads, after demo generation). */
export async function flush(mode: AppMode): Promise<void> {
  const h = opened.get(mode)
  if (!h) return
  if (h.timer) {
    clearTimeout(h.timer)
    h.timer = null
  }
  if (h.dirty || h.saving) await save(h)
}

export async function flushAll(): Promise<void> {
  await Promise.all([...opened.keys()].map((m) => flush(m)))
}

/** Stop scheduling saves while a bulk job runs; `false` releases and saves once. */
export async function holdSaves(mode: AppMode, on: boolean): Promise<void> {
  const h = await handle(mode)
  h.hold = on
  if (on && h.timer) {
    clearTimeout(h.timer)
    h.timer = null
  }
  if (!on && h.dirty) await flush(mode)
}

/** Is there saved data for this mode in IndexedDB (without opening it)? */
export async function hasSavedData(mode: AppMode): Promise<boolean> {
  return databaseExists(mode)
}

/** The whole database as a SQLite file (what "Download data" saves). */
export async function exportBytes(mode: AppMode): Promise<Uint8Array> {
  return exportRaw((await handle(mode)).client)
}

export async function closeHandle(mode: AppMode): Promise<void> {
  const p = handles.get(mode)
  if (!p) return
  handles.delete(mode)
  opened.delete(mode)
  const h = await p.catch(() => null)
  if (!h) return
  if (h.timer) clearTimeout(h.timer)
  h.client.close()
}

/** Forget a mode's saved data (and close it). The next getDb() starts from an empty, migrated database. */
export async function resetDatabase(mode: AppMode): Promise<void> {
  const p = handles.get(mode)
  handles.delete(mode)
  opened.delete(mode)
  const h = p ? await p.catch(() => null) : null
  if (h) {
    if (h.timer) clearTimeout(h.timer)
    h.client.close()
  }
  await deleteDatabase(mode)
}

export interface StorageSummary {
  persistent: boolean
  live: { savedAt: string | null; size: number } | null
  demo: { savedAt: string | null; size: number } | null
}

export async function storageSummary(): Promise<StorageSummary> {
  const persistent = await storageAvailable()
  const one = (m: AppMode) => {
    const h = opened.get(m)
    return h ? { savedAt: h.savedAt, size: h.size } : null
  }
  return { persistent, live: one('live'), demo: one('demo') }
}

/**
 * Replace the LIVE database with an imported SQLite file after checking it: a SQLite file, Piste's schema (same
 * migrations as this file), and not a demo database. Returns an error message instead of throwing on bad input.
 */
export async function importLive(bytes: Uint8Array): Promise<{ ok: true } | { ok: false; reason: string }> {
  const header = new TextDecoder().decode(bytes.slice(0, 16))
  if (header !== 'SQLite format 3\u0000') return { ok: false, reason: 'This is not a SQLite database file.' }
  const SQL = await sqlite()
  let raw: Database
  try {
    raw = new SQL.Database(bytes)
  } catch (e) {
    return { ok: false, reason: `The file could not be opened: ${e instanceof Error ? e.message : String(e)}` }
  }
  const probe = new SqlJsClient(raw)
  try {
    const integrity = await probe.execute('PRAGMA quick_check')
    if (String(integrity.rows[0]?.[0] ?? '') !== 'ok') return { ok: false, reason: 'The database file is damaged (integrity check failed).' }
    const m = await inspectMigrations(probe)
    if (!m.ok) return m
    const demo = await probe.execute(`SELECT value FROM app_meta WHERE key IN ('demo.database', 'demo.generatedAt') LIMIT 1`)
    if (demo.rows.length) return { ok: false, reason: 'This is a demo database. Demo data is never imported over your own records.' }
  } catch (e) {
    return { ok: false, reason: `The file is not a Piste database: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    probe.close()
  }
  await flush('live')
  await closeHandle('live')
  if (await storageAvailable()) await saveDatabase('live', { bytes, schemaId: BUILD_INFO.schemaId, savedAt: new Date().toISOString(), size: bytes.byteLength })
  else {
    // Memory only: open the imported bytes directly.
    const h = await wrap('live', new SQL.Database(bytes), false)
    opened.set('live', h)
    handles.set('live', Promise.resolve(h))
  }
  return { ok: true }
}
