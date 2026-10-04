/**
 * Place labels for the lifts-and-runs map: which towns, peaks and lift stations to name at the current zoom, and where
 * each label goes so that none overlaps another label, the map's own controls (zoom buttons, scale, selection card)
 * or the edge of the frame. Pure screen-space layout: the caller projects places to pixels and measures text.
 *
 * Priority: city / town > village > peak (higher first) > lift station > hamlet. Settlements always show at the
 * starting zoom; hamlets and stations appear as you zoom in. Each label tries a few positions around its point before
 * it is dropped.
 */

export type PlaceKind = 'city' | 'town' | 'village' | 'hamlet' | 'peak' | 'station'

export interface MapPlaceLabel {
  id: string
  name: string
  kind: PlaceKind
  lon: number
  lat: number
  /** '4,478 m' in the viewer's units (peaks, stations), or null. */
  ele: string | null
  /** Elevation in metres, for ordering peaks. */
  eleM: number | null
}

export interface Rect {
  l: number
  t: number
  r: number
  b: number
}

export interface LabelStyle {
  size: number
  weight: number
  /** Marker drawn at the point: settlement dot, peak triangle, station square. */
  marker: 'dot' | 'dot-lg' | 'peak' | 'station'
  /** Zoom factor (1 = the whole area in frame) from which the label may appear. */
  minZoom: number
  rank: number
}

export const LABEL_STYLE: Record<PlaceKind, LabelStyle> = {
  city: { size: 15, weight: 650, marker: 'dot-lg', minZoom: 0, rank: 0 },
  town: { size: 14, weight: 650, marker: 'dot-lg', minZoom: 0, rank: 0 },
  village: { size: 13, weight: 600, marker: 'dot', minZoom: 0, rank: 1 },
  peak: { size: 12, weight: 550, marker: 'peak', minZoom: 0, rank: 2 },
  station: { size: 12, weight: 500, marker: 'station', minZoom: 2.4, rank: 3 },
  hamlet: { size: 12, weight: 500, marker: 'dot', minZoom: 1.7, rank: 4 },
}

/** Elevation text size (mono, beside the name). */
export const ELE_SIZE = 12
const GAP = 7
const LINE = 1.3
const PAD = 3
const EDGE = 6

export interface PlacedLabel {
  place: MapPlaceLabel
  /** The point, px. */
  x: number
  y: number
  /** Text box, px (top-left corner + size). */
  box: { left: number; top: number; width: number; height: number }
  side: 'right' | 'left' | 'top' | 'bottom'
}

const hit = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
const grow = (a: Rect, d: number): Rect => ({ l: a.l - d, t: a.t - d, r: a.r + d, b: a.b + d })

/**
 * Lay out labels.
 * - `project` turns a place into a screen point (null when it cannot be drawn).
 * - `measure(text, size, weight, mono)` returns the rendered width in px.
 * - `zoom` is the zoom factor relative to the starting view (1 = whole area).
 * - `obstacles` are screen rects labels must avoid (controls, cards).
 */
export function layoutLabels(
  places: MapPlaceLabel[],
  opts: {
    project: (p: MapPlaceLabel) => [number, number] | null
    measure: (text: string, size: number, weight: number, mono: boolean) => number
    width: number
    height: number
    zoom: number
    obstacles?: Rect[]
  },
): PlacedLabel[] {
  const { width, height, zoom } = opts
  const taken: Rect[] = (opts.obstacles ?? []).map((o) => grow(o, PAD))
  const out: PlacedLabel[] = []
  const order = places
    .filter((p) => zoom >= LABEL_STYLE[p.kind].minZoom)
    .sort((a, b) => LABEL_STYLE[a.kind].rank - LABEL_STYLE[b.kind].rank || (b.eleM ?? 0) - (a.eleM ?? 0) || a.name.localeCompare(b.name))
  for (const p of order) {
    const pt = opts.project(p)
    if (!pt) continue
    const [x, y] = pt
    if (x < EDGE || y < EDGE || x > width - EDGE || y > height - EDGE) continue
    const st = LABEL_STYLE[p.kind]
    const m = st.marker === 'peak' ? 11 : st.marker === 'dot-lg' ? 9 : st.marker === 'station' ? 7 : 7
    const markerBox: Rect = { l: x - m / 2, t: y - m / 2, r: x + m / 2, b: y + m / 2 }
    if (taken.some((r) => hit(markerBox, r))) continue
    const nameW = opts.measure(p.name, st.size, st.weight, false)
    const eleW = p.ele ? opts.measure(p.ele, ELE_SIZE, 500, true) + 5 : 0
    const w = Math.ceil(nameW + eleW)
    const h = Math.ceil(st.size * LINE)
    const off = m / 2 + GAP / 2 + 1
    const candidates: [PlacedLabel['side'], number, number][] = [
      ['right', x + off, y - h / 2],
      ['left', x - off - w, y - h / 2],
      ['top', x - w / 2, y - off - h],
      ['bottom', x - w / 2, y + off],
    ]
    for (const [side, left, top] of candidates) {
      const r: Rect = { l: left, t: top, r: left + w, b: top + h }
      if (r.l < EDGE || r.t < EDGE || r.r > width - EDGE || r.b > height - EDGE) continue
      if (taken.some((o) => hit(r, o))) continue
      taken.push(grow(r, PAD), grow(markerBox, 1))
      out.push({ place: p, x, y, box: { left, top, width: w, height: h }, side })
      break
    }
  }
  return out
}

/** The base village named by the catalog locality: "Zermatt (car-free), linked with …" → "Zermatt". */
export function baseVillageName(locality: string | null | undefined): string | null {
  if (!locality) return null
  const first = locality
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;:]|\s+and\s+|\s+linked\s+|\s+with\s+|\s+\/\s+/i)[0]
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(village|town|towns|city)$/i, '')
  return first && first.length <= 32 && /\p{L}/u.test(first) ? first : null
}

/**
 * Where to pin a label's text so it hugs its marker even when the measured width is a little off (fonts still
 * loading): left-side labels grow leftwards from the marker, top / bottom labels are centred on it.
 */
export function labelAnchor(pl: PlacedLabel): { left: number; top: number; transform?: string } {
  const { box, side } = pl
  if (side === 'left') return { left: box.left + box.width, top: box.top, transform: 'translateX(-100%)' }
  if (side === 'top' || side === 'bottom') return { left: box.left + box.width / 2, top: box.top, transform: 'translateX(-50%)' }
  return { left: box.left, top: box.top }
}
