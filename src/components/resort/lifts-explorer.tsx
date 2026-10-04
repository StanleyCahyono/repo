'use client'
/**
 * Lifts & runs, the story view: a terrain map of the ski area beside glass cards for lifts by type and the runs
 * grouped by the resort's own difficulty signs. Where Piste bundles an OpenStreetMap snapshot (every catalog resort), every run
 * and lift is drawn in its sign's colour with the sign's shape, and tapping a line — or a name in the list, the
 * map's text alternative — shows its name, sign and mapped length.
 *
 * The map is layered: a schematic drawn from the bundled lines (or a quiet grid and the resort's position) is always
 * there and needs no network; when online, MapLibre's 3D terrain (open elevation data, satellite imagery) loads
 * lazily on top once it is on screen. Offline is a first-class state, labelled as such. No scroll-wheel zoom, so the
 * page never gets stuck scrolling the map.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react'
import { ArrowUpRight, Maximize2, Minus, Plus, X } from 'lucide-react'
import type { MappedLine } from '@/lib/data/lifts'
import type { PisteShape, PisteTone } from '@/lib/domain/lifts'
import { cn } from '@/lib/ui/cn'
import { EASE_OUT, t } from '@/lib/ui/motion'
import { measureText, useFontsReady } from './map-text'
import { LABEL_STYLE, labelAnchor, layoutLabels, type MapPlaceLabel, type PlaceKind, type PlacedLabel } from './map-labels'
import { PisteSymbol } from './piste-symbol'

const TerrainGl = dynamic(() => import('./terrain-map-gl'), { ssr: false, loading: () => null })

export const TONE_VAR: Record<PisteTone, string> = {
  green: 'var(--positive)',
  blue: 'var(--info)',
  red: 'var(--critical)',
  black: 'var(--ink)',
  orange: 'var(--caution)',
  neutral: 'var(--ink-3)',
}

export interface SignLegend {
  key: string
  label: string
  shape: PisteShape
  tone: PisteTone
  meaning: string
}

export interface RunChipGroup {
  sign: SignLegend
  /** '12 named runs' / '23 mapped sections' */
  count: string
  names: { name: string; ids: string[] }[]
  /** More names than shown (the full list is in the drawer below). */
  more: number
  unnamed: number
}

export interface LiftBar {
  label: string
  n: number
}

export interface LiftsExplorerProps {
  name: string
  center: { lat: number; lon: number }
  /** Bundled OpenStreetMap lines (null: none bundled for this resort). */
  lines: MappedLine[] | null
  bbox: [number, number, number, number] | null
  /** 'OpenStreetMap snapshot · 1 Oct 2026 · built in' */
  linesSource: string | null
  /** Signs that appear on the map (legend). */
  legend: SignLegend[]
  liftBars: { title: string; aside: string | null; bars: LiftBar[]; note: string | null } | null
  runs: { source: string; status: string; groups: RunChipGroup[]; empty: string | null }
  liveStatus: { url: string; label: string } | null
  units: 'metric' | 'imperial'
  /** Towns, peaks and lift stations from the snapshot (empty when it has none). */
  places: MapPlaceLabel[]
  /** The resort's own village (catalog locality), labelled at the resort when no settlement falls in the frame. */
  baseVillage: string | null
}

function lengthText(m: number, imperial: boolean): string {
  if (imperial) {
    const ft = m * 3.28084
    return ft < 5280 ? `${(Math.round(ft / 10) * 10).toLocaleString('en-US')} ft` : `${(ft / 5280).toFixed(1)} mi`
  }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

// ---------------------------------------------------------------------------------------------------------------------
// Schematic (always available)

interface Frame {
  vb: [number, number, number, number]
  x: (lon: number) => number
  y: (lat: number) => number
}

/** Equirectangular projection of the bbox, widened to the container's aspect ratio so overlays line up. */
function frameFor(bbox: [number, number, number, number], aspect: number): Frame {
  const [w, s, e, n] = bbox
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180)
  const x = (lon: number) => (lon - w) * k * 1000
  const y = (lat: number) => (n - lat) * 1000
  let bw = x(e)
  let bh = y(s)
  const pad = 0.1
  let ox = -bw * pad
  let oy = -bh * pad
  bw *= 1 + 2 * pad
  bh *= 1 + 2 * pad
  if (bw / bh < aspect) {
    const nw = bh * aspect
    ox -= (nw - bw) / 2
    bw = nw
  } else {
    const nh = bw / aspect
    oy -= (nh - bh) / 2
    bh = nh
  }
  return { vb: [ox, oy, bw, bh], x, y }
}

