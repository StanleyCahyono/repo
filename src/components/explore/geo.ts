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
  /** Higher keeps its own label first (selected, highlighted, favourites). */
  priority?: number
}

export interface Cluster<T extends ClusterInput> {
  key: string
  x: number
  y: number
  members: T[]
  /** The label runs to the left of the point (it would cross `maxX` otherwise). */
  flip: boolean
}

/** Approximate pill size for a single marker label (dot + name) at 12px Geist. */
export function labelBox(name: string): { w: number; h: number } {
  return { w: 30 + Math.min(name.length, 26) * 6.9, h: 28 }
}

/** Approximate bubble size for a cluster ("[4] Zermatt, Val…"). */
export function bubbleBox(caption: string): { w: number; h: number } {
  return { w: 44 + caption.length * 6.9, h: 34 }
}

export function clusterCaption(names: readonly string[]): string {
  const first = names.slice(0, 2).map((n) => n.split(/[\s-]/)[0])
  return first.join(', ') + (names.length > 2 ? '…' : '')
}

interface Box {
  l: number
  r: number
  t: number
  b: number
}

const hit = (a: Box, b: Box, gap: number) => a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap

/** Label box around an anchor: the dot sits on the point and the label runs right — or left when it would cross maxX. */
function anchoredBox(x: number, y: number, w: number, h: number, inset: number, maxX: number): Box & { flip: boolean } {
  const flip = x - inset + w > maxX
  return flip ? { l: x + inset - w, r: x + inset, t: y - h / 2, b: y + h / 2, flip } : { l: x - inset, r: x - inset + w, t: y - h / 2, b: y + h / 2, flip }
}

function singleBox(p: ClusterInput, maxX: number) {
  const { w, h } = labelBox(p.name)
  return anchoredBox(p.x, p.y, w, h, 14, maxX)
}

function clusterBox<T extends ClusterInput>(c: Cluster<T>, maxX: number) {
  if (c.members.length === 1) return singleBox(c.members[0], maxX)
  const { w, h } = bubbleBox(clusterCaption(c.members.map((m) => m.name)))
  return anchoredBox(c.x, c.y, w, h, 17, maxX)
}

/**
 * Greedy, label-aware clustering in screen space. Points are placed in priority order; a point whose label box
 * collides with an existing marker joins it (the cluster re-centres on its members). Deterministic for a given input.
 */
export function clusterPoints<T extends ClusterInput>(points: readonly T[], opts: { gap?: number; maxX?: number } = {}): Cluster<T>[] {
  const gap = opts.gap ?? 4
  const maxX = opts.maxX ?? Infinity
  const order = [...points].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const clusters: Cluster<T>[] = []
  for (const p of order) {
    const box = singleBox(p, maxX)
    const target = clusters.find((c) => hit(box, clusterBox(c, maxX), gap))
    if (target) {
      target.members.push(p)
      target.x = target.members.reduce((a, m) => a + m.x, 0) / target.members.length
      target.y = target.members.reduce((a, m) => a + m.y, 0) / target.members.length
    } else {
      clusters.push({ key: p.id, x: p.x, y: p.y, members: [p], flip: false })
    }
  }
  // Merged bubbles are wider than single labels: keep merging until no two markers collide.
  for (let changed = true; changed; ) {
    changed = false
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (!hit(clusterBox(clusters[i], maxX), clusterBox(clusters[j], maxX), gap)) continue
        const a = clusters[i]
        a.members.push(...clusters[j].members)
        a.x = a.members.reduce((acc, m) => acc + m.x, 0) / a.members.length
        a.y = a.members.reduce((acc, m) => acc + m.y, 0) / a.members.length
        clusters.splice(j, 1)
        changed = true
        break outer
      }
    }
  }
  for (const c of clusters) c.flip = clusterBox(c, maxX).flip
  for (const c of clusters) if (c.members.length > 1) c.key = `c:${c.members.map((m) => m.id).sort().join(',')}`
  return clusters
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
