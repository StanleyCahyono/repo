'use client'
/**
 * Route map for the trip planner hero: a real map (Web Mercator, fitted to the legs in view) of how you get there.
 *
 * - Drive: home and the resort, joined by the road itself when a route is on file (OSRM over OpenStreetMap, bundled).
 * - Fly: home → origin airport by road, the flight as a still arc (flights are never animated or timed here), and the
 *   destination airport → resort by road; coastlines and borders give the continent its shape.
 * - A ground leg without a stored road draws no line: never a straight line or an invented path. A note says so.
 * - Towns and cities near the route are labelled (muted, with a halo) so the places are easy to spot; every label —
 *   key places and towns — is placed so no text ever sits on other text or runs off the map.
 *
 * Motion: the map fades in, and a road draws itself in once along its own path; switching drive / fly cross-fades.
 * Under reduced motion everything is simply shown.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Car, Plane } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'

export type LonLat = [number, number]

export interface MapNode {
  id: string
  kind: 'home' | 'airport' | 'resort'
  ll: LonLat
  label: string
  sub?: string | null
}

/** A place label; lower rank = more important (Natural Earth zoom level, or OSM city/town/village). */
export interface MapCity {
  n: string
  ll: LonLat
  rank: number
}

export interface TripMapGeo {
  home: MapNode
  resort: MapNode
  origin: MapNode | null
  dest: MapNode | null
  roads: { drive: LonLat[] | null; toOrigin: LonLat[] | null; fromDest: LonLat[] | null }
  cities: { drive: MapCity[]; fly: MapCity[] }
  /** Coastline rings and border lines (flat lon,lat arrays) around a fly-in route. */
  land: number[][]
  borders: number[][]
}

type XY = [number, number]
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const RAD = Math.PI / 180
const merc = ([lon, lat]: LonLat): XY => [lon * RAD, -Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2))]

/** Projection fitted to `points` inside a w×h box (padding in px; minSpan in Mercator units keeps short drives sane). */
function fitProjection(points: LonLat[], w: number, h: number, pad: { x: number; top: number; bottom: number }, minSpan: number) {
  const m = points.map(merc)
  const xs = m.map((p) => p[0])
  const ys = m.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const sx = Math.max(x1 - x0, minSpan)
  const sy = Math.max(y1 - y0, minSpan)
  const iw = Math.max(40, w - 2 * pad.x)
  const ih = Math.max(40, h - pad.top - pad.bottom)
  const k = Math.min(iw / sx, ih / sy)
  const ox = w / 2 - cx * k
  const oy = pad.top + ih / 2 - cy * k
  return (ll: LonLat): XY => {
    const [x, y] = merc(ll)
    return [ox + x * k, oy + y * k]
  }
}

const overlaps = (a: Rect, b: Rect, gap = 3) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

function polyPath(pts: XY[]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  let last = pts[0]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    if (i < pts.length - 1 && Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1.2) continue
    d += `L${p[0].toFixed(1)},${p[1].toFixed(1)}`
    last = p
  }
  return d
}

const pathLength = (pts: XY[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)

/** Point and direction (degrees) halfway along a polyline. */
function midway(pts: XY[]): { at: XY; angle: number } | null {
  if (pts.length < 2) return null
  const seg: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    seg.push(l)
    total += l
  }
  let goal = total / 2
  for (let i = 0; i < seg.length; i++) {
    if (goal <= seg[i] || i === seg.length - 1) {
      const u = seg[i] ? goal / seg[i] : 0
      const a = pts[i]
      const b = pts[i + 1]
      return { at: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI }
    }
    goal -= seg[i]
  }
  return null
}

// Rough text metrics for placement (Geist 13px semibold labels, Geist Mono 12px uppercase subs, Geist 12px towns).
const labelSize = (label: string, sub?: string | null) => ({ w: Math.max(label.length * 7.6, sub ? sub.length * 8.4 : 0) + 22, h: sub ? 40 : 28 })
const townWidth = (n: string) => n.length * 6.7 + 10

interface Cluster {
  nodes: MapNode[]
  at: XY
  label: string
  sub: string | null
  strong: boolean
}

interface Placed {
  cluster: Cluster
  box: Rect
}

