'use client'
/**
 * Offline / no-tiles journey map: a mission-control schematic in Web Mercator — land and borders (Natural Earth),
 * graticule, range rings around home, nearby city names, every catalogued resort as a faint dot, and the journey.
 *
 * The camera is static: it frames every pin and label inside the padded view (clear of the panel and the overlays),
 * and pin labels are collision-avoided (label-layout.ts). Roads are drawn from the bundled road geometry; a drive draws
 * itself in along the road once, with a small car travelling it. A flight is a static dashed arc, never animated. A road
 * leg with no geometry is not drawn at all (the frame links to directions instead) — never a straight line.
 *
 * Reduced motion: everything is drawn at once.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Car } from './glyphs'
import { mercatorY, roadDrawMs, type LonLat } from '@/lib/domain/journey'
import type { Journey, Pin } from './journey-model'
import { journeyCoords } from './journey-model'
import { overlapArea, placeLabels, type Rect } from './label-layout'
import { PIN_GAP, PIN_PRIORITY, PinView } from './pin-view'
import { cn } from '@/lib/ui/cn'

export interface MapPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface JourneyCallbacks {
  /** Road draw-in progress 0…1 (drive only; 1 at once for flights and under reduced motion). */
  onProgress?: (f: number) => void
  /** How many road legs have no geometry to draw. */
  onMissing?: (n: number) => void
}

export interface SchematicProps extends JourneyCallbacks {
  journey: Journey | null
  home: { lat: number; lon: number; name: string }
  context: readonly { lat: number; lon: number }[]
  replay: number
  reduced: boolean
  padding: MapPadding
  /** Range-ring unit. */
  distanceUnit: 'km' | 'mi'
  className?: string
}

const DEG = 180 / Math.PI
const projY = (lat: number) => -mercatorY(lat) * DEG
const KM_PER_DEG = 111.32
const CITY_POOL = 12

// ---------------------------------------------------------------------------
// Geography (lazy, cached per session)

interface City {
  n: string
  ll: [number, number]
  z: number
  pop: number
}
interface Geo {
  land: string
  borders: string
  cities: City[]
}
let geoCache: Geo | null = null
let geoPromise: Promise<Geo> | null = null

function ringPath(r: readonly number[], close: boolean, shift: number) {
  let d = ''
  for (let i = 0; i + 1 < r.length; i += 2) d += `${i ? 'L' : 'M'}${(r[i] + shift).toFixed(2)} ${projY(r[i + 1]).toFixed(2)}`
  return close ? `${d}Z` : d
}

function loadGeo(): Promise<Geo> {
  if (geoCache) return Promise.resolve(geoCache)
  geoPromise ??= Promise.all([import('@/assets/geo/world-land.json'), import('@/assets/geo/world-borders.json'), import('@/assets/geo/world-cities.json')]).then(([l, b, c]) => {
    const rings = ((l as { default?: unknown }).default ?? l) as number[][]
    const lines = ((b as { default?: unknown }).default ?? b) as number[][]
    const cf = ((c as { default?: unknown }).default ?? c) as { cities: City[] }
    // Antarctica's pole-wrapping ring does not survive Mercator and no journey goes there. A second copy one world west
    // keeps journeys that are unwrapped past −180° (to Japan) over land.
    const keep = rings.filter((r) => !r.some((v, i) => i % 2 === 1 && v < -60))
    const land = [0, -360].map((sh) => keep.map((r) => ringPath(r, true, sh)).join('')).join('')
    const borders = [0, -360].map((sh) => lines.map((r) => ringPath(r, false, sh)).join('')).join('')
    geoCache = { land, borders, cities: [...cf.cities].sort((a, b) => a.z - b.z || b.pop - a.pop) }
    return geoCache
  })
  return geoPromise
}

