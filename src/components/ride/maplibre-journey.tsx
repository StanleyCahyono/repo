'use client'
/**
 * Online journey map (MapLibre GL + OpenFreeMap vector tiles, free and keyless, with a soft hillshade from open
 * Terrarium elevation tiles). The camera frames every pin and label in the padded view once; pin labels are
 * collision-avoided (label-layout.ts) and re-laid out when the user pans or zooms.
 *
 * Roads come from the bundled road geometry. A road leg without it asks the public OSRM router; if that fails too,
 * nothing is drawn for it (never a straight line) and `onMissing` lets the frame link to directions. A drive draws in
 * along its road once with a small car; a flight is a static dashed great-circle arc, never animated.
 *
 * If the style cannot be fetched quickly (offline, blocked), `onFail` is called and the caller shows the schematic.
 * Reduced motion: everything is drawn at once.
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoJSONSource, Map as MlMap, Marker as MlMarker } from 'maplibre-gl'
import { bearingDeg, cumulativeKm, pathKm, pointAlong, roadDrawMs, type LonLat } from '@/lib/domain/journey'
import type { Journey, Leg } from './journey-model'
import { placeLabels } from './label-layout'
import { Car } from './glyphs'
import { PIN_GAP, PIN_PRIORITY, PinView } from './pin-view'
import type { JourneyCallbacks, MapPadding } from './schematic-journey'

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const OSRM = 'https://router.project-osrm.org/route/v1/driving'
const MAPLIBRE_WORKER_PATH = '/vendor/maplibre/maplibre-gl-worker.mjs'

export interface MapLibreJourneyProps extends JourneyCallbacks {
  journey: Journey | null
  home: { lat: number; lon: number; name: string }
  replay: number
  reduced: boolean
  padding: MapPadding
  onFail: (reason: string) => void
}

async function fetchJson(url: string, ms: number): Promise<unknown> {
  const ctl = new AbortController()
  const to = window.setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new Error(String(r.status))
    return await r.json()
  } finally {
    window.clearTimeout(to)
  }
}

function isDark() {
  const attr = document.documentElement.dataset.theme
  if (attr === 'dark' || attr === 'light') return attr === 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Downsample long router geometries so per-frame updates stay cheap. */
function thin(coords: LonLat[], max = 1200): LonLat[] {
  if (coords.length <= max) return coords
  const step = coords.length / max
  const out: LonLat[] = []
  for (let i = 0; i < max; i++) out.push(coords[Math.floor(i * step)])
  out.push(coords[coords.length - 1])
  return out
}

/** Road geometry from the public OSRM router (only for legs without a bundled route). */
async function routedGeometry(from: LonLat, to: LonLat): Promise<LonLat[] | null> {
  try {
    const j = (await fetchJson(`${OSRM}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`, 6000)) as {
      routes?: { geometry?: { coordinates?: LonLat[] } }[]
    }
    const c = j.routes?.[0]?.geometry?.coordinates
    return c && c.length > 1 ? thin(c) : null
  } catch {
    return null
  }
}

const easeInOut = (f: number) => {
  const x = Math.max(0, Math.min(1, f))
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}

type LineFeature = { type: 'Feature'; properties: { kind: 'road' | 'arc' }; geometry: { type: 'LineString'; coordinates: LonLat[] } }
const feature = (leg: Leg, coords: LonLat[]): LineFeature => ({ type: 'Feature', properties: { kind: leg.geometry === 'arc' ? 'arc' : 'road' }, geometry: { type: 'LineString', coordinates: coords } })

