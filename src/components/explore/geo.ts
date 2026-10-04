/**
 * Explore map geometry — pure (no DOM, no MapLibre), shared by the stage and unit tests.
 *
 * - Web Mercator with 512 px tiles, so a camera `{ lon, lat, zoom }` means the same view here as in MapLibre.
 * - Region jumps: camera presets over Explore's region groups (the list follows the jump; filters are untouched).
 * - Label-aware clustering: markers whose label boxes would collide merge into one count bubble, so names never
 *   overlap on the map. Clicking a bubble zooms to its members.
 */

export const TILE = 512
export const MAX_LAT = 85.0511

export interface Camera {
  lon: number
  lat: number
  zoom: number
}

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

/** [west, south, east, north] in degrees. */
export type Bounds = [number, number, number, number]

const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))

/** Longitude → world x at zoom 0 (0…512). */
export function mx(lon: number): number {
  return ((lon + 180) / 360) * TILE
}

/** Latitude → world y at zoom 0 (0…512, north up). */
export function my(lat: number): number {
  const phi = (clampLat(lat) * Math.PI) / 180
  return ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * TILE
}

export function lonOf(x: number): number {
  return (x / TILE) * 360 - 180
}

export function latOf(y: number): number {
  const n = Math.PI - (2 * Math.PI * y) / TILE
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** Screen position of a coordinate for a camera and a viewport size. */
export function project(lon: number, lat: number, cam: Camera, width: number, height: number): { x: number; y: number } {
  const s = 2 ** cam.zoom
  return { x: (mx(lon) - mx(cam.lon)) * s + width / 2, y: (my(lat) - my(cam.lat)) * s + height / 2 }
}

/** Coordinate under a screen point. */
export function unproject(x: number, y: number, cam: Camera, width: number, height: number): { lon: number; lat: number } {
  const s = 2 ** cam.zoom
  return { lon: lonOf(mx(cam.lon) + (x - width / 2) / s), lat: latOf(my(cam.lat) + (y - height / 2) / s) }
}

export function boundsOf(points: readonly { lon: number; lat: number }[]): Bounds | null {
  if (!points.length) return null
  let w = 180
  let s = 90
  let e = -180
  let n = -90
  for (const p of points) {
    w = Math.min(w, p.lon)
    e = Math.max(e, p.lon)
    s = Math.min(s, p.lat)
    n = Math.max(n, p.lat)
  }
  return [w, s, e, n]
}

/** Camera that fits `b` inside the viewport minus padding (like MapLibre's cameraForBounds). */
export function fitCamera(b: Bounds, width: number, height: number, pad: Padding, opts: { maxZoom?: number; minZoom?: number } = {}): Camera {
  const { maxZoom = 9, minZoom = -0.6 } = opts
  const [w, s, e, n] = b
  const x0 = mx(w)
  const x1 = mx(e)
  const y0 = my(n)
  const y1 = my(s)
  const availW = Math.max(40, width - pad.left - pad.right)
  const availH = Math.max(40, height - pad.top - pad.bottom)
  const dx = Math.max(x1 - x0, 1e-6)
  const dy = Math.max(y1 - y0, 1e-6)
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.log2(Math.min(availW / dx, availH / dy))))
  const scale = 2 ** zoom
  // Centre of the bounds, shifted so it lands in the middle of the padded area.
  const cx = (x0 + x1) / 2 - (pad.left - pad.right) / 2 / scale
  const cy = (y0 + y1) / 2 - (pad.top - pad.bottom) / 2 / scale
  return { lon: lonOf(cx), lat: latOf(cy), zoom }
}

/** Keep the world filling the viewport vertically (no empty band above 85°N / below 85°S). */
export function clampCamera(c: Camera, height: number): Camera {
  const s = 2 ** c.zoom
  const worldH = TILE * s
  const y = my(c.lat) * s
  const half = height / 2
  const cy = worldH <= height ? worldH / 2 : Math.min(worldH - half, Math.max(half, y))
  const lon = ((((c.lon + 180) % 360) + 360) % 360) - 180
  return { lon, lat: latOf(cy / s), zoom: c.zoom }
}

/** Interpolated camera for a fly between two cameras: centre glides, zoom dips mid-flight for long hops. */
export function flyFrame(a: Camera, b: Camera, t: number): Camera {
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  const ax = mx(a.lon)
  const ay = my(a.lat)
  const bx = mx(b.lon)
  const by = my(b.lat)
  // How far apart the two centres are on screen at the lower zoom decides how much to pull back.
  const zMin = Math.min(a.zoom, b.zoom)
  const dist = Math.hypot(bx - ax, by - ay) * 2 ** zMin
  const dip = Math.min(2.2, Math.max(0, Math.log2(dist / 300 + 1) * 0.9))
  const zoom = a.zoom + (b.zoom - a.zoom) * e - dip * Math.sin(Math.PI * e)
  return { lon: lonOf(ax + (bx - ax) * e), lat: latOf(ay + (by - ay) * e), zoom }
}

