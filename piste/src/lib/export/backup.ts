/**
 * SQLite backup / restore helpers used by scripts/backup.ts and scripts/restore.ts (see docs/backup.md).
 *
 * - Backups use `VACUUM INTO`, which writes a consistent, compacted copy while the app keeps running (WAL content
 *   included), named `piste-YYYYMMDD-HHmm.db` (UTC). Only the newest N are kept.
 * - Every backup records which database it was taken from (app_meta 'backup.sourceMode' = live | demo). Live and
 *   demo backups default to separate directories, so rotation of one never removes the other.
 * - Restore validates the file first (SQLite header, integrity check, the expected Piste tables and the Drizzle
 *   migrations table, not newer than this code), refuses to cross the live/demo boundary (a demo backup, or any file
 *   holding demo rows, never becomes the live database — no flag overrides this), makes a safety copy of the current
 *   database, then replaces it atomically and removes stale -wal/-shm files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { DateTime } from 'luxon'
import type { AppMode } from '@/lib/domain/types'

export const BACKUP_RE = /^piste-(\d{8})-(\d{4})(?:-(\d+))?\.db$/
export const SAFETY_PREFIX = 'piste-pre-restore-'

/** Tables every Piste database has; a file without them is not a Piste database. */
export const REQUIRED_TABLES = [
  'resorts',
  'seasons',
  'resort_seasons',
  'status_events',
  'operational_reports',
  'weather_runs',
  'weather_points',
  'conditions_assessments',
  'user_preferences',
  'favorites',
  'trips',
  'trip_items',
  'ski_day_logs',
  'expenses',
  'alert_rules',
  'refresh_runs',
  'app_meta',
] as const
export const MIGRATIONS_TABLE = '__drizzle_migrations'

/** app_meta key recording which database (live / demo) a backup or safety copy was taken from. */
export const BACKUP_SOURCE_MODE_KEY = 'backup.sourceMode'

/**
 * Rows that are demonstration data. A live database never holds any, so one is enough to recognise a demo
 * database (or a mix-up) whatever the file is called. Only tables present in the file are queried.
 */
const DEMO_ROW_QUERIES: readonly { table: string; where: string }[] = [
  { table: 'weather_runs', where: "kind = 'demo'" },
  { table: 'operational_reports', where: "kind = 'demo'" },
  { table: 'conditions_assessments', where: "kind = 'demo'" },
  { table: 'fx_rates', where: "kind = 'demo'" },
  { table: 'price_snapshots', where: "quote_kind = 'demo'" },
  // CASE keeps json_extract away from malformed JSON (which would abort the whole query).
  { table: 'status_events', where: "(CASE WHEN json_valid(prov) THEN json_extract(prov, '$.kind') END) = 'demo'" },
]

/** Default backup directory per mode. Live and demo backups never share one: rotation counts every piste-*.db. */
export function defaultBackupDir(mode: AppMode, dataDir: string, env: Record<string, string | undefined> = process.env): string {
  const configured = env.PISTE_BACKUP_DIR?.trim()
  if (configured) return path.resolve(mode === 'demo' ? path.join(configured, 'demo') : configured)
  return path.join(dataDir, mode === 'demo' ? 'backups-demo' : 'backups')
}

export function backupFileName(now: string, n = 0): string {
  const stamp = DateTime.fromISO(now, { zone: 'utc' }).toFormat('yyyyMMdd-HHmm')
  return `piste-${stamp}${n > 0 ? `-${n}` : ''}.db`
}

/** Regular backups beyond the newest `keep` (safety copies made by restore are never rotated). */
export function backupsToRemove(files: readonly string[], keep: number): string[] {
  const backups = files.filter((f) => BACKUP_RE.test(f)).sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
  return backups.slice(Math.max(0, keep))
}

function sortKey(f: string): string {
  const m = BACKUP_RE.exec(f)!
  return `${m[1]}${m[2]}${String(m[3] ?? 0).padStart(4, '0')}`
}

function openFile(file: string): Client {
  return createClient({ url: 'file:' + file })
}

export function isSqliteFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(16)
      const n = fs.readSync(fd, buf, 0, 16, 0)
      return n === 16 && buf.toString('latin1') === 'SQLite format 3\u0000'
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

export interface LocalMigration {
  tag: string
  when: number
}

/** Migrations known to this code (drizzle/meta/_journal.json). */
export function localMigrations(migrationsDir: string): LocalMigration[] {
  const file = path.join(migrationsDir, 'meta', '_journal.json')
  if (!fs.existsSync(file)) return []
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: { tag: string; when: number }[] }
  return (j.entries ?? []).map((e) => ({ tag: e.tag, when: e.when }))
}