export default function MapLibreJourney({ journey, home, replay, reduced, padding, onFail, onProgress, onMissing }: MapLibreJourneyProps) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null)
  const [ready, setReady] = useState(false)
  const cbs = useRef({ onFail, onProgress, onMissing })
  useEffect(() => {
    cbs.current = { onFail, onProgress, onMissing }
  }, [onFail, onProgress, onMissing])

  // Create the map once (style fetched first so an offline device falls back fast).
  useEffect(() => {
    let cancelled = false
    let map: MlMap | null = null
    let loadTimer = 0
    ;(async () => {
      const custom = process.env.NEXT_PUBLIC_MAP_STYLE_URL
      const urls = custom ? [custom] : isDark() ? [DARK_STYLE, LIGHT_STYLE] : [LIGHT_STYLE]
      let style: unknown = null
      for (const u of urls) {
        try {
          style = await fetchJson(u, 4500)
          break
        } catch {
          /* try the next style */
        }
      }
      if (cancelled) return
      if (!style) return cbs.current.onFail('map tiles unavailable')
      let ml: typeof import('maplibre-gl')
      try {
        ml = await import('maplibre-gl')
      } catch {
        return cbs.current.onFail('the map library failed to load')
      }
      if (cancelled || !box.current) return
      mlRef.current = ml
      ml.setWorkerUrl(new URL(MAPLIBRE_WORKER_PATH, window.location.origin).href)
      map = new ml.Map({
        container: box.current,
        style: style as never,
        center: [home.lon, home.lat],
        zoom: 6,
        attributionControl: false,
        fadeDuration: 0,
        pitchWithRotate: false,
        dragRotate: false,
      })
      map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right')
      let loaded = false
      loadTimer = window.setTimeout(() => {
        if (!loaded) cbs.current.onFail('map tiles did not load')
      }, 12000)
      map.on('error', () => {
        if (!loaded) cbs.current.onFail('map style could not be loaded')
      })
      map.on('load', () => {
        loaded = true
        window.clearTimeout(loadTimer)
        const m = map!
        const teal = token('--teal', 'teal')
        try {
          m.addSource('dem-h', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14 })
          const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id
          m.addLayer({ id: 'ride-hill', type: 'hillshade', source: 'dem-h', paint: { 'hillshade-exaggeration': 0.35 } }, firstSymbol)
        } catch {
          /* terrain shading is decoration; the journey works without it */
        }
        const empty = { type: 'FeatureCollection' as const, features: [] }
        m.addSource('ride-ghost', { type: 'geojson', data: empty })
        m.addLayer({
          id: 'ride-ghost',
          type: 'line',
          source: 'ride-ghost',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': teal, 'line-opacity': 0.22, 'line-width': 4 },
        })
        m.addSource('ride', { type: 'geojson', data: empty })
        m.addLayer({
          id: 'ride-glow',
          type: 'line',
          source: 'ride',
          filter: ['==', ['get', 'kind'], 'road'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': teal, 'line-width': 12, 'line-opacity': 0.3, 'line-blur': 6 },
        })
        m.addLayer({
          id: 'ride-line',
          type: 'line',
          source: 'ride',
          filter: ['==', ['get', 'kind'], 'road'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': teal, 'line-width': 4.5 },
        })
        m.addLayer({
          id: 'ride-arc',
          type: 'line',
          source: 'ride',
          filter: ['==', ['get', 'kind'], 'arc'],
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': teal, 'line-width': 2.5, 'line-dasharray': [0.6, 2.6] },
        })
        setReady(true)
      })
      mapRef.current = map
    })()
    return () => {
      cancelled = true
      window.clearTimeout(loadTimer)
      map?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Draw the journey.
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml) return
    let alive = true
    let raf = 0
    const markers: { m: MlMarker; root: Root; el: HTMLElement; id: string; kind: 'home' | 'airport' | 'resort' | 'car' }[] = []
    const route = map.getSource('ride') as GeoJSONSource | undefined
    const ghost = map.getSource('ride-ghost') as GeoJSONSource | undefined
    const setRoute = (fs: LineFeature[]) => route?.setData({ type: 'FeatureCollection', features: fs })
    const pad = padding
    const addMarker = (at: LonLat, node: React.ReactNode, id: string, kind: (typeof markers)[number]['kind'], rotate = false) => {
      const el = document.createElement('div')
      el.style.width = '0'
      el.style.height = '0'
      // Pins (and their labels) stay above the travelling car.
      el.style.zIndex = kind === 'car' ? '1' : '2'
      const root = createRoot(el)
      flushSync(() => root.render(node))
      const m = new ml.Marker({ element: el, anchor: 'center', rotationAlignment: rotate ? 'map' : 'viewport', pitchAlignment: 'viewport' }).setLngLat(at).addTo(map)
      markers.push({ m, root, el, id, kind })
      return m
    }
    const cleanup = () => {
      alive = false
      cancelAnimationFrame(raf)
      map.stop()
      markers.forEach(({ m, root }) => {
        m.remove()
        window.setTimeout(() => root.unmount(), 0)
      })
    }

    // Pin labels: collision-avoided in the current view (padded view while framed, whole map once the user moves).
    let framed = true
    const relayout = () => {
      const pins = markers.filter((x) => x.kind !== 'car')
      const c = map.getContainer()
      const bounds = framed
        ? { x: pad.left, y: pad.top, w: Math.max(120, c.clientWidth - pad.left - pad.right), h: Math.max(120, c.clientHeight - pad.top - pad.bottom) }
        : { x: 8, y: 8, w: c.clientWidth - 16, h: c.clientHeight - 16 }
      const items = pins
        .map((x) => {
          const lab = x.el.querySelector<HTMLElement>('[data-pin-label]')
          const p = map.project(x.m.getLngLat())
          return { id: x.id, kind: x.kind as 'home' | 'airport' | 'resort', x: p.x, y: p.y, w: lab?.offsetWidth || 80, h: lab?.offsetHeight || 26, gap: PIN_GAP[x.kind as 'home'], lab }
        })
        .sort((a, b) => PIN_PRIORITY[a.kind] - PIN_PRIORITY[b.kind])
      for (const q of placeLabels(items, bounds, { pinRadius: 10, margin: 5 })) {
        const it = items.find((i) => i.id === q.id)
        if (it?.lab) it.lab.style.transform = `translate(${q.dx}px, ${q.dy}px)`
      }
    }
    const onUserMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) framed = false
      relayout()
    }
    map.on('move', onUserMove)

    setRoute([])
    ghost?.setData({ type: 'FeatureCollection', features: [] })

    if (!journey) {
      addMarker([home.lon, home.lat], <PinView pin={{ id: 'home', at: [home.lon, home.lat], label: home.name, kind: 'home' }} />, 'home', 'home')
      map.jumpTo({ center: [home.lon, home.lat], zoom: 5.2, pitch: 0, bearing: 0, padding: pad })
      relayout()
      cbs.current.onMissing?.(0)
      return () => {
        cleanup()
        map.off('move', onUserMove)
      }
    }

    const run = async () => {
      const legs: Leg[] = journey.legs.map((l) => ({ ...l }))
      // Road legs without bundled geometry: ask the router; never fall back to a straight line.
      await Promise.all(
        legs.map(async (l) => {
          if (l.geometry !== 'missing') return
          const road = await routedGeometry(l.from, l.to)
          if (road) {
            l.coords = road
            l.geometry = 'road'
            l.km = pathKm(road)
          }
        }),
      )
      if (!alive) return
      cbs.current.onMissing?.(legs.filter((l) => l.geometry === 'missing').length)

      for (const p of journey.pins) addMarker(p.at, <PinView pin={p} />, p.id, p.kind)

      // Frame every coordinate, inset by the largest label so labels fit beside any pin.
      const labs = markers.map((x) => x.el.querySelector<HTMLElement>('[data-pin-label]'))
      const wMax = Math.max(60, ...labs.map((l) => l?.offsetWidth ?? 0))
      const hMax = Math.max(22, ...labs.map((l) => l?.offsetHeight ?? 0))
      const all = journey.legs.flatMap((l) => l.coords).concat(legs.flatMap((l) => (l.geometry === 'road' ? l.coords : [])))
      const bounds = all.reduce((b, c) => b.extend(c), new ml.LngLatBounds(all[0], all[0]))
      const fitPad = { top: pad.top + hMax + 18, bottom: pad.bottom + 18, left: pad.left + wMax / 2 + 10, right: pad.right + wMax / 2 + 10 }
      const drive = journey.mode === 'drive' ? legs.find((l) => l.geometry === 'road') : undefined
      const animate = !reduced && !!drive
      map.fitBounds(bounds, { padding: fitPad, duration: animate ? 700 : 0, pitch: 0, bearing: 0, maxZoom: 11.5 })
      framed = true
      relayout()

      const drawn = legs.filter((l) => l.geometry !== 'missing')
      if (!animate || !drive) {
        if (journey.mode === 'drive') ghost?.setData({ type: 'FeatureCollection', features: [] })
        setRoute(drawn.map((l) => feature(l, l.coords)))
        cbs.current.onProgress?.(1)
        return
      }

      // Drive: the full road as a faint ghost, then the road draws in along it with a car at its head.
      ghost?.setData({ type: 'FeatureCollection', features: [feature(drive, drive.coords)] })
      cbs.current.onProgress?.(0)
      const cum = cumulativeKm(drive.coords)
      const car = addMarker(drive.from, <Car />, 'car', 'car', true)
      const dur = roadDrawMs(drive.km)
      const t0 = performance.now() + 300
      await new Promise<void>((resolve) => {
        const step = () => {
          if (!alive) return resolve()
          const f = Math.max(0, Math.min(1, (performance.now() - t0) / dur))
          const e = easeInOut(f)
          const at = pointAlong(drive.coords, cum, e)
          setRoute([feature(drive, [...drive.coords.slice(0, at.index), at.point])])
          const ahead = pointAlong(drive.coords, cum, Math.min(1, e + 0.01)).point
          const behind = pointAlong(drive.coords, cum, Math.max(0, e - 0.01)).point
          car.setLngLat(at.point)
          car.setRotation(bearingDeg(behind, ahead))
          cbs.current.onProgress?.(f)
          if (f < 1) raf = requestAnimationFrame(step)
          else resolve()
        }
        step()
      })
      if (!alive) return
      setRoute(drawn.map((l) => feature(l, l.coords)))
      const ci = markers.findIndex((x) => x.m === car)
      if (ci >= 0) {
        const [gone] = markers.splice(ci, 1)
        gone.m.remove()
        window.setTimeout(() => gone.root.unmount(), 0)
      }
    }
    void run()

    return () => {
      cleanup()
      map.off('move', onUserMove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, journey, replay, reduced, padding.left, padding.right, padding.top, padding.bottom])

  return (
    <div className="absolute inset-0">
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {!ready ? <div className="absolute inset-0 bg-surface-2" aria-hidden /> : null}
    </div>
  )
}
