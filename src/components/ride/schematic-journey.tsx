'use client'
/**
 * Offline / no-tiles journey map: a mission-control schematic in Web Mercator — graticule, range rings around home,
 * every catalogued resort as a faint dot, and the journey drawn with a glowing line while a car or plane glyph glides
 * along it. The camera follows the glyph (zooming out mid-leg, in at the ends) and ends on a tilted approach to the
 * resort. Lines are straight or great-circle arcs; the frame says "approximate route" and never implies roads.
 *
 * Everything per-frame is imperative (refs): React renders the static layers once per journey.
 * Reduced motion: the finished journey is drawn at once, framed, with no camera moves or tilt.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Car, Plane } from './glyphs'
import { mercatorY, type LonLat } from '@/lib/domain/journey'
import type { Journey, Pin } from './journey-model'
import { journeyCoords } from './journey-model'
import { APPROACH_SPAN_KM, followSpanKm, phaseAt, timeline } from './camera'
import { cn } from '@/lib/ui/cn'

export interface MapPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface JourneyCallbacks {
  /** Phase changes (not every frame). */
  onPhase?: (p: { phase: 'overview' | 'leg' | 'approach' | 'done'; leg: number }) => void
  /** Every frame while travelling: leg index and its progress 0…1. */
  onProgress?: (leg: number, f: number) => void
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
const proj = (p: LonLat): [number, number] => [p[0], projY(p[1])]
const KM_PER_DEG = 111.32

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

function pathD(pts: readonly LonLat[]): string {
  let d = ''
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = proj(pts[i])
    d += `${i ? 'L' : 'M'}${x.toFixed(4)} ${y.toFixed(4)}`
  }
  return d
}

const RINGS_KM = [25, 50, 100, 250, 500, 1000, 2500, 5000]
const RINGS_MI = [25, 50, 100, 250, 500, 1000, 2500]

interface Cam {
  x: number
  y: number
  /** log(px per projected unit) */
  ls: number
  tilt: number
}

/** Plane overscan so a tilted plane never shows its edges. */
const OVER_X = 0.3
const OVER_TOP = 0.7
const OVER_BOTTOM = 0.15
/** Tilt axis, as a fraction of the plane's height (a little below the view centre). */
const ORIGIN_Y = (OVER_TOP + 0.62) / (1 + OVER_TOP + OVER_BOTTOM)
const PERSPECTIVE = 1100
const PERSPECTIVE_Y = 0.3

