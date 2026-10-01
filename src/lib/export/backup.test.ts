import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { migrationsDir, schema } from '@/lib/db/client'
import { trips } from '@/lib/db/schema'
import { backupFileName, backupsToRemove, createBackup, defaultBackupDir, localMigrations, restoreFromBackup, validatePisteDbFile } from './backup'

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

describe('live / demo isolation', () => {
  const now = '2027-01-16T09:00:00.000Z'

  it('refuses a database holding demo rows for the live slot, whatever it is called, and leaves live untouched', async () => {
    const live = path.join(dir, 'piste.db')
    await makeDb(live, 'Live trip')
    // Demo backups use the same piste-*.db names as live ones.
    const demoFile = path.join(dir, 'piste-20270115-1400.db')
    await makeDb(demoFile, 'Demo trip')
    const c = createClient({ url: 'file:' + demoFile })
    await c.execute(
      "INSERT INTO fx_rates (base, quote, rate, rate_date, provider, fetched_at, kind) VALUES ('USD', 'EUR', '0.91', '2027-01-14', 'demo', '2027-01-15T14:00:00.000Z', 'demo')",
    )
    c.close()

    const v = await validatePisteDbFile(demoFile, { local: localMigrations(migrationsDir()) })
    expect(v.ok).toBe(true) // a valid Piste database…
    expect(v.demoRows).toBe(1) // …holding demo data
    await expect(restoreFromBackup({ backupFile: demoFile, targetFile: live, backupDir: path.join(dir, 'b'), now })).rejects.toThrow(/demo data never goes into the live database/)
    expect(await tripName(live)).toBe('Live trip')
    expect(fs.existsSync(path.join(dir, 'b'))).toBe(false) // refused before anything was touched

    // The demo slot takes it.
    const demoTarget = path.join(dir, 'piste-demo.db')
    await restoreFromBackup({ backupFile: demoFile, targetFile: demoTarget, backupDir: path.join(dir, 'b-demo'), now, mode: 'demo' })
    expect(await tripName(demoTarget)).toBe('Demo trip')
  })

  it('records which database a backup came from and never restores across live and demo', async () => {
    const live = path.join(dir, 'piste.db')
    const demo = path.join(dir, 'piste-demo.db')
    await makeDb(live, 'Live trip')
    await makeDb(demo, 'Demo trip') // no demo rows at all: recognised by the recorded source only
    const demoBackup = (await createBackup({ sourceFile: demo, backupDir: path.join(dir, 'backups-demo'), now, keep: 5, mode: 'demo' })).file
    const liveBackup = (await createBackup({ sourceFile: live, backupDir: path.join(dir, 'backups'), now, keep: 5, mode: 'live' })).file
    expect((await validatePisteDbFile(demoBackup)).sourceMode).toBe('demo')
    expect((await validatePisteDbFile(liveBackup)).sourceMode).toBe('live')
    expect((await validatePisteDbFile(live)).sourceMode).toBeNull() // the source database itself is never written to

    await expect(restoreFromBackup({ backupFile: demoBackup, targetFile: live, backupDir: path.join(dir, 'backups'), now })).rejects.toThrow(/backup of the demo database/)
    await expect(restoreFromBackup({ backupFile: liveBackup, targetFile: demo, backupDir: path.join(dir, 'backups-demo'), now, mode: 'demo' })).rejects.toThrow(
      /backup of the live database/,
    )
    expect(await tripName(live)).toBe('Live trip')
    expect(await tripName(demo)).toBe('Demo trip')

    // Same-mode restores work, and the safety copy is labelled with the database it came from.
    const res = await restoreFromBackup({ backupFile: liveBackup, targetFile: live, backupDir: path.join(dir, 'backups'), now })
    expect((await validatePisteDbFile(res.safetyCopy!)).sourceMode).toBe('live')
  })

  it('keeps live and demo backups in separate directories, so rotating one never removes the other', () => {
    expect(defaultBackupDir('live', '/srv/piste/data', {})).toBe(path.join('/srv/piste/data', 'backups'))
    expect(defaultBackupDir('demo', '/srv/piste/data', {})).toBe(path.join('/srv/piste/data', 'backups-demo'))
    expect(defaultBackupDir('live', '/srv/piste/data', { PISTE_BACKUP_DIR: '/mnt/usb/piste' })).toBe(path.resolve('/mnt/usb/piste'))
    expect(defaultBackupDir('demo', '/srv/piste/data', { PISTE_BACKUP_DIR: '/mnt/usb/piste' })).toBe(path.resolve('/mnt/usb/piste/demo'))
  })
})
