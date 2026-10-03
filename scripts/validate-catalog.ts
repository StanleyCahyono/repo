/**
 * Validate every catalog file against the zod schema: npx tsx scripts/validate-catalog.ts
 * Exits non-zero and lists the first issues per file when anything fails to parse.
 */
import fs from 'node:fs'
import path from 'node:path'
import { CatalogAirports, CatalogEvents, CatalogHotels, CatalogPasses, CatalogResort } from '../src/lib/catalog/schema'

const dir = path.join(process.cwd(), 'catalog')
let bad = 0
const check = (file: string, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }) => {
  const r = schema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!r.success) {
    bad++
    console.log(`✗ ${path.relative(process.cwd(), file)}`)
    for (const i of r.error!.issues.slice(0, 8)) console.log(`    ${i.path.join('.')}: ${i.message}`)
  }
}
for (const f of fs.readdirSync(path.join(dir, 'resorts')).filter((x) => x.endsWith('.json'))) check(path.join(dir, 'resorts', f), CatalogResort)
check(path.join(dir, 'passes.json'), CatalogPasses)
check(path.join(dir, 'airports.json'), CatalogAirports)
check(path.join(dir, 'hotels.json'), CatalogHotels)
check(path.join(dir, 'events.json'), CatalogEvents)
console.log(bad ? `${bad} file(s) failed` : 'catalog OK')
process.exit(bad ? 1 : 0)