// ---------------------------------------------------------------------------
// Region jumps

export interface JumpDef {
  key: string
  label: string
  /** Region groups (from the Explore read model); null = everything. */
  groups: readonly string[] | null
}

export const JUMPS: readonly JumpDef[] = [
  { key: 'world', label: 'World', groups: null },
  { key: 'northeast', label: 'Northeast', groups: ['Northeast US', 'Eastern Canada'] },
  { key: 'west', label: 'Rockies & West', groups: ['Western US', 'Western Canada'] },
  { key: 'alps', label: 'Alps', groups: ['Austria', 'Switzerland', 'France', 'Italy', 'Germany'] },
  { key: 'europe', label: 'Pyrenees & North', groups: ['Andorra & Spain', 'Scandinavia', 'Other Europe'] },
  { key: 'japan', label: 'Japan & Korea', groups: ['Japan', 'South Korea'] },
  { key: 'anz', label: 'Australia & NZ', groups: ['Australia & New Zealand'] },
  { key: 'south-america', label: 'South America', groups: ['South America'] },
]

export function jumpOf(key: string | null | undefined): JumpDef {
  return JUMPS.find((j) => j.key === key) ?? JUMPS[0]
}

export function inJump(jump: JumpDef, regionGroup: string): boolean {
  return !jump.groups || jump.groups.includes(regionGroup)
}

/** Jumps that hold at least one catalog resort, with counts (World first). */
export function availableJumps(groups: readonly string[]): { def: JumpDef; count: number }[] {
  return JUMPS.map((def) => ({ def, count: groups.filter((g) => inJump(def, g)).length })).filter((j) => j.def.key === 'world' || j.count > 0)
}

// ---------------------------------------------------------------------------
// Clustering

export interface ClusterInput {
  id: string
  name: string
  x: number
  y: number
  /** Higher keeps its own label first (selected, highlighted, favourites). 3+ = pinned: never merged into a bubble. */
  priority?: number
  /** Extra label width in px (e.g. a favourite star after the name). */
  extra?: number
}

/** Where a marker's label goes: right of the point, left of it, no label (dot / count only), or not drawn at all. */
export type LabelSide = 'right' | 'left' | 'dot' | 'hidden'

export interface Cluster<T extends ClusterInput> {
  key: string
  x: number
  y: number
  members: T[]
  /** The label runs to the left of the point (it would cross `maxX` or a panel otherwise). */
  flip: boolean
  /** Final label placement (see LabelSide). */
  side: LabelSide
  /** The member whose name captions the bubble (highest priority, then input order). */
  lead: T
}

/** Screen rectangle (px): left, top, right, bottom. */
export interface Rect {
  l: number
  t: number
  r: number
  b: number
}

/** Text width in px for a marker label; the stage passes a canvas measurer, tests use the estimate. */
export type MeasureText = (text: string) => number

export const estimateText: MeasureText = (text) => Math.min(text.length, 32) * 6.9

/** Pill size for a single marker label: dot + name (+ extra) at 12.5px Geist. */
export function labelBox(name: string, measure: MeasureText = estimateText, extra = 0): { w: number; h: number } {
  return { w: 38 + measure(name) + extra, h: 28 }
}

/** Bubble size for a cluster: count badge + the lead name ("[36] Greek Peak"). */
export function bubbleBox(caption: string, count = 2, measure: MeasureText = estimateText): { w: number; h: number } {
  return { w: 26 + Math.max(22, String(count).length * 7.5 + 8) + measure(caption), h: 34 }
}

/** Count badge alone (a bubble whose caption has no room). */
export const BADGE = 34
/** A single marker without its label: the dot and its halo. */
export const DOT = 16

/**
 * Bubble caption: the lead resort's full name — never cut mid-word. Two short names both fit ("Alta · Snowbird");
 * the count badge says how many more, the hover list names them all.
 */
export function clusterCaption(names: readonly string[]): string {
  if (!names.length) return ''
  if (names.length === 2 && names[0].length + names[1].length <= 22) return `${names[0]} · ${names[1]}`
  return names[0]
}

