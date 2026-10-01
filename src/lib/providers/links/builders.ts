/**
 * Prefilled SEARCH and DIRECTIONS links. These open third-party sites in the browser; Piste never reads fares,
 * schedules, availability or routes from them, so UI must present them as "Search …" / "Directions" links and never
 * as live data. Invalid input returns null (the link is simply not offered).
 */
import { isLocalDate } from '@/lib/domain/time'

export interface SearchLink {
  kind: 'flight-search' | 'directions' | 'map' | 'forecast-page' | 'attribution'
  label: string
  url: string
  /** Always false: these are links, not data feeds. */
  liveData: false
  note: string
}

const IATA = /^[A-Z]{3}$/

function iata(code: string | null | undefined): string | null {
  const c = (code ?? '').trim().toUpperCase()
  return IATA.test(c) ? c : null
}

function dates(depart: string, ret: string | null | undefined): { depart: string; ret: string | null } | null {
  if (!isLocalDate(depart)) return null
  if (ret === null || ret === undefined || ret === '') return { depart, ret: null }
  if (!isLocalDate(ret) || ret < depart) return null
  return { depart, ret }
}

function coord(v: number, limit: number): string | null {
  if (!Number.isFinite(v) || Math.abs(v) > limit) return null
  return String(Number(v.toFixed(5)))
}

export interface FlightSearch {
  from: string
  to: string
  /** YYYY-MM-DD */
  depart: string
  return?: string | null
}

/** Google Flights natural-language query form: /travel/flights?q=Flights from ITH to SLC on … through … */
export function googleFlightsSearchUrl(q: FlightSearch): string | null {
  const from = iata(q.from)
  const to = iata(q.to)
  const d = dates(q.depart, q.return)
  if (!from || !to || !d || from === to) return null
  const text = `Flights from ${from} to ${to} on ${d.depart}${d.ret ? ` through ${d.ret}` : ''}`
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(text)}`
}

/** KAYAK path form: /flights/ITH-SLC/2027-01-15/2027-01-19 (one-way omits the return segment). */
export function kayakFlightsUrl(q: FlightSearch): string | null {
  const from = iata(q.from)
  const to = iata(q.to)
  const d = dates(q.depart, q.return)
  if (!from || !to || !d || from === to) return null
  return `https://www.kayak.com/flights/${from}-${to}/${d.depart}${d.ret ? `/${d.ret}` : ''}`
}

export type Place = string | { lat: number; lon: number }
export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit'

function place(p: Place): string | null {
  if (typeof p === 'string') {
    const s = p.trim()
    return s.length > 0 && s.length <= 300 ? s : null
  }
  const lat = coord(p.lat, 90)
  const lon = coord(p.lon, 180)
  return lat && lon ? `${lat},${lon}` : null
}

/** Google Maps URLs API directions link (https://developers.google.com/maps/documentation/urls/get-started). */
export function googleMapsDirectionsUrl(origin: Place, destination: Place, travelmode: TravelMode = 'driving'): string | null {
  const o = place(origin)
  const d = place(destination)
  if (!o || !d) return null
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=${travelmode}`
}

/** OpenSkiMap centred on a point: https://openskimap.org/#zoom/lat/lon */
export function openSkiMapUrl(lat: number, lon: number, zoom = 12): string | null {
  const la = coord(lat, 90)
  const lo = coord(lon, 180)
  if (!la || !lo || !Number.isInteger(zoom) || zoom < 1 || zoom > 18) return null
  return `https://openskimap.org/#${zoom}/${la}/${lo}`
}

/** NWS point forecast page (human-readable; shows active hazards). US locations only. */
export function nwsForecastPageUrl(lat: number, lon: number): string | null {
  const la = coord(lat, 90)
  const lo = coord(lon, 180)
  if (!la || !lo) return null
  return `https://forecast.weather.gov/MapClick.php?lat=${la}&lon=${lo}`
}

export const OPEN_METEO_ATTRIBUTION_LINK: SearchLink = {
  kind: 'attribution',
  label: 'Weather data by Open-Meteo.com',
  url: 'https://open-meteo.com/',
  liveData: false,
  note: 'Open-Meteo data is licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).',
}

/** Labelled flight-search links for a route/date pair (empty when input is invalid). */
export function flightSearchLinks(q: FlightSearch): SearchLink[] {
  const out: SearchLink[] = []
  const g = googleFlightsSearchUrl(q)
  if (g) out.push({ kind: 'flight-search', label: 'Search Google Flights', url: g, liveData: false, note: 'Opens a search on Google Flights. Piste shows no fares or schedules from it.' })
  const k = kayakFlightsUrl(q)
  if (k) out.push({ kind: 'flight-search', label: 'Search KAYAK', url: k, liveData: false, note: 'Opens a search on KAYAK. Piste shows no fares or schedules from it.' })
  return out
}

export function directionsLink(origin: Place, destination: Place, label = 'Driving directions'): SearchLink | null {
  const url = googleMapsDirectionsUrl(origin, destination, 'driving')
  return url ? { kind: 'directions', label, url, liveData: false, note: 'Opens Google Maps directions; travel time there is Google’s estimate, not Piste data.' } : null
}
