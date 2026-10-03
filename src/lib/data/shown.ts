/**
 * What the app shows of a stored fact — the display policy for catalog provenance, applied centrally by the read
 * models (core.ts loaders and the few direct queries in src/lib/data), so every screen follows it:
 *
 * - Facts with a source — verification 'search-summary' (web research), 'official-page', 'api' or
 *   'user-confirmed', and provenance without a verification level (live, modeled, derived, demo data) — are shown
 *   like any other fact. No "confirm at source" labelling.
 * - Facts whose verification is 'unverified' (catalog "Piste reference data" with no source behind it) are treated
 *   as not known: the value is dropped (null / row removed) and nothing renders in its place. Values are never
 *   substituted. Coordinates, time zones, map geometry and identifiers (resort, airport and pass names, IATA codes)
 *   are kept: the app needs them to work and they are not shown as labelled facts.
 * - Pass access rules recorded as 'unknown' are not shown (and never count as included); with no rule, a pass check
 *   answers "Access unknown" the same way.
 *
 * Pure functions over rows (no database access), so tests and scripts can use them too.
 */
import type {
  AirportRow,
  EventRow,
  HotelRow,
  OperatingScheduleRow,
  OperationalReportRow,
  PassAccessRuleRow,
  PassFamilyRow,
  PassProductRow,
  PriceSnapshotRow,
  ResortRow,
  ResortSeasonRow,
  TravelOptionRow,
} from '@/lib/db/rows'
import type { Provenance } from '@/lib/domain/types'
import { isResearchedReport } from '@/lib/domain/reports'
import { cleanCatalogText, isCatalogProvider, providerLabel } from '@/lib/domain/source-label'

/** A fact with no source behind it ('unverified'): not displayed. */
export const isUnverified = (p: Pick<Provenance, 'verification'> | null | undefined): boolean => p?.verification === 'unverified'

/**
 * Free-text catalog fields written as Piste reference notes rather than from a source ("Reference note: …",
 * "Reference, confirm: …", "Piste reference data …") are unverified content: not displayed.
 */
const REFERENCE_TEXT = /^\s*(?:reference(?: note)?(?:,\s*confirm)?\s*:|piste reference data\b)/i
export const isReferenceText = (s: string | null | undefined): boolean => !!s && REFERENCE_TEXT.test(s)

/** Catalog prose as shown: reference notes dropped, research caveats ("per search summary", "confirm") removed. */
const prose = (s: string | null | undefined): string | null => (s == null || isReferenceText(s) ? null : cleanCatalogText(s))

/** A catalog provenance as shown: plain provider name, research note cleaned (other provenance is returned as is). */
export function shownProv<P extends Provenance | null>(p: P): P {
  return catalogProv(p)
}

function catalogProv<P extends Provenance | null>(p: P): P {
  if (!p || !isCatalogProvider(p.provider)) return p
  // Machine markers ('catalog-research', 'entered-by-user'…) are kept: read models branch on them.
  const marker = !!p.note && /^[a-z]+(?:-[a-z]+)*$/.test(p.note)
  return { ...p, provider: providerLabel(p.provider), note: p.note && !marker ? cleanCatalogText(p.note) : p.note }
}

/** Keep rows whose own provenance is not 'unverified'. */
export function shownRows<T extends { prov: Provenance | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !isUnverified(r.prov))
}

/**
 * Resort row without unverified elevation, terrain or feature facts (coordinates, zone and identity are kept), and —
 * for catalog resorts — with research caveats removed from its prose.
 */
export function shownResort(r: ResortRow): ResortRow {
  const elevation = isUnverified(r.elevationProv)
  const terrain = !!r.terrain && isUnverified(r.terrain.prov)
  const features = !!r.features && isUnverified(r.features.prov)
  const catalog = r.origin === 'catalog'
  if (!elevation && !terrain && !features && !catalog) return r
  const text = (s: string | null) => (catalog ? prose(s) : s)
  return {
    ...r,
    ...(elevation ? { baseElevationM: null, summitElevationM: null, verticalM: null, elevationProv: null } : { elevationProv: catalogProv(r.elevationProv) }),
    // Coordinates are kept (maps need them) but are not a labelled fact: an unverified location lists no source.
    locationProv: isUnverified(r.locationProv) ? null : catalogProv(r.locationProv),
    terrain: terrain || !r.terrain ? null : { ...r.terrain, prov: catalogProv(r.terrain.prov) },
    features: features || !r.features ? null : { ...r.features, beginnerArea: text(r.features.beginnerArea), prov: catalogProv(r.features.prov) },
    character: text(r.character),
    learning: text(r.learning),
    operator: text(r.operator),
    links: catalog && r.links.more ? { ...r.links, more: r.links.more.map((m) => ({ ...m, label: cleanCatalogText(m.label) ?? m.url })) } : r.links,
  }
}

