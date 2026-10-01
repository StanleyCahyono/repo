'use client'
/**
 * Online journey map (MapLibre GL + OpenFreeMap vector tiles, free and keyless). Draws the journey with a glowing line
 * while a car / plane glyph glides along it; the camera follows with pitch and bearing, zooms out mid-leg and ends on
 * a tilted 3D-terrain approach (open Terrarium elevation tiles). A drive leg asks the public OSRM demo router for road
 * geometry; when that fails the line stays straight and dashed and the badge says "approximate route".
 *
 * If the style cannot be fetched quickly (offline, blocked), `onFail` is called and the caller shows the schematic.
 * Reduced motion: the finished journey is drawn at once and framed, with no camera flights.
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoJSONSource, Map as MlMap, Marker as MlMarker } from 'maplibre-gl'
import { angleDelta, bearingDeg, cumulativeKm, easeInOut, legDurationMs, pathKm, pointAlong, type LonLat } from '@/lib/domain/journey'
import type { Journey, Leg } from './journey-model'
import { followSpanKm } from './camera'
import { Car, Plane } from './glyphs'
import { PinView, type JourneyCallbacks, type MapPadding } from './schematic-journey'

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
  /** Status line for the map badge (approximate route, road geometry, illustrative flight). */
  onBadge: (text: string) => void
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