/** Pan & zoom of the schematic: screen = base × k + (x, y), base being the whole area fitted to the frame. */
interface View {
  k: number
  x: number
  y: number
}
const HOME: View = { k: 1, x: 0, y: 0 }
const MAX_ZOOM = 8

/** Base-pixel projection of the frame for a container size. */
function baseProjector(frame: Frame, w: number, h: number) {
  const [ox, oy, bw, bh] = frame.vb
  return { x: (lon: number) => ((frame.x(lon) - ox) / bw) * w, y: (lat: number) => ((frame.y(lat) - oy) / bh) * h }
}

/** The drawn lines, in base pixels (the pan/zoom transform is applied by the parent group). Memoised: panning never re-renders them. */
const SchematicLines = memo(function SchematicLines({
  lines,
  frame,
  w,
  h,
  selected,
  onSelect,
  wasDrag,
}: {
  lines: MappedLine[]
  frame: Frame
  w: number
  h: number
  selected: Set<string>
  onSelect: (ids: string[]) => void
  wasDrag: () => boolean
}) {
  const pr = baseProjector(frame, w, h)
  const any = selected.size > 0
  return (
    <>
      {lines.map((l, i) => {
        const d = `M${l.coords.map((c) => `${pr.x(c[0]).toFixed(1)},${pr.y(c[1]).toFixed(1)}`).join('L')}`
        const on = selected.has(l.id)
        const dim = any && !on
        const color = l.kind === 'lift' ? 'var(--ink)' : TONE_VAR[l.sign?.tone ?? 'neutral']
        const solid = l.kind === 'run' && l.sign?.key !== 'unknown'
        return (
          <g key={l.id} opacity={dim ? 0.28 : 1} className="transition-opacity duration-200">
            <path d={d} fill="none" stroke="var(--surface)" strokeWidth={on ? 9 : l.kind === 'lift' ? 5 : 6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="lx-case" />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={on ? 5 : l.kind === 'lift' ? 2 : 3}
              strokeDasharray={l.kind === 'lift' ? '6 3' : l.sign?.key === 'unknown' ? '2 3' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pathLength={solid ? 1 : undefined}
              className={solid ? 'lx-run' : 'lx-fade'}
              style={solid ? ({ '--lx-d': `${Math.min(i, 400) * 1.2}ms` } as CSSProperties) : undefined}
            />
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
              onClick={() => {
                if (wasDrag()) return
                onSelect(l.name ? lines.filter((x) => x.name === l.name && x.kind === l.kind).map((x) => x.id) : [l.id])
              }}
            />
          </g>
        )
      })}
    </>
  )
})

const HALO = '[text-shadow:0_0_2px_var(--surface),0_0_4px_var(--surface),0_0_9px_var(--surface)]'

function PlaceMarker({ kind }: { kind: PlaceKind }) {
  const st = LABEL_STYLE[kind]
  if (st.marker === 'peak')
    return (
      <svg aria-hidden viewBox="0 0 12 11" className="size-[11px] overflow-visible">
        <path d="M6 0.8 11.2 10.2H0.8Z" fill="var(--ink-2)" stroke="var(--surface)" strokeWidth="1.6" paintOrder="stroke" strokeLinejoin="round" />
      </svg>
    )
  if (st.marker === 'station') return <span aria-hidden className="block size-[7px] rounded-[2px] border-[1.5px] border-surface bg-ink-2" />
  return <span aria-hidden className={cn('block rounded-full border-2 border-surface bg-ink shadow-[0_0_0_1px_color-mix(in_srgb,var(--ink)_25%,transparent)]', st.marker === 'dot-lg' ? 'size-[9px]' : 'size-[7px]')} />
}

/** Town, peak and station names over the map: constant screen size, collision-free, fading in as they gain room. */
function PlaceLabels({ placed }: { placed: PlacedLabel[] }) {
  return (
    <div aria-hidden data-audit-text="yes" className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
      <AnimatePresence initial={false}>
        {placed.map((pl) => {
          const { place, x, y } = pl
          const st = LABEL_STYLE[place.kind]
          return (
            <motion.div key={place.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.pageIn} className="absolute inset-0">
              <span className="absolute flex -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
                <PlaceMarker kind={place.kind} />
              </span>
              <span
                className={cn('absolute leading-[1.3] whitespace-nowrap text-ink', HALO, place.kind === 'city' || place.kind === 'town' ? 'tracking-[0.01em]' : '')}
                style={{ ...labelAnchor(pl), fontSize: st.size, fontWeight: st.weight }}
              >
                {place.name}
                {place.ele ? <span className="ml-[5px] font-mono text-[12px] font-medium text-ink-2 tnum">{place.ele}</span> : null}
              </span>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function Grid({ view }: { view: View }) {
  const s = 40 * Math.min(view.k, 2.5)
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full">
      <defs>
        <pattern id="schematic-grid" width={s} height={s} patternUnits="userSpaceOnUse" patternTransform={`translate(${(view.x % s).toFixed(1)} ${(view.y % s).toFixed(1)})`}>
          <path d={`M${s} 0H0V${s}`} fill="none" stroke="var(--topo-line)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#schematic-grid)" />
    </svg>
  )
}

const ZOOM_BTN =
  'flex size-10 items-center justify-center text-ink transition-[background-color,color,transform] duration-150 hover:bg-chip-hover active:scale-95 disabled:pointer-events-none disabled:text-ink-3 md:size-9'

// ---------------------------------------------------------------------------------------------------------------------

function MapPanel(p: LiftsExplorerProps & { selected: Set<string>; onSelect: (ids: string[]) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '200px 0px' })
  const [gl, setGl] = useState<'loading' | 'live' | 'offline'>('loading')
  const reduce = useReducedMotion()
  const imperial = p.units === 'imperial'
  const sel = p.lines?.filter((l) => p.selected.has(l.id)) ?? []
  const first = sel[0] ?? null
  const total = sel.reduce((m, l) => m + l.lengthM, 0)
  const { onSelect } = p

  const [size, setSize] = useState({ w: 840, h: 560 })
  // Labels are laid out from measured text, so only once the frame has been measured in the browser.
  const [measured, setMeasured] = useState(false)
  useEffect(() => {
    const el = area.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      if (r.width && r.height) {
        setSize({ w: Math.round(r.width), h: Math.round(r.height) })
        setMeasured(true)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const frame = useMemo(() => (p.bbox ? frameFor(p.bbox, size.w / size.h) : null), [p.bbox, size.w, size.h])
  const pr = useMemo(() => (frame ? baseProjector(frame, size.w, size.h) : null), [frame, size.w, size.h])
  const live = gl === 'live'
  const interactive = !!(frame && p.lines) && !live

  // ---- pan & zoom ----
  const [view, setViewState] = useState<View>(HOME)
  const viewRef = useRef<View>(HOME)
  const anim = useRef<{ stop: () => void } | null>(null)
  const clamp = useCallback(
    (v: View): View => {
      const k = Math.min(MAX_ZOOM, Math.max(1, v.k))
      return { k, x: Math.min(0, Math.max(size.w - size.w * k, v.x)), y: Math.min(0, Math.max(size.h - size.h * k, v.y)) }
    },
    [size.w, size.h],
  )
  const setView = useCallback(
    (v: View) => {
      const c = clamp(v)
      viewRef.current = c
      setViewState(c)
    },
    [clamp],
  )
  // Keep the view valid when the frame resizes.
  useEffect(() => setView(viewRef.current), [setView])
  const flyTo = useCallback(
    (target: View) => {
      anim.current?.stop()
      const to = clamp(target)
      if (reduce) return setView(to)
      const from = viewRef.current
      anim.current = animate(0, 1, {
        duration: 0.26,
        ease: EASE_OUT,
        onUpdate: (q) => setView({ k: from.k + (to.k - from.k) * q, x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q }),
      })
    },
    [clamp, reduce, setView],
  )
  const zoomAt = useCallback((v: View, factor: number, px: number, py: number): View => {
    const k = Math.min(MAX_ZOOM, Math.max(1, v.k * factor))
    const r = k / v.k
    return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r }
  }, [])
  const zoomBy = useCallback((factor: number) => flyTo(zoomAt(viewRef.current, factor, size.w / 2, size.h / 2)), [flyTo, zoomAt, size.w, size.h])

  // Drag to pan, pinch to zoom (pointer events), with a small threshold so a tap still selects a line.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ moved: boolean; start: { x: number; y: number }; dist: number; mid: { x: number; y: number } } | null>(null)
  const dragged = useRef(false)
  const wasDrag = useCallback(() => dragged.current, [])
  const [engaged, setEngaged] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  const local = (e: { clientX: number; clientY: number }) => {
    const r = area.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const pinchInfo = () => {
    const pts = [...pointers.current.values()]
    if (pts.length < 2) return { dist: 0, mid: pts[0] ?? { x: 0, y: 0 } }
    return { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } }
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || (e.target as HTMLElement).closest('button,a')) return
    setEngaged(true)
    anim.current?.stop()
    pointers.current.set(e.pointerId, local(e))
    const info = pinchInfo()
    gesture.current = { moved: false, start: local(e), dist: info.dist, mid: info.mid }
    dragged.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, local(e))
    const info = pinchInfo()
    const v = viewRef.current
    if (pointers.current.size >= 2) {
      g.moved = true
      dragged.current = true
      const z = g.dist ? zoomAt(v, info.dist / g.dist, info.mid.x, info.mid.y) : v
      setView({ k: z.k, x: z.x + info.mid.x - g.mid.x, y: z.y + info.mid.y - g.mid.y })
      g.dist = info.dist
      g.mid = info.mid
      return
    }
    const pt = info.mid
    if (!g.moved && Math.hypot(pt.x - g.start.x, pt.y - g.start.y) < 4) return
    if (!g.moved) {
      g.moved = true
      dragged.current = true
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      setGrabbing(true)
    }
    setView({ k: v.k, x: v.x + pt.x - g.mid.x, y: v.y + pt.y - g.mid.y })
    g.mid = pt
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const info = pinchInfo()
    if (gesture.current) {
      gesture.current.dist = info.dist
      gesture.current.mid = info.mid
    }
    if (!pointers.current.size) {
      gesture.current = null
      setGrabbing(false)
      // The click that ends a drag still fires after pointerup; forget the drag just after it.
      window.setTimeout(() => (dragged.current = false), 0)
    }
  }

  // Wheel: Ctrl/⌘ + wheel (and trackpad pinch) always zooms; a plain wheel zooms once you have clicked into the map,
  // and otherwise keeps scrolling the page with a hint, so the page never gets stuck on the map.
  const [hint, setHint] = useState(false)
  const hintTimer = useRef(0)
  useEffect(() => {
    const el = area.current
    if (!el || !interactive) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || engaged)) {
        window.clearTimeout(hintTimer.current)
        setHint(true)
        hintTimer.current = window.setTimeout(() => setHint(false), 1400)
        return
      }
      e.preventDefault()
      anim.current?.stop()
      const r = el.getBoundingClientRect()
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022))
      setView(zoomAt(viewRef.current, factor, e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [interactive, engaged, setView, zoomAt])
  useEffect(() => () => window.clearTimeout(hintTimer.current), [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive || e.target !== e.currentTarget) return
    const step = 90
    const v = viewRef.current
    const keys: Record<string, () => void> = {
      '+': () => zoomBy(1.6),
      '=': () => zoomBy(1.6),
      '-': () => zoomBy(1 / 1.6),
      _: () => zoomBy(1 / 1.6),
      '0': () => flyTo(HOME),
      ArrowLeft: () => flyTo({ ...v, x: v.x + step }),
      ArrowRight: () => flyTo({ ...v, x: v.x - step }),
      ArrowUp: () => flyTo({ ...v, y: v.y + step }),
      ArrowDown: () => flyTo({ ...v, y: v.y - step }),
    }
    const fn = keys[e.key]
    if (!fn) return
    e.preventDefault()
    fn()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSelect])

  // ---- 3D camera (labels follow it when the terrain layer is live) ----
  const [cam, setCam] = useState<{ project: (lon: number, lat: number) => [number, number]; zoom: number } | null>(null)
  const onCamera = useCallback((project: (lon: number, lat: number) => [number, number], zoom: number) => setCam({ project, zoom }), [])

  // ---- labels ----
  const places = useMemo(() => {
    const list = [...p.places]
    const settled = (frame && pr ? list.filter((pl) => pl.kind === 'city' || pl.kind === 'town' || pl.kind === 'village') : []).some((pl) => {
      const x = pr!.x(pl.lon)
      const y = pr!.y(pl.lat)
      return x >= 0 && y >= 0 && x <= size.w && y <= size.h
    })
    if (!settled && p.baseVillage) list.push({ id: 'base-village', name: p.baseVillage, kind: 'village', lon: p.center.lon, lat: p.center.lat, ele: null, eleM: null })
    return list
  }, [p.places, p.baseVillage, p.center.lon, p.center.lat, frame, pr, size.w, size.h])

  // Scale bar: one view unit is 1/1000° of latitude (≈111.3 m).
  const scale = useMemo(() => {
    if (!frame) return null
    const mPerPx = (frame.vb[2] * 111.32) / size.w / view.k
    const steps = imperial
      ? [200, 500, 1000, 2000, 5280, 10560].map((ft) => ({ m: ft * 0.3048, label: ft >= 5280 ? `${ft / 5280} mi` : `${ft.toLocaleString('en-US')} ft` }))
      : [50, 100, 200, 250, 500, 1000, 2000, 5000].map((m) => ({ m, label: m >= 1000 ? `${m / 1000} km` : `${m} m` }))
    const pick = steps.find((x) => x.m / mPerPx >= 70) ?? steps[steps.length - 1]
    return { px: Math.round(pick.m / mPerPx), label: pick.label }
  }, [frame, size.w, view.k, imperial])

  const scalePx = scale?.px ?? 0
  const hasSel = !!first
  const obstacles = useMemo(() => {
    const w = size.w
    const h = size.h
    const o = live
      ? [{ l: w - 56, t: h - 170, r: w, b: h }]
      : [
          { l: w - 60, t: 0, r: w, b: 150 },
          { l: w - 28 - Math.max(scalePx, 64), t: h - 76, r: w, b: h },
        ]
    if (hasSel) o.push({ l: 0, t: h - 116, r: Math.min(w, 400), b: h })
    return o
  }, [size.w, size.h, live, hasSel, scalePx])

  const fonts = useFontsReady()
  const placed = useMemo(() => {
    if (!places.length || !measured) return []
    void fonts
    if (live) {
      if (!cam) return []
      return layoutLabels(places, { project: (pl) => cam.project(pl.lon, pl.lat), measure: measureText, width: size.w, height: size.h, zoom: cam.zoom, obstacles })
    }
    if (!pr) return []
    return layoutLabels(places, { project: (pl) => [pr.x(pl.lon) * view.k + view.x, pr.y(pl.lat) * view.k + view.y], measure: measureText, width: size.w, height: size.h, zoom: view.k, obstacles })
  }, [places, measured, fonts, live, cam, pr, view, size.w, size.h, obstacles])

  // ---- run markers: one per named run, thinned per zoom level so lines stay readable ----
  const level = Math.round(Math.log2(view.k) * 2) / 2
  const markers = useMemo(() => {
    if (!p.lines || !pr) return []
    const lk = 2 ** level
    const best = new Map<string, MappedLine>()
    for (const l of p.lines) {
      if (l.kind !== 'run' || !l.name || !l.sign) continue
      const cur = best.get(l.name)
      if (!cur || l.lengthM > cur.lengthM) best.set(l.name, l)
    }
    const out: { l: MappedLine; bx: number; by: number }[] = []
    for (const l of [...best.values()].sort((a, b) => b.lengthM - a.lengthM)) {
      const c = l.coords[Math.floor(l.coords.length / 2)]
      const bx = pr.x(c[0])
      const by = pr.y(c[1])
      if (!out.some((m) => Math.hypot((m.bx - bx) * lk, (m.by - by) * lk) < 24)) out.push({ l, bx, by })
    }
    return out
  }, [p.lines, pr, level])
  // Run markers give way to place labels (and their markers): a marker is ~10 px across, so keep its centre 9 px clear.
  const labelBoxes = placed.flatMap((l) => [
    { l: l.box.left - 9, t: l.box.top - 9, r: l.box.left + l.box.width + 9, b: l.box.top + l.box.height + 9 },
    { l: l.x - 14, t: l.y - 14, r: l.x + 14, b: l.y + 14 },
  ])

  const any = p.selected.size > 0
  const zoomed = view.k > 1.01
  // The draw-in runs once, then the lines drop their dash trick (it would not survive zooming).
  const [drawn, setDrawn] = useState(false)
  const drawOn = inView && !reduce && !drawn
  useEffect(() => {
    if (!inView || reduce) return
    const id = window.setTimeout(() => setDrawn(true), 1900)
    return () => window.clearTimeout(id)
  }, [inView, reduce])

  return (
    <div ref={ref} className="glass relative flex h-[480px] flex-col overflow-hidden rounded-[32px] p-0 md:h-[640px]">
      <div
        ref={area}
        tabIndex={interactive ? 0 : undefined}
        role={interactive ? 'application' : undefined}
        aria-roledescription={interactive ? 'zoomable map' : undefined}
        aria-label={interactive ? `Map of ${p.name}: drag to pan; + and − zoom, arrow keys pan, 0 resets` : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !gesture.current && setEngaged(false)}
        onDoubleClick={(e) => {
          if (!interactive || (e.target as HTMLElement).closest('button,a')) return
          const pt = local(e)
          flyTo(zoomAt(viewRef.current, e.shiftKey ? 1 / 2 : 2, pt.x, pt.y))
        }}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden rounded-t-[32px] bg-[radial-gradient(120%_90%_at_30%_10%,var(--glacier),var(--surface-2)_70%)] outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-teal',
          interactive && (zoomed ? 'touch-none' : 'touch-pan-y'),
          interactive && (grabbing ? 'cursor-grabbing' : zoomed ? 'cursor-grab' : ''),
        )}
      >
        <Grid view={view} />
        {frame && p.lines ? (
          <>
            <svg className={cn('absolute inset-0 h-full w-full', drawOn && 'lx-draw')} role="img" aria-label={`Schematic map of ${p.name}'s mapped runs and lifts (list alternative beside it)`}>
              <style>{LINE_CSS}</style>
              <g transform={`translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`}>
                <SchematicLines lines={p.lines} frame={frame} w={size.w} h={size.h} selected={p.selected} onSelect={onSelect} wasDrag={wasDrag} />
              </g>
            </svg>
            {markers.map(({ l, bx, by }) => {
              const left = bx * view.k + view.x
              const top = by * view.k + view.y
              if (left < -10 || top < -10 || left > size.w + 10 || top > size.h + 10) return null
              if (labelBoxes.some((b) => left > b.l && left < b.r && top > b.t && top < b.b)) return null
              return (
                <span
                  key={l.id}
                  aria-hidden
                  className={cn('pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface p-[1.5px] transition-opacity duration-200', !zoomed && 'max-sm:hidden', any && !p.selected.has(l.id) && 'opacity-30', drawOn && 'lx-marker')}
                  style={{ left, top }}
                >
                  <PisteSymbol shape={l.sign!.shape} tone={l.sign!.tone} className={l.sign!.shape === 'double-diamond' ? 'h-2 w-[15px]' : 'size-2'} />
                </span>
              )
            })}
          </>
        ) : !live ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span aria-hidden className="absolute size-40 rounded-full border border-[color-mix(in_srgb,var(--teal)_25%,transparent)]" />
            <span aria-hidden className="absolute size-72 rounded-full border border-dashed border-[color-mix(in_srgb,var(--teal)_18%,transparent)]" />
            <span aria-hidden className="absolute h-px w-24 bg-[color-mix(in_srgb,var(--teal)_45%,transparent)]" />
            <span aria-hidden className="absolute h-24 w-px bg-[color-mix(in_srgb,var(--teal)_45%,transparent)]" />
            <div className="relative flex flex-col items-center gap-2">
              <span aria-hidden className="size-3.5 rounded-full border-[3px] border-teal bg-surface shadow-[0_0_0_6px_color-mix(in_srgb,var(--teal)_18%,transparent)]" />
              <span className="glass-strong hud rounded-[12px] px-3 py-1.5 text-ink">
                {p.name} · {Math.abs(p.center.lat).toFixed(3)}°{p.center.lat >= 0 ? 'N' : 'S'} {Math.abs(p.center.lon).toFixed(3)}°{p.center.lon >= 0 ? 'E' : 'W'}
              </span>
            </div>
          </div>
        ) : null}

        {inView ? (
          <motion.div initial={false} animate={{ opacity: live ? 1 : 0 }} transition={{ duration: reduce ? 0 : 0.6 }} className={cn('absolute inset-0 z-[1]', !live && 'pointer-events-none')}>
            <TerrainGl center={p.center} lines={p.lines} bbox={p.bbox} selected={[...p.selected]} onSelect={onSelect} onState={setGl} onCamera={onCamera} />
          </motion.div>
        ) : null}

        <PlaceLabels placed={placed} />

        {interactive ? (
          <div className="glass-strong absolute top-3 right-3 z-[3] flex flex-col overflow-hidden rounded-[16px]" role="group" aria-label="Map zoom">
            <button type="button" className={ZOOM_BTN} onClick={() => zoomBy(1.6)} disabled={view.k >= MAX_ZOOM - 0.01} aria-label="Zoom in">
              <Plus aria-hidden className="size-4" />
            </button>
            <span aria-hidden className="mx-2 h-px bg-divider" />
            <button type="button" className={ZOOM_BTN} onClick={() => zoomBy(1 / 1.6)} disabled={!zoomed} aria-label="Zoom out">
              <Minus aria-hidden className="size-4" />
            </button>
            <span aria-hidden className="mx-2 h-px bg-divider" />
            <button type="button" className={ZOOM_BTN} onClick={() => flyTo(HOME)} disabled={!zoomed} aria-label="Show the whole area">
              <Maximize2 aria-hidden className="size-[15px]" />
            </button>
          </div>
        ) : null}

        {scale && !live ? (
          <div aria-hidden className="pointer-events-none absolute right-4 bottom-4 z-[2] flex flex-col items-end gap-2 max-sm:right-3 max-sm:bottom-3">
            <span className="hud flex flex-col items-center leading-none text-ink-2">
              <span className="text-[13px] text-teal">▲</span>N
            </span>
            <span className="flex flex-col items-end gap-1">
              <span className="hud text-ink-2 tnum">{scale.label}</span>
              <span className="h-1.5 border-x border-b border-ink-2" style={{ width: scale.px }} />
            </span>
          </div>
        ) : null}

        <AnimatePresence>
          {hint ? (
            <motion.p
              key="hint"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={t.pageIn}
              className="pointer-events-none absolute top-1/2 left-1/2 z-[4] m-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-chip px-4 py-2 text-[13px] font-medium whitespace-nowrap text-on-ink-chip shadow-[0_12px_30px_rgb(19_32_44/0.25)]"
            >
              Click the map, or hold Ctrl / ⌘, to zoom with the wheel
            </motion.p>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {first ? (
            <motion.div
              key={first.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: reduce ? 0 : 0.2 }}
              role="status"
              className="absolute bottom-3 left-3 z-[3] flex max-w-[min(calc(100%-24px),384px)] items-start gap-3 rounded-[18px] bg-ink-chip px-4 py-3 text-on-ink-chip shadow-[0_12px_30px_rgb(19_32_44/0.3)]"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface">
                {first.sign ? <PisteSymbol shape={first.sign.shape} tone={first.sign.tone} className={first.sign.shape === 'double-diamond' ? 'h-3 w-[22px]' : 'size-3'} /> : <i aria-hidden className="w-3.5 border-t-2 border-dashed border-ink" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold break-words">{first.name ?? (first.kind === 'lift' ? 'Unnamed lift' : 'Unnamed run section')}</span>
                <span className="block text-[13px] text-on-ink-chip-2">
                  {first.label}
                  {first.sign ? ` · ${first.sign.meaning}` : ''}
                </span>
                <span className="hud mt-1 block text-on-ink-chip-accent">
                  {sel.length > 1 ? `${sel.length} mapped sections · ` : ''}
                  {lengthText(total, imperial)} mapped length
                </span>
              </span>
              <button type="button" onClick={() => onSelect([])} aria-label="Clear selection" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--on-ink-chip)_12%,transparent)]">
                <X aria-hidden className="size-4" />
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Key and map status sit under the map, never over its lines. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-glass-line px-4 py-3 md:px-5">
        {p.legend.length ? (
          <ul aria-label="Map key" className="m-0 flex list-none flex-wrap items-center gap-x-3.5 gap-y-1.5 p-0 text-[12.5px] text-ink">
            {p.legend.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                <PisteSymbol shape={s.shape} tone={s.tone} />
                {s.label}
              </li>
            ))}
            <li className="flex items-center gap-1.5 whitespace-nowrap">
              <i aria-hidden className="inline-block w-4 border-t-2 border-dashed border-ink" />
              Lift
            </li>
            {p.places.length ? (
              <li className="flex items-center gap-1.5 whitespace-nowrap">
                <PlaceMarker kind="peak" />
                Peak
              </li>
            ) : null}
          </ul>
        ) : null}
        <p className="hud m-0 ml-auto text-ink-2">
          {live
            ? `3D terrain · open elevation data${p.lines ? ' · OpenStreetMap lines' : ''}`
            : gl === 'offline'
              ? `Offline · schematic${p.lines ? ', lines to scale' : ''}`
              : `Schematic${p.lines ? ', lines to scale' : ''} · 3D terrain loads online`}
        </p>
      </div>
    </div>
  )
}

