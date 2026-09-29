/**
 * Extra read models for the resort page (/resorts/[id]) that getResortDetail does not cover:
 * - catalog facts the summary leaves out (character, terrain counts, weather points, report source),
 * - status history (every appended status statement, newest first),
 * - my own observations (personal feedback reports — never operations evidence, so the detail loader skips them),
 * - refresh health for weather and the official report adapter: last attempt, how it went for THIS resort (its own
 *   item errors), and last success — from the job run history, so the normal all-resort runs count, not only runs
 *   targeted at this resort (scanRunHistory, the same rule Sources & Sync uses),
 * - origin and destination airports with coordinates (flight-search links, the travel map),
 * - trips that can take a resort day or a hotel, and the resorts offered for comparison,
 * - a 14-day history window ending on the viewed date (or on today for a future date).
 * Everything honours the live/demo split and the app clock.
 */
import 'server-only'
import { and, asc, desc, eq, gte, lte, ne, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { DriveEstimate, ReportSourceInfo, TerrainInfo, WeatherPointDef } from '@/lib/db/schema'
import { addDays, isLocalDate } from '@/lib/domain/time'
import { OPERATING_STATUS_LABEL, type OperatingStatus, type Provenance, type ScoringMode } from '@/lib/domain/types'
import { isLive, loadResortRows, notDemoProv, resortToday, type DataCtx } from './core'
import { providerStatus, type ConnectorState } from './deps'
import { getHistoryCalendar, type HistoryDay } from './forecast'
import { scanRunHistory, type AttemptOutcome } from './sources'
import { reportView, type ReportView } from './views'

export interface StatusEventView {
  id: number
  status: OperatingStatus
  label: string
  effectiveAt: string
  localDate: string
  note: string | null
  prov: Provenance
}

export interface RefreshErrorView {
  /** Which source inside the job failed, e.g. "base · open-meteo" or "greek-peak-official". */
  source: string
  message: string
}

export interface RefreshHealthView {
  job: 'weather' | 'reports'
  /** Most recent run that attempted this resort — an all-resort run or one targeted at it (skipped runs excluded). */
  lastAttemptAt: string | null
  /** How that run went for THIS resort. */
  lastAttemptOutcome: AttemptOutcome | null
  /** 'all' = a run over every resort (the scheduler's normal pass); 'resort' = a run for this resort only. */
  lastAttemptScope: 'all' | 'resort' | null
  lastAttemptTrigger: 'schedule' | 'manual' | 'startup' | null
  /** This resort's own errors in that run (an all-resort run also carries other resorts' errors). */
  lastAttemptErrors: RefreshErrorView[]
  /** Last successful update for this resort (jobs' success rule: a failed or empty run never advances it). */
  lastSuccessAt: string | null
}

export interface ReportAdapterView {
  id: string
  label: string
  state: ConnectorState
  sourceUrl: string
}

export interface AirportPlace {
  iata: string
  name: string
  city: string | null
  lat: number
  lon: number
  role: 'origin' | 'destination' | 'both'
  officialUrl: string | null
  airlinesUrl: string | null
  parking: string | null
  /** Catalog note, e.g. that current routes could not be verified. */
  notes: string | null
  /** Drive from home to this airport (origin airports only); curated estimate unless sourced. */
  driveFromHome: DriveEstimate | null
  prov: Provenance | null
}

export interface TripOption {
  id: string
  name: string
  status: 'draft' | 'booked' | 'done' | 'cancelled'
  startDate: string
  endDate: string
  /** Resorts already planned on the trip (resort-day items). */
  resortIds: string[]
}

export interface CompareCandidate {
  id: string
  name: string
  region: string
  favorite: boolean
}

/** Catalog facts the summary does not carry. */
export interface ResortCatalogFacts {
  character: string | null
  /** Trail / lift / acreage counts with their season and source. */
  terrain: TerrainInfo | null
  /** Where weather is requested (base and upper-mountain points, with the catalog's own labels). */
  weatherPoints: WeatherPointDef[]
  /** Official report page and format (null when none is recorded). */
  reportSource: ReportSourceInfo | null
}

export interface ResortPageExtras {
  catalog: ResortCatalogFacts
  statusHistory: StatusEventView[]
  personalReports: ReportView[]
  refresh: { weather: RefreshHealthView; reports: RefreshHealthView | null; reportAdapter: ReportAdapterView | null }
  /** Origin airports (ITH first, then the alternatives) and every destination airport recorded for this resort. */
  originAirports: AirportPlace[]
  destinationAirports: AirportPlace[]
  home: { name: string; lat: number; lon: number }
  trips: TripOption[]
  compare: CompareCandidate[]
  /** Up to 14 resort-local days ending on the viewed date, or on today when the viewed date is ahead (oldest first). */
  historyWindow: HistoryDay[]
  trackingStart: string | null
  demo: boolean
}

const HISTORY_DAYS = 14

/** 'greek-peak:base:open-meteo' → 'base · open-meteo'; 'http: Open-Meteo: HTTP 403' → 'Open-Meteo: HTTP 403'. */
function errorView(resortId: string, key: string, message: string): RefreshErrorView {
  const source = key.startsWith(`${resortId}:`) ? key.slice(resortId.length + 1) : key
  return { source: source.split(':').join(' · '), message: message.replace(/^(http|parse|timeout):\s*/i, '').trim() }
}

async function refreshHealth(ctx: DataCtx, job: 'weather' | 'reports', resortId: string): Promise<RefreshHealthView> {
  const history = await scanRunHistory(ctx.db, job, [resortId])
  const h = history.scopes.get(resortId)
  // Never report a run from the simulated future (demo clock) or one that started after `now`.
  const run = h?.lastAttempt && h.lastAttempt.startedAt <= ctx.now ? h.lastAttempt : null
  const lastSuccessAt = h?.lastSuccessAt && h.lastSuccessAt <= ctx.now ? h.lastSuccessAt : null
  let errors: RefreshErrorView[] = []
  if (run && h?.outcome && h.outcome !== 'ok' && h.outcome !== 'running') {
    const [row] = await ctx.db.select({ details: s.refreshRuns.details, error: s.refreshRuns.error }).from(s.refreshRuns).where(eq(s.refreshRuns.id, run.id))
    const own = (row?.details?.items ?? []).filter((i) => i.target === resortId && !i.skipped && !i.ok)
    errors = own.map((i) => errorView(resortId, i.key, i.error ?? 'Failed without an error message'))
    // A run that failed before it reached any resort has no per-resort items: its own error is the reason.
    if (!errors.length && row?.error) errors = [{ source: run.target === resortId ? 'run' : 'all-resort run', message: row.error.slice(0, 300) }]
    const unique = new Map<string, RefreshErrorView>()
    for (const e of errors) if (!unique.has(`${e.source}|${e.message}`)) unique.set(`${e.source}|${e.message}`, e)
    errors = [...unique.values()].slice(0, 6)
  }
  return {
    job,
    lastAttemptAt: run ? (run.finishedAt ?? run.startedAt) : null,
    lastAttemptOutcome: run ? (h?.outcome ?? null) : null,
    lastAttemptScope: run ? (run.target === resortId ? 'resort' : 'all') : null,
    lastAttemptTrigger: run ? run.trigger : null,
    lastAttemptErrors: errors,
    lastSuccessAt,
  }
}

/** A resort's name/region/timezone for metadata, the existence check and the default planning date (null when unknown). */
export async function getResortName(
  ctx: Pick<DataCtx, 'db'>,
  id: string,
): Promise<{ id: string; name: string; region: string; stateProvince: string | null; timezone: string } | null> {
  const [r] = await loadResortRows(ctx, [id])
  return r ? { id: r.id, name: r.name, region: r.region, stateProvince: r.stateProvince, timezone: r.timezone } : null
}

export async function getResortPageExtras(
  ctx: DataCtx,
  id: string,
  opts: { date: string; mode?: ScoringMode; destinationIatas?: readonly string[] },
): Promise<ResortPageExtras> {
  const { db, now } = ctx
  const live = isLive(ctx)
  const date = isLocalDate(opts.date) ? opts.date : ctx.today
  const mode = opts.mode ?? ctx.prefs.scoringMode
  const adapter = providerStatus().find((c) => c.role === 'resort-report' && c.resortId === id) ?? null

  const [row] = await loadResortRows(ctx, [id])
  const tz = row?.timezone ?? ctx.prefs.homeTimezone
  // History never runs past the resort's own today.
  const localToday = resortToday({ timezone: tz }, now)
  const windowTo = date > localToday ? localToday : date
  const windowFrom = addDays(windowTo, -(HISTORY_DAYS - 1))
  const months = [...new Set([windowFrom.slice(0, 7), windowTo.slice(0, 7)])]

  const [events, personal, weather, reports, airports, trips, tripDays, resorts, favs, ...calendars] = await Promise.all([
    db
      .select()
      .from(s.statusEvents)
      .where(and(eq(s.statusEvents.resortId, id), lte(s.statusEvents.effectiveAt, now), live ? notDemoProv(s.statusEvents.prov) : undefined))
      .orderBy(desc(s.statusEvents.effectiveAt), desc(s.statusEvents.id))
      .limit(12),
    db
      .select()
      .from(s.operationalReports)
      .where(
        and(
          eq(s.operationalReports.resortId, id),
          eq(s.operationalReports.kind, 'manual'),
          sql`coalesce(json_extract(${s.operationalReports.prov}, '$.note'), '') = 'personal'`,
          lte(s.operationalReports.createdAt, now),
        ),
      )
      .orderBy(desc(s.operationalReports.localDate), desc(s.operationalReports.id))
      .limit(8),
    refreshHealth(ctx, 'weather', id),
    adapter ? refreshHealth(ctx, 'reports', id) : Promise.resolve(null),
    db.select().from(s.airports),
    db
      .select()
      .from(s.trips)
      .where(and(ne(s.trips.status, 'cancelled'), ne(s.trips.status, 'done'), gte(s.trips.endDate, ctx.today)))
      .orderBy(asc(s.trips.startDate), asc(s.trips.id)),
    db.select({ tripId: s.tripItems.tripId, refId: s.tripItems.refId }).from(s.tripItems).where(eq(s.tripItems.type, 'resort-day')),
    loadResortRows(ctx, null),
    db.select().from(s.favorites).orderBy(asc(s.favorites.sortOrder), asc(s.favorites.addedAt)),
    ...months.map((m) => getHistoryCalendar(ctx, id, m, { mode })),
  ])

  const place = (a: (typeof airports)[number]): AirportPlace => ({
    iata: a.iata,
    name: a.name,
    city: a.city,
    lat: a.lat,
    lon: a.lon,
    role: a.role,
    officialUrl: a.officialUrl,
    airlinesUrl: a.airlinesUrl,
    parking: a.parking,
    notes: a.notes,
    driveFromHome: a.driveFromHome,
    prov: a.prov,
  })
  const preferred = ctx.prefs.travel.originAirports.length ? ctx.prefs.travel.originAirports : ['ITH', 'SYR', 'ELM', 'ROC', 'BUF']
  const originAirports = airports
    .filter((a) => a.role === 'origin' || a.role === 'both')
    .sort((x, y) => {
      const ix = preferred.indexOf(x.iata)
      const iy = preferred.indexOf(y.iata)
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy) || x.iata.localeCompare(y.iata)
    })
    .map(place)
  const wanted = new Set(opts.destinationIatas ?? [])
  const destinationAirports = airports.filter((a) => wanted.has(a.iata)).map(place)

  const favIds = favs.map((f) => f.resortId)
  const favSet = new Set(favIds)
  const compare: CompareCandidate[] = resorts
    .filter((r) => r.id !== id)
    .map((r) => ({ id: r.id, name: r.shortName || r.name, region: r.region, favorite: favSet.has(r.id) }))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (a.favorite ? favIds.indexOf(a.id) - favIds.indexOf(b.id) : 0) || a.name.localeCompare(b.name))

  const daysByTrip = new Map<string, string[]>()
  for (const d of tripDays) if (d.refId) daysByTrip.set(d.tripId, [...new Set([...(daysByTrip.get(d.tripId) ?? []), d.refId])])

  const allDays = calendars.flatMap((c) => c?.days ?? [])
  const historyWindow = allDays.filter((d) => d.date >= windowFrom && d.date <= windowTo).sort((a, b) => a.date.localeCompare(b.date))

  return {
    catalog: {
      character: row?.character ?? null,
      terrain: row?.terrain ?? null,
      weatherPoints: row?.weatherPoints ?? [],
      reportSource: row?.reportSource ?? null,
    },
    statusHistory: events.map((e) => ({
      id: e.id,
      status: e.status,
      label: OPERATING_STATUS_LABEL[e.status],
      effectiveAt: e.effectiveAt,
      localDate: e.localDate,
      note: e.note,
      prov: e.prov,
    })),
    personalReports: personal.map((r) => reportView(r, now, tz)).filter((r): r is ReportView => r !== null),
    refresh: {
      weather,
      reports,
      reportAdapter: adapter ? { id: adapter.id, label: adapter.label, state: adapter.state, sourceUrl: adapter.sourceUrl } : null,
    },
    originAirports,
    destinationAirports,
    home: { name: ctx.prefs.homeName, lat: ctx.prefs.homeLat, lon: ctx.prefs.homeLon },
    trips: trips.map((t) => ({ id: t.id, name: t.name, status: t.status, startDate: t.startDate, endDate: t.endDate, resortIds: daysByTrip.get(t.id) ?? [] })),
    compare,
    historyWindow,
    trackingStart: calendars.find((c) => c?.trackingStart)?.trackingStart ?? null,
    demo: !live,
  }
}
