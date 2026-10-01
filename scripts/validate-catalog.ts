/** Validate catalog/*.json against the catalog schema and print a coverage summary. Usage: npx tsx scripts/validate-catalog.ts */
import { loadCatalog } from '../src/lib/catalog/seed'

try {
  const c = loadCatalog()
  const rows = c.resorts.map((r) => ({
    id: r.id,
    verified: r.location.source?.verification ?? 'none',
    elev: r.elevation.baseM !== null && r.elevation.summitM !== null ? 'yes' : 'no',
    opening: r.season.announcedOpening.date ?? (r.season.history.length ? 'estimate' : '—'),
    hours: r.hours.length,
    prices: r.prices.length,
    links: Object.values(r.links).filter(Boolean).length,
    airports: r.travel.airports.length,
    drive: r.travel.driveFromIthaca?.minutes ?? '—',
  }))
  console.table(rows)
  console.log(`resorts=${c.resorts.length} products=${c.passes?.products.length ?? 0} rules=${c.passes?.access.length ?? 0} airports=${c.airports?.airports.length ?? 0} hotels=${c.hotels?.hotels.length ?? 0} events=${c.events?.events.length ?? 0}`)
  const ids = new Set(c.resorts.map((r) => r.id))
  const productIds = new Set(c.passes?.products.map((p) => p.id) ?? [])
  const problems: string[] = []
  for (const a of c.passes?.access ?? []) {
    if (!ids.has(a.resortId)) problems.push(`access rule for unknown resort ${a.resortId}`)
    if (!productIds.has(a.productId)) problems.push(`access rule for unknown product ${a.productId}`)
  }
  for (const h of c.hotels?.hotels ?? []) if (!ids.has(h.resortId)) problems.push(`hotel ${h.id} → unknown resort ${h.resortId}`)
  for (const e of c.events?.events ?? []) if (e.resortId && !ids.has(e.resortId)) problems.push(`event ${e.id} → unknown resort ${e.resortId}`)
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  console.log('Catalog valid.')
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e))
  process.exit(1)
}