function useGeo(): Geo | null {
  const [g, setG] = useState<Geo | null>(geoCache)
  useEffect(() => {
    if (g) return
    let alive = true
    loadGeo()
      .then((x) => alive && setG(x))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [g])
  return g
}

/** Destination point (great circle) — for range rings. */
function destination(lat: number, lon: number, bearing: number, km: number): LonLat {
  const d = km / 6371
  const b = bearing / DEG
  const p1 = lat / DEG
  const l1 = lon / DEG
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  let lonOut = l2 * DEG
  while (lonOut - lon > 180) lonOut -= 360
  while (lonOut - lon < -180) lonOut += 360
  return [lonOut, p2 * DEG]
}

function worldD(pts: readonly LonLat[]): string {
  let d = ''
  for (let i = 0; i < pts.length; i++) d += `${i ? 'L' : 'M'}${pts[i][0].toFixed(4)} ${projY(pts[i][1]).toFixed(4)}`
  return d
}

const RINGS_KM = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
const RINGS_MI = [10, 25, 50, 100, 250, 500, 1000, 2500]

interface Cam {
  /** World centre (lon, projected y). */
  x: number
  y: number
  /** px per world unit. */
  s: number
  /** Screen point the world centre maps to. */
  cx: number
  cy: number
}

const easeOut = (f: number) => 1 - (1 - Math.max(0, Math.min(1, f))) ** 3
const easeInOut = (f: number) => {
  const x = Math.max(0, Math.min(1, f))
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}

export function SchematicJourney({ journey, home, context, replay, reduced, padding, distanceUnit, onProgress, onMissing, className }: SchematicProps) {
  const geo = useGeo()
  const root = useRef<HTMLDivElement>(null)
  const world = useRef<SVGGElement>(null)
  const gratEls = useRef<(SVGPathElement | null)[]>([])
  const bordersEl = useRef<SVGPathElement>(null)
  const ghostEls = useRef<(SVGPathElement | null)[]>([])
  const glowEls = useRef<(SVGPathElement | null)[]>([])
  const lineEls = useRef<(SVGPathElement | null)[]>([])
  const pinEls = useRef<Map<string, HTMLDivElement>>(new Map())
  const glyphEl = useRef<HTMLDivElement>(null)
  const sweepEl = useRef<HTMLDivElement>(null)
  const ringLabelEls = useRef<(HTMLSpanElement | null)[]>([])
  const cityEls = useRef<(HTMLSpanElement | null)[]>([])
  const cbs = useRef({ onProgress, onMissing })
  useEffect(() => {
    cbs.current = { onProgress, onMissing }
  }, [onProgress, onMissing])

  const rings = useMemo(() => {
    const list = distanceUnit === 'mi' ? RINGS_MI.map((v) => ({ v, km: v * 1.609344 })) : RINGS_KM.map((v) => ({ v, km: v }))
    return list.map((r) => {
      const pts: LonLat[] = []
      for (let a = 0; a <= 360; a += 5) pts.push(destination(home.lat, home.lon, a, r.km))
      return { ...r, d: worldD(pts) + 'Z', labelAt: destination(home.lat, home.lon, 160, r.km), label: `${r.v.toLocaleString('en-US')} ${distanceUnit}` }
    })
  }, [home.lat, home.lon, distanceUnit])

  const graticule = useMemo(() => {
    const coarse: string[] = []
    for (let lon = -540; lon <= 540; lon += 10) coarse.push(`M${lon} ${projY(-80)}V${projY(84)}`)
    for (let lat = -80; lat <= 80; lat += 10) coarse.push(`M-540 ${projY(lat)}H540`)
    const mid: string[] = []
    const fine: string[] = []
    const focus: LonLat[] = [[home.lon, home.lat], ...(journey ? journey.pins.map((p) => p.at) : [])]
    const seen = new Set<string>()
    const seenFine = new Set<string>()
    for (const [lon0, lat0] of focus) {
      const bx = Math.round(lon0)
      const by = Math.round(lat0)
      if (!seen.has(`${bx}:${by}`)) {
        seen.add(`${bx}:${by}`)
        for (let k = -8; k <= 8; k++) {
          mid.push(`M${bx + k} ${projY(by - 8)}V${projY(by + 8)}`)
          mid.push(`M${bx - 8} ${projY(by + k)}H${bx + 8}`)
        }
      }
      const fx = Math.round(lon0 * 10) / 10
      const fy = Math.round(lat0 * 10) / 10
      if (seenFine.has(`${fx}:${fy}`)) continue
      seenFine.add(`${fx}:${fy}`)
      for (let k = -12; k <= 12; k++) {
        fine.push(`M${(fx + k / 10).toFixed(2)} ${projY(fy - 1.2)}V${projY(fy + 1.2)}`)
        fine.push(`M${(fx - 1.2).toFixed(2)} ${projY(fy + k / 10)}H${(fx + 1.2).toFixed(2)}`)
      }
    }
    return [coarse.join(''), mid.join(''), fine.join('')]
  }, [home.lat, home.lon, journey])

  const contextD = useMemo(
    () =>
      context
        .map((c) => {
          const lon = c.lon - home.lon > 180 ? c.lon - 360 : c.lon - home.lon < -180 ? c.lon + 360 : c.lon
          const y = projY(c.lat)
          return `M${lon.toFixed(3)} ${y.toFixed(3)}h0M${(lon - 360).toFixed(3)} ${y.toFixed(3)}h0`
        })
        .join(''),
    [context, home.lon],
  )

  const pins: Pin[] = useMemo(() => journey?.pins ?? [{ id: 'home', at: [home.lon, home.lat], label: home.name, kind: 'home' }], [journey, home])
  const legs = useMemo(() => journey?.legs ?? [], [journey])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    let raf = 0
    let alive = true
    let W = el.clientWidth
    let H = el.clientHeight
    const pad = padding
    cbs.current.onMissing?.(legs.filter((l) => l.geometry === 'missing').length)

    const sizes = () =>
      pins.map((p) => {
        const lab = pinEls.current.get(p.id)?.querySelector<HTMLElement>('[data-pin-label]')
        return { w: lab?.offsetWidth || 80, h: lab?.offsetHeight || 26 }
      })

    // Frame: every journey coordinate inside the padded view, inset so a label above or beside any pin still fits.
    const fit = (): { cam: Cam; view: Rect } => {
      const sz = sizes()
      const wMax = Math.max(60, ...sz.map((s) => s.w))
      const hMax = Math.max(22, ...sz.map((s) => s.h))
      const view: Rect = { x: pad.left, y: pad.top, w: Math.max(120, W - pad.left - pad.right), h: Math.max(120, H - pad.top - pad.bottom) }
      const ix = Math.min(wMax / 2 + 10, view.w * 0.3)
      const it = Math.min(hMax + 18, view.h * 0.3)
      const ib = Math.min(18, view.h * 0.1)
      const inner = { x: view.x + ix, y: view.y + it, w: view.w - 2 * ix, h: view.h - it - ib }
      const cx = inner.x + inner.w / 2
      const cy = inner.y + inner.h / 2
      if (!journey) {
        const unit = KM_PER_DEG * Math.cos(home.lat / DEG)
        return { cam: { x: home.lon, y: projY(home.lat), s: inner.w / (1400 / unit), cx, cy }, view }
      }
      const pts = [...journeyCoords(journey), ...pins.map((p) => p.at)]
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => projY(p[1]))
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const lat = (pins[0]?.at[1] ?? home.lat) / DEG
      // Never closer than ~12 km across the view, so a short drive still shows its surroundings.
      const minSpan = 12 / (KM_PER_DEG * Math.cos(lat))
      const bw = Math.max(maxX - minX, minSpan)
      const bh = Math.max(maxY - minY, minSpan * (inner.h / inner.w))
      const s = Math.min(inner.w / bw, inner.h / bh)
      return { cam: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, s, cx, cy }, view }
    }

    const screenOf = (cam: Cam) => {
      const tx = cam.cx - cam.x * cam.s
      const ty = cam.cy - cam.y * cam.s
      return (p: LonLat) => [p[0] * cam.s + tx, projY(p[1]) * cam.s + ty] as const
    }

    let target = fit()

    // Labels: pins collision-avoided against each other and every pin; ring and city labels only where they stay clear.
    const placeAll = () => {
      const { cam, view } = target
      const at = screenOf(cam)
      const sz = sizes()
      const order = pins.map((p, i) => ({ p, i })).sort((a, b) => PIN_PRIORITY[a.p.kind] - PIN_PRIORITY[b.p.kind])
      const items = order.map(({ p, i }) => {
        const [x, y] = at(p.at)
        return { id: p.id, x, y, w: sz[i].w, h: sz[i].h, gap: PIN_GAP[p.kind] }
      })
      const placed = placeLabels(items, view, { pinRadius: 10, margin: 5 })
      for (const q of placed) {
        const lab = pinEls.current.get(q.id)?.querySelector<HTMLElement>('[data-pin-label]')
        if (lab) lab.style.transform = `translate(${q.dx}px, ${q.dy}px)`
      }
      const taken: Rect[] = [...placed.map((q) => q.rect), ...items.map((it) => ({ x: it.x - 12, y: it.y - 12, w: 24, h: 24 }))]
      const clear = (r: Rect) =>
        r.x >= view.x && r.y >= view.y && r.x + r.w <= view.x + view.w && r.y + r.h <= view.y + view.h && !taken.some((t) => overlapArea(t, { x: r.x - 6, y: r.y - 4, w: r.w + 12, h: r.h + 8 }) > 0)
      // Range ring labels.
      const homeCos = Math.cos(home.lat / DEG)
      rings.forEach((r, i) => {
        const lab = ringLabelEls.current[i]
        if (!lab) return
        const [x, y] = at(r.labelAt)
        const rpx = (r.km / (KM_PER_DEG * homeCos)) * cam.s
        const w = lab.offsetWidth
        const h = lab.offsetHeight
        const rect = { x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h }
        const ok = rpx > 60 && rpx < Math.max(W, H) * 1.1 && clear(rect)
        if (ok) taken.push(rect)
        lab.style.opacity = ok ? '1' : '0'
      })
      // City names near the journey (largest first), right of their dot, skipping any that would crowd a label.
      const pool = cityEls.current
      for (const c of pool) {
        if (!c) continue
        c.style.opacity = '0'
        c.dataset.lon = ''
      }
      if (!geo) return
      const spanKm = (view.w / cam.s) * KM_PER_DEG * Math.cos((pins[0]?.at[1] ?? home.lat) / DEG)
      const maxZ = spanKm > 4000 ? 3 : spanKm > 1500 ? 4 : spanKm > 600 ? 5 : spanKm > 200 ? 6 : spanKm > 80 ? 7 : 9
      const near = items.map((it) => [it.x, it.y] as const)
      const lonRef = (Math.min(...pins.map((p) => p.at[0])) + Math.max(...pins.map((p) => p.at[0]))) / 2
      let k = 0
      for (const c of geo.cities) {
        if (k >= CITY_POOL) break
        if (c.z > maxZ) continue
        let lon = c.ll[0]
        while (lon - lonRef > 180) lon -= 360
        while (lon - lonRef < -180) lon += 360
        const [x, y] = at([lon, c.ll[1]])
        if (x < view.x || x > view.x + view.w || y < view.y || y > view.y + view.h) continue
        if (near.some(([px, py]) => Math.hypot(px - x, py - y) < 26)) continue
        const node = pool[k]
        if (!node) break
        const name = node.querySelector<HTMLElement>('[data-city-name]')
        if (name) name.textContent = c.n
        const w = node.offsetWidth
        const h = node.offsetHeight
        const rect = { x: Math.round(x - 3), y: Math.round(y - h / 2), w, h }
        if (!clear(rect)) continue
        taken.push(rect)
        node.dataset.lon = String(lon)
        node.dataset.lat = String(c.ll[1])
        node.style.opacity = '1'
        k++
      }
    }

    const render = (cam: Cam, draw: number, glyph: boolean) => {
      const at = screenOf(cam)
      const tx = cam.cx - cam.x * cam.s
      const ty = cam.cy - cam.y * cam.s
      if (![tx, ty, cam.s].every(Number.isFinite)) return
      world.current?.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${cam.s.toFixed(6)})`)
      // Graticule levels fade by on-screen spacing; borders only once countries are big enough to read.
      ;[10, 1, 0.1].forEach((st, i) => {
        const px = st * cam.s
        const o = px < 16 ? 0 : px < 44 ? (px - 16) / 28 : px > 900 ? Math.max(0, 1 - (px - 900) / 600) : 1
        gratEls.current[i]?.setAttribute('opacity', (o * (i ? 0.7 : 1)).toFixed(3))
      })
      bordersEl.current?.setAttribute('opacity', Math.max(0, Math.min(1, (cam.s - 4) / 6)).toFixed(3))
      const px = (pts: readonly LonLat[]) => {
        let d = ''
        for (let k = 0; k < pts.length; k++) {
          const [x, y] = at(pts[k])
          d += `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
        }
        return d
      }
      let car: { x: number; y: number; heading: number } | null = null
      legs.forEach((leg, i) => {
        const line = lineEls.current[i]
        const glow = glowEls.current[i]
        const ghost = ghostEls.current[i]
        const d = leg.geometry === 'missing' ? 'M0 0' : px(leg.coords)
        line?.setAttribute('d', d)
        glow?.setAttribute('d', d)
        ghost?.setAttribute('d', d)
        if (leg.geometry !== 'road' || !line || !glow) return
        if (journey?.mode === 'drive' && draw < 1) {
          const L = line.getTotalLength()
          const shown = L * draw
          const dash = `${shown.toFixed(1)} ${(L + 8).toFixed(1)}`
          line.setAttribute('stroke-dasharray', dash)
          glow.setAttribute('stroke-dasharray', dash)
          if (glyph && L > 0) {
            const step = Math.max(2, L * 0.01)
            const p = line.getPointAtLength(shown)
            const q = line.getPointAtLength(Math.min(L, shown + step))
            const b = line.getPointAtLength(Math.max(0, shown - step))
            car = { x: p.x, y: p.y, heading: Math.atan2(q.x - b.x, -(q.y - b.y)) * DEG }
          }
        } else {
          line.removeAttribute('stroke-dasharray')
          glow.removeAttribute('stroke-dasharray')
        }
      })
      // Pins and labels in whole pixels, so text stays crisp.
      for (const p of pins) {
        const node = pinEls.current.get(p.id)
        if (!node) continue
        const [x, y] = at(p.at)
        node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      }
      rings.forEach((r, i) => {
        const lab = ringLabelEls.current[i]
        if (!lab) return
        const [x, y] = at(r.labelAt)
        lab.style.transform = `translate3d(${Math.round(x - lab.offsetWidth / 2)}px, ${Math.round(y - lab.offsetHeight / 2)}px, 0)`
      })
      for (const c of cityEls.current) {
        if (!c?.dataset.lon) continue
        const [x, y] = at([Number(c.dataset.lon), Number(c.dataset.lat)])
        c.style.transform = `translate3d(${Math.round(x - 3)}px, ${Math.round(y - c.offsetHeight / 2)}px, 0)`
      }
      if (sweepEl.current) {
        const [x, y] = at([home.lon, home.lat])
        sweepEl.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
      const g = glyphEl.current
      if (g) {
        const c = car as { x: number; y: number; heading: number } | null
        if (c) {
          g.style.opacity = '1'
          g.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${c.heading.toFixed(1)}deg)`
        } else g.style.opacity = '0'
      }
    }

    const road = legs.find((l) => l.geometry === 'road')
    const animate = !reduced && journey?.mode === 'drive' && !!road
    const drawMs = road ? roadDrawMs(road.km) : 0
    const INTRO = 650
    const DELAY = 260
    let finished = !animate

    const settle = () => {
      target = fit()
      placeAll()
    }
    settle()

    if (!animate) {
      render(target.cam, 1, false)
      cbs.current.onProgress?.(1)
    } else {
      const from: Cam = { ...target.cam, s: target.cam.s * 0.84 }
      const t0 = performance.now()
      cbs.current.onProgress?.(0)
      const step = (now: number) => {
        if (!alive) return
        const t = now - t0
        const z = easeOut(t / INTRO)
        const cam: Cam = { ...target.cam, s: from.s + (target.cam.s - from.s) * z }
        const f = Math.max(0, Math.min(1, (t - DELAY) / drawMs))
        render(cam, easeInOut(f), f > 0 && f < 1)
        cbs.current.onProgress?.(f)
        if (t < Math.max(INTRO, DELAY + drawMs)) raf = requestAnimationFrame(step)
        else {
          finished = true
          render(target.cam, 1, false)
        }
      }
      render(from, 0, false)
      raf = requestAnimationFrame(step)
    }

    // Re-frame on resize and once web fonts settle (label sizes change).
    const reframe = () => {
      if (!alive) return
      W = el.clientWidth
      H = el.clientHeight
      settle()
      if (finished) render(target.cam, 1, false)
    }
    const ro = new ResizeObserver(reframe)
    ro.observe(el)
    void document.fonts?.ready.then(reframe)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey, replay, reduced, padding.left, padding.right, padding.top, padding.bottom, home.lat, home.lon, rings, geo])

  return (
    <div ref={root} className={cn('absolute inset-0 overflow-hidden bg-surface-2', className)} aria-hidden>
      {/* Water, land and graticule (world units, non-scaling strokes). */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--glacier)_70%,var(--surface-2)),var(--surface-2))]" />
      <svg className="absolute inset-0 h-full w-full">
        <g ref={world}>
          {geo ? <path d={geo.land} fill="color-mix(in srgb, var(--surface) 88%, transparent)" fillRule="evenodd" /> : null}
          <path ref={(n) => void (gratEls.current[0] = n)} d={graticule[0]} fill="none" stroke="var(--topo-line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path ref={(n) => void (gratEls.current[1] = n)} d={graticule[1]} fill="none" stroke="var(--topo-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path ref={(n) => void (gratEls.current[2] = n)} d={graticule[2]} fill="none" stroke="var(--topo-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {geo ? (
            <>
              <path ref={bordersEl} d={geo.borders} fill="none" stroke="var(--topo-line-strong)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              <path d={geo.land} fill="none" stroke="var(--topo-line-strong)" strokeWidth={1.1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </>
          ) : null}
          {rings.map((r) => (
            <path key={r.v} d={r.d} fill="none" stroke="var(--teal)" strokeOpacity={0.3} strokeWidth={1} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={contextD} stroke="var(--teal)" strokeOpacity={0.4} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>

      {/* Radar sweep at home (decorative; still under reduced motion). */}
      <div ref={sweepEl} className="pointer-events-none absolute top-0 left-0">
        <div
          style={{ animationDuration: '7s' }}
          className="absolute -top-[120px] -left-[120px] size-[240px] rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,color-mix(in_srgb,var(--teal)_14%,transparent)_40deg,transparent_70deg)] [mask-image:radial-gradient(circle,#000_55%,transparent_70%)] motion-safe:animate-spin"
        />
      </div>

      {/* The journey, in screen pixels: the full road as a faint ghost (drive), a glow, then the road or flight arc. */}
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {legs.map((l, i) => (
          <path
            key={i}
            ref={(n) => void (ghostEls.current[i] = n)}
            d="M0 0"
            fill="none"
            stroke={l.geometry === 'road' && journey?.mode === 'drive' ? 'var(--teal)' : 'none'}
            strokeOpacity={0.22}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <svg className="absolute inset-0 h-full w-full overflow-visible [filter:blur(6px)]">
        {legs.map((l, i) => (
          <path
            key={i}
            ref={(n) => void (glowEls.current[i] = n)}
            d="M0 0"
            fill="none"
            stroke={l.geometry === 'road' ? 'var(--teal)' : 'none'}
            strokeOpacity={0.6}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {legs.map((l, i) => (
          <path
            key={i}
            ref={(n) => void (lineEls.current[i] = n)}
            d="M0 0"
            fill="none"
            stroke={l.geometry === 'missing' ? 'none' : 'var(--teal)'}
            strokeWidth={l.geometry === 'arc' ? 2.25 : 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={l.geometry === 'arc' ? '2 7' : undefined}
          />
        ))}
      </svg>

      <div ref={glyphEl} className="pointer-events-none absolute top-0 left-0 opacity-0 transition-opacity duration-200">
        <Car />
      </div>

      {/* Labels: city names, range rings, then pins on top. */}
      <div className="pointer-events-none absolute inset-0">
        {Array.from({ length: CITY_POOL }, (_, i) => (
          <span key={`c${i}`} ref={(n) => void (cityEls.current[i] = n)} className="absolute top-0 left-0 flex items-center gap-1.5 whitespace-nowrap opacity-0 transition-opacity duration-300">
            <i className="block size-1.5 shrink-0 rounded-full bg-ink-3" />
            <span data-city-name className="rounded-[6px] bg-surface-2/70 px-1 text-[12px] leading-[1.35] text-ink-2" />
          </span>
        ))}
        {rings.map((r, i) => (
          <span
            key={r.v}
            ref={(n) => void (ringLabelEls.current[i] = n)}
            className="hud absolute top-0 left-0 rounded-full bg-surface-2/80 px-1.5 text-[11px] tracking-[0.12em] whitespace-nowrap text-teal opacity-0 transition-opacity duration-300"
          >
            {r.label}
          </span>
        ))}
        {pins.map((p) => (
          <div
            key={`${journey?.key ?? 'home'}:${p.id}`}
            ref={(n) => {
              if (n) pinEls.current.set(p.id, n)
              else if (pinEls.current.get(p.id) && !pinEls.current.get(p.id)!.isConnected) pinEls.current.delete(p.id)
            }}
            className="absolute top-0 left-0"
          >
            <PinView pin={p} />
          </div>
        ))}
      </div>
      {/* HUD vignette and fine scanlines. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_55%_45%,transparent_60%,color-mix(in_srgb,var(--canvas)_60%,transparent))]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background:repeating-linear-gradient(0deg,transparent_0_3px,var(--topo-line)_3px_4px)]" />
    </div>
  )
}