async function roadGeometry(from: LonLat, to: LonLat): Promise<LonLat[] | null> {
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

/** MapLibre zoom (512px tiles) that shows `km` across `px` pixels at latitude `lat`. */
function zoomForSpan(km: number, px: number, lat: number) {
  return Math.max(1, Math.min(16, Math.log2((78271.517 * Math.cos((lat * Math.PI) / 180) * px) / Math.max(1, km * 1000))))
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

export default function MapLibreJourney({ journey, home, replay, reduced, padding, onFail, onBadge, onPhase, onProgress }: MapLibreJourneyProps) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null)
  const [ready, setReady] = useState(false)
  const cbs = useRef({ onFail, onBadge, onPhase, onProgress })
  useEffect(() => {
    cbs.current = { onFail, onBadge, onPhase, onProgress }
  }, [onFail, onBadge, onPhase, onProgress])

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
        maxPitch: 75,
        attributionControl: false,
        fadeDuration: 0,
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
        const ink3 = token('--ink-3', 'gray')
        try {
          m.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14 })
          m.addSource('dem-h', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14 })
          const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id
          m.addLayer({ id: 'ride-hill', type: 'hillshade', source: 'dem-h', paint: { 'hillshade-exaggeration': 0.4 } }, firstSymbol)
        } catch {
          /* terrain is decoration; the journey works without it */
        }
        m.addSource('ride-ghost', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        m.addLayer({ id: 'ride-ghost', type: 'line', source: 'ride-ghost', layout: { 'line-cap': 'round' }, paint: { 'line-color': ink3, 'line-opacity': 0.45, 'line-width': 2, 'line-dasharray': [0.3, 2.4] } })
        m.addSource('ride', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true })
        m.addLayer({ id: 'ride-glow', type: 'line', source: 'ride', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': teal, 'line-width': 16, 'line-opacity': 0.32, 'line-blur': 8 } })
        m.addLayer({ id: 'ride-line', type: 'line', source: 'ride', filter: ['!=', ['get', 'dash'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': teal, 'line-width': 4.5 } })
        m.addLayer({ id: 'ride-dash', type: 'line', source: 'ride', filter: ['==', ['get', 'dash'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': teal, 'line-width': 4, 'line-dasharray': [1.2, 1.6] } })
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

  // Run the journey.
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml) return
    let alive = true
    let raf = 0
    let userMoved = false
    const markers: { m: MlMarker; root: Root }[] = []
    const onUser = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMoved = true
    }
    map.on('dragstart', onUser)
    map.on('wheel', onUser)
    const route = map.getSource('ride') as GeoJSONSource | undefined
    const ghost = map.getSource('ride-ghost') as GeoJSONSource | undefined
    const feature = (leg: Leg, coords: LonLat[]) => ({ type: 'Feature' as const, properties: { dash: leg.approx ? 1 : 0 }, geometry: { type: 'LineString' as const, coordinates: coords } })
    const setRoute = (fs: ReturnType<typeof feature>[]) => route?.setData({ type: 'FeatureCollection', features: fs })
    const pad = padding
    const viewW = () => Math.max(200, map.getContainer().clientWidth - pad.left - pad.right)
    const marker = (el: HTMLElement, at: LonLat, node: React.ReactNode, opts: { anchor?: 'bottom' | 'center'; rotate?: boolean } = {}) => {
      const root = createRoot(el)
      root.render(node)
      const m = new ml.Marker({ element: el, anchor: opts.anchor ?? 'bottom', rotationAlignment: opts.rotate ? 'map' : 'viewport', pitchAlignment: opts.rotate ? 'map' : 'viewport' }).setLngLat(at).addTo(map)
      markers.push({ m, root })
      return m
    }

    try {
      map.setTerrain(null)
    } catch {
      /* no terrain yet */
    }
    setRoute([])
    ghost?.setData({ type: 'FeatureCollection', features: [] })

    if (!journey) {
      const el = document.createElement('div')
      marker(el, [home.lon, home.lat], <PinView pin={{ id: 'home', at: [home.lon, home.lat], label: home.name, kind: 'home' }} />)
      map.jumpTo({ center: [home.lon, home.lat], zoom: 5.2, pitch: 0, bearing: 0, padding: pad })
      cbs.current.onBadge('Home · pick a resort to ride there')
      cbs.current.onPhase?.({ phase: 'overview', leg: 0 })
      return () => {
        alive = false
        map.off('dragstart', onUser)
        map.off('wheel', onUser)
        markers.forEach(({ m, root }) => {
          m.remove()
          window.setTimeout(() => root.unmount(), 0)
        })
      }
    }

    const run = async () => {
      // Road geometry for the drive leg (falls back to the straight, dashed line).
      const legs: Leg[] = journey.legs.map((l) => ({ ...l }))
      const drive = legs.find((l) => l.kind === 'drive')
      if (drive) {
        cbs.current.onBadge('Finding road geometry…')
        const road = await roadGeometry(drive.from, drive.to)
        if (!alive) return
        if (road) {
          drive.coords = road
          drive.approx = false
          drive.km = pathKm(road)
          cbs.current.onBadge('Road geometry · OpenStreetMap via OSRM · time is Piste’s estimate')
        } else cbs.current.onBadge('Approximate route · straight line, not roads')
      } else cbs.current.onBadge('Illustrative flight arc · no times or fares · ground legs approximate')

      for (const p of journey.pins) {
        const el = document.createElement('div')
        marker(el, p.at, <PinView pin={p} />)
      }
      ghost?.setData({ type: 'FeatureCollection', features: legs.map((l) => feature(l, l.coords)) })
      const all = legs.flatMap((l) => l.coords)
      const bounds = all.reduce((b, c) => b.extend(c), new ml.LngLatBounds(all[0], all[0]))
      const resort = legs[legs.length - 1].to

      if (reduced) {
        setRoute(legs.map((l) => feature(l, l.coords)))
        map.fitBounds(bounds, { padding: pad, duration: 0, pitch: 0, bearing: 0, maxZoom: 11 })
        legs.forEach((_, i) => cbs.current.onProgress?.(i, 1))
        cbs.current.onPhase?.({ phase: 'done', leg: legs.length - 1 })
        return
      }

      cbs.current.onPhase?.({ phase: 'overview', leg: 0 })
      map.fitBounds(bounds, { padding: pad, duration: 1600, pitch: 0, bearing: 0, maxZoom: 11 })
      await sleep(1700)
      if (!alive) return
      const first = legs[0]
      let brg = bearingDeg(first.coords[0], first.coords[Math.min(first.coords.length - 1, 8)])
      if (!userMoved) {
        map.easeTo({ center: first.from, zoom: zoomForSpan(followSpanKm(first, 0), viewW(), first.from[1]), pitch: 55, bearing: brg, padding: pad, duration: 1500, essential: true })
        await sleep(1500)
      }
      const done: ReturnType<typeof feature>[] = []
      for (let i = 0; i < legs.length; i++) {
        if (!alive) return
        const leg = legs[i]
        cbs.current.onPhase?.({ phase: 'leg', leg: i })
        if (i === legs.length - 1) {
          try {
            map.setTerrain({ source: 'dem', exaggeration: 1.4 })
          } catch {
            /* terrain unavailable */
          }
        }
        const cum = cumulativeKm(leg.coords)
        const glyphEl = document.createElement('div')
        const glyph = marker(glyphEl, leg.from, leg.kind === 'air' ? <Plane /> : <Car />, { anchor: 'center', rotate: true })
        const dur = legDurationMs(leg.kind, leg.km)
        const t0 = performance.now()
        await new Promise<void>((resolve) => {
          const step = () => {
            if (!alive) return resolve()
            const f = Math.min(1, (performance.now() - t0) / dur)
            const e = easeInOut(f)
            const at = pointAlong(leg.coords, cum, e)
            setRoute([...done, feature(leg, [...leg.coords.slice(0, at.index), at.point])])
            const ahead = pointAlong(leg.coords, cum, Math.min(1, e + 0.02)).point
            const behind = pointAlong(leg.coords, cum, Math.max(0, e - 0.01)).point
            const heading = bearingDeg(behind, ahead)
            glyph.setLngLat(at.point)
            glyph.setRotation(heading)
            if (!userMoved) {
              brg += angleDelta(brg, heading) * 0.05
              const arc = Math.sin(Math.PI * e)
              map.jumpTo({
                center: at.point,
                zoom: zoomForSpan(followSpanKm(leg, e), viewW(), at.point[1]),
                bearing: brg,
                pitch: leg.kind === 'air' ? 52 - 26 * arc : 56 - 8 * arc,
                padding: pad,
              })
            }
            cbs.current.onProgress?.(i, f)
            if (f < 1) raf = requestAnimationFrame(step)
            else resolve()
          }
          step()
        })
        done.push(feature(leg, leg.coords))
        const gi = markers.findIndex((x) => x.m === glyph)
        if (gi >= 0) {
          markers[gi].m.remove()
          const r = markers[gi].root
          window.setTimeout(() => r.unmount(), 0)
          markers.splice(gi, 1)
        }
      }
      if (!alive) return
      setRoute(done)
      cbs.current.onPhase?.({ phase: 'approach', leg: legs.length - 1 })
      if (!userMoved) map.flyTo({ center: resort, zoom: 12.8, pitch: 64, bearing: -28, padding: pad, duration: 4200, curve: 1.5, essential: true })
      await sleep(4200)
      if (alive) cbs.current.onPhase?.({ phase: 'done', leg: legs.length - 1 })
    }
    void run()

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      map.off('dragstart', onUser)
      map.off('wheel', onUser)
      map.stop()
      markers.forEach(({ m, root }) => {
        m.remove()
        window.setTimeout(() => root.unmount(), 0)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, journey, replay, reduced, padding.left, padding.right, padding.top, padding.bottom])

  return (
    <div className="absolute inset-0">
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {!ready ? <div className="absolute inset-0 animate-pulse bg-surface-3/50" aria-hidden /> : null}
    </div>
  )
}
