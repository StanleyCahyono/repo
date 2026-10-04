/**
 * City labels for the Explore schematic map (Natural Earth populated places, public domain) — pure, unit-tested.
 *
 * - Zoom-aware density: Natural Earth's `min_zoom` (`z`, for 256 px tiles) decides when a place appears. At the world
 *   view only the major cities show; a region view (Alps, Northeast, Japan…) brings in regional cities and the towns
 *   near resorts (Geneva, Innsbruck, Salt Lake City, Sapporo, Queenstown, Ithaca…).
 * - Collision-aware: resort markers, cluster bubbles, the home marker and the HUD panels always win. A city label is
 *   placed right of its dot, else left; if both sides collide with anything already placed it is dropped.
 * - Output is a list of anchors; the stage positions them with the live camera, so they move exactly like markers.
 */
import { project, rectsHit, type Camera, type Rect } from './geo'

export interface City {
  /** Name. */
  n: string
  /** [lon, lat] */
  ll: [number, number]
  /** Natural Earth min_zoom (256 px tiles): the zoom at which a web map would start labelling it. */
  z: number
  pop: number
  /** 1 = national capital. */
  c: number
}

export type CitySide = 'right' | 'left' | 'above' | 'below'

export interface CityLabel {
  key: string
  name: string
  lon: number
  lat: number
  capital: boolean
  /** Where the label sits around its dot: right (preferred), left, above or below. */
  side: CitySide
  /** The city is where the home marker is: the home diamond stands in for its dot and the label clears it. */
  atHome: boolean
}

/**
 * Natural Earth's z is for 256 px tiles; the stage's camera uses 512 px tiles (one level lower for the same view).
 * A small lead lets regional towns appear at the region framing rather than only after one more zoom.
 */
export const CITY_ZOOM_LEAD = 1.4

export function cityVisibleAt(c: Pick<City, 'z' | 'c'>, zoom: number): boolean {
  // The world's major cities (Natural Earth z ≤ 2) are always candidates: even a phone-sized world map needs a few.
  return c.z <= 2 || c.z - (c.c ? 0.3 : 0) <= zoom + CITY_ZOOM_LEAD
}

/** Approximate width of a 12px Geist label (capitals are set a little bolder). Tests and the server use this. */
export function estimateCityText(name: string, capital: boolean): number {
  return name.length * (capital ? 6.8 : 6.4)
}

export interface CityLayoutOpts {
  /** Rectangles labels must stay clear of: placed markers and bubbles (with their labels), home, HUD panels. */
  blockers: readonly Rect[]
  /** Keep labels this far inside the stage edges. */
  margin?: number
  /** Most labels to place (scaled to the stage area by the caller). */
  max?: number
  measure?: (name: string, capital: boolean) => number
  /** Home marker (screen px). Other labels keep clear of it; a city right at home is labelled beside it. */
  home?: { x: number; y: number } | null
}

/** Half-size of the area kept clear around the home marker, and how close a city must be to count as "at home". */
export const HOME_CLEAR = 10
const AT_HOME = 8

/** Dot (5px) + gap + text, 16px tall; `x`,`y` is the city. At home the label starts past the home marker. */
export function cityBox(x: number, y: number, textW: number, side: CitySide, atHome = false): Rect {
  const h = 16
  if (atHome) return side === 'left' ? { l: x - HOME_CLEAR - 4 - textW, r: x - HOME_CLEAR - 1, t: y - h / 2, b: y + h / 2 } : { l: x + HOME_CLEAR + 1, r: x + HOME_CLEAR + 4 + textW, t: y - h / 2, b: y + h / 2 }
  switch (side) {
    case 'left':
      return { l: x - 9 - textW - 2, r: x + 4, t: y - h / 2, b: y + h / 2 }
    case 'above':
      // Text centred over the dot; the box covers the dot too, so a marker never hides it.
      return { l: Math.min(x - 4, x - textW / 2 - 2), r: Math.max(x + 4, x + textW / 2 + 2), t: y - 5 - h, b: y + 4 }
    case 'below':
      return { l: Math.min(x - 4, x - textW / 2 - 2), r: Math.max(x + 4, x + textW / 2 + 2), t: y - 4, b: y + 5 + h }
    default:
      return { l: x - 4, r: x + 9 + textW + 2, t: y - h / 2, b: y + h / 2 }
  }
}

/** Placement order: beside the dot reads best; above / below rescue labels squeezed between markers. */
const SIDES: readonly CitySide[] = ['right', 'left', 'above', 'below']

/**
 * Pick and place the city labels for a camera. Order: lower Natural Earth zoom first (more important places), then
 * capitals, then population; a label that would touch a blocker or an earlier label is dropped.
 */
export function layoutCities(cities: readonly City[], cam: Camera, w: number, h: number, opts: CityLayoutOpts): CityLabel[] {
  const margin = opts.margin ?? 6
  const max = opts.max ?? 60
  const measure = opts.measure ?? estimateCityText
  const candidates = cities
    .filter((c) => cityVisibleAt(c, cam.zoom))
    .map((c) => ({ c, p: project(c.ll[0], c.ll[1], cam, w, h) }))
    .filter(({ p }) => p.x > margin && p.x < w - margin && p.y > margin + 8 && p.y < h - margin - 8)
    .sort((a, b) => a.c.z - b.c.z || b.c.c - a.c.c || b.c.pop - a.c.pop || a.c.n.localeCompare(b.c.n))
  const home = opts.home ?? null
  const homeRect: Rect | null = home ? { l: home.x - HOME_CLEAR, t: home.y - HOME_CLEAR, r: home.x + HOME_CLEAR, b: home.y + HOME_CLEAR } : null
  const placed: Rect[] = []
  const out: CityLabel[] = []
  const clear = (r: Rect) =>
    r.l >= margin &&
    r.r <= w - margin &&
    r.t >= margin &&
    r.b <= h - margin &&
    !opts.blockers.some((b) => rectsHit(r, b, 3)) &&
    !(homeRect && rectsHit(r, homeRect, 3)) &&
    !placed.some((b) => rectsHit(r, b, 6))
  for (const { c, p } of candidates) {
    if (out.length >= max) break
    const capital = c.c === 1
    const tw = measure(c.n, capital)
    const atHome = !!home && Math.hypot(p.x - home.x, p.y - home.y) <= AT_HOME
    for (const side of atHome ? (['right', 'left'] as const) : SIDES) {
      const box = cityBox(p.x, p.y, tw, side, atHome)
      if (!clear(box)) continue
      placed.push(box)
      out.push({ key: `${c.n}@${c.ll[0]},${c.ll[1]}`, name: c.n, lon: c.ll[0], lat: c.ll[1], capital, side, atHome })
      break
    }
  }
  return out
}

/** How many labels a stage of this size can carry without feeling busy (≈ one per 150 × 150 px). */
export function cityBudget(w: number, h: number): number {
  return Math.max(3, Math.min(70, Math.round((w * h) / 22000)))
}
