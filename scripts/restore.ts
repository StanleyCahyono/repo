/**
 * Restore the live database from a backup. Usage:
 *   npm run restore -- data/backups/piste-20270115-1400.db
 *   npm run restore -- <file> --force     # even if the worker heartbeat looks recent
 *   npm run restore -- <file> --check     # validate only, change nothing
 *   npm run restore -- <file> --demo      # restore the demo database instead
 *
 * Stop `npm run dev|start` and the worker first. The file is validated (SQLite header, integrity, Piste tables,
 * migrations table, not newer than this code), a demo backup — or any file holding demo rows — is refused for the
 * live database (`--force` does not override this; nor is a live backup restored into the demo slot), the current
 * database is copied to <backup dir>/piste-pre-restore-*.db, then replaced. See docs/backup.md.
 */
import './_env'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, dbFile, migrationsDir } from '../src/lib/db/client'
import { nowFor } from '../src/lib/clock'
import { hoursBetween } from '../src/lib/domain/time'
import { defaultBackupDir, localMigrations, modeMismatch, restoreFromBackup, validatePisteDbFile } from '../src/lib/export/backup'
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
  console.log(
    `  tables: ${v.tables.length}, migrations: ${v.migrations.length}, demo rows: ${v.demoRows}, taken from: ${v.sourceMode ? `the ${v.sourceMode} database` : 'not recorded'}`,
  )
  if (!v.ok) {
    console.error(`Not a restorable Piste database: ${v.errors.join('; ')}`)
    process.exit(1)
  }
  const mismatch = modeMismatch(v, mode)
  if (mismatch) {
    console.error(`Cannot restore into the ${mode} database: ${mismatch}. (--force does not override this.)`)
    process.exit(1)
  }
  if (args.flags.has('check')) {
    console.log(`Valid for the ${mode} database. (--check: nothing changed)`)
    return
  }

  if (fs.existsSync(target) && !args.flags.has('force')) {
    const current = await validatePisteDbFile(target)
    if (current.heartbeat && Math.abs(hoursBetween(current.heartbeat, now)) < 5 / 60) {
      console.error(`The worker wrote a heartbeat ${current.heartbeat} (< 5 min ago). Stop the worker and the app, then retry (or pass --force).`)
      process.exit(1)
    }
  }

  const explicitDir = args.values.get('dir')
  const backupDir = explicitDir ? path.resolve(explicitDir) : defaultBackupDir(mode, dataDir())
  const res = await restoreFromBackup({ backupFile, targetFile: target, backupDir, now, local, mode })
  if (res.safetyCopy) console.log(`Safety copy of the previous database: ${res.safetyCopy}`)
  console.log(`Restored ${mode} database: ${res.restored}`)
  console.log('Start the app again; pending migrations (if the backup is older) apply automatically on first open.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