export interface DbValidation {
  ok: boolean
  errors: string[]
  tables: string[]
  migrations: { hash: string; createdAt: number }[]
  /** Latest scheduler heartbeat in the file, if any. */
  heartbeat: string | null
  /** Rows marked as demonstration data (see DEMO_ROW_QUERIES). */
  demoRows: number
  /** Which database the file was backed up from, when the backup recorded it (older backups: null). */
  sourceMode: AppMode | null
}

/**
 * Why a validated file must not become the `mode` database, or null when it may. Not overridable (no --force):
 * demo rows never go into the live database, and a backup of the live database never goes into the demo slot.
 */
export function modeMismatch(v: Pick<DbValidation, 'demoRows' | 'sourceMode'>, mode: AppMode): string | null {
  if (mode === 'live') {
    if (v.sourceMode === 'demo') return 'it is a backup of the demo database, and demo data never goes into the live database'
    if (v.demoRows > 0) return `it contains ${v.demoRows} demo row${v.demoRows === 1 ? '' : 's'}, and demo data never goes into the live database`
    return null
  }
  if (v.sourceMode === 'live') return 'it is a backup of the live database, and live data never goes into the demo database'
  return null
}

/** Check that `file` is an intact Piste database compatible with this code. Read-only. */
export async function validatePisteDbFile(file: string, opts: { local?: readonly LocalMigration[] } = {}): Promise<DbValidation> {
  const res: DbValidation = { ok: false, errors: [], tables: [], migrations: [], heartbeat: null, demoRows: 0, sourceMode: null }
  if (!fs.existsSync(file)) {
    res.errors.push(`File not found: ${file}`)
    return res
  }
  if (!isSqliteFile(file)) {
    res.errors.push('Not a SQLite database (bad header)')
    return res
  }
  const client = openFile(file)
  try {
    const check = await client.execute('PRAGMA quick_check')
    const verdict = String(check.rows[0]?.[0] ?? '')
    if (verdict !== 'ok') res.errors.push(`Integrity check failed: ${verdict}`)
    const t = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    res.tables = t.rows.map((r) => String(r[0]))
    const missing = REQUIRED_TABLES.filter((x) => !res.tables.includes(x))
    if (missing.length) res.errors.push(`Missing Piste tables: ${missing.join(', ')}`)
    if (!res.tables.includes(MIGRATIONS_TABLE)) {
      res.errors.push(`Missing ${MIGRATIONS_TABLE} (not created by Piste's migrator)`)
    } else {
      const m = await client.execute(`SELECT hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at`)
      res.migrations = m.rows.map((r) => ({ hash: String(r[0]), createdAt: Number(r[1]) }))
      if (res.migrations.length === 0) res.errors.push('No migrations recorded')
      const local = opts.local ?? []
      if (local.length && res.migrations.length) {
        const newestLocal = Math.max(...local.map((l) => l.when))
        const newestFile = Math.max(...res.migrations.map((x) => x.createdAt))
        if (newestFile > newestLocal) res.errors.push('The database was written by a newer Piste version than this code; update the code first')
      }
    }
    if (res.tables.includes('app_meta')) {
      const hb = await client.execute("SELECT value FROM app_meta WHERE key = 'scheduler.heartbeat'")
      res.heartbeat = hb.rows[0] ? String(hb.rows[0][0]) : null
      const sm = await client.execute({ sql: 'SELECT value FROM app_meta WHERE key = ?', args: [BACKUP_SOURCE_MODE_KEY] })
      const recorded = sm.rows[0] ? String(sm.rows[0][0]) : null
      res.sourceMode = recorded === 'live' || recorded === 'demo' ? recorded : null
    }
    for (const q of DEMO_ROW_QUERIES) {
      if (!res.tables.includes(q.table)) continue
      const r = await client.execute(`SELECT COUNT(*) FROM ${q.table} WHERE ${q.where}`)
      res.demoRows += Number(r.rows[0]?.[0] ?? 0)
    }
  } catch (e) {
    res.errors.push(`Could not read database: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    client.close()
  }
  res.ok = res.errors.length === 0
  return res
}

/** Consistent copy of a live database file (includes committed WAL content). */
export async function vacuumInto(sourceFile: string, destFile: string): Promise<void> {
  if (fs.existsSync(destFile)) throw new Error(`Refusing to overwrite ${destFile}`)
  fs.mkdirSync(path.dirname(destFile), { recursive: true })
  const client = openFile(sourceFile)
  try {
    await client.execute({ sql: 'VACUUM INTO ?', args: [destFile] })
  } finally {
    client.close()
  }
}

/** Record in a fresh copy (never the source) which database it was taken from. Skipped for non-Piste files. */
async function recordSourceMode(file: string, mode: AppMode, now: string): Promise<void> {
  const client = openFile(file)
  try {
    const t = await client.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'")
    if (!t.rows.length) return
    await client.execute({
      sql: 'INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      args: [BACKUP_SOURCE_MODE_KEY, mode, now],
    })
  } finally {
    client.close()
  }
}

export async function createBackup(a: {
  sourceFile: string
  backupDir: string
  now: string
  keep: number
  /** Which database is being backed up; recorded in the copy so restore can refuse to cross live/demo. */
  mode?: AppMode
}): Promise<{ file: string; removed: string[] }> {
  if (!fs.existsSync(a.sourceFile)) throw new Error(`Database not found: ${a.sourceFile}`)
  fs.mkdirSync(a.backupDir, { recursive: true })
  let n = 0
  let file = path.join(a.backupDir, backupFileName(a.now))
  while (fs.existsSync(file)) file = path.join(a.backupDir, backupFileName(a.now, ++n))
  await vacuumInto(a.sourceFile, file)
  if (a.mode) await recordSourceMode(file, a.mode, a.now)
  const removed = backupsToRemove(fs.readdirSync(a.backupDir), a.keep)
  for (const f of removed) fs.rmSync(path.join(a.backupDir, f), { force: true })
  return { file, removed }
}

export interface RestoreResult {
  safetyCopy: string | null
  restored: string
  validation: DbValidation
}

/**
 * Replace `targetFile` (the `mode` database, default live) with `backupFile` after validating it. A demo backup, or
 * any file holding demo rows, is refused for the live database (and a live backup for the demo one) before anything
 * is touched. The current database is first copied to `<backupDir>/piste-pre-restore-YYYYMMDD-HHmmss.db`. Stop the
 * app and worker before calling this.
 */
export async function restoreFromBackup(a: {
  backupFile: string
  targetFile: string
  backupDir: string
  now: string
  local?: readonly LocalMigration[]
  /** Which database `targetFile` is. Default 'live'. */
  mode?: AppMode
}): Promise<RestoreResult> {
  const mode = a.mode ?? 'live'
  const v = await validatePisteDbFile(a.backupFile, { local: a.local })
  if (!v.ok) throw new Error(`Not restoring — ${v.errors.join('; ')}`)
  const mismatch = modeMismatch(v, mode)
  if (mismatch) throw new Error(`Not restoring into the ${mode} database — ${mismatch}`)
  if (path.resolve(a.backupFile) === path.resolve(a.targetFile)) throw new Error('Backup and target are the same file')

  let safetyCopy: string | null = null
  if (fs.existsSync(a.targetFile)) {
    const stamp = DateTime.fromISO(a.now, { zone: 'utc' }).toFormat('yyyyMMdd-HHmmss')
    safetyCopy = path.join(a.backupDir, `${SAFETY_PREFIX}${stamp}.db`)
    let n = 0
    while (fs.existsSync(safetyCopy)) safetyCopy = path.join(a.backupDir, `${SAFETY_PREFIX}${stamp}-${++n}.db`)
    let vacuumed = false
    try {
      await vacuumInto(a.targetFile, safetyCopy)
      vacuumed = true
    } catch {
      // A damaged current database cannot be vacuumed: keep a raw copy of the file and its WAL instead.
      fs.mkdirSync(a.backupDir, { recursive: true })
      fs.copyFileSync(a.targetFile, safetyCopy)
      if (fs.existsSync(`${a.targetFile}-wal`)) fs.copyFileSync(`${a.targetFile}-wal`, `${safetyCopy}-wal`)
    }
    // Label the safety copy like a backup of this database. Best effort: an unlabelled copy is still a valid copy,
    // and restoring it later is still checked for demo rows.
    if (vacuumed) await recordSourceMode(safetyCopy, mode, a.now).catch(() => {})
  }

  fs.mkdirSync(path.dirname(a.targetFile), { recursive: true })
  const tmp = `${a.targetFile}.restore-tmp`
  fs.rmSync(tmp, { force: true })
  fs.copyFileSync(a.backupFile, tmp)
  // A stale WAL from the old database would be replayed onto the restored file — remove it first.
  fs.rmSync(`${a.targetFile}-wal`, { force: true })
  fs.rmSync(`${a.targetFile}-shm`, { force: true })
  fs.renameSync(tmp, a.targetFile)

  const after = await validatePisteDbFile(a.targetFile, { local: a.local })
  if (!after.ok) throw new Error(`Restored file failed validation (${after.errors.join('; ')}). Safety copy: ${safetyCopy ?? 'none'}`)
  return { safetyCopy, restored: a.targetFile, validation: after }
}
