/**
 * Load catalog/ into the live database (idempotent). Usage: npm run db:seed
 * Set PISTE_DATA_DIR to target another data directory.
 */
import { getDb, closeAll, dbFile } from '../src/lib/db/client'
import { loadCatalog, seedCatalog } from '../src/lib/catalog/seed'

async function main() {
  const db = await getDb('live')
  const catalog = loadCatalog()
  const report = await seedCatalog(db, catalog, new Date().toISOString())
  console.log(`Seeded ${dbFile('live')}`)
  console.table(report)
  await closeAll()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