/** The member that names a bubble: highest priority, then the order the points came in (the list order). */
export function clusterLead<T extends ClusterInput>(members: readonly T[], rank: ReadonlyMap<string, number>): T {
  let best = members[0]
  for (const m of members) {
    const dp = (m.priority ?? 0) - (best.priority ?? 0)
    if (dp > 0 || (dp === 0 && (rank.get(m.id) ?? 0) < (rank.get(best.id) ?? 0))) best = m
  }
  return best
}

const hit = (a: Rect, b: Rect, gap: number) => a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap

export function rectsHit(a: Rect, b: Rect, gap = 0): boolean {
  return hit(a, b, gap)
}

interface Placed {
  box: Rect | null
  side: LabelSide
}

interface PlaceOpts {
  maxX: number
  minX: number
  obstacles: readonly Rect[]
}

/**
 * Label box around an anchor: the dot sits on the point and the label runs right — or left when the right side
 * crosses `maxX` or a panel. When neither side is clear of the panels the marker drops its label (`dot`), and a
 * marker whose dot is itself under a panel is not drawn (`hidden`).
 */
function placeBox(x: number, y: number, w: number, h: number, inset: number, dot: number, o: PlaceOpts): Placed {
  const right: Rect = { l: x - inset, r: x - inset + w, t: y - h / 2, b: y + h / 2 }
  const left: Rect = { l: x + inset - w, r: x + inset, t: y - h / 2, b: y + h / 2 }
  const clearR = !o.obstacles.some((b) => hit(right, b, 2))
  const clearL = !o.obstacles.some((b) => hit(left, b, 2))
  const fitsR = right.r <= o.maxX
  const fitsL = left.l >= o.minX
  if (clearR && fitsR) return { box: right, side: 'right' }
  if (clearL && fitsL) return { box: left, side: 'left' }
  // Neither side fits the edges but one is clear of panels: keep the roomier clear side (the stage clips the rest).
  if (clearR && clearL) return o.maxX - x >= x - o.minX ? { box: right, side: 'right' } : { box: left, side: 'left' }
  if (clearR) return { box: right, side: 'right' }
  if (clearL) return { box: left, side: 'left' }
  const d: Rect = { l: x - dot / 2, r: x + dot / 2, t: y - dot / 2, b: y + dot / 2 }
  if (o.obstacles.some((b) => hit(d, b, 0))) return { box: null, side: 'hidden' }
  return { box: d, side: 'dot' }
}

/** Markers closer than this (px, anchor to anchor) merge into one bubble when their labels collide. */
export const MERGE_RADIUS = 84

type Work<T extends ClusterInput> = Cluster<T> & {
  /** A single marker drawn as a bare dot (next to the selection, or crowded by a far-away label). */
  dotOnly?: boolean
  /** Crowded by a far-away label (not by the selection): may group with crowded neighbours, may get a label back. */
  crowded?: boolean
  /** A bubble that gave up its caption: just the count badge. */
  compact?: boolean
  /** A label (or caption) given back on the side that turned out to be free. */
  forceSide?: 'right' | 'left'
}

/**
 * Greedy, label-aware clustering in screen space. Points are placed in priority order. When two labels collide:
 * markers that are close together (≤ MERGE_RADIUS) merge into one count bubble that re-centres on its members;
 * markers that are far apart keep their own spot and the later one gives up its label (a bare dot, or a count badge
 * for a group), so a bubble never sits halfway between two distant places. Crowded neighbours still group into a
 * badge, and any marker or badge whose label fits on a free side gets it back at the end. A pinned point
 * (priority ≥ 3, the selection) is never merged: neighbours that would cover its label keep only their dot. Panels
 * over the map (`obstacles`) push labels to the other side, or drop them. Deterministic for a given input.
 */
