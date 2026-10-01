'use client'
/**
 * Explore's map stage (Glass HUD): a mission-control map of the current results.
 *
 * - Base map: MapLibre + OpenFreeMap vector tiles when they load; until then — and whenever tiles are blocked or
 *   offline — a built-in schematic (Natural Earth land, public domain, bundled) with a graticule. Both share one
 *   Web Mercator camera, so markers, region jumps and fly-tos behave the same either way.
 * - Markers are real <button>s in an HTML overlay. Markers whose labels would collide merge into a dark count
 *   bubble; clicking it flies in until they separate (or lists them when they share a spot).
 * - Region jumps and explicit selections fly the camera (zoom pulls back mid-flight for long hops); hover only
 *   restyles. Under reduced motion every move is a jump.
 * - HUD: corner brackets, centre crosshair, live coordinates/zoom readout, legend, zoom controls, attribution.
 * The list beside/below the map is always the full alternative.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Map as MlMap } from 'maplibre-gl'
import { AnimatePresence, motion } from 'motion/react'
import { Crosshair, Minus, Plus, Star, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import {
  boundsOf,
  clampCamera,
  clusterCaption,
  clusterPoints,
  fitCamera,
  flyFrame,
  formatLat,
  formatLon,
  latOf,
  lonOf,
  mx,
  my,
  project,
  unproject,
  type Bounds,
  type Camera,
  type Cluster,
  type Padding,
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

interface MarkerPoint {
  id: string
  name: string
  x: number
  y: number
  priority: number
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
  /** Rendered over the map area (e.g. the selected resort preview). */
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
  const { w, h } = useSize(rootRef)
  const reduced = usePrefersReducedMotion()
  const geo = useGeo()

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

  const framed = useMemo<Bounds>(() => frame ?? boundsOf(points) ?? [home.lon - 3, home.lat - 2, home.lon + 3, home.lat + 2], [frame, points, home.lon, home.lat])
  const padRef = useRef(padding)
  useEffect(() => {
    padRef.current = padding
  }, [padding])

  const cameraFor = useCallback(
    (b: Bounds, maxZoom = 8, extraLeft = 0) => {
      const pad = { ...padRef.current, left: padRef.current.left + extraLeft }
      // Small stages cannot afford the full padding: scale it down so the frame keeps some room.
      const k = Math.min(1, (w - 120) / Math.max(1, pad.left + pad.right), (h - 80) / Math.max(1, pad.top + pad.bottom))
      const p = { top: pad.top * k + 24, right: pad.right * k + 24, bottom: pad.bottom * k + 24, left: pad.left * k + 24 }
      return fitCamera(b, w, h, p, { maxZoom, minZoom: MIN_ZOOM })
    },
    [w, h],
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

  // Explicit selection flies to the resort (hover never moves the camera).
  const selectedPoint = selectedId ? (points.find((p) => p.id === selectedId) ?? null) : null
  useEffect(() => {
    if (!selectedPoint || !w) return
    const z = Math.max(camRef.current.zoom, 6.5)
    const c = cameraFor([selectedPoint.lon, selectedPoint.lat, selectedPoint.lon, selectedPoint.lat], z, selectionInset)
    goTo({ ...c, zoom: z }, 1100)
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

  // ---- Markers: membership from the settled camera, positions from the live one.
  const clusters = useMemo<Cluster<MarkerPoint>[]>(() => {
    if (!w || !h) return []
    const list: MarkerPoint[] = points.map((p) => {
      const { x, y } = project(p.lon, p.lat, settled, w, h)
      return { id: p.id, name: p.name, x, y, priority: p.id === selectedId ? 3 : p.favorite ? 1 : 0, p }
    })
    return clusterPoints(list, { maxX: w - padding.right - 60 })
  }, [points, settled, w, h, selectedId, padding.right])

  const live = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>()
    for (const p of points) pos.set(p.id, project(p.lon, p.lat, cam, w, h))
    return pos
  }, [points, cam, w, h])

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

  return (
    <div ref={rootRef} className={cn('isolate overflow-hidden bg-[color-mix(in_srgb,var(--teal)_7%,var(--surface-2))]', className ?? 'relative')}>
      {/* Schematic base (always underneath; fades out when tiles are up). */}
      <Schematic geo={geo} cam={cam} w={w} h={h} padding={padding} hidden={tiles === 'ready'} />

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

      {/* HUD chrome */}
      <HudFrame w={w} h={h} cx={cx} cy={cy} />

      {/* Markers */}
      <div className="pointer-events-none absolute inset-0" role="group" aria-label={`Map markers: ${points.length} ${points.length === 1 ? 'resort' : 'resorts'}`}>
        {w && inView(homePos.x, homePos.y) ? <HomeMarker x={homePos.x} y={homePos.y} name={home.name} /> : null}
        <AnimatePresence initial={false}>
          {clusters.map((c) => {
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
                  flip={c.flip}
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
                flip={c.flip}
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

      {top ? <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3 md:pt-4" style={{ paddingRight: padding.right + 12 }}>{top}</div> : null}

      {/* Zoom controls */}
      <div className="absolute z-20 flex flex-col gap-1.5" style={{ right: padding.right + 12, bottom: compact ? 12 : 16 }}>
        <div className="glass-strong flex flex-col overflow-hidden rounded-full">
          <button type="button" aria-label="Zoom in" onClick={() => {
              moved.current = true
              goTo({ ...camRef.current, zoom: camRef.current.zoom + 1 }, 320)
            }} className="flex size-10 items-center justify-center text-ink-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink">
            <Plus aria-hidden className="size-4" />
          </button>
          <span aria-hidden className="mx-2.5 h-px bg-divider" />
          <button type="button" aria-label="Zoom out" onClick={() => {
              moved.current = true
              goTo({ ...camRef.current, zoom: camRef.current.zoom - 1 }, 320)
            }} className="flex size-10 items-center justify-center text-ink-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink">
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
          className="glass-strong flex size-10 items-center justify-center rounded-full text-ink-2 transition-colors hover:text-teal"
        >
          <Crosshair aria-hidden className="size-4" />
        </button>
      </div>

      {/* Readout + legend (one panel, so labels never show between two chips) */}
      <div
        className="pointer-events-none absolute bottom-3 left-3 z-20 md:bottom-4 md:left-4"
        style={{ maxWidth: `calc(100% - ${padding.right + (compact ? 76 : 96)}px)` }}
      >
        <div className={cn('glass-strong pointer-events-auto flex max-w-full flex-col gap-1.5', compact ? 'rounded-[12px] px-2.5 py-1.5' : 'rounded-[18px] px-3.5 py-2.5')}>
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
          <span className="hud text-[11px] leading-snug tracking-[0.08em] text-ink-2">
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

function Schematic({ geo, cam, w, h, hidden }: { geo: Geo | null; cam: Camera; w: number; h: number; padding: Padding; hidden: boolean }) {
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
  const latLabels = lats.filter((l) => Math.abs(l) < 85).map((l) => ({ l, y: project(0, l, cam, w, h).y })).filter((q) => q.y > 76 && q.y < h - 140)
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
        <span key={`lal${q.l}`} className="hud absolute left-3 -translate-y-1/2 text-[11px] tracking-[0.1em] text-ink-3" style={{ top: q.y }}>
          {formatLat(q.l, 0)}
        </span>
      ))}
    </div>
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
          <i aria-hidden className={cn('size-2 rounded-full', TONE_DOT[i.tone])} />
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

const POP = { initial: { opacity: 0, scale: 0.7 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.7 }, transition: { duration: 0.22, ease: [0.22, 0.8, 0.26, 1] as const } }

function SingleMarker({
  p,
  x,
  y,
  flip,
  selected,
  highlighted,
  onSelect,
  onHighlight,
}: {
  p: StagePoint
  x: number
  y: number
  /** Label runs to the left of the dot (near the right edge). */
  flip: boolean
  selected: boolean
  highlighted: boolean
  onSelect: (id: string) => void
  onHighlight?: (id: string | null) => void
}) {
  const active = selected || highlighted
  return (
    <div className="absolute top-0 left-0" style={{ transform: `translate(${x}px, ${y}px)`, zIndex: selected ? 6 : highlighted ? 5 : p.favorite ? 3 : 2 }}>
      <motion.button
        {...POP}
        type="button"
        data-marker-id={p.id}
        aria-pressed={selected}
        aria-label={`${p.name}, ${p.description}`}
        onClick={() => onSelect(p.id)}
        onMouseEnter={() => onHighlight?.(p.id)}
        onMouseLeave={() => onHighlight?.(null)}
        onFocus={() => onHighlight?.(p.id)}
        onBlur={() => onHighlight?.(null)}
        style={flip ? { right: -14, top: -14, originX: 'calc(100% - 14px)', originY: '14px' } : { left: -14, top: -14, originX: '14px', originY: '14px' }}
        className={cn(
          'pointer-events-auto absolute flex h-7 items-center gap-1.5 rounded-full border text-[12px] leading-none font-medium whitespace-nowrap',
          flip ? 'flex-row-reverse pr-2 pl-2.5' : 'pr-2.5 pl-2',
          'transition-[transform,background-color,color,box-shadow] duration-150 ease-out hover:-translate-y-0.5',
          active
            ? '-translate-y-0.5 border-transparent bg-ink-chip text-on-ink-chip shadow-[0_10px_24px_rgb(12_30_42/0.3)]'
            : 'glass-strong text-ink',
          selected && 'ring-2 ring-teal ring-offset-2 ring-offset-transparent',
        )}
      >
        <i aria-hidden className={cn('size-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_var(--surface)]', TONE_DOT[p.tone])} />
        <span>{p.name}</span>
        {p.favorite ? <Star aria-hidden className={cn('size-3 shrink-0', active ? 'fill-on-ink-chip text-on-ink-chip' : 'fill-copper text-copper')} /> : null}
      </motion.button>
    </div>
  )
}

function ClusterBubble({
  c,
  x,
  y,
  flip,
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
  flip: boolean
  active: boolean
  open: boolean
  onClick: () => void
  onPick: (id: string) => void
  onClose: () => void
  onHighlight?: (id: string | null) => void
}) {
  const names = c.members.map((m) => m.name)
  const caption = clusterCaption(names)
  return (
    <div className="absolute top-0 left-0" style={{ transform: `translate(${x}px, ${y}px)`, zIndex: open ? 9 : active ? 5 : 4 }}>
      <motion.button
        {...POP}
        type="button"
        aria-expanded={open}
        aria-label={`${c.members.length} resorts here: ${names.join(', ')}. Zoom in to separate them.`}
        title={names.join(', ')}
        onClick={onClick}
        style={flip ? { right: -17, top: -17, originX: 'calc(100% - 17px)', originY: '17px' } : { left: -17, top: -17, originX: '17px', originY: '17px' }}
        className={cn(
          'pointer-events-auto absolute flex h-[34px] items-center gap-2 rounded-full bg-ink-chip text-[12px] leading-none font-semibold whitespace-nowrap text-on-ink-chip',
          flip ? 'flex-row-reverse pr-1.5 pl-3' : 'pr-3 pl-1.5',
          'shadow-[0_10px_26px_rgb(12_30_42/0.3)] transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:scale-[1.04]',
          active && 'ring-2 ring-teal ring-offset-2 ring-offset-transparent',
        )}
      >
        <b className="tnum flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-surface px-1 text-[11.5px] text-ink">{c.members.length}</b>
        {caption}
      </motion.button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-label="Resorts at this spot"
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            className={cn('glass-strong pointer-events-auto absolute top-6 w-60 rounded-[18px] p-1.5', flip ? '-right-4' : '-left-4')}
          >
            <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
              <span className="hud text-ink-2">Same spot · {c.members.length}</span>
              <button type="button" onClick={onClose} aria-label="Close" className="flex size-7 items-center justify-center rounded-full text-ink-3 hover:text-ink">
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
            <ul className="flex flex-col">
              {c.members.map((m) => (
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
