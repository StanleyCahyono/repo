/**
 * Back up the live database. Usage:
 *   npm run backup                     # data/backups/piste-YYYYMMDD-HHmm.db (UTC), keeps the newest 14
 *   npm run backup -- --keep 30        # or PISTE_BACKUP_KEEP
 *   npm run backup -- --dir /mnt/usb   # or PISTE_BACKUP_DIR
 *   npm run backup -- --demo           # the demo database instead, into data/backups-demo (or $PISTE_BACKUP_DIR/demo)
 * File names are the same for both modes; live and demo backups are kept apart by directory, and each backup records
 * which database it came from (restore refuses a demo backup for the live database).
 * Uses SQLite `VACUUM INTO`: safe while the app and worker are running. See docs/backup.md.
 */
import './_env'
import path from 'node:path'
import { dataDir, dbFile } from '../src/lib/db/client'
import { nowFor } from '../src/lib/clock'
import { createBackup, defaultBackupDir } from '../src/lib/export/backup'
import { parseArgs } from './_args'

async function main() {
  const args = parseArgs(process.argv.slice(2), ['keep', 'dir'])
  const mode = args.flags.has('demo') ? 'demo' : 'live'
  const keep = Number(args.values.get('keep') ?? process.env.PISTE_BACKUP_KEEP ?? 14)
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a positive integer')
  const explicitDir = args.values.get('dir')
  const backupDir = explicitDir ? path.resolve(explicitDir) : defaultBackupDir(mode, dataDir())
  const { file, removed } = await createBackup({ sourceFile: dbFile(mode), backupDir, now: nowFor('live'), keep, mode })
  console.log(`Backup of the ${mode} database written: ${file}`)
  if (removed.length) console.log(`Removed old backups (keeping ${keep}): ${removed.join(', ')}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
