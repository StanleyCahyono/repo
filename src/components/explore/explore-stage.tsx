'use client'
/**
 * Explore's map stage (Glass HUD): a mission-control map of the current results.
 *
 * - Base map: MapLibre + OpenFreeMap vector tiles when they load; until then — and whenever tiles are blocked or
 *   offline — a built-in schematic (Natural Earth land, public domain, bundled) with a graticule and city labels
 *   (Natural Earth populated places). Both share one Web Mercator camera, so markers, region jumps and fly-tos behave
 *   the same either way. The tile style carries its own place labels, so the schematic's city labels step aside then.
 * - Markers are real <button>s in an HTML overlay. Markers whose labels would collide merge into a dark count
 *   bubble ("[36] Greek Peak"; hover lists every resort); clicking it flies in until they separate (or lists them
 *   when they share a spot). Labels never run under the HUD panels: they flip side, or drop to a bare dot.
 * - City labels are zoom-aware (major cities at the world view, regional towns near the resorts in a region) and
 *   collision-aware (markers always win); they fade while the zoom changes and move with the camera like markers.
 * - Region jumps and explicit selections fly the camera (zoom pulls back mid-flight for long hops); the selected
 *   resort carries a beacon. Hover only restyles. Under reduced motion every move is a jump.
 * - HUD: corner brackets, centre crosshair, live coordinates/zoom readout, legend, zoom controls, attribution.
 * The list beside/below the map is always the full alternative.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Map as MlMap } from 'maplibre-gl'
import { AnimatePresence, motion } from 'motion/react'
import { Crosshair, Minus, Plus, Star, X, ZoomIn } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { EASE_OUT } from '@/lib/ui/motion'
import { HOME_CLEAR, cityBox, cityBudget, estimateCityText, layoutCities, type City, type CityLabel } from './city-labels'
import {
  boundsOf,
  clampCamera,
  clusterCaption,
  clusterPoints,
  clusterRect,
  estimateText,
  fitCamera,
  flyFrame,
  formatLat,
  formatLon,
  latOf,
  lonOf,
  mx,
  my,
  project,
  rectsHit,
  unproject,
  type Bounds,
  type Camera,
  type Cluster,
  type LabelSide,
  type MeasureText,
  type Padding,
  type Rect,
} from './geo'
import { TONE_DOT, type StageTone } from './tones'
import { usePrefersReducedMotion } from './use-client-state'

export type { StageTone } from './tones'

export interface StagePoint {
  id: string
  name: string
  lon: number
  lat: number
  tone: StageTone
  favorite: boolean
  /** Accessible description (status, score, travel…). */
  description: string
}

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'
const MAPLIBRE_WORKER_PATH = '/vendor/maplibre/maplibre-gl-worker.mjs'
const MIN_ZOOM = -0.6
const MAX_ZOOM = 12
/** Width a favourite star adds to a marker label (gap + 12px icon). */
const STAR_W = 18

interface MarkerPoint {
  id: string
  name: string
  x: number
  y: number
  priority: number
  extra: number
  p: StagePoint
}

// ---------------------------------------------------------------------------
// Land + country borders (lazy, bundled; Natural Earth 1:50m, public domain, simplified) as SVG paths in zoom-0
// Mercator space, so the camera is a single transform.

interface Geo {
  land: string
  borders: string
}

let geoCache: Geo | null = null
let geoPromise: Promise<Geo> | null = null

function ringPath(r: number[], close: boolean): string {
  // Unwrap lines that cross the antimeridian (Chukotka, Fiji) so they never draw a stroke across the world.
  let d = ''
  let shift = 0
  for (let i = 0; i < r.length; i += 2) {
    if (i && Math.abs(r[i] - r[i - 2]) > 180) shift += r[i] < r[i - 2] ? 360 : -360
    d += `${i ? 'L' : 'M'}${mx(r[i] + shift).toFixed(3)},${my(r[i + 1]).toFixed(3)}`
  }
  return close ? `${d}Z` : d
}

