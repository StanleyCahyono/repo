/**
 * Apply database migrations. Usage: npm run db:migrate            (live database)
 *                                   npm run db:migrate -- --demo  (demo database)
 * The app also migrates on first open; this makes it explicit (e.g. after pulling new code or before a restore).
 */
import './_env'
import { closeAll, dbFile, getDb } from '../src/lib/db/client'
import { validatePisteDbFile, localMigrations } from '../src/lib/export/backup'
import { migrationsDir } from '../src/lib/db/client'
import { parseArgs } from './_args'

async function main() {
  const args = parseArgs()
  const mode = args.flags.has('demo') ? 'demo' : 'live'
  const file = dbFile(mode)
  await getDb(mode) // applies pending migrations (drizzle migrator)
  await closeAll()
  const local = localMigrations(migrationsDir())
  const v = await validatePisteDbFile(file, { local })
  console.log(`${mode} database: ${file}`)
  console.log(`Migrations applied: ${v.migrations.length} (known to this code: ${local.map((m) => m.tag).join(', ') || 'none'})`)
  if (!v.ok) {
    console.error(`Problems: ${v.errors.join('; ')}`)
    process.exit(1)
  }
  console.log('OK')
}

main().catch(async (e) => {
  console.error(e)
  await closeAll()
  process.exit(1)
})
