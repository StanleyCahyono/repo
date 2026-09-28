/**
 * Restore the live database from a backup. Usage:
 *   npm run restore -- data/backups/piste-20270115-1400.db
 *   npm run restore -- <file> --force     # even if the worker heartbeat looks recent
 *   npm run restore -- <file> --check     # validate only, change nothing
 *
 * Stop `npm run dev|start` and the worker first. The file is validated (SQLite header, integrity, Piste tables,
 * migrations table, not newer than this code), the current database is copied to
 * data/backups/piste-pre-restore-*.db, then replaced. See docs/backup.md.
 */
import './_env'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, dbFile, migrationsDir } from '../src/lib/db/client'
import { nowFor } from '../src/lib/clock'
import { hoursBetween } from '../src/lib/domain/time'
import { localMigrations, restoreFromBackup, validatePisteDbFile } from '../src/lib/export/backup'
import { parseArgs } from './_args'

async function main() {
  const args = parseArgs(process.argv.slice(2), ['dir'])
  const src = args.positional[0]
  if (!src) {
    console.error('Usage: npm run restore -- <backup-file> [--check] [--force] [--demo]')
    process.exit(2)
  }
  const backupFile = path.resolve(src)
  const mode = args.flags.has('demo') ? 'demo' : 'live'
  const target = dbFile(mode)
  const local = localMigrations(migrationsDir())
  const now = nowFor('live')

  const v = await validatePisteDbFile(backupFile, { local })
  console.log(`Backup: ${backupFile}`)
  console.log(`  tables: ${v.tables.length}, migrations: ${v.migrations.length}`)
  if (!v.ok) {
    console.error(`Not a restorable Piste database: ${v.errors.join('; ')}`)
    process.exit(1)
  }
  if (args.flags.has('check')) {
    console.log('Valid. (--check: nothing changed)')
    return
  }

  if (fs.existsSync(target) && !args.flags.has('force')) {
    const current = await validatePisteDbFile(target)
    if (current.heartbeat && Math.abs(hoursBetween(current.heartbeat, now)) < 5 / 60) {
      console.error(`The worker wrote a heartbeat ${current.heartbeat} (< 5 min ago). Stop the worker and the app, then retry (or pass --force).`)
      process.exit(1)
    }
  }

  const backupDir = path.resolve(args.values.get('dir') ?? process.env.PISTE_BACKUP_DIR ?? path.join(dataDir(), mode === 'demo' ? 'backups-demo' : 'backups'))
  const res = await restoreFromBackup({ backupFile, targetFile: target, backupDir, now, local })
  if (res.safetyCopy) console.log(`Safety copy of the previous database: ${res.safetyCopy}`)
  console.log(`Restored ${mode} database: ${res.restored}`)
  console.log('Start the app again; pending migrations (if the backup is older) apply automatically on first open.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