function loadGeo(): Promise<Geo> {
  if (geoCache) return Promise.resolve(geoCache)
  geoPromise ??= Promise.all([import('@/assets/geo/world-land.json'), import('@/assets/geo/world-borders.json')]).then(([l, b]) => {
    const rings = (l.default ?? l) as unknown as number[][]
    const lines = (b.default ?? b) as unknown as number[][]
    // Antarctica has no resorts and its pole-wrapping ring does not survive Mercator: leave it out.
    const land = rings.filter((r) => !r.some((v, i) => i % 2 === 1 && v < -60)).map((r) => ringPath(r, true)).join('')
    const borders = lines.map((r) => ringPath(r, false)).join('')
    geoCache = { land, borders }
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

// City labels (Natural Earth 1:10m populated places, public domain; bundled, lazy).
let citiesCache: City[] | null = null
let citiesPromise: Promise<City[]> | null = null

function useCities(): City[] | null {
  const [c, setC] = useState<City[] | null>(citiesCache)
  useEffect(() => {
    if (c) return
    let alive = true
    citiesPromise ??= import('@/assets/geo/world-cities.json').then((m) => {
      const j = (m.default ?? m) as unknown as { cities: City[] }
      citiesCache = j.cities
      return citiesCache
    })
    citiesPromise.then((x) => alive && setC(x)).catch(() => {})
    return () => {
      alive = false
    }
  }, [c])
  return c
}

// ---------------------------------------------------------------------------
// Text measuring: real glyph widths (canvas) for the label collision boxes, once the fonts are in.

interface Measurers {
  marker: MeasureText
  bubble: MeasureText
  city: (name: string, capital: boolean) => number
}

const FALLBACK_MEASURERS: Measurers = { marker: estimateText, bubble: estimateText, city: estimateCityText }

function useMeasurers(): Measurers {
  const [fontsTick, setFontsTick] = useState(0)
  useEffect(() => {
    let alive = true
    document.fonts?.ready.then(() => alive && setFontsTick((n) => n + 1)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return useMemo(() => {
    if (typeof document === 'undefined') return FALLBACK_MEASURERS
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return FALLBACK_MEASURERS
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    const make = (font: string) => {
      const cache = new Map<string, number>()
      return (text: string) => {
        let v = cache.get(text)
        if (v === undefined) {
          ctx.font = font
          v = Math.ceil(ctx.measureText(text).width) + 1
          cache.set(text, v)
        }
        return v
      }
    }
    const city = make(`500 12px ${family}`)
    const capital = make(`600 12px ${family}`)
    return { marker: make(`500 12.5px ${family}`), bubble: make(`600 12.5px ${family}`), city: (n: string, cap: boolean) => (cap ? capital(n) : city(n)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsTick])
}

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))

/**
 * Map space taken by large cards over the map: a tall card along the left edge (the desktop preview) or a wide card
 * along the bottom (the phone preview). Small chips (jump pill, legend, zoom) do not count.
 */
function freeInsets(panels: readonly Rect[], w: number, h: number): { left: number; bottom: number } {
  let left = 0
  let bottom = 0
  for (const r of panels) {
    const wide = r.l < w * 0.2 && r.r > w * 0.8
    const tall = r.b - r.t > h * 0.35
    if (wide && r.t > h * 0.25 && r.b > h * 0.85) bottom = Math.max(bottom, h - r.t)
    else if (tall && r.l < w * 0.15 && r.r < w * 0.6) left = Math.max(left, r.r)
  }
  return { left, bottom }
}
const sameRects = (a: readonly Rect[], b: readonly Rect[]) => a.length === b.length && a.every((r, i) => r.l === b[i].l && r.t === b[i].t && r.r === b[i].r && r.b === b[i].b)
const grow = (r: Rect, d: number): Rect => ({ l: r.l - d, t: r.t - d, r: r.r + d, b: r.b + d })

export interface ExploreStageProps {
  points: StagePoint[]
  /** Bounds the camera frames (the region jump); changing `frameKey` flies there. */
  frame: Bounds | null
  frameKey: string
  home: { name: string; lat: number; lon: number }
  selectedId: string | null
  highlightedId: string | null
  onSelect: (id: string) => void
  onHighlight?: (id: string | null) => void
  /** Screen space covered by floating panels (aside, jump pill), kept clear when framing. */
  padding: Padding
  /** Region jump control, rendered top-centre over the map area. */
  top?: ReactNode
  /** Rendered over the map area (e.g. the selected resort preview). Mark panels with `data-stage-obstacle`. */
  overlay?: ReactNode
  /** Extra line in the HUD readout (e.g. "9 of 108 in view · list available"). */
  caption?: string
  /** Extra left space kept clear when flying to a selection (e.g. a preview card over the map). */
  selectionInset?: number
  /** Hide the legend and coordinate readout (small mobile stage). */
  compact?: boolean
  className?: string
  children?: ReactNode
}

export function ExploreStage({
  points,
  frame,
  frameKey,
  home,
  selectedId,
  highlightedId,
  onSelect,
  onHighlight,
  padding,
  top,
  overlay,
  caption,
  selectionInset = 0,
  compact = false,
  className,
  children,
}: ExploreStageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mapBox = useRef<HTMLDivElement>(null)
  /** Latest measured panels over the map (see measurePanels). */
  const panelsRef = useRef<Rect[]>([])
  const { w, h } = useSize(rootRef)
  const reduced = usePrefersReducedMotion()
  const geo = useGeo()
  const cities = useCities()
  const measurers = useMeasurers()

  const [cam, setCam] = useState<Camera>({ lon: home.lon, lat: home.lat, zoom: 1.4 })
  /** Camera at the end of the last movement — cluster membership is computed here, so markers do not churn mid-flight. */
  const [settled, setSettled] = useState<Camera>(cam)
  const camRef = useRef(cam)
  const anim = useRef<number | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [tiles, setTiles] = useState<'pending' | 'ready' | 'failed'>('pending')
  const [spider, setSpider] = useState<string | null>(null)
  const [dark, setDark] = useState(false)

  const heightRef = useRef(0)
  const setCamera = useCallback((raw: Camera, done: boolean) => {
    const c = heightRef.current ? clampCamera(raw, heightRef.current) : raw
    camRef.current = c
    setCam(c)
    if (done) setSettled(c)
  }, [])
  useEffect(() => {
    heightRef.current = h
  }, [h])

  // Theme (tiles are inverted for the alpine-night theme).
  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.dataset.theme
      setDark(attr ? attr === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches)
    }
    read()
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', read)
    return () => mql.removeEventListener('change', read)
  }, [])

  /** Move the camera: MapLibre when tiles are up, else the schematic's own fly. */
  const goTo = useCallback(
    (target: Camera, duration: number) => {
      const t = { ...target, zoom: clampZoom(target.zoom) }
      const map = mapRef.current
      if (map && tiles === 'ready') {
        if (reduced || duration === 0) map.jumpTo({ center: [t.lon, t.lat], zoom: t.zoom })
        else map.flyTo({ center: [t.lon, t.lat], zoom: t.zoom, duration, curve: 1.5, essential: true })
        return
      }
      if (anim.current) cancelAnimationFrame(anim.current)
      anim.current = null
      const from = camRef.current
      if (reduced || duration === 0) {
        setCamera(t, true)
        return
      }
      const t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / duration)
        const c = k >= 1 ? t : flyFrame(from, t, k)
        setCamera(c, k >= 1)
        anim.current = k < 1 ? requestAnimationFrame(step) : null
      }
      anim.current = requestAnimationFrame(step)
    },
    [reduced, setCamera, tiles],
  )
  useEffect(() => () => void (anim.current && cancelAnimationFrame(anim.current)), [])

  // A region frame keeps a little context around its resorts (10% each side), so the nearby cities and the coast
  // around the edge resorts are on screen too.
  const framed = useMemo<Bounds>(() => {
    const b = frame ?? boundsOf(points) ?? [home.lon - 3, home.lat - 2, home.lon + 3, home.lat + 2]
    const dx = Math.max(0.6, (b[2] - b[0]) * 0.1)
    const dy = Math.max(0.4, (b[3] - b[1]) * 0.1)
    return [Math.max(-180, b[0] - dx), Math.max(-80, b[1] - dy), Math.min(180, b[2] + dx), Math.min(84, b[3] + dy)]
  }, [frame, points, home.lon, home.lat])
  const padRef = useRef(padding)
  useEffect(() => {
    padRef.current = padding
  }, [padding])

  const cameraFor = useCallback(
    (b: Bounds, maxZoom = 8, extra: Partial<Padding> = {}) => {
      const base = padRef.current
      // The small stage's zoom controls sit in the bottom-right corner: frames keep a column clear for them.
      const controls = compact ? 52 : 0
      const pad = { top: base.top + (extra.top ?? 0), right: base.right + controls + (extra.right ?? 0), bottom: base.bottom + (extra.bottom ?? 0), left: base.left + (extra.left ?? 0) }
      // Small stages cannot afford the full padding: scale it down so the frame keeps some room.
      const k = Math.min(1, (w - 120) / Math.max(1, pad.left + pad.right), (h - 80) / Math.max(1, pad.top + pad.bottom))
      const p = { top: pad.top * k + 24, right: pad.right * k + 24, bottom: pad.bottom * k + 24, left: pad.left * k + 24 }
      return fitCamera(b, w, h, p, { maxZoom, minZoom: MIN_ZOOM })
    },
    [w, h, compact],
  )

  // Frame the region on first size, and fly when the region jump changes.
  // Until the user moves the map, a resize (toolbar wraps, List → Map) re-frames the region without animation.
  const framedKey = useRef<string | null>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (!w || !h) return
    const first = framedKey.current === null
    if (!first && framedKey.current === frameKey) {
      if (!moved.current && !selectedId) goTo(cameraFor(framed, 7.2), 0)
      return
    }
    framedKey.current = frameKey
    moved.current = false
    goTo(cameraFor(framed, 7.2), first ? 0 : 2000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, w, h])

  // Explicit selection flies to the resort (hover never moves the camera), into the part of the map that the
  // selection's preview card leaves free (left of a side card, above a bottom card).
  const selectedPoint = selectedId ? (points.find((p) => p.id === selectedId) ?? null) : null
  const flyToSelection = useCallback(
    (p: { lon: number; lat: number }, duration: number) => {
      const z = Math.max(camRef.current.zoom, 6.5)
      const free = freeInsets(panelsRef.current, w, h)
      const c = cameraFor([p.lon, p.lat, p.lon, p.lat], z, { left: Math.max(selectionInset, free.left), bottom: free.bottom })
      goTo({ ...c, zoom: z }, duration)
    },
    [cameraFor, goTo, selectionInset, w, h],
  )
  useEffect(() => {
    if (!selectedPoint || !w) return
    flyToSelection(selectedPoint, 1100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoint?.id])

  // ---- MapLibre (optional): tiles over the schematic once they load.
  useEffect(() => {
    let cancelled = false
    let map: MlMap | null = null
    let raf = 0
    const timeout = window.setTimeout(() => {
      if (!cancelled && !map?.loaded()) {
        setTiles('failed')
        map?.remove()
        mapRef.current = null
      }
    }, 12000)
    import('maplibre-gl')
      .then(({ Map, setWorkerUrl }) => {
        if (cancelled || !mapBox.current) return
        setWorkerUrl(new URL(MAPLIBRE_WORKER_PATH, window.location.origin).href)
        const c = camRef.current
        map = new Map({
          container: mapBox.current,
          style: STYLE_URL,
          center: [c.lon, c.lat],
          zoom: c.zoom,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          attributionControl: false,
          fadeDuration: 0,
          dragRotate: false,
          pitchWithRotate: false,
        })
        mapRef.current = map
        let loaded = false
        map.on('error', () => {
          if (loaded || cancelled) return
          setTiles('failed')
          map?.remove()
          mapRef.current = null
        })
        map.on('load', () => {
          loaded = true
          window.clearTimeout(timeout)
          if (cancelled || !map) return
          const now = camRef.current
          map.jumpTo({ center: [now.lon, now.lat], zoom: now.zoom })
          setTiles('ready')
        })
        const read = (done: boolean) => {
          if (!map) return
          const ctr = map.getCenter()
          setCamera({ lon: ctr.lng, lat: ctr.lat, zoom: map.getZoom() }, done)
        }
        map.on('move', () => {
          if (!loaded) return
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(() => read(false))
        })
        map.on('moveend', () => loaded && read(true))
        map.on('dragstart', () => {
          moved.current = true
        })
        map.on('wheel', () => {
          moved.current = true
        })
      })
      .catch(() => setTiles('failed'))
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      cancelAnimationFrame(raf)
      map?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    mapRef.current?.resize()
  }, [w, h])

  // ---- Schematic interactions: drag to pan, wheel / double-click to zoom, keys.
  const drag = useRef<{ x: number; y: number; cam: Camera; id: number } | null>(null)
  const wheelEnd = useRef<number | null>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el || tiles === 'ready') return
    const onWheel = (e: WheelEvent) => {
      if (!(e.target as HTMLElement).closest('[data-stage-surface]')) return
      e.preventDefault()
      moved.current = true
      if (anim.current) cancelAnimationFrame(anim.current)
      anim.current = null
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      const c = camRef.current
      const z = clampZoom(c.zoom - e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))
      const at = unproject(px, py, c, r.width, r.height)
      // Keep the coordinate under the cursor fixed.
      const s = 2 ** z
      const next = { lon: lonOf(mx(at.lon) - (px - r.width / 2) / s), lat: latOf(my(at.lat) - (py - r.height / 2) / s), zoom: z }
      setCamera(next, false)
      if (wheelEnd.current) window.clearTimeout(wheelEnd.current)
      wheelEnd.current = window.setTimeout(() => setSettled(camRef.current), 140)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [tiles, setCamera])

  const surfaceHandlers =
    tiles === 'ready'
      ? {}
      : {
          onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) return
            if (anim.current) cancelAnimationFrame(anim.current)
            anim.current = null
            e.currentTarget.setPointerCapture(e.pointerId)
            moved.current = true
            drag.current = { x: e.clientX, y: e.clientY, cam: camRef.current, id: e.pointerId }
            setSpider(null)
          },
          onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
            const d = drag.current
            if (!d || d.id !== e.pointerId) return
            const s = 2 ** d.cam.zoom
            setCamera({ lon: lonOf(mx(d.cam.lon) - (e.clientX - d.x) / s), lat: latOf(my(d.cam.lat) - (e.clientY - d.y) / s), zoom: d.cam.zoom }, false)
          },
          onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
            if (!drag.current) return
            drag.current = null
            e.currentTarget.releasePointerCapture(e.pointerId)
            setSettled(camRef.current)
          },
          onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => {
            moved.current = true
            const r = e.currentTarget.getBoundingClientRect()
            const at = unproject(e.clientX - r.left, e.clientY - r.top, camRef.current, w, h)
            goTo({ ...at, zoom: camRef.current.zoom + 1 }, 450)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
            moved.current = true
            const c = camRef.current
            const s = 2 ** c.zoom
            const stepPx = e.shiftKey ? 240 : 80
            const pan = (dx: number, dy: number) => goTo({ lon: lonOf(mx(c.lon) + dx / s), lat: latOf(my(c.lat) + dy / s), zoom: c.zoom }, 220)
            if (e.key === 'ArrowLeft') pan(-stepPx, 0)
            else if (e.key === 'ArrowRight') pan(stepPx, 0)
            else if (e.key === 'ArrowUp') pan(0, -stepPx)
            else if (e.key === 'ArrowDown') pan(0, stepPx)
            else if (e.key === '+' || e.key === '=') goTo({ ...c, zoom: c.zoom + 1 }, 300)
            else if (e.key === '-' || e.key === '_') goTo({ ...c, zoom: c.zoom - 1 }, 300)
            else return
            e.preventDefault()
          },
        }

  // ---- Panels over the map (jump pill, legend, zoom controls, preview card, results aside): labels keep clear.
  const [panels, setPanels] = useState<Rect[]>([])
  const measurePanels = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const rb = root.getBoundingClientRect()
    const scope = root.parentElement ?? root
    const list: Rect[] = []
    scope.querySelectorAll<HTMLElement>('[data-stage-obstacle]').forEach((el) => {
      const b = el.getBoundingClientRect()
      if (b.width < 1 || b.height < 1) return
      const r = { l: Math.floor(b.left - rb.left), t: Math.floor(b.top - rb.top), r: Math.ceil(b.right - rb.left), b: Math.ceil(b.bottom - rb.top) }
      if (r.r <= 0 || r.l >= rb.width || r.b <= 0 || r.t >= rb.height) return
      list.push(r)
    })
    list.sort((a, b) => a.l - b.l || a.t - b.t)
    // The selection fly reads this in the same commit (layout effects run before it), so the preview that mounts
    // with a selection is already accounted for.
    panelsRef.current = list
    setPanels((prev) => (sameRects(prev, list) ? prev : list))
  }, [])
  useLayoutEffect(() => {
    measurePanels()
    // The preview card animates in/out: measure again once it has settled.
    const t1 = window.setTimeout(measurePanels, 120)
    const t2 = window.setTimeout(measurePanels, 360)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [measurePanels, w, h, selectedId, tiles, compact, top, overlay])
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measurePanels())
    ;(root.parentElement ?? root).querySelectorAll<HTMLElement>('[data-stage-obstacle]').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [measurePanels, overlay, top, compact, w, h])

  const obstacles = useMemo<Rect[]>(() => {
    const list = panels.map((r) => grow(r, 4))
    // The results aside, known before it is measured (first paint).
    if (padding.right > 0 && w) list.push({ l: w - padding.right + 8, t: 0, r: w + 400, b: h })
    return list
  }, [panels, padding.right, w, h])

  // Fallback: if a card still covers the selected resort once the camera has settled (the card grew after it was
  // measured), glide out from under it — once per selection.
  const reflown = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedPoint || !w || reflown.current === selectedPoint.id) return
    const q = project(selectedPoint.lon, selectedPoint.lat, settled, w, h)
    const covered = panels.some((r) => q.x > r.l - 8 && q.x < r.r + 8 && q.y > r.t - 8 && q.y < r.b + 8)
    if (!covered) return
    reflown.current = selectedPoint.id
    flyToSelection(selectedPoint, 450)
  }, [settled, panels, selectedPoint, w, h, flyToSelection])
  useEffect(() => {
    if (!selectedId) reflown.current = null
  }, [selectedId])

  // ---- Markers: membership from the settled camera, positions from the live one.
  const clusters = useMemo<Cluster<MarkerPoint>[]>(() => {
    if (!w || !h) return []
    const list: MarkerPoint[] = points.map((p) => {
      const { x, y } = project(p.lon, p.lat, settled, w, h)
      return { id: p.id, name: p.name, x, y, priority: p.id === selectedId ? 3 : p.favorite ? 1 : 0, extra: p.favorite ? STAR_W : 0, p }
    })
    return clusterPoints(list, { minX: 8, maxX: w - 8, obstacles, measure: measurers.marker, measureBubble: measurers.bubble })
  }, [points, settled, w, h, selectedId, obstacles, measurers])

  const live = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>()
    for (const p of points) pos.set(p.id, project(p.lon, p.lat, cam, w, h))
    return pos
  }, [points, cam, w, h])

  // ---- City labels (schematic only): placed around the markers at the settled camera.
  const markerRects = useMemo(() => {
    const out: Rect[] = []
    for (const c of clusters) {
      const r = clusterRect(c, measurers.marker, measurers.bubble)
      if (r) out.push(grow(r, 3))
    }
    return out
  }, [clusters, measurers])
  const homeSettled = useMemo(() => (w ? project(home.lon, home.lat, settled, w, h) : null), [home.lon, home.lat, settled, w, h])
  const cityLabels = useMemo<CityLabel[]>(() => {
    if (!cities || !w || !h || tiles === 'ready') return []
    const blockers = [...markerRects, ...obstacles]
    const resorts = points.map((p) => project(p.lon, p.lat, settled, w, h))
    return layoutCities(cities, settled, w, h, { blockers, max: cityBudget(w, h), measure: measurers.city, home: homeSettled, resorts })
  }, [cities, points, settled, w, h, tiles, markerRects, obstacles, measurers, homeSettled])
  const cityRects = useMemo(
    () =>
      cityLabels.map((c) => {
        const p = project(c.lon, c.lat, settled, w, h)
        return cityBox(p.x, p.y, measurers.city(c.name, c.capital), c.side, c.atHome)
      }),
    [cityLabels, settled, w, h, measurers],
  )
  /**
   * A bare-dot marker shows its name in a chip above the dot while it is hovered, focused or selected: city labels
   * under that chip step aside for as long as it shows, so its name never sits on top of a city's.
   */
  const tipRects = useMemo(() => {
    const out: Rect[] = []
    for (const c of clusters) {
      if (c.side !== 'dot' || c.members.length !== 1) continue
      const m = c.members[0]
      if (m.id !== selectedId && m.id !== highlightedId) continue
      const tw = measurers.marker(m.name) + 22
      out.push({ l: c.x - tw / 2 - 4, r: c.x + tw / 2 + 4, t: c.y - 12 - 26 - 4, b: c.y - 8 })
    }
    return out
  }, [clusters, selectedId, highlightedId, measurers])
  /** City labels fade out while the zoom is changing (wheel, fly) and come back once the camera settles. */
  const zooming = Math.abs(cam.zoom - settled.zoom) > 0.2

  const zoomToCluster = (c: Cluster<MarkerPoint>) => {
    moved.current = true
    const b = boundsOf(c.members.map((m) => m.p))
    if (!b) return
    const target = cameraFor(b, 10.5)
    if (target.zoom - camRef.current.zoom < 0.6) {
      setSpider((s) => (s === c.key ? null : c.key))
      return
    }
    setSpider(null)
    goTo(target, 1300)
  }

  const homePos = project(home.lon, home.lat, cam, w, h)
  const inView = (x: number, y: number, m = 40) => x > -m && x < w + m && y > -m && y < h + m
  const visibleCount = points.filter((p) => {
    const q = live.get(p.id)
    return q ? q.x >= padding.left && q.x <= w - padding.right && q.y >= 0 && q.y <= h : false
  }).length

  // Centre of the usable map area (outside the floating panels).
  const cx = padding.left + (w - padding.left - padding.right) / 2
  const cy = padding.top + (h - padding.top - padding.bottom) / 2
  const centre = w ? unproject(cx, cy, cam, w, h) : { lon: cam.lon, lat: cam.lat }
  const labelBlockers = useMemo(() => [...markerRects, ...cityRects, ...obstacles], [markerRects, cityRects, obstacles])

  return (
    <div ref={rootRef} className={cn('isolate overflow-hidden bg-[color-mix(in_srgb,var(--teal)_7%,var(--surface-2))]', className ?? 'relative')}>
      {/* Schematic base (always underneath; fades out when tiles are up). */}
      <Schematic geo={geo} cam={cam} w={w} h={h} hidden={tiles === 'ready'} blockers={labelBlockers} />

      {/* MapLibre canvas (only visible once loaded). */}
      <div
        ref={mapBox}
        aria-hidden={tiles !== 'ready'}
        style={{ position: 'absolute', inset: 0 }}
        className={cn(
          'transition-opacity duration-700',
          tiles === 'ready' ? 'opacity-100' : 'pointer-events-none opacity-0',
          dark && '[&_.maplibregl-canvas]:[filter:invert(0.92)_hue-rotate(180deg)_saturate(0.55)_brightness(0.92)]',
        )}
      />

      {/* Interaction surface for the schematic (drag / wheel / keys). */}
      {tiles !== 'ready' ? (
        <div
          data-stage-surface
          role="application"
          aria-roledescription="map"
          aria-label="Resort map. Drag or use the arrow keys to pan, plus and minus to zoom. The list has every resort."
          tabIndex={0}
          className="absolute inset-0 cursor-grab touch-none outline-none active:cursor-grabbing focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]"
          {...surfaceHandlers}
        />
      ) : null}

      {/* City labels (schematic only — the tile style has its own). Decorative, so hidden from assistive tech. */}
      <div
        aria-hidden
        data-audit-text="yes"
        className={cn('pointer-events-none absolute inset-0 transition-opacity duration-200 ease-out', zooming || tiles === 'ready' ? 'opacity-0' : 'opacity-100')}
      >
        <AnimatePresence initial={false}>
          {cityLabels.map((c, i) => {
            if (tipRects.length && tipRects.some((t) => rectsHit(t, cityRects[i]))) return null
            const q = project(c.lon, c.lat, cam, w, h)
            return <CityMark key={c.key} c={c} x={q.x} y={q.y} />
          })}
        </AnimatePresence>
      </div>

      {/* HUD chrome */}
      <HudFrame w={w} h={h} cx={cx} cy={cy} />

      {/* Markers */}
      <div className="pointer-events-none absolute inset-0" role="group" aria-label={`Map markers: ${points.length} ${points.length === 1 ? 'resort' : 'resorts'}`}>
        {w && inView(homePos.x, homePos.y) ? <HomeMarker x={homePos.x} y={homePos.y} name={home.name} /> : null}
        <AnimatePresence initial={false}>
          {clusters.map((c) => {
            if (c.side === 'hidden') return null
            let x = 0
            let y = 0
            for (const m of c.members) {
              const q = live.get(m.id)!
              x += q.x
              y += q.y
            }
            x /= c.members.length
            y /= c.members.length
            if (!inView(x, y, 120)) return null
            if (c.members.length === 1) {
              const p = c.members[0].p
              return (
                <SingleMarker
                  key={c.key}
                  p={p}
                  x={x}
                  y={y}
                  side={c.side}
                  selected={p.id === selectedId}
                  highlighted={p.id === highlightedId}
                  onSelect={onSelect}
                  onHighlight={onHighlight}
                />
              )
            }
            const active = c.members.some((m) => m.id === selectedId || m.id === highlightedId)
            return (
              <ClusterBubble
                key={c.key}
                c={c}
                x={x}
                y={y}
                below={y < h * 0.45}
                cardRight={x + 300 > w - padding.right}
                active={active}
                open={spider === c.key}
                onClick={() => zoomToCluster(c)}
                onPick={(id) => {
                  setSpider(null)
                  onSelect(id)
                }}
                onClose={() => setSpider(null)}
                onHighlight={onHighlight}
              />
            )
          })}
        </AnimatePresence>
      </div>

      {top ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3 md:pt-4" style={{ paddingRight: padding.right + 12 }}>
          <div data-stage-obstacle className="flex min-w-0 max-w-full justify-center">
            {top}
          </div>
        </div>
      ) : null}

      {/* Zoom controls */}
      <div data-stage-obstacle className="absolute z-20 flex flex-col gap-1.5" style={{ right: padding.right + 12, bottom: compact ? 12 : 16 }}>
        <div className="glass-strong flex flex-col overflow-hidden rounded-full">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              moved.current = true
              goTo({ ...camRef.current, zoom: camRef.current.zoom + 1 }, 320)
            }}
            className="flex size-10 items-center justify-center text-ink-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink active:scale-95"
          >
            <Plus aria-hidden className="size-4" />
          </button>
          <span aria-hidden className="mx-2.5 h-px bg-divider" />
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              moved.current = true
              goTo({ ...camRef.current, zoom: camRef.current.zoom - 1 }, 320)
            }}
            className="flex size-10 items-center justify-center text-ink-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink active:scale-95"
          >
            <Minus aria-hidden className="size-4" />
          </button>
        </div>
        <button
          type="button"
          aria-label="Re-frame this region"
          title="Re-frame this region"
          onClick={() => {
            setSpider(null)
            moved.current = false
            goTo(cameraFor(framed, 7.2), 1200)
          }}
          className="glass-strong flex size-10 items-center justify-center rounded-full text-ink-2 transition-[color,transform] duration-150 hover:text-teal active:scale-95"
        >
          <Crosshair aria-hidden className="size-4" />
        </button>
      </div>

      {/* Readout + legend (one panel, so labels never show between two chips) */}
      <div
        className="pointer-events-none absolute bottom-3 left-3 z-20 md:bottom-4 md:left-4"
        style={{ maxWidth: `calc(100% - ${padding.right + (compact ? 76 : 96)}px)` }}
      >
        <div
          data-stage-obstacle
          className={cn('glass-strong pointer-events-auto flex max-w-full flex-col gap-1.5', compact ? 'rounded-[12px] px-2.5 py-1.5' : 'rounded-[18px] px-3.5 py-2.5')}
        >
          {!compact ? (
            <>
              <Legend />
              <span aria-hidden className="h-px bg-divider" />
              <span className="hud tnum flex flex-wrap items-center gap-x-2 text-ink" aria-live="off">
                <span aria-hidden className="inline-block size-1.5 rounded-full bg-teal shadow-[0_0_0_3px_color-mix(in_srgb,var(--teal)_25%,transparent)]" />
                <span>
                  {formatLat(centre.lat)} {formatLon(centre.lon)}
                </span>
                <span className="text-ink-3">·</span>
                <span>Z {cam.zoom.toFixed(1)}</span>
                <span className="text-ink-3">·</span>
                <span>{visibleCount} in view</span>
              </span>
            </>
          ) : null}
          <span className="hud text-[12px] leading-snug tracking-[0.08em] text-ink-2">
            {tiles === 'ready' ? (
              <>
                ©{' '}
                <a href="https://openfreemap.org" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                  OpenFreeMap
                </a>{' '}
                ©{' '}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                  OpenStreetMap
                </a>
              </>
            ) : tiles === 'failed' ? (
              compact ? 'Offline · schematic' : 'Offline · schematic map · Natural Earth'
            ) : (
              'Schematic · loading tiles…'
            )}
            {caption && !compact ? ` · ${caption}` : ''}
          </span>
        </div>
      </div>

      {overlay}
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces

function Schematic({ geo, cam, w, h, hidden, blockers }: { geo: Geo | null; cam: Camera; w: number; h: number; hidden: boolean; blockers: readonly Rect[] }) {
  if (!w || !h) return null
  const s = 2 ** cam.zoom
  const tx = w / 2 - mx(cam.lon) * s
  const ty = h / 2 - my(cam.lat) * s
  // Graticule spacing follows the zoom (30° → 10° → 5° → 2° → 1°).
  const step = cam.zoom < 2.2 ? 30 : cam.zoom < 3.6 ? 10 : cam.zoom < 4.8 ? 5 : cam.zoom < 6 ? 2 : 1
  const tl = unproject(0, 0, cam, w, h)
  const br = unproject(w, h, cam, w, h)
  const lons: number[] = []
  for (let l = Math.ceil(tl.lon / step) * step; l <= br.lon && lons.length < 80; l += step) lons.push(l)
  const lats: number[] = []
  for (let l = Math.ceil(br.lat / step) * step; l <= tl.lat && lats.length < 80; l += step) lats.push(l)
  // Latitude ticks along the left edge, dropped where a marker, city or panel would cover them.
  const latLabels = lats
    .filter((l) => Math.abs(l) < 85)
    .map((l) => ({ l, y: project(0, l, cam, w, h).y }))
    .filter((q) => q.y > 24 && q.y < h - 24 && !blockers.some((b) => rectsHit({ l: 8, r: 64, t: q.y - 8, b: q.y + 8 }, b, 2)))
  return (
    <div aria-hidden className={cn('absolute inset-0 transition-opacity duration-700', hidden && 'opacity-0')}>
      <svg width={w} height={h} className="absolute inset-0">
        <defs>
          <pattern id="stage-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform={`scale(${1 / s}) rotate(35)`}>
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--topo-line)" strokeWidth="1" />
          </pattern>
        </defs>
        {lats.filter((l) => Math.abs(l) < 85).map((l) => {
          const y = project(0, l, cam, w, h).y
          return <line key={`la${l}`} x1={0} x2={w} y1={y} y2={y} stroke="var(--topo-line)" strokeWidth={l === 0 ? 1.2 : 0.8} />
        })}
        {lons.map((l) => {
          const x = project(l, 0, cam, w, h).x
          return <line key={`lo${l}`} y1={0} y2={h} x1={x} x2={x} stroke="var(--topo-line)" strokeWidth={0.8} />
        })}
        {geo ? (
          <g transform={`translate(${tx} ${ty}) scale(${s})`}>
            <path d={geo.land} fill="color-mix(in srgb, var(--surface) 82%, transparent)" fillRule="evenodd" />
            <path d={geo.land} fill="url(#stage-hatch)" fillRule="evenodd" opacity={0.55} />
            {cam.zoom > 2.6 ? (
              <path
                d={geo.borders}
                fill="none"
                stroke="var(--topo-line-strong)"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                opacity={Math.min(1, cam.zoom - 2.6)}
              />
            ) : null}
            <path d={geo.land} fill="none" stroke="var(--topo-line-strong)" strokeWidth={1.1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </g>
        ) : null}
      </svg>
      {latLabels.map((q) => (
        <span key={`lal${q.l}`} className="hud absolute left-3 -translate-y-1/2 text-[12px] tracking-[0.1em] text-ink-3" style={{ top: q.y }}>
          {formatLat(q.l, 0)}
        </span>
      ))}
    </div>
  )
}