export function clusterPoints<T extends ClusterInput>(
  points: readonly T[],
  opts: { gap?: number; maxX?: number; minX?: number; obstacles?: readonly Rect[]; measure?: MeasureText; measureBubble?: MeasureText; mergeRadius?: number } = {},
): Cluster<T>[] {
  const gap = opts.gap ?? 4
  const po: PlaceOpts = { maxX: opts.maxX ?? Infinity, minX: opts.minX ?? -Infinity, obstacles: opts.obstacles ?? [] }
  const measure = opts.measure ?? estimateText
  const measureBubble = opts.measureBubble ?? measure
  const mergeR = opts.mergeRadius ?? MERGE_RADIUS
  const rank = new Map(points.map((p, i) => [p.id, i]))
  const pinned = (c: Work<T>) => c.members.length === 1 && !c.dotOnly && (c.members[0].priority ?? 0) >= 3
  const labelSize = (c: Work<T>) => {
    if (c.members.length === 1) return { ...labelBox(c.members[0].name, measure, c.members[0].extra ?? 0), inset: 14 }
    const lead = clusterLead(c.members, rank)
    const names = [lead.name, ...c.members.filter((m) => m !== lead).map((m) => m.name)]
    return { ...bubbleBox(clusterCaption(names), c.members.length, measureBubble), inset: 17 }
  }
  const sideBox = (c: Work<T>, side: 'right' | 'left'): Rect => {
    const { w, h, inset } = labelSize(c)
    return side === 'right' ? { l: c.x - inset, r: c.x - inset + w, t: c.y - h / 2, b: c.y + h / 2 } : { l: c.x + inset - w, r: c.x + inset, t: c.y - h / 2, b: c.y + h / 2 }
  }
  const badgeBox = (c: Work<T>): Rect => ({ l: c.x - BADGE / 2, r: c.x + BADGE / 2, t: c.y - BADGE / 2, b: c.y + BADGE / 2 })
  const place = (c: Work<T>): Placed => {
    if (c.forceSide && !c.dotOnly && !c.compact) return { box: sideBox(c, c.forceSide), side: c.forceSide }
    if (c.members.length === 1) {
      if (c.dotOnly) return { box: null, side: 'dot' }
      const { w, h } = labelSize(c)
      return placeBox(c.x, c.y, w, h, 14, DOT, po)
    }
    if (c.compact) {
      const d = badgeBox(c)
      return po.obstacles.some((o) => hit(d, o, 0)) ? { box: null, side: 'hidden' } : { box: d, side: 'dot' }
    }
    const { w, h } = labelSize(c)
    return placeBox(c.x, c.y, w, h, 17, BADGE, po)
  }
  // Boxes that take part in collisions: labels and count badges. A bare dot never pushes anything around.
  const solid = (c: Work<T>, p: Placed) => p.box !== null && !(c.members.length === 1 && p.side === 'dot')
  const centre = (c: Work<T>) => {
    c.x = c.members.reduce((a, m) => a + m.x, 0) / c.members.length
    c.y = c.members.reduce((a, m) => a + m.y, 0) / c.members.length
    c.forceSide = undefined
  }
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= mergeR
  const make = (p: T, how: 'label' | 'pinned-neighbour' | 'crowded' = 'label'): Work<T> => ({
    key: p.id,
    x: p.x,
    y: p.y,
    members: [p],
    flip: false,
    side: 'right',
    lead: p,
    dotOnly: how !== 'label',
    crowded: how === 'crowded',
  })
  /** Give up the label: a single becomes a crowded dot, a group a count badge. */
  const yieldLabel = (c: Work<T>) => {
    c.forceSide = undefined
    if (c.members.length === 1) {
      c.dotOnly = true
      c.crowded = true
    } else c.compact = true
  }

  const order = [...points].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const clusters: Work<T>[] = []
  /** Join a nearby crowd (crowded dots, or the badge they formed): the crowd becomes one count badge. */
  const joinCrowd = (p: T): boolean => {
    const crowd = clusters.find((c) => c.crowded && near(c, p))
    if (!crowd) return false
    crowd.members.push(p)
    crowd.dotOnly = false
    crowd.compact = true
    centre(crowd)
    return true
  }
  for (const p of order) {
    const me = make(p)
    const mine = place(me)
    if (!mine.box) {
      clusters.push(me)
      continue
    }
    if (mine.side === 'dot') {
      // Both label sides run into a panel: stack with the crowded dots / badge right here, else a bare dot.
      if (!joinCrowd(p)) clusters.push(make(p, 'crowded'))
      continue
    }
    const hits = clusters.filter((c) => {
      const q = place(c)
      return solid(c, q) && hit(mine.box!, q.box!, gap)
    })
    if (!hits.length) {
      clusters.push(me)
      continue
    }
    if (hits.some(pinned)) {
      // Next to the selection: keep only the dot, under the selected label.
      clusters.push(make(p, 'pinned-neighbour'))
      continue
    }
    const target = hits.find((c) => near(c, p))
    if (target) {
      target.members.push(p)
      centre(target)
      continue
    }
    // Crowded by a far-away label: group with crowded neighbours (a count badge), else stay a bare dot.
    if (!joinCrowd(p)) clusters.push(make(p, 'crowded'))
  }
  // Merged bubbles are wider than single labels: resolve until no two solid boxes collide.
  for (let guard = 0, changed = true; changed && guard < 4000; guard++) {
    changed = false
    outer: for (let i = 0; i < clusters.length; i++) {
      const pi = place(clusters[i])
      if (!solid(clusters[i], pi)) continue
      for (let j = i + 1; j < clusters.length; j++) {
        const pj = place(clusters[j])
        if (!solid(clusters[j], pj) || !hit(pi.box!, pj.box!, gap)) continue
        const a = clusters[i]
        const b = clusters[j]
        if (pinned(a) || pinned(b)) {
          // Never cover the selection: the other marker's members become bare dots.
          const other = pinned(a) ? b : a
          clusters.splice(clusters.indexOf(other), 1, ...other.members.map((m) => make(m, 'pinned-neighbour')))
        } else if (near(a, b)) {
          a.members.push(...b.members)
          a.compact = !!(a.compact && b.compact)
          a.dotOnly = false
          a.crowded = false
          centre(a)
          clusters.splice(j, 1)
        } else if (pj.side !== 'dot') {
          // Far apart: the later (lower-priority) marker gives up its label first…
          yieldLabel(b)
        } else if (pi.side !== 'dot') {
          // …and if its badge still collides, the earlier one gives up its caption too.
          yieldLabel(a)
        } else {
          // Two badges touching are close anyway: one badge.
          a.members.push(...b.members)
          a.compact = true
          centre(a)
          clusters.splice(j, 1)
        }
        changed = true
        break outer
      }
    }
  }
  // Give labels back where a side turned out to be free (clear of every label, badge, panel and edge), in order.
  const taken: Rect[] = []
  for (const c of clusters) {
    const q = place(c)
    if (solid(c, q)) taken.push(q.box!)
  }
  for (const c of clusters) {
    const single = c.members.length === 1
    if (single ? !(c.dotOnly && c.crowded) : !c.compact) continue
    const own = single ? null : badgeBox(c)
    for (const side of ['right', 'left'] as const) {
      const was = { dotOnly: c.dotOnly, compact: c.compact }
      c.dotOnly = false
      c.compact = false
      const box = sideBox(c, side)
      const free =
        box.r <= po.maxX &&
        box.l >= po.minX &&
        !po.obstacles.some((o) => hit(box, o, 2)) &&
        !taken.some((t) => t !== own && !(own && t.l === own.l && t.t === own.t && t.r === own.r && t.b === own.b) && hit(box, t, gap))
      if (free) {
        c.forceSide = side
        taken.push(box)
        break
      }
      c.dotOnly = was.dotOnly
      c.compact = was.compact
    }
  }
  for (const c of clusters) {
    const p = place(c)
    c.side = p.side
    c.flip = p.side === 'left'
    c.lead = clusterLead(c.members, rank)
    if (c.members.length > 1) c.key = `c:${c.members.map((m) => m.id).sort().join(',')}`
    else if (c.dotOnly) c.key = `d:${c.members[0].id}`
    delete c.dotOnly
    delete c.crowded
    delete c.compact
    delete c.forceSide
  }
  return clusters
}