/** Runs draw themselves in once the map scrolls into view; lifts and run markers fade in after them. */
const LINE_CSS = `
@keyframes lx-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes lx-fade { from { opacity: 0; } to { opacity: 1; } }
.lx-draw .lx-run { stroke-dasharray: 1 1; stroke-dashoffset: 1; animation: lx-draw 1100ms cubic-bezier(0.22, 0.8, 0.26, 1) var(--lx-d, 0ms) forwards; }
.lx-draw .lx-case, .lx-draw .lx-fade { animation: lx-fade 600ms ease-out 250ms both; }
.lx-marker { animation: lx-fade 400ms ease-out 900ms both; }
@media (prefers-reduced-motion: reduce) { .lx-draw .lx-run, .lx-draw .lx-case, .lx-draw .lx-fade, .lx-marker { animation: none; stroke-dasharray: none; stroke-dashoffset: 0; opacity: 1; } }
`

export function LiftsExplorer(p: LiftsExplorerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const select = (ids: string[]) => setSelected((cur) => (ids.length && ids.every((i) => cur.has(i)) && cur.size === ids.length ? new Set() : new Set(ids)))
  const maxBar = Math.max(1, ...(p.liftBars?.bars.map((b) => b.n) ?? [1]))

  return (
    <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]">
      <MapPanel {...p} selected={selected} onSelect={select} />
      <div className="flex min-w-0 flex-col gap-3.5">
        <section className="glass flex flex-col gap-3.5 rounded-[28px] p-5 md:p-[22px]" aria-labelledby="lift-types-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 id="lift-types-title" className="hud m-0 tracking-[0.14em] text-ink-2">
              {p.liftBars?.title ?? 'Lifts by type'}
            </h3>
            {p.liftBars?.aside ? <span className="hud text-ink-2">{p.liftBars.aside}</span> : null}
          </div>
          {p.liftBars?.bars.length ? (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {p.liftBars.bars.map((b, i) => (
                <li key={b.label} className="grid grid-cols-[96px_minmax(0,1fr)_32px] items-center gap-3">
                  <span className="text-[13px] text-ink">{b.label}</span>
                  <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]">
                    <motion.span
                      className="block h-full origin-left rounded-full bg-teal"
                      style={{ width: `${(b.n / maxBar) * 100}%` }}
                      initial={{ scaleX: 0 }}
                      whileInView={{ scaleX: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.8, delay: i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                  </span>
                  <span className="text-right text-[14px] font-semibold text-ink tnum">{b.n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13.5px] text-ink-2">Lift types are not on file for {p.name}.</p>
          )}
          {p.liftBars?.note ? <p className="m-0 text-[12.5px] text-ink-2">{p.liftBars.note}</p> : null}
        </section>

        <section className="glass flex min-h-0 flex-1 flex-col gap-3 rounded-[28px] p-5 md:p-[22px]" aria-labelledby="runs-chips-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 id="runs-chips-title" className="hud m-0 tracking-[0.14em] text-ink-2">
              {p.runs.source}
            </h3>
            <span className="hud text-ink-2">{p.runs.status}</span>
          </div>
          {p.runs.groups.length ? (
            <div className="flex max-h-[300px] flex-col gap-3.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {p.runs.groups.map((g) => (
                <div key={g.sign.key} className="flex flex-col gap-1.5">
                  <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <PisteSymbol shape={g.sign.shape} tone={g.sign.tone} />
                    {g.sign.label}
                    <span className="hud ml-auto font-normal text-ink-2">{g.count}</span>
                  </p>
                  <ul className="m-0 flex list-none flex-wrap gap-[5px] p-0" aria-label={`${g.sign.label} runs`}>
                    {g.names.map((n) => {
                      const on = n.ids.length > 0 && n.ids.every((i) => selected.has(i))
                      return (
                        <li key={n.name}>
                          {n.ids.length ? (
                            <button
                              type="button"
                              aria-pressed={on}
                              onClick={() => select(n.ids)}
                              className={cn(
                                'rounded-[10px] px-2.5 py-1.5 text-[12.5px] transition-colors duration-150',
                                on ? 'bg-ink-chip text-on-ink-chip' : 'bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-ink hover:bg-[color-mix(in_srgb,var(--teal)_16%,transparent)]',
                              )}
                            >
                              {n.name}
                            </button>
                          ) : (
                            <span className="inline-block rounded-[10px] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-2.5 py-1.5 text-[12.5px] text-ink">{n.name}</span>
                          )}
                        </li>
                      )
                    })}
                    {g.more ? <li className="px-1.5 py-1.5 text-[12.5px] text-ink-2">+{g.more} more in the full list</li> : null}
                    {g.unnamed ? <li className="px-1.5 py-1.5 text-[12.5px] text-ink-2">{g.unnamed} unnamed sections</li> : null}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 text-[13.5px] text-ink-2">{p.runs.empty}</p>
          )}
          {p.lines ? <p className="m-0 text-[12.5px] text-ink-2">Tap a run or lift on the map, or a name here, for its sign and mapped length.</p> : null}
        </section>

        {p.liveStatus ? (
          <a
            href={p.liveStatus.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 items-center justify-between gap-3 rounded-[20px] bg-ink-chip px-[18px] py-3.5 text-[14px] font-semibold text-on-ink-chip transition-transform duration-150 hover:-translate-y-px"
          >
            {p.liveStatus.label}
            <ArrowUpRight aria-hidden className="size-4 shrink-0" />
            <span className="sr-only"> (opens a new tab)</span>
          </a>
        ) : null}
      </div>
    </div>
  )
}
