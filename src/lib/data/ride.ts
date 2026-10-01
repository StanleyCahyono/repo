/**
 * "Ride there" read models: the destination picker index and one resort's journey plan from home.
 *
 * Everything comes from stored travel data — the curated drive estimate (labelled as an estimate, with the winter
 * buffer), recorded gateway airports and their transfer times, the user's departure airports and their drive from
 * home, published lift hours (for "leave by") and modeled weather when a run is stored. Flights are illustrative only:
 * no flight numbers, times or fares exist here. Costs are not estimated (no fuel or fare model), so they stay unknown.
 */
import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { OperatingScheduleRow, ResortRow } from '@/lib/db/rows'
import type { Ctx } from '@/lib/context'
import type { UnitPrefs } from '@/lib/domain/types'
import { loadBundle, loadResortRows, needsConfirmation, pointsForRuns, floorHour, resortToday, seasonRowFor } from './core'
import { openingView, travelView } from './views'
import { liftHoursFor } from '@/lib/jobs/assessments'
import { addDays, addHours, formatInstant, formatLocalDate, hemisphereOf, previousSeasonId, relativeLabel, seasonIdForHemisphere, nextSaturday } from '@/lib/domain/time'
import { leaveBy, haversineKm } from '@/lib/domain/journey'
import { flightSearchLinks, directionsLink } from '@/lib/providers/links/builders'

export interface RideHome {
  name: string
  lat: number
  lon: number
  tz: string
}

export interface RidePick {
  id: string
  name: string
  short: string
  /** "Central New York · US" */
  where: string
  lat: number
  lon: number
  /** Curated one-way drive estimate from home, minutes (null: none recorded). */
  driveMinutes: number | null
  favorite: boolean
}

export interface RideIndex {
  home: RideHome
  resorts: RidePick[]
  /** Quick picks: favourites first, then the closest drives. */
  picks: string[]
}

export interface RideAirport {
  iata: string
  name: string | null
  city: string | null
  lat: number
  lon: number
  /** Departure airports: drive from home. Gateways: ground transfer to the resort. Minutes, null when unknown. */
  minutes: number | null
  km: number | null
  role: string | null
  /** "Reference — confirm at source" style wording when the fact needs checking, else null. */
  confirm: string | null
}

export interface RideDrive {
  minutes: number
  winterMinutes: number | null
  bufferPct: number
  km: number | null
  isEstimate: boolean
  basis: string | null
  confirm: string | null
  directionsUrl: string | null
}

export type RideLeaveBy =
  | { state: 'known'; leave: string; leaveDay: string; firstLift: string; dayLabel: string; dateIso: string; usesBuffer: boolean }
  | { state: 'unknown'; reason: string; short: string; lastSeason: string | null }

export interface RideWeatherHour {
  label: string
  tempC: number | null
  snowCm: number | null
  windKmh: number | null
}

export interface RideWeather {
  where: string
  source: string
  demo: boolean
  hours: RideWeatherHour[]
}

export interface RidePlan {
  resort: { id: string; name: string; short: string; where: string; lat: number; lon: number; tz: string; href: string; country: string; baseM: number | null; summitM: number | null }
  home: RideHome
  units: UnitPrefs
  /** Great-circle km home → resort (always known from coordinates). */
  straightKm: number
  drive: RideDrive | null
  /** The user's departure airports (ITH, SYR, ELM, ROC, BUF by default), in their order. */
  origins: RideAirport[]
  /** Recorded gateway airports near the resort, practical first. */
  gateways: RideAirport[]
  transfers: { name: string; type: string | null; url: string | null }[]
  recommended: 'drive' | 'fly' | 'none'
  verdictNote: string | null
  leaveBy: RideLeaveBy
  opening: string | null
  weather: RideWeather | null
  /** Flight search links (open external searches; Piste shows no fares or schedules). Keyed `${from}-${to}`. */
  flightSearch: Record<string, { label: string; url: string }>
  unknowns: string[]
  demo: boolean
}

const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function whereOf(r: Pick<ResortRow, 'region' | 'country'>) {
  return `${r.region} · ${r.country}`
}