/** One city label: a small dot (a ring for capitals) and the name with a soft halo, so it reads on the hatching. */
function CityMark({ c, x, y }: { c: CityLabel; x: number; y: number }) {
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      className="absolute top-0 left-0 block size-0"
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      {c.atHome ? null : (
        <span
          className={cn(
            'absolute rounded-full',
            c.capital ? '-top-[3.5px] -left-[3.5px] size-[7px] border-[1.5px] border-ink-2 bg-surface' : '-top-[2.5px] -left-[2.5px] size-[5px] bg-ink-3 shadow-[0_0_0_1.5px_var(--surface)]',
          )}
        />
      )}
      <span
        className={cn(
          'absolute -top-2 block text-[12px] leading-4 whitespace-nowrap [text-shadow:0_0_1px_var(--surface),0_0_2px_var(--surface),0_0_3px_var(--surface),0_0_6px_var(--surface)]',
          c.capital || c.atHome ? 'font-semibold text-ink' : 'font-medium text-ink-2',
        )}
        style={
          c.side === 'above'
            ? { left: 0, top: c.atHome ? -HOME_CLEAR - 18 : -21, translate: '-50% 0' }
            : c.side === 'below'
              ? { left: 0, top: c.atHome ? HOME_CLEAR + 2 : 5, translate: '-50% 0' }
              : c.side === 'right'
                ? { left: c.atHome ? HOME_CLEAR + 2 : 7 }
                : { right: c.atHome ? HOME_CLEAR + 2 : 7 }
        }
      >
        {c.name}
      </span>
    </motion.span>
  )
}