/** Screen box a placed cluster occupies (for other labels to avoid); null when it draws nothing. */
export function clusterRect<T extends ClusterInput>(c: Cluster<T>, measure: MeasureText = estimateText, measureBubble: MeasureText = measure): Rect | null {
  if (c.side === 'hidden') return null
  if (c.members.length === 1) {
    const p = c.members[0]
    if (c.side === 'dot') return { l: c.x - DOT / 2, r: c.x + DOT / 2, t: c.y - DOT / 2, b: c.y + DOT / 2 }
    const { w, h } = labelBox(p.name, measure, p.extra ?? 0)
    return c.side === 'left' ? { l: c.x + 14 - w, r: c.x + 14, t: c.y - h / 2, b: c.y + h / 2 } : { l: c.x - 14, r: c.x - 14 + w, t: c.y - h / 2, b: c.y + h / 2 }
  }
  if (c.side === 'dot') return { l: c.x - BADGE / 2, r: c.x + BADGE / 2, t: c.y - BADGE / 2, b: c.y + BADGE / 2 }
  const names = [c.lead.name, ...c.members.filter((m) => m !== c.lead).map((m) => m.name)]
  const { w, h } = bubbleBox(clusterCaption(names), c.members.length, measureBubble)
  return c.side === 'left' ? { l: c.x + 17 - w, r: c.x + 17, t: c.y - h / 2, b: c.y + h / 2 } : { l: c.x - 17, r: c.x - 17 + w, t: c.y - h / 2, b: c.y + h / 2 }
}

// ---------------------------------------------------------------------------
// HUD formatting

export function formatLat(lat: number, digits = 2): string {
  return `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? 'N' : 'S'}`
}

export function formatLon(lon: number, digits = 2): string {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180
  return `${Math.abs(l).toFixed(digits)}°${l >= 0 ? 'E' : 'W'}`
}