const EDGE = 4
/** The map dissolves into the panel at its edges instead of ending in a hard rectangle. */
const EDGE_FADE: React.CSSProperties = {
  maskImage: 'linear-gradient(to right, transparent, #000 7%, #000 93%, transparent), linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent)',
  maskComposite: 'intersect',
  WebkitMaskImage: 'linear-gradient(to right, transparent, #000 7%, #000 93%, transparent), linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent)',
  WebkitMaskComposite: 'source-in',
}

function placeLabels(clusters: Cluster[], w: number, h: number, blockers: Rect[]): Placed[] {
  const placed: Placed[] = []
  const taken: Rect[] = [...blockers]
  // The resort first (it matters most), then the rest in order.
  const order = [...clusters].sort((a, b) => Number(b.strong) - Number(a.strong))
  for (const c of order) {
    const { w: lw, h: lh } = labelSize(c.label, c.sub)
    const [x, y] = c.at
    const gap = c.strong ? 14 : 11
    const cands: Rect[] = [
      { x: x - lw / 2, y: y - gap - lh, w: lw, h: lh },
      { x: x - lw / 2, y: y + gap, w: lw, h: lh },
      { x: x + gap, y: y - lh / 2, w: lw, h: lh },
      { x: x - gap - lw, y: y - lh / 2, w: lw, h: lh },
      { x: x + gap - 4, y: y - gap - lh + 6, w: lw, h: lh },
      { x: x - lw - gap + 4, y: y + gap - 6, w: lw, h: lh },
    ]
    let best: Rect | null = null
    let bestCost = Infinity
    for (const r of cands) {
      const inside = r.x >= EDGE && r.y >= EDGE && r.x + r.w <= w - EDGE && r.y + r.h <= h - EDGE
      const clamped = { ...r, x: Math.min(Math.max(EDGE, r.x), w - EDGE - r.w), y: Math.min(Math.max(EDGE, r.y), h - EDGE - r.h) }
      const cost = taken.reduce((s, o) => s + overlapArea(clamped, o), 0) + (inside ? 0 : 400)
      if (cost < bestCost) {
        best = clamped
        bestCost = cost
      }
      if (cost === 0) break
    }
    if (best) {
      placed.push({ cluster: c, box: best })
      taken.push(best)
    }
  }
  return placed
}

function placeTowns(cities: MapCity[], project: (ll: LonLat) => XY, w: number, h: number, taken: Rect[], skip: Set<string>, max: number) {
  const out: { n: string; at: XY; box: Rect; side: 'right' | 'left' }[] = []
  const blocks = [...taken]
  for (const c of cities) {
    if (out.length >= max) break
    if (skip.has(c.n.toLowerCase())) continue
    const at = project(c.ll)
    const tw = townWidth(c.n)
    const right: Rect = { x: at[0] - 3, y: at[1] - 8, w: tw + 6, h: 16 }
    const left: Rect = { x: at[0] - tw - 3, y: at[1] - 8, w: tw + 6, h: 16 }
    const pick = [right, left].find((r) => r.x >= EDGE && r.y >= EDGE && r.x + r.w <= w - EDGE && r.y + r.h <= h - EDGE && !blocks.some((b) => overlaps(r, b, 4)))
    if (!pick) continue
    out.push({ n: c.n, at, box: pick, side: pick === right ? 'right' : 'left' })
    blocks.push(pick)
  }
  return out
}

