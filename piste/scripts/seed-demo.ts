/**
 * Delete and regenerate the isolated demo database. Usage: npm run demo:seed
 *
 * Only `<PISTE_DATA_DIR>/piste-demo.db` (default ./data) and its -wal/-shm/-journal files are removed; the live
 * database is never opened. Restart a running dev server afterwards so it opens the new file.
 */
import './_env'
import fs from 'node:fs'
import path from 'node:path'
import { closeAll, dbFile, getDb } from '../src/lib/db/client'
import { generateDemoData } from '../src/lib/demo/generate'

async function main() {
  const demo = path.resolve(dbFile('demo'))
  const live = path.resolve(dbFile('live'))
  if (demo === live) throw new Error(`Refusing to run: the demo and live database paths are the same (${demo})`)
  if (path.basename(demo) !== 'piste-demo.db') throw new Error(`Refusing to run: unexpected demo database name ${demo}`)

  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(demo + suffix, { force: true })
  console.log(`Regenerating ${demo}`)
  const db = await getDb('demo')
  const summary = await generateDemoData(db, { log: (line) => console.log(line) })
  await closeAll()

  console.log(`\nDemo database ready (${summary.totalMs} ms, clock ${summary.now}, tracking since ${summary.trackingStart}).`)
  console.log(`Simulated resorts (${summary.simulatedResorts.length}): ${summary.simulatedResorts.join(', ')}`)
  console.log(`Left without simulated data (${summary.untouchedResorts.length}): ${summary.untouchedResorts.join(', ')}`)
  console.table(Object.fromEntries(Object.entries(summary.counts).filter(([, n]) => n > 0)))
  console.log('If the dev server is running, restart it so it opens the regenerated file.')
}

main().catch(async (e) => {
  console.error(e)
  await closeAll()
  process.exit(1)
})