/** Season row without unverified announced dates (the Piste estimate window is kept: it is labelled an estimate). */
export function shownSeason(r: ResortSeasonRow): ResortSeasonRow {
  const opening = isUnverified(r.announcedOpeningProv)
  const closing = isUnverified(r.announcedClosingProv)
  const catalog = isCatalogProvider(r.announcedOpeningProv?.provider) || isCatalogProvider(r.announcedClosingProv?.provider) || !!r.typicalOpeningText || !!r.notes
  if (!opening && !closing && !catalog) return r
  return {
    ...r,
    announcedOpeningText: prose(r.announcedOpeningText),
    announcedOpeningProv: catalogProv(r.announcedOpeningProv),
    announcedClosingText: prose(r.announcedClosingText),
    announcedClosingProv: catalogProv(r.announcedClosingProv),
    typicalOpeningText: prose(r.typicalOpeningText),
    notes: prose(r.notes),
    ...(opening ? { announcedOpening: null, announcedOpeningText: null, announcedOpeningOn: null, announcedOpeningProv: null } : {}),
    ...(closing ? { announcedClosing: null, announcedClosingText: null, announcedClosingProv: null } : {}),
  }
}

/**
 * Travel options without unverified facts: an unverified drive estimate, or a transfer that is unverified or described
 * only by a reference note, is dropped; an unverified gateway airport keeps its identity (IATA code and role, which fly
 * journeys need) but loses its transfer time, distance, notes and source.
 */
export function shownTravel<T extends Partial<TravelOptionRow> & { mode: TravelOptionRow['mode']; prov: Provenance | null }>(rows: readonly T[]): T[] {
  const out: T[] = []
  for (const t of rows) {
    const catalog = isCatalogProvider(t.prov?.provider)
    const clean = (s: string | null | undefined) => (catalog ? prose(s) : (s ?? null))
    if (!isUnverified(t.prov) && !isReferenceText(t.notes)) {
      out.push({ ...t, notes: clean(t.notes), ...('basis' in t ? { basis: clean(t.basis) } : {}), prov: catalogProv(t.prov) })
    } else if (t.mode === 'airport') out.push({ ...t, minutes: null, km: null, basis: null, notes: null, prov: null })
    else if (t.mode === 'drive-from-home' && !isUnverified(t.prov)) out.push({ ...t, notes: null, prov: catalogProv(t.prov) })
  }
  return out
}

/** Airport without unverified facts (name, city, coordinates, zone and role are identity and kept). */
export function shownAirport<T extends Partial<AirportRow> & { prov: Provenance | null }>(a: T): T {
  const d = a.driveFromHome
  const drive = !d || isUnverified(d.prov) ? null : { ...d, basis: prose(d.basis), prov: catalogProv(d.prov) }
  if (isUnverified(a.prov)) return { ...a, officialUrl: null, airlinesUrl: null, airlines: [], parking: null, notes: null, driveFromHome: drive, prov: null }
  const catalog = isCatalogProvider(a.prov?.provider)
  return { ...a, parking: catalog ? prose(a.parking) : a.parking, notes: catalog ? prose(a.notes) : a.notes, driveFromHome: drive, prov: catalogProv(a.prov) }
}

/** Price snapshots that are shown (catalog notes cleaned; unverified prices dropped). */
export function shownPrices(rows: readonly PriceSnapshotRow[]): PriceSnapshotRow[] {
  return shownRows(rows).map((r) => (isCatalogProvider(r.prov.provider) ? { ...r, feesText: prose(r.feesText), prov: catalogProv(r.prov) } : r))
}

export function shownSchedules(rows: readonly OperatingScheduleRow[]): OperatingScheduleRow[] {
  return shownRows(rows).map((r) => (isCatalogProvider(r.prov?.provider) ? { ...r, prov: catalogProv(r.prov) } : r))
}

