/**
 * The live database's first run in the single-file build: migrations are applied by getDb(); this seeds the embedded
 * catalog (the same `seedCatalog` as `npm run db:setup`) on first run, and re-seeds when the file was rebuilt with a
 * changed catalog. Seeding is idempotent and conservative: corrections and personal records are kept.
 */
import { BUILD_INFO } from 'virtual:piste/build-info'
import { nowFor } from '@/lib/clock'
import { getMeta, loadCatalog, seedCatalog, setMeta } from '@/lib/catalog/seed'
import { getDb } from '../db/client'

const CATALOG_KEY = 'standalone.catalogHash'

export async function ensureLiveReady(): Promise<{ seeded: boolean; ms: number }> {
  const t0 = performance.now()
  const db = await getDb('live')
  const [seededAt, hash] = await Promise.all([getMeta(db, 'catalog.seededAt'), getMeta(db, CATALOG_KEY)])
  if (seededAt && hash === BUILD_INFO.catalogHash) return { seeded: false, ms: Math.round(performance.now() - t0) }
  const now = nowFor('live')
  await seedCatalog(db, loadCatalog(), now)
  await setMeta(db, CATALOG_KEY, BUILD_INFO.catalogHash, now)
  return { seeded: true, ms: Math.round(performance.now() - t0) }
}