/** All resorts for the "Where to?" picker. */
export async function getRideIndex(ctx: Ctx): Promise<RideIndex> {
  const [rows, drives, favs] = await Promise.all([
    loadResortRows(ctx, null),
    ctx.db.select({ resortId: s.travelOptions.resortId, minutes: s.travelOptions.minutes }).from(s.travelOptions).where(eq(s.travelOptions.mode, 'drive-from-home')),
    ctx.db.select().from(s.favorites),
  ])
  const driveBy = new Map(drives.map((d) => [d.resortId, d.minutes]))
  const favOrder = new Map(favs.map((f) => [f.resortId, f.sortOrder]))
  const resorts: RidePick[] = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      short: r.shortName,
      where: whereOf(r),
      lat: r.lat,
      lon: r.lon,
      driveMinutes: driveBy.get(r.id) ?? null,
      favorite: favOrder.has(r.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const favorites = resorts.filter((r) => r.favorite).sort((a, b) => (favOrder.get(a.id) ?? 0) - (favOrder.get(b.id) ?? 0))
  const near = resorts
    .filter((r) => !r.favorite && r.driveMinutes != null)
    .sort((a, b) => a.driveMinutes! - b.driveMinutes!)
  const picks = [...favorites, ...near].slice(0, 6).map((r) => r.id)
  const p = ctx.prefs
  return { home: { name: p.homeName, lat: p.homeLat, lon: p.homeLon, tz: p.homeTimezone }, resorts, picks }
}

/** "08:30 Sat, Sun · 09:30 Fri" from last season's published lift rows (historical, for context only). */
function lastSeasonHours(schedules: readonly OperatingScheduleRow[], seasonId: string): string | null {
  const rows = schedules.filter((x) => x.activity === 'lifts' && x.seasonId === seasonId && !x.exceptionDate && !x.closed && x.opens)
  if (!rows.length) return null
  const byTime = new Map<string, Set<number>>()
  for (const r of rows) {
    const set = byTime.get(r.opens!) ?? new Set<number>()
    for (const d of r.daysOfWeek ?? [1, 2, 3, 4, 5, 6, 7]) set.add(d)
    byTime.set(r.opens!, set)
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([t, days]) => (days.size === 7 ? `${t} daily` : `${t} ${[...days].sort().map((d) => WEEKDAY[d]).join(', ')}`))
    .join(' · ')
}

/** The journey plan for one resort, or null when the id is unknown. */
export async function getRidePlan(ctx: Ctx, resortId: string): Promise<RidePlan | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(resortId)) return null
  const b = await loadBundle(ctx, { ids: [resortId] })
  const rec = b.byId.get(resortId)
  if (!rec) return null
  const r = rec.row
  const p = ctx.prefs
  const home: RideHome = { name: p.homeName, lat: p.homeLat, lon: p.homeLon, tz: p.homeTimezone }
  const tv = travelView(b, resortId)
  const demo = ctx.mode === 'demo'

  const originCodes = p.travel.originAirports.length ? p.travel.originAirports : ['ITH']
  const [originRows, schedules] = await Promise.all([
    ctx.db.select().from(s.airports).where(inArray(s.airports.iata, originCodes)),
    ctx.db.select().from(s.operatingSchedules).where(and(eq(s.operatingSchedules.resortId, resortId), eq(s.operatingSchedules.activity, 'lifts'))),
  ])
  const originBy = new Map(originRows.map((a) => [a.iata, a]))
  const origins: RideAirport[] = originCodes
    .map((code) => originBy.get(code))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({
      iata: a.iata,
      name: a.name,
      city: a.city,
      lat: a.lat,
      lon: a.lon,
      minutes: a.driveFromHome?.minutes ?? null,
      km: a.driveFromHome?.km ?? null,
      role: a.role,
      confirm: 'Estimate — confirm with a routing service',
    }))

  const gateways: RideAirport[] = tv.airports
    .map((a) => {
      const row = b.airports.get(a.iata)
      if (!row) return null
      return {
        iata: a.iata,
        name: a.name,
        city: a.city,
        lat: row.lat,
        lon: row.lon,
        minutes: a.minutes,
        km: a.km,
        role: a.role,
        confirm: needsConfirmation(a.prov) ? (a.prov?.verification === 'search-summary' ? 'Researched — confirm at source' : 'Reference — confirm at source') : null,
      }
    })
    .filter((a): a is RideAirport => !!a)

  const drive: RideDrive | null =
    tv.driveMinutes != null
      ? {
          minutes: tv.driveMinutes,
          winterMinutes: tv.winterMinutes,
          bufferPct: tv.winterBufferPct,
          km: tv.km,
          isEstimate: tv.isEstimate,
          basis: tv.basis,
          confirm: needsConfirmation(tv.prov) ? (tv.prov?.verification === 'search-summary' ? 'Researched — confirm at source' : 'Estimate — confirm at source') : null,
          directionsUrl: directionsLink({ lat: home.lat, lon: home.lon }, { lat: r.lat, lon: r.lon })?.url ?? null,
        }
      : null

  const recommended: RidePlan['recommended'] = tv.verdict.mode === 'none' ? (drive ? 'drive' : gateways.length ? 'fly' : 'none') : tv.verdict.mode

  // Leave by: the next resort-local day (within two weeks) with published lift hours, minus the drive (with buffer).
  const rToday = resortToday(r, ctx.now)
  const hemi = hemisphereOf(r.lat)
  let lb: RideLeaveBy
  const prevSeason = previousSeasonId(seasonIdForHemisphere(rToday, hemi))
  const last = lastSeasonHours(schedules, prevSeason)
  if (!drive) {
    lb = { state: 'unknown', reason: gateways.length ? 'Needs flight times, which Piste does not show' : 'No drive estimate recorded', short: gateways.length ? 'Needs flight times' : 'No drive estimate', lastSeason: null }
  } else {
    let found: { date: string; opens: string } | null = null
    for (let i = 0; i < 14 && !found; i++) {
      const date = addDays(rToday, i)
      const h = liftHoursFor(schedules, date, hemi)
      if (h) found = { date, opens: h.opens }
    }
    const planMinutes = drive.winterMinutes ?? drive.minutes
    const calc = found ? leaveBy({ date: found.date, firstLift: found.opens, resortTz: r.timezone, homeTz: home.tz, driveMinutes: planMinutes }) : null
    if (found && calc && calc.leaveAt > ctx.now) {
      lb = {
        state: 'known',
        leave: calc.leaveLocal,
        leaveDay: formatLocalDate(calc.leaveDate, 'ccc d LLL'),
        firstLift: found.opens,
        dayLabel: formatLocalDate(found.date, 'ccc d LLL'),
        dateIso: found.date,
        usesBuffer: drive.winterMinutes != null,
      }
    } else {
      lb = { state: 'unknown', reason: 'First-lift time not posted for the next two weeks', short: 'First lift not posted', lastSeason: last ? `${prevSeason.replace('-', '–')}: ${last}` : null }
    }
  }

  // Opening wording for the season in play.
  const season = seasonRowFor(b, r, rToday)
  const seasonId = seasonIdForHemisphere(rToday, hemi)
  const ov = openingView(season, seasonId, rToday)
  const sl = seasonId.replace('-', '–')
  const opening =
    ov.label === 'opened'
      ? `The ${sl} season has opened.`
      : ov.label === 'announced'
        ? `${sl} opening announced: ${ov.text ?? (ov.date ? formatLocalDate(ov.date, 'd LLL yyyy') : 'date in the announcement')}.`
        : ov.label === 'estimated' && ov.date
          ? `${sl} opening not announced. Piste estimates from ${formatLocalDate(ov.date, 'd LLL')} (estimate).`
          : `${sl} opening date not announced.`

  // Modeled weather at the base for the next hours, only when a run is stored.
  let weather: RideWeather | null = null
  const run = b.runs.get(resortId)?.get('base') ?? b.runs.get(resortId)?.values().next().value ?? null
  if (run) {
    const from = floorHour(ctx.now)
    const pts = (await pointsForRuns(ctx.db, [run.id], from, addHours(from, 12))).get(run.id) ?? []
    const hours = pts.filter((_, i) => i % 2 === 0).slice(0, 6)
    if (hours.length) {
      weather = {
        where: run.pointKey === 'base' ? `${r.shortName} base` : r.shortName,
        source: `${run.kind === 'demo' ? 'Demo' : 'Modeled'} · ${run.provider} · fetched ${relativeLabel(run.fetchedAt, ctx.now)}`,
        demo: run.kind === 'demo',
        hours: hours.map((h) => ({ label: formatInstant(h.validTime, r.timezone, 'HH:mm'), tempC: h.temperatureC, snowCm: h.snowfallCm, windKmh: h.windKmh })),
      }
    }
  }

  // Flight search links (external searches only) for every origin × gateway pair.
  const depart = nextSaturday(ctx.today)
  const flightSearch: RidePlan['flightSearch'] = {}
  for (const o of origins)
    for (const g of gateways) {
      const link = flightSearchLinks({ from: o.iata, to: g.iata, depart, return: addDays(depart, 1) })[0]
      if (link) flightSearch[`${o.iata}-${g.iata}`] = { label: link.label, url: link.url }
    }

  const unknowns: string[] = []
  unknowns.push(opening)
  if (drive && lb.state === 'unknown') unknowns.push(`Leave-by time: ${lb.reason.toLowerCase()}.`)
  if (drive) unknowns.push('Road conditions and weather along the road are not modeled by Piste. Check the state road report before you go.')
  if (drive) unknowns.push('Driving cost is not estimated (no fuel or toll data).')
  if (gateways.length) unknowns.push('Flight times, airlines and fares are not shown. The flight arc is illustrative.')
  if (gateways.some((g) => g.minutes == null)) unknowns.push('Some airport transfer times are not recorded.')
  if (!drive && !gateways.length) unknowns.push('No drive estimate or airport is recorded for this resort.')

  return {
    resort: { id: r.id, name: r.name, short: r.shortName, where: whereOf(r), lat: r.lat, lon: r.lon, tz: r.timezone, href: `/resorts/${r.id}`, country: r.country, baseM: r.baseElevationM, summitM: r.summitElevationM },
    home,
    units: p.units,
    straightKm: haversineKm([home.lon, home.lat], [r.lon, r.lat]),
    drive,
    origins,
    gateways,
    transfers: tv.transfers.filter((t) => t.name).map((t) => ({ name: t.name!, type: t.type, url: t.url })),
    recommended,
    verdictNote: tv.verdict.note ?? null,
    leaveBy: lb,
    opening,
    weather,
    flightSearch,
    unknowns,
    demo,
  }
}