export function shownHotels(rows: readonly HotelRow[]): HotelRow[] {
  return shownRows(rows).map((h) =>
    h.origin === 'catalog'
      ? { ...h, distanceText: prose(h.distanceText), shuttle: prose(h.shuttle), parking: prose(h.parking), notes: prose(h.notes), prov: catalogProv(h.prov) }
      : h,
  )
}

export function shownEvents(rows: readonly EventRow[]): EventRow[] {
  return shownRows(rows).map((e) => (e.origin === 'catalog' ? { ...e, prov: catalogProv(e.prov) } : e))
}

/** Reports: a researched catalog report with no source is dropped; reports read by Piste or entered by you are kept. */
export function shownReports<T extends Pick<OperationalReportRow, 'prov'>>(rows: readonly T[]): T[] {
  return rows.filter((r) => !(isResearchedReport(r) && isUnverified(r.prov)))
}

/**
 * Pass family: identity (id, name and its official site links, like a resort's own links) kept; an unverified
 * operator is dropped.
 */
export function shownPassFamily(f: PassFamilyRow): PassFamilyRow {
  return isUnverified(f.prov) ? { ...f, operator: null, prov: null } : { ...f, prov: catalogProv(f.prov) }
}

/** Pass product: identity (id, name, family, season, resort) kept; unverified summaries, deadlines and notes dropped. */
export function shownPassProduct(p: PassProductRow): PassProductRow {
  if (isUnverified(p.prov)) {
    return { ...p, summary: null, blackoutsSummary: null, reservationsSummary: null, salesDeadline: null, salesDeadlineText: null, renewalNotes: null, prov: null }
  }
  if (!isCatalogProvider(p.prov?.provider)) return p
  return {
    ...p,
    summary: prose(p.summary),
    blackoutsSummary: prose(p.blackoutsSummary),
    reservationsSummary: prose(p.reservationsSummary),
    salesDeadlineText: prose(p.salesDeadlineText),
    renewalNotes: prose(p.renewalNotes),
    prov: catalogProv(p.prov),
  }
}

const hiddenRule = (r: Pick<PassAccessRuleRow, 'access' | 'prov'>) => r.access === 'unknown' || isUnverified(r.prov)

/** A catalog rule's prose without research caveats (your own rules are untouched). */
function cleanRule<T extends Partial<PassAccessRuleRow> & { prov: Provenance | null }>(r: T): T {
  if (!isCatalogProvider(r.prov?.provider)) return r
  return {
    ...r,
    ...('notes' in r ? { notes: prose(r.notes) } : {}),
    ...('reservationNotes' in r ? { reservationNotes: prose(r.reservationNotes) } : {}),
    ...('eligibilityNotes' in r ? { eligibilityNotes: prose(r.eligibilityNotes) } : {}),
    ...('discountText' in r ? { discountText: prose(r.discountText) } : {}),
    ...('poolLabel' in r && r.poolLabel ? { poolLabel: cleanCatalogText(r.poolLabel) ?? r.poolLabel } : {}),
    ...('blackouts' in r && r.blackouts ? { blackouts: r.blackouts.map((b) => ({ ...b, label: b.label ? cleanCatalogText(b.label) : b.label })) } : {}),
    prov: catalogProv(r.prov),
  }
}

/**
 * Pass access rules that are shown and used. Rules are versioned per (product, resort); when the current (latest)
 * version is unverified or recorded as 'unknown', the pair has no shown rule at all — an older version never
 * resurfaces as current. Pairs with a usable current rule keep their full history.
 */
export function shownRules<T extends Pick<PassAccessRuleRow, 'productId' | 'resortId' | 'version' | 'access' | 'prov'>>(rules: readonly T[]): T[] {
  const latest = new Map<string, T>()
  for (const r of rules) {
    const k = `${r.productId}|${r.resortId}`
    const prev = latest.get(k)
    if (!prev || (r.version ?? 1) > (prev.version ?? 1)) latest.set(k, r)
  }
  return rules
    .filter((r) => {
      const cur = latest.get(`${r.productId}|${r.resortId}`)
      return !!cur && !hiddenRule(cur)
    })
    .map(cleanRule)
}