export function TripMap({ geo, mode, className, label }: { geo: TripMapGeo; mode: 'drive' | 'fly'; className?: string; label: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const reduce = useReducedMotion()
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scene = useMemo(() => {
    const { w, h } = size
    if (!w || !h) return null
    const fly = mode === 'fly' && geo.origin && geo.dest
    const nodes: MapNode[] = fly ? [geo.home, geo.origin!, geo.dest!, geo.resort] : [geo.home, geo.resort]
    const roads = fly ? [geo.roads.toOrigin, geo.roads.fromDest] : [geo.roads.drive]
    const fitPts: LonLat[] = [...nodes.map((n) => n.ll), ...roads.flatMap((r) => r ?? [])]
    const project = fitProjection(fitPts, w, h, { x: Math.min(96, w * 0.2), top: fly ? 64 : 52, bottom: 44 }, fly ? 0.02 : 0.011)

    // Key places, merged when they would sit on top of each other (e.g. home and its airport on a continental map).
    const clusters: Cluster[] = []
    for (const n of nodes) {
      const at = project(n.ll)
      const near = clusters.find((c) => Math.hypot(c.at[0] - at[0], c.at[1] - at[1]) < 34)
      if (near) {
        near.nodes.push(n)
        near.label = near.nodes.map((x) => x.label).join(' · ')
        // Merged places read as one label ("Ithaca · SYR"); their kinds would only crowd it.
        near.sub = null
        near.strong = near.strong || n.kind === 'resort'
      } else clusters.push({ nodes: [n], at, label: n.label, sub: n.sub ?? null, strong: n.kind === 'resort' })
    }
    const dots: Rect[] = nodes.map((n) => {
      const [x, y] = project(n.ll)
      return { x: x - 8, y: y - 8, w: 16, h: 16 }
    })

    const roadPaths = roads.map((r) => (r ? r.map(project) : null))
    let arc: { d: string; c: XY; plane: { at: XY; angle: number } } | null = null
    if (fly) {
      const a = project(geo.origin!.ll)
      const b = project(geo.dest!.ll)
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len = Math.hypot(dx, dy) || 1
      // Bulge upward (screen), 18% of the distance.
      let nx = -dy / len
      let ny = dx / len
      if (ny > 0) {
        nx = -nx
        ny = -ny
      }
      const bulge = Math.min(len * 0.2, h * 0.3)
      const c: XY = [(a[0] + b[0]) / 2 + nx * bulge, (a[1] + b[1]) / 2 + ny * bulge]
      const mid: XY = [0.25 * a[0] + 0.5 * c[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * c[1] + 0.25 * b[1]]
      arc = { d: `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`, c, plane: { at: mid, angle: (Math.atan2(dy, dx) * 180) / Math.PI } }
    }
    const glyphs: Rect[] = []
    const plane = arc?.plane ?? null
    if (plane) glyphs.push({ x: plane.at[0] - 15, y: plane.at[1] - 15, w: 30, h: 30 })
    // The car rides on the road only when the road is long enough on screen to stay visible around it.
    const car = !fly && roadPaths[0] && pathLength(roadPaths[0]) > 150 ? midway(roadPaths[0]) : null
    if (car) glyphs.push({ x: car.at[0] - 15, y: car.at[1] - 15, w: 30, h: 30 })

    const placed = placeLabels(clusters, w, h, [...dots, ...glyphs])
    // Town labels also keep off the drawn lines (sampled), so no text sits on a road or the flight arc.
    const lineMarks: Rect[] = []
    const mark = (p: XY) => lineMarks.push({ x: p[0] - 3, y: p[1] - 3, w: 6, h: 6 })
    for (const r of roadPaths) if (r) r.forEach((p, i) => i % 3 === 0 && mark(p))
    if (arc && fly) {
      const a = project(geo.origin!.ll)
      const b = project(geo.dest!.ll)
      const c = arc.c
      for (let i = 0; i <= 40; i++) {
        const u = i / 40
        mark([(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1]])
      }
    }
    const skip = new Set(nodes.flatMap((n) => [n.label, n.sub ?? '']).map((s) => s.toLowerCase()))
    const towns = placeTowns(fly ? geo.cities.fly : geo.cities.drive, project, w, h, [...placed.map((p) => p.box), ...dots, ...glyphs, ...lineMarks], skip, fly ? 8 : 7)
    const land = fly ? geo.land.map((r) => ringPath(r, project, true)).join('') : ''
    const borders = fly ? geo.borders.map((r) => ringPath(r, project, false)).join('') : ''
    const missing = fly ? [!geo.roads.toOrigin, !geo.roads.fromDest].some(Boolean) : !geo.roads.drive
    return { fly: !!fly, nodes: nodes.map((n) => ({ n, at: project(n.ll) })), placed, towns, roadPaths, arc, plane, car, land, borders, missing }
  }, [size, mode, geo])

  return (
    <div ref={boxRef} role="img" aria-label={label} className={cn('relative', className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {scene ? (
          <motion.div key={mode} aria-hidden data-audit-text="yes" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.pageIn}>
            <svg viewBox={`0 0 ${size.w} ${size.h}`} className="absolute inset-0 h-full w-full overflow-hidden" style={EDGE_FADE} data-audit-text="yes" aria-hidden>
              {scene.land ? <path d={scene.land} fill="var(--ink)" fillOpacity={0.05} stroke="var(--ink)" strokeOpacity={0.16} strokeWidth={0.8} strokeLinejoin="round" /> : null}
              {scene.borders ? <path d={scene.borders} fill="none" stroke="var(--ink)" strokeOpacity={0.18} strokeWidth={0.8} strokeDasharray="3 3" /> : null}
              {scene.arc ? (
                <g>
                  <path d={scene.arc.d} fill="none" stroke="var(--surface)" strokeOpacity={0.9} strokeWidth={6} strokeLinecap="round" />
                  <path d={scene.arc.d} fill="none" stroke="var(--ink-chip)" strokeWidth={2} strokeDasharray="1 7" strokeLinecap="round" />
                </g>
              ) : null}
              {scene.roadPaths.map((pts, i) =>
                pts ? (
                  <g key={i}>
                    <path d={polyPath(pts)} fill="none" stroke="var(--surface)" strokeOpacity={0.95} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
                    <motion.path
                      d={polyPath(pts)}
                      fill="none"
                      stroke="var(--teal)"
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={reduce ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.9, ease: [0.22, 0.8, 0.26, 1], delay: 0.1 + i * 0.15 }}
                    />
                  </g>
                ) : null,
              )}
              {scene.towns.map((c) => (
                <g key={c.n}>
                  <circle cx={c.at[0]} cy={c.at[1]} r={2.2} fill="var(--ink-3)" />
                  <text
                    x={c.side === 'right' ? c.at[0] + 6 : c.at[0] - 6}
                    y={c.at[1] + 4}
                    textAnchor={c.side === 'right' ? 'start' : 'end'}
                    className="fill-ink-2 text-[12px]"
                    style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3.5, strokeLinejoin: 'round' }}
                  >
                    {c.n}
                  </text>
                </g>
              ))}
              {scene.nodes.map(({ n, at }) => (
                <circle
                  key={n.id}
                  cx={at[0]}
                  cy={at[1]}
                  r={n.kind === 'resort' ? 6.5 : 4.5}
                  fill={n.kind === 'resort' ? 'var(--teal)' : n.kind === 'airport' ? 'var(--surface)' : 'var(--ink-chip)'}
                  stroke={n.kind === 'airport' ? 'var(--ink-chip)' : 'var(--surface)'}
                  strokeWidth={n.kind === 'airport' ? 2.5 : 3}
                />
              ))}
            </svg>
            {scene.plane ? <Glyph at={scene.plane.at} angle={scene.plane.angle} kind="fly" /> : null}
            {scene.car ? <Glyph at={scene.car.at} angle={0} kind="drive" /> : null}
            {scene.placed.map(({ cluster, box }) => (
              <span
                key={cluster.nodes.map((n) => n.id).join('|')}
                className={cn('glass-strong absolute flex flex-col justify-center rounded-[12px] px-2.5 whitespace-nowrap', cluster.strong && 'shadow-[0_8px_22px_-10px_rgb(19_32_44/0.45)]')}
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              >
                <span className="truncate text-[13px] leading-tight font-semibold text-ink">{cluster.label}</span>
                {cluster.sub ? <span className="truncate font-mono text-[12px] leading-tight tracking-[0.06em] text-ink-2 uppercase">{cluster.sub}</span> : null}
              </span>
            ))}
            {scene.missing ? (
              <span className="hud absolute bottom-2 left-2 rounded-full bg-surface/80 px-2.5 py-1 text-ink-3">{scene.fly ? 'Some road routes not on file' : 'Road route not on file'}</span>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function Glyph({ at, angle, kind }: { at: XY; angle: number; kind: 'fly' | 'drive' }) {
  const Icon = kind === 'fly' ? Plane : Car
  return (
    <span className="absolute flex size-[30px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink-chip text-on-ink-chip shadow-[0_6px_16px_-4px_rgb(19_32_44/0.5)]" style={{ left: at[0], top: at[1] }}>
      {/* lucide's plane points up-right (45°). */}
      <Icon className="size-4" strokeWidth={2} style={kind === 'fly' ? { transform: `rotate(${angle + 45}deg)` } : undefined} />
    </span>
  )
}

function ringPath(r: number[], project: (ll: LonLat) => XY, close: boolean): string {
  let d = ''
  let last: XY | null = null
  for (let i = 0; i < r.length; i += 2) {
    const p = project([r[i], r[i + 1]])
    if (last && Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1.5 && i < r.length - 2) continue
    d += `${d ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`
    last = p
  }
  return d ? d + (close ? 'Z' : '') : ''
}