/** Corner brackets and a centre crosshair — the mission-control frame. */
function HudFrame({ w, h, cx, cy }: { w: number; h: number; cx: number; cy: number }) {
  if (!w || !h) return null
  const L = 18
  const m = 10
  const corners = [
    `M${m},${m + L}V${m}H${m + L}`,
    `M${w - m - L},${m}H${w - m}V${m + L}`,
    `M${m},${h - m - L}V${h - m}H${m + L}`,
    `M${w - m - L},${h - m}H${w - m}V${h - m - L}`,
  ]
  return (
    <svg aria-hidden width={w} height={h} className="pointer-events-none absolute inset-0 z-10">
      {corners.map((d) => (
        <path key={d} d={d} fill="none" stroke="var(--teal)" strokeOpacity={0.55} strokeWidth={1.5} />
      ))}
      <g stroke="var(--teal)" strokeOpacity={0.5} strokeWidth={1}>
        <line x1={cx - 16} x2={cx - 5} y1={cy} y2={cy} />
        <line x1={cx + 5} x2={cx + 16} y1={cy} y2={cy} />
        <line x1={cx} x2={cx} y1={cy - 16} y2={cy - 5} />
        <line x1={cx} x2={cx} y1={cy + 5} y2={cy + 16} />
      </g>
      <circle cx={cx} cy={cy} r={2} fill="var(--teal)" fillOpacity={0.6} />
    </svg>
  )
}

