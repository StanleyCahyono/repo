/**
 * Distances and the "long haul" rule. Pure.
 *
 * Today answers short-range questions ("where do I ski this weekend?"). A resort more than LONG_HAUL_KM from home
 * (great-circle distance) is a trip to plan — Europe or Japan from North America, Australia or New Zealand from
 * almost anywhere else — so Today's ranking, its seven-day strip and the weekend finder leave it out. It stays in
 * Explore, Trips, Passes, Forecast and in favourites.
 */

/** Resorts farther than this (km, great circle) from home are planned as trips, not ranked on Today. */
export const LONG_HAUL_KM = 4500

/** Where the long-haul rule is explained in the UI. */
export const LONG_HAUL_NOTE = 'Resorts more than a long flight away are planned as trips — see Explore'

export interface LatLon {
  lat: number
  lon: number
}

/** Great-circle ("straight-line") distance in km between two coordinates (haversine, mean Earth radius). */
export function greatCircleKm(a: LatLon, b: LatLon): number {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * More than LONG_HAUL_KM from home. Unknown coordinates are never long haul (nothing is hidden on a guess).
 */
export function isLongHaul(home: Partial<LatLon> | null | undefined, resort: Partial<LatLon> | null | undefined, limitKm = LONG_HAUL_KM): boolean {
  const ok = (p: Partial<LatLon> | null | undefined): p is LatLon =>
    !!p && typeof p.lat === 'number' && typeof p.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon)
  if (!ok(home) || !ok(resort)) return false
  return greatCircleKm(home, resort) > limitKm
}
