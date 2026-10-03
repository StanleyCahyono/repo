#!/usr/bin/env node
/**
 * Build research/plan.json — the searches and pages the research-fetch CI job collects so catalog facts can be verified
 * from real pages (the dev container cannot browse). One entry per resort plus the multi-resort pass sites.
 *
 *   node scripts/research-plan.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAT = path.join(ROOT, 'catalog')
const resorts = fs
  .readdirSync(path.join(CAT, 'resorts'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(CAT, 'resorts', f), 'utf8')))

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Keywords (several languages) that mark price / ticket / season / hours / snow-report / rental / lesson pages.
const KEYWORDS = [
  'ticket', 'tickets', 'lift-ticket', 'price', 'prices', 'pricing', 'rates', 'tarif', 'tarife', 'tarifs', 'preise', 'skipass', 'ski-pass', 'forfait', 'forfaits', 'prezzi', 'skipass-prezzi',
  'snow-report', 'snowreport', 'conditions', 'schneebericht', 'bulletin', 'meteo', 'lift-status', 'open-lifts', 'live',
  'opening', 'season', 'saison', 'hours', 'oeffnungszeiten', 'opening-hours', 'horaires', 'orari',
  'rental', 'rentals', 'verleih', 'location', 'noleggio', 'ski-school', 'lessons', 'skischule', 'ecole', 'scuola', 'facts', 'mountain-stats', 'statistics', 'about',
]

const plan = { generated: new Date().toISOString(), keywords: KEYWORDS, items: [] }
for (const r of resorts) {
  const official = r.links?.official ?? null
  const urls = new Set([official, r.links?.snowReport, r.links?.liftTickets, r.links?.tickets, r.links?.hours, r.reportSource?.url, ...(r.prices ?? []).map((p) => p.source?.url), r.season?.announcedOpening?.source?.url].filter(Boolean))
  plan.items.push({
    id: `resort:${r.id}`,
    name: r.name,
    officialHost: official ? host(official) : null,
    urls: [...urls],
    queries: [`${r.name} lift ticket prices 2026-27`, `${r.name} 2026-27 season opening date`, `${r.name} snow report`, `${r.name} ski rental lesson prices`],
    // Search results from these hosts are fetched too (besides the official host).
    allow: ['onthesnow.com', 'skiresort.info', 'skiresort.de', 'snow-forecast.com', 'liftopia.com', 'ski.com', 'skimag.com', 'powder.com', 'thelocal.at', 'thelocal.ch', 'thelocal.fr', 'snowpak.com', 'skiinfo.de', 'bergfex.com', 'bergfex.at', 'japan-guide.com', 'snowjapan.com', 'mountainwatch.com', 'zrankings.com', 'skimap.org'],
  })
}
const PASSES = [
  { id: 'pass:ikon', name: 'Ikon Pass', host: 'ikonpass.com', urls: ['https://www.ikonpass.com/en/shop-passes', 'https://www.ikonpass.com/en/shop-passes/ikon-pass', 'https://www.ikonpass.com/en/shop-passes/ikon-base-pass', 'https://www.ikonpass.com/en/shop-passes/ikon-session-pass', 'https://www.ikonpass.com/en/destinations', 'https://www.ikonpass.com/en/compare-passes', 'https://www.ikonpass.com/en/blackout-dates', 'https://www.ikonpass.com/en/reservations'], queries: ['Ikon Pass 2026-27 price', 'Ikon Base Pass 2026-27 price destinations', 'Ikon Session Pass 2026-27 price', 'Ikon Pass 2026-27 new destinations days', 'Ikon Pass 2026-27 blackout dates'] },
  { id: 'pass:epic', name: 'Epic Pass', host: 'epicpass.com', urls: ['https://www.epicpass.com/passes/epic-pass.aspx', 'https://www.epicpass.com/passes/epic-local-pass.aspx', 'https://www.epicpass.com/passes/epic-day-pass.aspx', 'https://www.epicpass.com/passes/northeast-value-pass.aspx', 'https://www.epicpass.com/passes/northeast-midweek-pass.aspx', 'https://www.epicpass.com/passes/compare.aspx', 'https://www.epicpass.com/resorts/epic-partner-resorts.aspx'], queries: ['Epic Pass 2026-27 price', 'Epic Local Pass 2026-27 price', 'Epic Day Pass 2026-27 price', 'Epic Pass 2026-27 partner resorts Europe Japan', 'Northeast Value Pass 2026-27 price'] },
  { id: 'pass:indy', name: 'Indy Pass', host: 'indyskipass.com', urls: ['https://www.indyskipass.com/', 'https://www.indyskipass.com/our-resorts', 'https://www.indyskipass.com/passes', 'https://www.indyskipass.com/blackout-dates'], queries: ['Indy Pass 2026-27 price', 'Indy Base Pass 2026-27 price', 'Indy+ Pass 2026-27 price blackout dates', 'Indy Pass 2026-27 resorts New York'] },
  { id: 'pass:mountain-collective', name: 'Mountain Collective', host: 'mountaincollective.com', urls: ['https://mountaincollective.com/', 'https://mountaincollective.com/destinations/', 'https://mountaincollective.com/pass/', 'https://mountaincollective.com/faq/'], queries: ['Mountain Collective 2026-27 price', 'Mountain Collective 2026-27 destinations'] },
]
for (const p of PASSES) plan.items.push({ id: p.id, name: p.name, officialHost: p.host, urls: p.urls, queries: p.queries, allow: ['onthesnow.com', 'skimag.com', 'tetongravity.com', 'unofficialnetworks.com', 'epicorikon.com', 'ski.com', 'snowbrains.com', 'powder.com', 'outsideonline.com'] })

fs.mkdirSync(path.join(ROOT, 'research'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'research', 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
console.log(`research/plan.json: ${plan.items.length} items, ${plan.items.reduce((n, i) => n + i.queries.length, 0)} searches`)