function Legend() {
  const items: { tone: StageTone; label: string }[] = [
    { tone: 'open', label: 'Open' },
    { tone: 'announced', label: 'Dates announced' },
    { tone: 'estimate', label: 'Estimate' },
    { tone: 'closed', label: 'Closed' },
    { tone: 'unknown', label: 'Unknown' },
  ]
  return (
    <ul aria-label="Marker colours" className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
      {items.map((i) => (
        <li key={i.tone} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <i aria-hidden className={cn('size-2.5 rounded-full shadow-[0_0_0_1.5px_var(--surface)]', TONE_DOT[i.tone])} />
          {i.label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Star aria-hidden className="size-3 fill-copper text-copper" />
        Favourite
      </li>
      <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <i aria-hidden className="size-2 rotate-45 bg-ink-chip" />
        Home
      </li>
    </ul>
  )
}

function HomeMarker({ x, y, name }: { x: number; y: number; name: string }) {
  return (
    <span className="absolute z-[1] block size-3.5" style={{ transform: `translate(${x - 7}px, ${y - 7}px)` }} title={`Home: ${name}`}>
      <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-ink-chip" style={{ animation: 'piste-beacon 2.4s ease-out infinite' }} />
      <span className="absolute inset-[3px] rotate-45 bg-ink-chip shadow-[0_0_0_2px_var(--surface)]" />
      <span className="sr-only">Home: {name}</span>
    </span>
  )
}

const POP = { initial: { opacity: 0, scale: 0.7 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.7 }, transition: { duration: 0.22, ease: EASE_OUT } }

/** Tone dot with a surface halo; the selected resort adds a pulsing beacon (a steady ring under reduced motion). */
function ToneDot({ tone, selected, size = 'md' }: { tone: StageTone; selected: boolean; size?: 'md' | 'lg' }) {
  return (
    <span aria-hidden className={cn('relative inline-flex shrink-0', size === 'lg' ? 'size-3.5' : 'size-3')}>
      {selected ? (
        <span className="piste-beacon-ring absolute inset-0 rounded-full border-2 border-teal" style={{ animation: 'piste-beacon 1.8s ease-out infinite' }} />
      ) : null}
      <i className={cn('absolute inset-0 rounded-full shadow-[0_0_0_2px_var(--surface),0_1px_3px_2px_rgb(12_30_42/0.25)]', TONE_DOT[tone])} />
    </span>
  )
}

function SingleMarker({
  p,
  x,
  y,
  side,
  selected,
  highlighted,
  onSelect,
  onHighlight,
}: {
  p: StagePoint
  x: number
  y: number
  /** Label right of the dot, left of it, or no label (a panel is in the way; the name shows on hover/focus). */
  side: LabelSide
  selected: boolean
  highlighted: boolean
  onSelect: (id: string) => void
  onHighlight?: (id: string | null) => void
}) {
  const active = selected || highlighted
  const handlers = {
    onClick: () => onSelect(p.id),
    onMouseEnter: () => onHighlight?.(p.id),
    onMouseLeave: () => onHighlight?.(null),
    onFocus: () => onHighlight?.(p.id),
    onBlur: () => onHighlight?.(null),
  }
  const z = selected ? 7 : highlighted ? 6 : side === 'dot' ? 1 : p.favorite ? 3 : 2
  if (side === 'dot') {
    return (
      <div className="group/dot absolute top-0 left-0" style={{ transform: `translate(${x}px, ${y}px)`, zIndex: z }}>
        <motion.button
          {...POP}
          {...handlers}
          type="button"
          data-marker-id={p.id}
          aria-pressed={selected}
          aria-label={`${p.name}, ${p.description}`}
          style={{ left: -14, top: -14 }}
          className="pointer-events-auto absolute flex size-7 items-center justify-center rounded-full"
        >
          <span className="transition-transform duration-150 ease-out group-hover/dot:scale-125">
            <ToneDot tone={p.tone} selected={selected} size="lg" />
          </span>
        </motion.button>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-3 left-0 -translate-x-1/2 rounded-full bg-ink-chip px-2.5 py-1 text-[12.5px] leading-none font-medium whitespace-nowrap text-on-ink-chip shadow-[0_8px_20px_rgb(12_30_42/0.3)]',
            'invisible opacity-0 transition-opacity duration-150 group-focus-within/dot:visible group-focus-within/dot:opacity-100 group-hover/dot:visible group-hover/dot:opacity-100',
            active && 'visible opacity-100',
          )}
        >
          {p.name}
        </span>
      </div>
    )
  }
  const flip = side === 'left'
  return (
    <div className="absolute top-0 left-0" style={{ transform: `translate(${x}px, ${y}px)`, zIndex: z }}>
      <motion.button
        {...POP}
        {...handlers}
        type="button"
        data-marker-id={p.id}
        aria-pressed={selected}
        aria-label={`${p.name}, ${p.description}`}
        style={flip ? { right: -14, top: -14, originX: 'calc(100% - 14px)', originY: '14px' } : { left: -14, top: -14, originX: '14px', originY: '14px' }}
        className={cn(
          'pointer-events-auto absolute flex h-7 items-center gap-1.5 rounded-full border text-[12.5px] leading-none font-medium whitespace-nowrap',
          flip ? 'flex-row-reverse pr-[7px] pl-2.5' : 'pr-2.5 pl-[7px]',
          'transition-[translate,background-color,color,border-color,box-shadow] duration-150 ease-out hover:-translate-y-0.5',
          active
            ? '-translate-y-0.5 border-transparent bg-ink-chip text-on-ink-chip shadow-[0_12px_26px_-6px_rgb(12_30_42/0.5)]'
            : 'border-[color-mix(in_srgb,var(--ink)_14%,transparent)] bg-surface text-ink shadow-[0_6px_16px_-6px_rgb(12_30_42/0.35),0_1px_2px_rgb(12_30_42/0.14)] hover:border-[color-mix(in_srgb,var(--teal)_45%,transparent)]',
          selected && 'ring-2 ring-teal ring-offset-2 ring-offset-transparent',
        )}
      >
        <ToneDot tone={p.tone} selected={selected} />
        <span>{p.name}</span>
        {p.favorite ? <Star aria-hidden className={cn('size-3 shrink-0', active ? 'fill-on-ink-chip text-on-ink-chip' : 'fill-copper text-copper')} /> : null}
      </motion.button>
    </div>
  )
}

/** How many names the hover card lists before "+N more". */
const CLUSTER_LIST_MAX = 12

function ClusterBubble({
  c,
  x,
  y,
  below,
  cardRight,
  active,
  open,
  onClick,
  onPick,
  onClose,
  onHighlight,
}: {
  c: Cluster<MarkerPoint>
  x: number
  y: number
  /** Open the hover card below the bubble (bubbles in the top half of the map). */
  below: boolean
  /** Align the hover card's right edge to the bubble (bubbles near the right side or the results panel). */
  cardRight: boolean
  active: boolean
  open: boolean
  onClick: () => void
  onPick: (id: string) => void
  onClose: () => void
  onHighlight?: (id: string | null) => void
}) {
  const ordered = [c.lead, ...c.members.filter((m) => m !== c.lead)]
  const names = ordered.map((m) => m.name)
  const caption = clusterCaption(names)
  const flip = c.side === 'left'
  const badgeOnly = c.side === 'dot'
  const n = c.members.length
  return (
    <div className="group/cluster absolute top-0 left-0" style={{ transform: `translate(${x}px, ${y}px)`, zIndex: open ? 9 : active ? 5 : 4 }}>
      <motion.button
        {...POP}
        type="button"
        aria-expanded={open}
        aria-label={`${n} resorts here: ${names.join(', ')}. Zoom in to separate them.`}
        onClick={onClick}
        style={
          badgeOnly
            ? { left: -17, top: -17, originX: '17px', originY: '17px' }
            : flip
              ? { right: -17, top: -17, originX: 'calc(100% - 17px)', originY: '17px' }
              : { left: -17, top: -17, originX: '17px', originY: '17px' }
        }
        className={cn(
          'pointer-events-auto absolute flex h-[34px] items-center gap-2 rounded-full bg-ink-chip text-[12.5px] leading-none font-semibold whitespace-nowrap text-on-ink-chip',
          badgeOnly ? 'w-[34px] justify-center' : flip ? 'flex-row-reverse pr-1.5 pl-3' : 'pr-3 pl-1.5',
          // A stack of cards: two offset edges behind the bubble say "several resorts" before you read the count.
          'shadow-[3px_-3px_0_-1px_color-mix(in_srgb,var(--ink-chip)_50%,transparent),6px_-6px_0_-2px_color-mix(in_srgb,var(--ink-chip)_24%,transparent),0_10px_26px_rgb(12_30_42/0.32)]',
          'transition-[translate,scale] duration-150 ease-out hover:-translate-y-0.5 hover:scale-[1.03]',
          active && 'ring-2 ring-teal ring-offset-2 ring-offset-transparent',
        )}
      >
        <b className={cn('tnum flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-[12px]', badgeOnly ? 'text-on-ink-chip' : 'bg-surface text-ink')}>{n}</b>
        {badgeOnly ? null : <span>{caption}</span>}
      </motion.button>

      {/* Hover / focus card: every resort in the bubble. */}
      {!open ? (
        <div
          aria-hidden
          className={cn(
            'glass-strong pointer-events-none absolute w-max max-w-[280px] rounded-[16px] px-3 py-2.5 shadow-[var(--glass-shadow-lg)]',
            below ? 'top-6' : 'bottom-6',
            flip || cardRight ? '-right-4' : '-left-4',
            'invisible translate-y-1 opacity-0 transition-[opacity,translate,visibility] duration-150 ease-out group-focus-within/cluster:visible group-focus-within/cluster:translate-y-0 group-focus-within/cluster:opacity-100 group-hover/cluster:visible group-hover/cluster:translate-y-0 group-hover/cluster:opacity-100',
          )}
        >
          <p className="hud mb-1.5 text-ink-2">{n} resorts here</p>
          <ul className={cn('grid gap-x-4 gap-y-1', n > 6 ? 'grid-cols-2' : 'grid-cols-1')}>
            {ordered.slice(0, CLUSTER_LIST_MAX).map((m) => (
              <li key={m.id} className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-tight text-ink">
                <i className={cn('size-2 shrink-0 rounded-full', TONE_DOT[m.p.tone])} />
                <span className="whitespace-nowrap">{m.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1 text-[12px] text-ink-2">
            <ZoomIn className="size-3.5 shrink-0" />
            {n > CLUSTER_LIST_MAX ? `+${n - CLUSTER_LIST_MAX} more · ` : ''}Click to zoom in
          </p>
        </div>
      ) : null}

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            role="dialog"
            aria-label="Resorts at this spot"
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            className={cn('glass-strong pointer-events-auto absolute w-60 rounded-[18px] p-1.5', below ? 'top-6' : 'bottom-6', flip || cardRight ? '-right-4' : '-left-4')}
          >
            <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
              <span className="hud text-ink-2">Same spot · {n}</span>
              <button type="button" onClick={onClose} aria-label="Close" className="flex size-7 items-center justify-center rounded-full text-ink-3 hover:text-ink">
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
            <ul className="flex max-h-64 flex-col overflow-y-auto scrollbar-thin">
              {ordered.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onPick(m.id)}
                    onMouseEnter={() => onHighlight?.(m.id)}
                    onMouseLeave={() => onHighlight?.(null)}
                    className="flex min-h-9 w-full items-center gap-2 rounded-[12px] px-2 text-left text-[13px] font-medium text-ink hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"
                  >
                    <i aria-hidden className={cn('size-2 shrink-0 rounded-full', TONE_DOT[m.p.tone])} />
                    <span className="min-w-0 truncate">{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
