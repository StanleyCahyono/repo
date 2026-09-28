/**
 * Back up the live database. Usage:
 *   npm run backup                     # data/backups/piste-YYYYMMDD-HHmm.db (UTC), keeps the newest 14
 *   npm run backup -- --keep 30
 *   npm run backup -- --demo           # the demo database instead (file name gets -demo)
 * Uses SQLite `VACUUM INTO`: safe while the app and worker are running. See docs/backup.md.
 */
import './_env'
import path from 'node:path'
import { dataDir, dbFile } from '../src/lib/db/client'
import { nowFor } from '../src/lib/clock'
import { createBackup } from '../src/lib/export/backup'
import { parseArgs } from './_args'

async function main() {
  const args = parseArgs(process.argv.slice(2), ['keep', 'dir'])
  const mode = args.flags.has('demo') ? 'demo' : 'live'
  const keep = Number(args.values.get('keep') ?? process.env.PISTE_BACKUP_KEEP ?? 14)
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a positive integer')
  const backupDir = path.resolve(args.values.get('dir') ?? process.env.PISTE_BACKUP_DIR ?? path.join(dataDir(), mode === 'demo' ? 'backups-demo' : 'backups'))
  const { file, removed } = await createBackup({ sourceFile: dbFile(mode), backupDir, now: nowFor('live'), keep })
  console.log(`Backup written: ${file}`)
  if (removed.length) console.log(`Removed old backups (keeping ${keep}): ${removed.join(', ')}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
