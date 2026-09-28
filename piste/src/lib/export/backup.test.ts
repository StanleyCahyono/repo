import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { migrationsDir, schema } from '@/lib/db/client'
import { trips } from '@/lib/db/schema'
import { backupFileName, backupsToRemove, createBackup, localMigrations, restoreFromBackup, validatePisteDbFile } from './backup'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piste-backup-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

async function makeDb(file: string, tripName: string) {
  const client = createClient({ url: 'file:' + file })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: migrationsDir() })
  await db.insert(trips).values({ id: 't1', name: tripName, startDate: '2027-02-12', endDate: '2027-02-15', companions: [], createdAt: 'x', updatedAt: 'x' })
  client.close()
}

async function tripName(file: string) {
  const c = createClient({ url: 'file:' + file })
  const r = await c.execute('SELECT name FROM trips')
  c.close()
  return String(r.rows[0]?.[0])
}

describe('backup naming and rotation', () => {
  it('names backups piste-YYYYMMDD-HHmm.db (UTC) and keeps the newest N', () => {
    expect(backupFileName('2027-01-15T14:05:59.000Z')).toBe('piste-20270115-1405.db')
    const files = ['piste-20270101-0300.db', 'piste-20270115-1405.db', 'piste-20270115-1405-1.db', 'piste-20261231-2359.db', 'piste-pre-restore-20270101-000000.db', 'notes.txt']
    expect(backupsToRemove(files, 2)).toEqual(['piste-20270101-0300.db', 'piste-20261231-2359.db'])
  })
})

describe('backup and restore', () => {
  it('backs up with VACUUM INTO, validates, and restores with a safety copy of the current database', async () => {
    const live = path.join(dir, 'piste.db')
    const backups = path.join(dir, 'backups')
    await makeDb(live, 'Original')
    const { file } = await createBackup({ sourceFile: live, backupDir: backups, now: '2027-01-15T14:00:00.000Z', keep: 5 })
    expect(path.basename(file)).toBe('piste-20270115-1400.db')
    const v = await validatePisteDbFile(file, { local: localMigrations(migrationsDir()) })
    expect(v.errors).toEqual([])
    expect(v.ok).toBe(true)

    // The live database changes after the backup; a stale WAL file is lying around.
    const c = createClient({ url: 'file:' + live })
    await c.execute("UPDATE trips SET name = 'Changed'")
    c.close()
    fs.writeFileSync(`${live}-wal`, 'stale')

    const res = await restoreFromBackup({ backupFile: file, targetFile: live, backupDir: backups, now: '2027-01-16T09:00:00.000Z' })
    expect(await tripName(live)).toBe('Original')
    expect(fs.existsSync(`${live}-wal`)).toBe(false)
    expect(res.safetyCopy && path.basename(res.safetyCopy)).toBe('piste-pre-restore-20270116-090000.db')
    expect(await tripName(res.safetyCopy!)).toBe('Changed')
  })

  it('refuses files that are not Piste databases, leaving the current database untouched', async () => {
    const live = path.join(dir, 'piste.db')
    await makeDb(live, 'Keep me')
    const text = path.join(dir, 'notes.db')
    fs.writeFileSync(text, 'not a database')
    const other = path.join(dir, 'other.db')
    const c = createClient({ url: 'file:' + other })
    await c.execute('CREATE TABLE things (id INTEGER)')
    c.close()

    expect((await validatePisteDbFile(text)).errors[0]).toMatch(/Not a SQLite database/)
    const v = await validatePisteDbFile(other)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/Missing Piste tables/)
    expect(v.errors.join(' ')).toMatch(/__drizzle_migrations/)
    await expect(restoreFromBackup({ backupFile: other, targetFile: live, backupDir: path.join(dir, 'b'), now: '2027-01-16T09:00:00.000Z' })).rejects.toThrow(/Not restoring/)
    expect(await tripName(live)).toBe('Keep me')
    expect(fs.existsSync(path.join(dir, 'b'))).toBe(false)
  })

  it('refuses a backup written by a newer schema than this code knows', async () => {
    const file = path.join(dir, 'newer.db')
    await makeDb(file, 'x')
    const c = createClient({ url: 'file:' + file })
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 99999999999999)")
    c.close()
    const v = await validatePisteDbFile(file, { local: localMigrations(migrationsDir()) })
    expect(v.errors.join(' ')).toMatch(/newer Piste version/)
  })
})
