/**
 * Load curated catalog files into the database. Idempotent and conservative:
 * - Catalog-owned rows are refreshed; user rows (origin 'user', provider 'You') and personal records are untouched.
 * - Opening-date changes are logged to opening_date_history; actual openings/closings (live data) are never
 *   overwritten by catalog research.
 * - Price snapshots and pass rules are appended/versioned, never rewritten, so history stays explainable.
 */
import fs from 'node:fs'
import path from 'node:path'
import { and, eq, desc, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import { provenance, type Provenance } from '@/lib/domain/types'
import { fromMajor } from '@/lib/domain/money'
import { estimateOpeningWindow } from '@/lib/domain/season'
import {
  CatalogResort,
  CatalogPasses,
  CatalogAirports,
  CatalogHotels,
  CatalogEvents,
  type SourceRef,
} from './schema'
import type { z } from 'zod'

export const CATALOG_PROVIDER = 'Piste catalog (web research)'
export const CATALOG_SEASON = '2026-27'

export interface Catalog {
  resorts: CatalogResort[]
  passes: z.infer<typeof CatalogPasses> | null
  airports: z.infer<typeof CatalogAirports> | null
  hotels: z.infer<typeof CatalogHotels> | null
  events: z.infer<typeof CatalogEvents> | null
}

export function catalogDir(): string {
  return path.join(process.cwd(), 'catalog')
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Read and validate every catalog file; throws with the file name and zod issues on invalid data. */
export function loadCatalog(dir = catalogDir()): Catalog {
  const resortDir = path.join(dir, 'resorts')
  const resorts: CatalogResort[] = []
  if (fs.existsSync(resortDir)) {
    for (const f of fs.readdirSync(resortDir).filter((x) => x.endsWith('.json')).sort()) {
      const parsed = CatalogResort.safeParse(readJson(path.join(resortDir, f)))
      if (!parsed.success) throw new Error(`catalog/resorts/${f}: ${parsed.error.message}`)
      resorts.push(parsed.data)
    }
  }
  const opt = <T extends z.ZodTypeAny>(name: string, schema: T): z.infer<T> | null => {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) return null
    const parsed = schema.safeParse(readJson(file))
    if (!parsed.success) throw new Error(`catalog/${name}: ${parsed.error.message}`)
    return parsed.data
  }
  return {
    resorts,
    passes: opt('passes.json', CatalogPasses),
    airports: opt('airports.json', CatalogAirports),
    hotels: opt('hotels.json', CatalogHotels),
    events: opt('events.json', CatalogEvents),
  }
}

function prov(src: SourceRef | null | undefined, season: string | null = null): Provenance {
  return provenance({
    kind: 'manual',
    provider: CATALOG_PROVIDER,
    sourceUrl: src?.url ?? null,
    fetchedAt: src ? `${src.checkedOn}T12:00:00.000Z` : null,
    verification: src?.verification ?? 'unverified',
    season,
    note: src?.note ?? null,
  })
}

const isCatalogProv = (p: Provenance | null | undefined) => p?.provider === CATALOG_PROVIDER

export interface SeedReport {
  resorts: number
  schedules: number
  prices: number
  products: number
  rules: number
  ruleVersionsAdded: number
  airports: number
  travelOptions: number
  hotels: number
  events: number
  openingChanges: number
  firstRun: boolean
}

const DEFAULT_SKILLS: [string, string][] = [
  ['Walk and glide on the flat with skis on', 'Basics'],
  ['Get up after a fall', 'Basics'],
  ['Straight glide on a gentle slope', 'Basics'],
  ['Controlled stopping (wedge)', 'Control'],
  ['Control speed with a wedge on green terrain', 'Control'],
  ['Wedge turns left and right', 'Turning'],
  ['Link turns on a green run', 'Turning'],
  ['Traverse and sideslip', 'Turning'],
  ['Ride the magic carpet / surface lift', 'Lifts'],
  ['Load and unload a chairlift', 'Lifts'],
  ['Match skis at the end of the turn', 'Progression'],
  ['Parallel turns on easy greens', 'Progression'],
  ['Ski a blue run in control', 'Progression'],
  ['Pole plant timing', 'Progression'],
]

const DEFAULT_CHECKLIST: [string, string][] = [
  ['Helmet, goggles, gloves, base layers, ski socks', 'Gear'],
  ['Book lesson', 'Bookings'],
  ['Reserve rentals', 'Bookings'],
  ['Lift ticket bought / pass reservation made', 'Bookings'],
  ['Parking reservation (where required)', 'Bookings'],
  ['Airport transfer or rental car', 'Travel'],
  ['Check road and chain-control information', 'Travel'],
  ['Download trail map', 'On the day'],
  ['Check forecast and resort report', 'On the day'],
]

/** Seed or refresh the catalog. `now` is the app clock instant. */
export async function seedCatalog(db: Db, catalog: Catalog, now: string): Promise<SeedReport> {
  const report: SeedReport = {
    resorts: 0,
    schedules: 0,
    prices: 0,
    products: 0,
    rules: 0,
    ruleVersionsAdded: 0,
    airports: 0,
    travelOptions: 0,
    hotels: 0,
    events: 0,
    openingChanges: 0,
    firstRun: false,
  }

  await db
    .insert(s.seasons)
    .values({ id: CATALOG_SEASON, label: '2026–27', startDate: '2026-07-01', endDate: '2027-06-30' })
    .onConflictDoNothing()

  // --- Resorts ------------------------------------------------------------------------------------------------
  for (const r of catalog.resorts) {
    const row = {
      id: r.id,
      name: r.name,
      shortName: r.shortName,
      country: r.country,
      region: r.region,
      stateProvince: r.stateProvince,
      locality: r.locality,
      timezone: r.timezone,
      operator: r.operator,
      lat: r.location.lat,
      lon: r.location.lon,
      locationProv: prov(r.location.source),
      baseElevationM: r.elevation.baseM,
      summitElevationM: r.elevation.summitM,
      verticalM: r.elevation.verticalM,
      elevationProv: prov(r.elevation.source),
      terrain: { ...r.terrain, prov: prov(r.terrain.source, r.terrain.season) },
      features: { ...r.features, prov: prov(r.features.source) },
      character: r.character,
      learning: r.learning,
      links: { ...r.links, more: r.moreLinks },
      weatherPoints: r.weatherPoints.map((p) => ({ key: p.key, label: p.label, lat: p.lat, lon: p.lon, elevationM: p.elevationM })),
      reportSource: r.reportSource ? { url: r.reportSource.url, format: r.reportSource.format, adapter: null, notes: r.reportSource.notes } : null,
      research: {
        method: r.research.method,
        date: r.research.date,
        openQuestions: r.research.openQuestions,
        conflicts: r.research.conflicts,
        confidenceNotes: r.research.confidenceNotes,
      },
      photo: r.photo,
      priority: r.priority,
      origin: 'catalog' as const,
      updatedAt: now,
    }
    // Strip per-group `source` keys that were folded into prov.
    delete (row.terrain as Record<string, unknown>).source
    delete (row.features as Record<string, unknown>).source
    await db
      .insert(s.resorts)
      .values({ ...row, createdAt: now })
      .onConflictDoUpdate({ target: s.resorts.id, set: row })
    report.resorts++

    // --- Season dates ---
    const season = r.season
    const est = estimateOpeningWindow(season.history.map((h) => ({ season: h.season, opened: h.opened })), season.season)
    const existing = (
      await db
        .select()
        .from(s.resortSeasons)
        .where(and(eq(s.resortSeasons.resortId, r.id), eq(s.resortSeasons.seasonId, season.season)))
    )[0]
    const seasonRow = {
      announcedOpening: season.announcedOpening.date,
      announcedOpeningText: season.announcedOpening.text,
      announcedOpeningOn: season.announcedOpening.announcedOn,
      announcedOpeningProv: season.announcedOpening.date || season.announcedOpening.text ? prov(season.announcedOpening.source, season.season) : null,
      estimatedOpenFrom: est?.from ?? null,
      estimatedOpenTo: est?.to ?? null,
      estimateBasis: est?.basis ?? null,
      announcedClosing: season.announcedClosing.date,
      announcedClosingText: season.announcedClosing.text,
      announcedClosingProv: season.announcedClosing.date || season.announcedClosing.text ? prov(season.announcedClosing.source, season.season) : null,
      typicalOpeningText: season.typicalText,
      notes: season.notes,
      lastCheckedAt: `${r.research.date}T12:00:00.000Z`,
      updatedAt: now,
    }
    if (!existing) {
      await db.insert(s.resortSeasons).values({ resortId: r.id, seasonId: season.season, ...seasonRow })
    } else {
      for (const field of ['announcedOpening', 'announcedClosing'] as const) {
        const before = existing[field]
        const after = seasonRow[field]
        if (before !== after && (before !== null || after !== null)) {
          await db.insert(s.openingDateHistory).values({
            resortId: r.id,
            seasonId: season.season,
            field,
            previousValue: before,
            newValue: after,
            changedAt: now,
            prov: field === 'announcedOpening' ? seasonRow.announcedOpeningProv : seasonRow.announcedClosingProv,
          })
          report.openingChanges++
        }
      }
      // Actual openings/closings are live facts: never touched here.
      await db.update(s.resortSeasons).set(seasonRow).where(eq(s.resortSeasons.id, existing.id))
    }

    // --- Published hours (catalog-owned rows are replaced) ---
    const oldSchedules = await db.select({ id: s.operatingSchedules.id, prov: s.operatingSchedules.prov }).from(s.operatingSchedules).where(eq(s.operatingSchedules.resortId, r.id))
    const stale = oldSchedules.filter((x) => isCatalogProv(x.prov)).map((x) => x.id)
    if (stale.length) await db.delete(s.operatingSchedules).where(inArray(s.operatingSchedules.id, stale))
    for (const h of r.hours) {
      await db.insert(s.operatingSchedules).values({
        resortId: r.id,
        seasonId: h.season,
        activity: h.activity,
        label: h.label,
        daysOfWeek: h.days,
        opens: h.opens,
        closes: h.closes,
        closed: false,
        nature: 'published',
        prov: { ...prov(h.source, h.season), note: h.note ?? h.source?.note ?? null },
        updatedAt: now,
      })
      report.schedules++
    }

    // --- Prices (append-only snapshots) ---
    for (const p of r.prices) {
      const inserted = await insertPriceIfNew(db, {
        subjectType: p.subjectType,
        subjectId: r.id,
        resortId: r.id,
        item: p.item,
        category: p.category,
        amountMinor: fromMajor(p.amount, p.currency).amountMinor,
        amountMaxMinor: p.amountMax === null ? null : fromMajor(p.amountMax, p.currency).amountMinor,
        currency: p.currency,
        seasonId: p.season,
        dayType: p.dayType,
        appliesFrom: p.appliesFrom,
        appliesTo: p.appliesTo,
        purchaseBy: p.purchaseBy,
        includesTax: p.includesTax,
        feesText: null,
        quoteKind: 'published',
        observedAt: `${p.source?.checkedOn ?? r.research.date}T12:00:00.000Z`,
        expiresAt: null,
        prov: { ...prov(p.source, p.season), note: p.note ?? p.source?.note ?? null },
      })
      if (inserted) report.prices++
    }

    // --- Travel options (catalog-owned rows replaced) ---
    const oldTravel = await db.select({ id: s.travelOptions.id, prov: s.travelOptions.prov }).from(s.travelOptions).where(eq(s.travelOptions.resortId, r.id))
    const staleTravel = oldTravel.filter((x) => isCatalogProv(x.prov)).map((x) => x.id)
    if (staleTravel.length) await db.delete(s.travelOptions).where(inArray(s.travelOptions.id, staleTravel))
    const d = r.travel.driveFromIthaca
    if (d && (d.minutes !== null || d.km !== null)) {
      await db.insert(s.travelOptions).values({ resortId: r.id, mode: 'drive-from-home', minutes: d.minutes, km: d.km, basis: d.basis, prov: prov(d.source) })
      report.travelOptions++
    }
    for (const a of r.travel.airports) {
      await db.insert(s.travelOptions).values({ resortId: r.id, mode: 'airport', airportIata: a.iata, role: a.role, minutes: a.minutes, km: a.km, basis: a.basis, prov: prov(a.source) })
      report.travelOptions++
    }
    // Transfers carry no per-item source: only records built from web research may claim 'search-summary';
    // reference-only records (research.method 'reference-only') are Piste reference data and stay 'unverified'.
    const transferVerification = r.research.method === 'web-search' ? 'search-summary' : 'unverified'
    const transferNote = transferVerification === 'unverified' ? 'Piste reference data (not web-verified in this build) — confirm at source' : null
    for (const t of r.travel.transfers) {
      await db.insert(s.travelOptions).values({ resortId: r.id, mode: 'transfer', name: t.name, transferType: t.type, url: t.url, notes: t.notes, prov: prov({ url: t.url, verification: transferVerification, checkedOn: r.research.date, note: transferNote }) })
      report.travelOptions++
    }
  }

  // --- Passes -------------------------------------------------------------------------------------------------
  if (catalog.passes) {
    for (const f of catalog.passes.families) {
      await db
        .insert(s.passFamilies)
        .values({ id: f.id, name: f.name, operator: f.operator, links: f.links, prov: prov(f.source) })
        .onConflictDoUpdate({ target: s.passFamilies.id, set: { name: f.name, operator: f.operator, links: f.links, prov: prov(f.source) } })
    }
    for (const p of catalog.passes.products) {
      const row = {
        familyId: p.family,
        seasonId: p.season,
        name: p.name,
        resortId: p.resortId,
        summary: p.summary,
        blackoutsSummary: p.blackoutsSummary,
        reservationsSummary: p.reservationsSummary,
        salesDeadline: p.salesDeadline,
        salesDeadlineText: p.salesDeadlineText,
        renewalNotes: p.renewalNotes,
        prov: prov(p.source, p.season),
        updatedAt: now,
      }
      await db.insert(s.passProducts).values({ id: p.id, ...row }).onConflictDoUpdate({ target: s.passProducts.id, set: row })
      report.products++
      for (const price of p.prices) {
        const inserted = await insertPriceIfNew(db, {
          subjectType: 'pass-product',
          subjectId: p.id,
          resortId: p.resortId,
          item: p.name,
          category: price.category,
          amountMinor: fromMajor(price.amount, price.currency).amountMinor,
          amountMaxMinor: null,
          currency: price.currency,
          seasonId: p.season,
          dayType: null,
          appliesFrom: null,
          appliesTo: null,
          purchaseBy: price.purchaseBy,
          includesTax: null,
          feesText: null,
          quoteKind: 'published',
          observedAt: `${price.source?.checkedOn ?? '2026-09-28'}T12:00:00.000Z`,
          expiresAt: null,
          prov: { ...prov(price.source, p.season), note: price.window ?? price.source?.note ?? null },
        })
        if (inserted) report.prices++
      }
    }
    const knownResorts = new Set(catalog.resorts.map((r) => r.id))
    for (const a of catalog.passes.access) {
      if (!knownResorts.has(a.resortId)) continue
      const comparable = {
        access: a.access,
        days: a.days,
        poolId: a.poolId,
        poolLabel: a.poolLabel,
        blackouts: a.blackouts.map((b) => ({ from: b.from, to: b.to, label: b.label })),
        reservationRequired: a.reservationRequired,
        reservationNotes: a.reservationNotes,
        discountText: a.discountText,
        eligibilityNotes: a.eligibilityNotes,
        notes: a.notes,
      }
      const latest = (
        await db
          .select()
          .from(s.passAccessRules)
          .where(and(eq(s.passAccessRules.productId, a.productId), eq(s.passAccessRules.resortId, a.resortId)))
          .orderBy(desc(s.passAccessRules.version))
          .limit(1)
      )[0]
      const same =
        latest &&
        JSON.stringify({
          access: latest.access,
          days: latest.days,
          poolId: latest.poolId,
          poolLabel: latest.poolLabel,
          blackouts: latest.blackouts,
          reservationRequired: latest.reservationRequired,
          reservationNotes: latest.reservationNotes,
          discountText: latest.discountText,
          eligibilityNotes: latest.eligibilityNotes,
          notes: latest.notes,
        }) === JSON.stringify(comparable)
      if (!same) {
        await db.insert(s.passAccessRules).values({
          productId: a.productId,
          resortId: a.resortId,
          version: latest ? latest.version + 1 : 1,
          ...comparable,
          prov: prov(a.source, CATALOG_SEASON),
          updatedAt: now,
        })
        if (latest) report.ruleVersionsAdded++
      }
      report.rules++
    }
  }

  // --- Airports -----------------------------------------------------------------------------------------------
  if (catalog.airports) {
    for (const a of catalog.airports.airports) {
      const row = {
        name: a.name,
        city: a.city,
        lat: a.lat,
        lon: a.lon,
        timezone: a.timezone,
        role: a.role,
        officialUrl: a.officialUrl,
        airlinesUrl: a.airlinesUrl,
        airlines: a.airlines,
        parking: a.parking,
        driveFromHome: a.driveFromHome ? { minutes: a.driveFromHome.minutes, km: a.driveFromHome.km, basis: a.driveFromHome.basis, prov: prov(a.driveFromHome.source) } : null,
        notes: a.notes,
        prov: prov(a.source),
      }
      await db.insert(s.airports).values({ iata: a.iata, ...row }).onConflictDoUpdate({ target: s.airports.iata, set: row })
      report.airports++
    }
    await setMeta(db, 'catalog.routeNotes', JSON.stringify(catalog.airports.routeNotes), now)
    await setMeta(db, 'catalog.skiBaggage', JSON.stringify(catalog.airports.skiBaggage), now)
  }

  // --- Hotels -------------------------------------------------------------------------------------------------
  if (catalog.hotels) {
    const known = new Set(catalog.resorts.map((r) => r.id))
    for (const h of catalog.hotels.hotels) {
      if (!known.has(h.resortId)) continue
      const row = {
        resortId: h.resortId,
        name: h.name,
        tier: h.tier,
        brand: h.brand,
        address: h.address,
        lat: h.lat,
        lon: h.lon,
        officialUrl: h.officialUrl,
        distanceText: h.distanceText,
        skiInOut: h.skiInOut,
        shuttle: h.shuttle,
        parking: h.parking,
        notes: h.notes,
        origin: 'catalog' as const,
        prov: prov(h.source),
      }
      await db.insert(s.hotels).values({ id: h.id, ...row }).onConflictDoUpdate({ target: s.hotels.id, set: row })
      report.hotels++
    }
  }

  // --- Events -------------------------------------------------------------------------------------------------
  if (catalog.events) {
    for (const e of catalog.events.events) {
      const dedupeKey = eventDedupeKey(e.title, e.resortId, e.startLocal)
      const row = {
        resortId: e.resortId,
        title: e.title,
        category: e.category,
        venue: e.venue,
        startLocal: e.startLocal,
        endLocal: e.endLocal,
        timezone: e.timezone,
        status: e.status,
        lastEdition: e.lastEdition,
        ticketUrl: e.ticketUrl,
        priceMinor: e.price === null || !e.currency ? null : fromMajor(e.price, e.currency).amountMinor,
        currency: e.currency,
        ageRestriction: e.ageRestriction,
        bookingRequired: e.bookingRequired,
        officialUrl: e.officialUrl,
        dedupeKey,
        origin: 'catalog' as const,
        lastVerifiedAt: e.source ? `${e.source.checkedOn}T12:00:00.000Z` : null,
        prov: prov(e.source, CATALOG_SEASON),
      }
      const clash = (await db.select({ id: s.events.id, origin: s.events.origin }).from(s.events).where(eq(s.events.dedupeKey, dedupeKey)))[0]
      if (clash && clash.id !== e.id) continue // syndicated duplicate of an existing listing
      await db.insert(s.events).values({ id: e.id, ...row }).onConflictDoUpdate({ target: s.events.id, set: row })
      report.events++
    }
  }

  // --- First run personal defaults ----------------------------------------------------------------------------
  const firstRun = !(await getMeta(db, 'firstRun.done'))
  if (firstRun) {
    report.firstRun = true
    const ids = new Set(catalog.resorts.map((r) => r.id))
    let order = 0
    for (const id of ['greek-peak', 'alta']) {
      if (ids.has(id)) await db.insert(s.favorites).values({ resortId: id, addedAt: now, sortOrder: order++ }).onConflictDoNothing()
    }
    const [{ n: skills }] = await db.select({ n: sql<number>`count(*)` }).from(s.skillChecklist)
    if (!skills) {
      await db.insert(s.skillChecklist).values(DEFAULT_SKILLS.map(([label, category], i) => ({ label, category, sortOrder: i })))
    }
    const [{ n: tmpl }] = await db.select({ n: sql<number>`count(*)` }).from(s.checklistTemplates)
    if (!tmpl) {
      await db.insert(s.checklistTemplates).values(DEFAULT_CHECKLIST.map(([label, category], i) => ({ label, category, sortOrder: i })))
    }
    await setMeta(db, 'firstRun.done', now, now)
  }
  await setMeta(db, 'catalog.seededAt', now, now)
  return report
}

export function eventDedupeKey(title: string, resortId: string | null, startLocal: string | null): string {
  const norm = title
    .toLowerCase()
    .replace(/\b(20\d\d|annual|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return `${resortId ?? 'none'}|${norm}|${startLocal?.slice(0, 10) ?? 'tba'}`
}

async function insertPriceIfNew(db: Db, row: typeof s.priceSnapshots.$inferInsert): Promise<boolean> {
  const existing = await db
    .select({ id: s.priceSnapshots.id, amountMinor: s.priceSnapshots.amountMinor, currency: s.priceSnapshots.currency, seasonId: s.priceSnapshots.seasonId, dayType: s.priceSnapshots.dayType })
    .from(s.priceSnapshots)
    .where(
      and(
        eq(s.priceSnapshots.subjectType, row.subjectType),
        eq(s.priceSnapshots.subjectId, row.subjectId),
        eq(s.priceSnapshots.item, row.item),
        eq(s.priceSnapshots.quoteKind, row.quoteKind),
      ),
    )
  const dup = existing.some(
    (e) => e.amountMinor === row.amountMinor && e.currency === row.currency && (e.seasonId ?? null) === (row.seasonId ?? null) && (e.dayType ?? null) === (row.dayType ?? null),
  )
  if (dup) return false
  await db.insert(s.priceSnapshots).values(row)
  return true
}

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const r = await db.select({ v: s.appMeta.value }).from(s.appMeta).where(eq(s.appMeta.key, key))
  return r[0]?.v ?? null
}

export async function setMeta(db: Db, key: string, value: string, now: string) {
  await db.insert(s.appMeta).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: s.appMeta.key, set: { value, updatedAt: now } })
}