export function SchematicJourney({ journey, home, context, replay, reduced, padding, distanceUnit, onPhase, onProgress, className }: SchematicProps) {
  const root = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const worlds = useRef<(SVGGElement | null)[]>([])
  const legPaths = useRef<(SVGPathElement | null)[]>([])
  const glowPaths = useRef<(SVGPathElement | null)[]>([])
  const pinEls = useRef<Map<string, HTMLDivElement>>(new Map())
  const glyphEl = useRef<HTMLDivElement>(null)
  const sweepEl = useRef<HTMLDivElement>(null)
  const ringLabelEls = useRef<(HTMLSpanElement | null)[]>([])
  const gratEls = useRef<(SVGGElement | null)[]>([])
  const reticleEl = useRef<SVGGElement | null>(null)
  const anchorEls = useRef<Map<string, HTMLDivElement>>(new Map())
  const cbs = useRef({ onPhase, onProgress })
  useEffect(() => {
    cbs.current = { onPhase, onProgress }
  }, [onPhase, onProgress])

  const rings = useMemo(() => {
    const list = distanceUnit === 'mi' ? RINGS_MI.map((v) => ({ v, km: v * 1.609344 })) : RINGS_KM.map((v) => ({ v, km: v }))
    return list.map((r) => {
      const pts: LonLat[] = []
      for (let a = 0; a <= 360; a += 5) pts.push(destination(home.lat, home.lon, a, r.km))
      return { ...r, d: pathD(pts) + 'Z', labelAt: destination(home.lat, home.lon, 160, r.km), label: `${r.v.toLocaleString('en-US')} ${distanceUnit.toUpperCase()}` }
    })
  }, [home.lat, home.lon, distanceUnit])

  // Graticule: three levels (10°, 1°, 0.1°), finer ones only around home and the journey ends.
  const graticule = useMemo(() => {
    const coarse: string[] = []
    for (let lon = -540; lon <= 540; lon += 10) coarse.push(`M${lon} ${projY(-80)}V${projY(84)}`)
    for (let lat = -80; lat <= 80; lat += 10) coarse.push(`M-540 ${projY(lat)}H540`)
    const focus: LonLat[] = [[home.lon, home.lat], ...(journey ? journey.pins.map((p) => p.at) : [])]
    const mid: string[] = []
    const fine: string[] = []
    const seenMid = new Set<string>()
    const seenFine = new Set<string>()
    for (const [lon0, lat0] of focus) {
      const bx = Math.round(lon0)
      const by = Math.round(lat0)
      const key = `${bx}:${by}`
      if (!seenMid.has(key)) {
        seenMid.add(key)
        for (let k = -8; k <= 8; k++) {
          mid.push(`M${bx + k} ${projY(by - 8)}V${projY(by + 8)}`)
          mid.push(`M${bx - 8} ${projY(by + k)}H${bx + 8}`)
        }
      }
      const fx = Math.round(lon0 * 10) / 10
      const fy = Math.round(lat0 * 10) / 10
      const fkey = `${fx}:${fy}`
      if (!seenFine.has(fkey)) {
        seenFine.add(fkey)
        for (let k = -12; k <= 12; k++) {
          fine.push(`M${(fx + k / 10).toFixed(2)} ${projY(fy - 1.2)}V${projY(fy + 1.2)}`)
          fine.push(`M${(fx - 1.2).toFixed(2)} ${projY(fy + k / 10)}H${(fx + 1.2).toFixed(2)}`)
        }
      }
    }
    return [coarse.join(''), mid.join(''), fine.join('')]
  }, [home.lat, home.lon, journey])

  const contextD = useMemo(
    () =>
      context
        .map((c) => {
          const lon = c.lon - home.lon > 180 ? c.lon - 360 : c.lon - home.lon < -180 ? c.lon + 360 : c.lon
          const [x, y] = proj([lon, c.lat])
          // Also draw the copy one world west (antimeridian journeys run west of −180).
          const [x2] = proj([lon - 360, c.lat])
          return `M${x.toFixed(3)} ${y.toFixed(3)}h0M${x2.toFixed(3)} ${y.toFixed(3)}h0`
        })
        .join(''),
    [context, home.lon],
  )

  // Range reticle around the resort (2 / 5 / 10 km), drawn flat on the plane so the approach tilt reads as depth.
  const reticle = useMemo(() => {
    if (!journey) return null
    const at = journey.legs[journey.legs.length - 1].to
    const circles = [2, 5, 10].map((km) => {
      const pts: LonLat[] = []
      for (let a = 0; a <= 360; a += 6) pts.push(destination(at[1], at[0], a, km))
      return pathD(pts.map((p) => [p[0] - (p[0] - at[0] > 180 ? 360 : 0), p[1]] as LonLat)) + 'Z'
    })
    const ticks = [0, 90, 180, 270].map((b) => pathD([destination(at[1], at[0], b, 10.6), destination(at[1], at[0], b, 13)])).join('')
    return { circles, ticks }
  }, [journey])

  const ghostD = useMemo(() => (journey ? journey.legs.map((l) => pathD(l.coords)) : []), [journey])
  const pins: Pin[] = useMemo(() => journey?.pins ?? [{ id: 'home', at: [home.lon, home.lat], label: home.name, kind: 'home' }], [journey, home])

  // The animation loop.
  useEffect(() => {
    const el = root.current
    const pl = plane.current
    if (!el || !pl) return
    let raf = 0
    let alive = true
    const tl = journey ? timeline(journey) : null
    let W = el.clientWidth
    let H = el.clientHeight
    const pad = padding

    const viewCenter = () => ({ x: pad.left + (W - pad.left - pad.right) / 2, y: pad.top + (H - pad.top - pad.bottom) / 2 })
    const viewW = () => Math.max(120, W - pad.left - pad.right)
    const viewH = () => Math.max(120, H - pad.top - pad.bottom)

    const fit = (pts: LonLat[]): Cam => {
      const xs = pts.map((p) => proj(p))
      const minX = Math.min(...xs.map((p) => p[0]))
      const maxX = Math.max(...xs.map((p) => p[0]))
      const minY = Math.min(...xs.map((p) => p[1]))
      const maxY = Math.max(...xs.map((p) => p[1]))
      const bw = Math.max(maxX - minX, 0.05)
      const bh = Math.max(maxY - minY, 0.05)
      const s = Math.min(viewW() / bw, viewH() / bh) * 0.78
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, ls: Math.log(s), tilt: 0 }
    }
    const spanCam = (at: LonLat, km: number, tilt: number): Cam => {
      const [x, y] = proj(at)
      const unitKm = KM_PER_DEG * Math.cos(at[1] / DEG)
      const s = viewW() / Math.max(0.002, km / Math.max(1e-3, unitKm))
      return { x, y, ls: Math.log(s), tilt }
    }

    const all = journey ? journeyCoords(journey) : []
    const overview = journey ? fit([...all, [home.lon, home.lat]]) : spanCam([home.lon, home.lat], 1400, 0)
    const resortAt = journey ? journey.legs[journey.legs.length - 1].to : ([home.lon, home.lat] as LonLat)
    const finalCam = reduced || !journey ? overview : spanCam(resortAt, APPROACH_SPAN_KM, 48)
    let cam: Cam = reduced || !journey ? { ...overview } : spanCam([home.lon, home.lat], 140, 0)

    let lastPhase = ''
    const emit = (phase: 'overview' | 'leg' | 'approach' | 'done', leg: number) => {
      const k = `${phase}:${leg}`
      if (k === lastPhase) return
      lastPhase = k
      cbs.current.onPhase?.({ phase, leg })
    }

    const render = (drawn: { leg: number; e: number; vertex: number; point: LonLat | null }, glyph: { at: LonLat; heading: number; kind: 'car' | 'plane' } | null) => {
      const s = Math.exp(cam.ls)
      const vc = viewCenter()
      // Plane coordinates: the plane overscans the viewport.
      const ox = OVER_X * W + vc.x
      const oy = OVER_TOP * H + vc.y
      if (![s, cam.x, cam.y, ox, oy].every(Number.isFinite)) return
      const tf = `translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${s.toFixed(6)}) translate(${(-cam.x).toFixed(5)} ${(-cam.y).toFixed(5)})`
      worlds.current[0]?.setAttribute('transform', tf)
      pl.style.transform = `rotateX(${cam.tilt.toFixed(2)}deg)`
      // Flat overlay positions: anchors inside the tilted plane are read back after layout, so labels sit exactly
      // where the browser projected the point (no hand-rolled perspective maths to drift).
      const anchorKeys: { key: string; at: LonLat }[] = [...pins.map((p) => ({ key: `pin:${p.id}`, at: p.at })), ...rings.map((r, i) => ({ key: `ring:${i}`, at: r.labelAt }))]
      const flat = new Map<string, readonly [number, number]>()
      const toScreen = (p: LonLat) => {
        const [x, y] = proj(p)
        return [(x - cam.x) * s + ox, (y - cam.y) * s + oy] as const
      }
      for (const a of anchorKeys) {
        const n = anchorEls.current.get(a.key)
        if (!n) continue
        const [x, y] = toScreen(a.at)
        n.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
      const rootBox = el.getBoundingClientRect()
      for (const a of anchorKeys) {
        const n = anchorEls.current.get(a.key)
        if (!n) continue
        const r = n.getBoundingClientRect()
        flat.set(a.key, [r.left - rootBox.left, r.top - rootBox.top])
      }
      const toFlat = (key: string) => flat.get(key) ?? ([-9999, -9999] as const)
      // Graticule level opacity by on-screen spacing.
      const steps = [10, 1, 0.1]
      steps.forEach((st, i) => {
        const px = st * s
        const o = px < 14 ? 0 : px < 40 ? (px - 14) / 26 : px > 900 ? Math.max(0, 1 - (px - 900) / 600) : 1
        gratEls.current[i]?.setAttribute('opacity', o.toFixed(3))
      })
      // Resort reticle: fades in once its 5 km ring is large on screen.
      if (reticleEl.current && journey) {
        const at = journey.legs[journey.legs.length - 1].to
        const r5 = (5 / (KM_PER_DEG * Math.cos(at[1] / DEG))) * s
        reticleEl.current.setAttribute('opacity', Math.max(0, Math.min(1, (r5 - 40) / 80)).toFixed(3))
      }
      // Ring labels.
      rings.forEach((r, i) => {
        const lab = ringLabelEls.current[i]
        if (!lab) return
        const [x, y] = toFlat(`ring:${i}`)
        const rpx = (r.km / (KM_PER_DEG * Math.cos(home.lat / DEG))) * s
        const vis = rpx > 50 && rpx < Math.max(W, H) * 1.2
        lab.style.opacity = vis ? '1' : '0'
        lab.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`
      })
      // Drawn route.
      if (journey) {
        journey.legs.forEach((leg, i) => {
          let d = ''
          // Route lines are drawn in plane pixels (not world units) so dashes and widths stay exact at any zoom.
          const px = (pts: readonly LonLat[]) =>
            pts
              .map((p, k) => {
                const [x, y] = toScreen(p)
                return `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
              })
              .join('')
          if (i < drawn.leg) d = px(leg.coords)
          else if (i === drawn.leg && drawn.point) d = px([...leg.coords.slice(0, drawn.vertex), drawn.point])
          legPaths.current[i]?.setAttribute('d', d || 'M0 0')
          glowPaths.current[i]?.setAttribute('d', d || 'M0 0')
          legPaths.current[i]?.setAttribute('visibility', d ? 'visible' : 'hidden')
          glowPaths.current[i]?.setAttribute('visibility', d ? 'visible' : 'hidden')
        })
      }
      // Pins (counter-rotated so they stand up on the tilted plane).
      for (const p of pins) {
        const node = pinEls.current.get(p.id)
        if (!node) continue
        const [x, y] = toFlat(`pin:${p.id}`)
        node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
        node.style.visibility = x < -200 || y < -200 || x > W + 200 || y > H + 200 ? 'hidden' : 'visible'
      }
      // Radar sweep at home.
      if (sweepEl.current) {
        const [x, y] = toScreen([home.lon, home.lat])
        sweepEl.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
      // Glyph.
      const g = glyphEl.current
      if (g) {
        if (glyph) {
          const [x, y] = toScreen(glyph.at)
          g.style.opacity = '1'
          g.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${glyph.heading.toFixed(1)}deg)`
          g.dataset.kind = glyph.kind
        } else g.style.opacity = '0'
      }
    }

    const screenHeading = (a: LonLat, b: LonLat) => {
      const [x1, y1] = proj(a)
      const [x2, y2] = proj(b)
      return Math.atan2(x2 - x1, -(y2 - y1)) * DEG
    }

    if (reduced || !tl || !journey) {
      cam = { ...finalCam }
      // Re-render for a few frames: labels are placed from laid-out anchors, and the first layout may not be final.
      let n = 0
      const settle = () => {
        if (!alive) return
        render({ leg: journey ? journey.legs.length : 0, e: 1, vertex: 0, point: null }, null)
        if (++n < 30) raf = requestAnimationFrame(settle)
      }
      settle()
      emit(journey ? 'done' : 'overview', journey ? journey.legs.length - 1 : 0)
      if (journey) for (let i = 0; i < journey.legs.length; i++) cbs.current.onProgress?.(i, 1)
    }

    const t0 = performance.now()
    let prev = t0
    const step = (now: number) => {
      if (!alive || !tl || !journey) return
      const dt = Math.min(64, now - prev)
      prev = now
      const t = now - t0
      const ph = phaseAt(tl, t)
      let target: Cam
      let drawn = { leg: 0, e: 0, vertex: 0, point: null as LonLat | null }
      let glyph: { at: LonLat; heading: number; kind: 'car' | 'plane' } | null = null
      let tau = 420
      if (ph.phase === 'overview') {
        target = overview
        emit('overview', 0)
        tau = 380
      } else if (ph.phase === 'leg') {
        const L = tl.legs[ph.index]
        const leg = L.leg
        const span = followSpanKm(leg, ph.e)
        // Lead the camera slightly ahead of the glyph.
        const ahead = phaseAt(tl, Math.min(L.start + L.dur - 1, t + 220))
        const lead = ahead.phase === 'leg' && ahead.index === ph.index ? ahead.point : ph.point
        const center: LonLat = [ph.point[0] * 0.6 + lead[0] * 0.4, ph.point[1] * 0.6 + lead[1] * 0.4]
        target = spanCam(center, span, leg.kind === 'air' ? 22 + 10 * Math.sin(Math.PI * ph.e) : 34)
        // Ease from the overview into the first follow.
        // Ease in from the overview, then lock onto the glyph (a lagging camera loses fast planes).
        const blend = ph.index === 0 ? Math.min(1, (t - L.start) / 1100) : 1
        tau = 520 + (60 - 520) * blend
        drawn = { leg: ph.index, e: ph.e, vertex: ph.vertex, point: ph.point }
        const back = phaseAt(tl, Math.max(L.start, t - 120))
        const from = back.phase === 'leg' && back.index === ph.index ? back.point : leg.coords[0]
        const to = ahead.phase === 'leg' && ahead.index === ph.index ? ahead.point : leg.coords[Math.min(leg.coords.length - 1, 1)]
        const heading = screenHeading(from[0] === to[0] && from[1] === to[1] ? leg.coords[0] : from, from[0] === to[0] && from[1] === to[1] ? leg.coords[leg.coords.length - 1] : to)
        glyph = { at: ph.point, heading, kind: leg.kind === 'air' ? 'plane' : 'car' }
        emit('leg', ph.index)
        cbs.current.onProgress?.(ph.index, ph.f)
        for (let i = 0; i < ph.index; i++) cbs.current.onProgress?.(i, 1)
      } else {
        target = finalCam
        tau = 650
        drawn = { leg: journey.legs.length, e: 1, vertex: 0, point: null }
        for (let i = 0; i < journey.legs.length; i++) cbs.current.onProgress?.(i, 1)
        emit(ph.phase === 'approach' ? 'approach' : 'done', journey.legs.length - 1)
      }
      const k = 1 - Math.exp(-dt / tau)
      const ks = 1 - Math.exp(-dt / Math.max(260, tau * 1.25))
      cam = {
        x: cam.x + (target.x - cam.x) * k,
        y: cam.y + (target.y - cam.y) * k,
        ls: cam.ls + (target.ls - cam.ls) * ks,
        tilt: cam.tilt + (target.tilt - cam.tilt) * (1 - Math.exp(-dt / 600)),
      }
      render(drawn, glyph)
      if (ph.phase === 'done' && Math.abs(cam.ls - target.ls) < 0.002 && Math.abs(cam.tilt - target.tilt) < 0.05) return
      raf = requestAnimationFrame(step)
    }
    if (!reduced && tl && journey) {
      render({ leg: 0, e: 0, vertex: 0, point: null }, null)
      raf = requestAnimationFrame(step)
    }

    const ro = new ResizeObserver(() => {
      W = el.clientWidth
      H = el.clientHeight
      if (reduced || !tl) {
        const fresh = journey ? fit([...all, [home.lon, home.lat]]) : spanCam([home.lon, home.lat], 1400, 0)
        cam = fresh
        render({ leg: journey ? journey.legs.length : 0, e: 1, vertex: 0, point: null }, null)
      }
    })
    ro.observe(el)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey, replay, reduced, padding.left, padding.right, padding.top, padding.bottom, home.lat, home.lon, rings])

  return (
    <div ref={root} className={cn('absolute inset-0 overflow-hidden bg-surface-2', className)} style={{ perspective: `${PERSPECTIVE}px`, perspectiveOrigin: `50% ${PERSPECTIVE_Y * 100}%` }} aria-hidden>
      {/* Sky wash behind the plane (visible when it tilts). */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--sky-1),var(--sky-3))]" />
      <div
        ref={plane}
        className="absolute"
        style={{
          left: `${-OVER_X * 100}%`,
          right: `${-OVER_X * 100}%`,
          top: `${-OVER_TOP * 100}%`,
          bottom: `${-OVER_BOTTOM * 100}%`,
          transformStyle: 'preserve-3d',
          transformOrigin: `50% ${ORIGIN_Y * 100}%`,
        }}
      >
        <div className="absolute inset-0 bg-surface-2" />
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          <g ref={(n) => void (worlds.current[0] = n)}>
            <g ref={(n) => void (gratEls.current[0] = n)}>
              <path d={graticule[0]} fill="none" stroke="var(--topo-line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </g>
            <g ref={(n) => void (gratEls.current[1] = n)}>
              <path d={graticule[1]} fill="none" stroke="var(--topo-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </g>
            <g ref={(n) => void (gratEls.current[2] = n)}>
              <path d={graticule[2]} fill="none" stroke="var(--topo-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </g>
            {rings.map((r) => (
              <path key={r.v} d={r.d} fill="none" stroke="var(--teal)" strokeOpacity={0.28} strokeWidth={1} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={contextD} stroke="var(--teal)" strokeOpacity={0.4} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {reticle ? (
              <g ref={(n) => void (reticleEl.current = n)} opacity={0}>
                {reticle.circles.map((d, i) => (
                  <path key={i} d={d} fill="none" stroke="var(--teal)" strokeOpacity={0.55 - i * 0.12} strokeWidth={1.25} strokeDasharray={i === 2 ? '3 4' : undefined} vectorEffect="non-scaling-stroke" />
                ))}
                <path d={reticle.ticks} stroke="var(--teal)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </g>
            ) : null}
            {ghostD.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="var(--ink-3)" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="1 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        </svg>
        {/* Glow: a blurred copy of the drawn route (screen-space blur on the svg element). */}
        <svg className="absolute inset-0 h-full w-full overflow-visible [filter:blur(7px)]">
          <g>
            {journey?.legs.map((l, i) => (
              <path
                key={i}
                ref={(n) => void (glowPaths.current[i] = n)}
                d="M0 0"
                visibility="hidden"
                fill="none"
                stroke="var(--teal)"
                strokeOpacity={0.75}
                strokeWidth={l.kind === 'air' ? 9 : 11}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>
        </svg>
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          <g>
            {journey?.legs.map((l, i) => (
              <path
                key={i}
                ref={(n) => void (legPaths.current[i] = n)}
                d="M0 0"
                visibility="hidden"
                fill="none"
                stroke="var(--teal)"
                strokeWidth={l.kind === 'air' ? 3 : 4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={l.kind === 'air' ? undefined : '7 7'}
              />
            ))}
          </g>
        </svg>

        {/* Zero-size anchors for the flat overlay (see render). */}
        {[...pins.map((p) => `pin:${p.id}`), ...rings.map((_, i) => `ring:${i}`)].map((key) => (
          <div
            key={key}
            ref={(n) => {
              if (n) anchorEls.current.set(key, n)
              else anchorEls.current.delete(key)
            }}
            className="pointer-events-none absolute top-0 left-0 size-0"
          />
        ))}
        {/* Radar sweep at home (decorative). */}
        <div ref={sweepEl} className="pointer-events-none absolute top-0 left-0">
          <div style={{ animationDuration: '7s' }} className="animate-spin absolute -top-[140px] -left-[140px] size-[280px] rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,color-mix(in_srgb,var(--teal)_14%,transparent)_40deg,transparent_70deg)] [mask-image:radial-gradient(circle,#000_55%,transparent_70%)]" />
        </div>

        <div ref={glyphEl} className="pointer-events-none absolute top-0 left-0 opacity-0 [&[data-kind=car]_.g-plane]:hidden [&[data-kind=plane]_.g-car]:hidden">
          <Car className="g-car" />
          <Plane className="g-plane" />
        </div>
      </div>
      {/* Flat overlay: labels stay upright and crisp while the plane tilts. */}
      <div className="pointer-events-none absolute inset-0">
          {rings.map((r, i) => (
            <span
              key={r.v}
              ref={(n) => void (ringLabelEls.current[i] = n)}
              className="hud pointer-events-none absolute top-0 left-0 rounded-full bg-surface-2/80 px-1.5 text-[10.5px] tracking-[0.14em] whitespace-nowrap text-teal opacity-0 transition-opacity duration-300"
            >
              {r.label}
            </span>
          ))}

          {pins.map((p) => (
            <div
              key={p.id}
              ref={(n) => {
                if (n) pinEls.current.set(p.id, n)
                else pinEls.current.delete(p.id)
              }}
              className="pointer-events-none absolute top-0 left-0"
              style={{ transformOrigin: '0 0' }}
            >
              <PinView pin={p} />
            </div>
          ))}

      </div>
      {/* HUD vignette and fine scanlines. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_55%_45%,transparent_55%,color-mix(in_srgb,var(--canvas)_70%,transparent))]" />
      <div className="pointer-events-none absolute inset-0 opacity-40 [background:repeating-linear-gradient(0deg,transparent_0_3px,var(--topo-line)_3px_4px)]" />
    </div>
  )
}

export function PinView({ pin }: { pin: Pin }) {
  if (pin.kind === 'resort') {
    return (
      <div className="flex -translate-x-1/2 -translate-y-[calc(100%-7px)] flex-col items-center gap-1.5">
        <span className="flex flex-col items-center rounded-[14px] bg-ink-chip px-3 py-1.5 whitespace-nowrap text-on-ink-chip shadow-overlay">
          <span className="text-[12.5px] leading-tight font-semibold">{pin.label}</span>
          {pin.sub ? <span className="hud text-[9.5px] tracking-[0.1em] text-on-ink-chip-2">{pin.sub}</span> : null}
        </span>
        <span className="relative block size-3.5">
          <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: 'piste-beacon 2.2s ease-out infinite' }} />
          <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: 'piste-beacon 2.2s ease-out 1.1s infinite' }} />
          <span className="absolute inset-[2px] rounded-full bg-teal shadow-[0_0_0_2px_var(--surface),0_0_14px_var(--teal)]" />
        </span>
      </div>
    )
  }
  return (
    <div className="flex -translate-x-1/2 -translate-y-[calc(100%-6px)] flex-col items-center gap-1.5">
      <span
        className={cn(
          'glass-strong rounded-[12px] px-2.5 py-1 whitespace-nowrap text-ink',
          pin.kind === 'airport' ? 'hud text-[11px]' : 'text-[12px] font-medium',
        )}
      >
        {pin.label}
      </span>
      {pin.kind === 'home' ? (
        <span className="block size-3 rounded-full border-[2.5px] border-ink bg-surface shadow-lift" />
      ) : (
        <span className="block size-2.5 rotate-45 border-2 border-teal bg-surface" />
      )}
    </div>
  )
}
