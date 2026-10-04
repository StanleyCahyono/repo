'use client'
/**
 * The online layer of the lifts-and-runs map: MapLibre GL with 3D terrain from open elevation tiles (Terrarium
 * encoding) under satellite imagery, and the bundled OpenStreetMap runs and lifts drawn on the mountain in their
 * sign colours (the schematic beneath carries the shapes and the list carries the words). Loaded lazily, only once the
 * map is on screen. It reports 'live' after the first imagery tile arrives and 'offline' when none does, so the
 * schematic stays in charge when tiles are blocked. Scroll-wheel zoom is off (no scroll trapping); drag, pinch and
 * the zoom buttons work. No automatic camera motion.
 */
import { useEffect, useRef } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl'
import type { MappedLine } from '@/lib/data/lifts'
import type { PisteTone } from '@/lib/domain/lifts'

/** Served by src/app/vendor/maplibre/[file]/route.ts from the installed maplibre-gl package. */
const MAPLIBRE_WORKER_PATH = '/vendor/maplibre/maplibre-gl-worker.mjs'
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const TONE_TOKEN: Record<PisteTone, string> = { green: '--positive', blue: '--info', red: '--critical', black: '--ink', orange: '--caution', neutral: '--ink-3' }

/** Resolve design tokens to colours MapLibre can paint (it cannot read CSS variables). */
function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function features(lines: MappedLine[] | null) {
  return {
    type: 'FeatureCollection' as const,
    features: (lines ?? []).map((l) => ({
      type: 'Feature' as const,
      properties: { id: l.id, k: l.kind, name: l.name ?? '', c: l.kind === 'lift' ? '' : token(TONE_TOKEN[l.sign?.tone ?? 'neutral'], '#555') },
      geometry: { type: 'LineString' as const, coordinates: l.coords },
    })),
  }
}

export default function TerrainMapGl({
  center,
  lines,
  bbox,
  selected,
  onSelect,
  onState,
  onCamera,
}: {
  center: { lat: number; lon: number }
  lines: MappedLine[] | null
  bbox: [number, number, number, number] | null
  selected: string[]
  onSelect: (ids: string[]) => void
  onState: (s: 'live' | 'offline') => void
  /** Called as the camera moves: a lon/lat → container-pixel projection and the zoom factor since the first view (place labels follow it). */
  onCamera?: (project: (lon: number, lat: number) => [number, number], zoom: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const cb = useRef({ onSelect, onState, onCamera, lines })
  useEffect(() => {
    cb.current = { onSelect, onState, onCamera, lines }
  }, [onSelect, onState, onCamera, lines])

  useEffect(() => {
    let cancelled = false
    let map: MlMap | null = null
    let live = false
    const timer = window.setTimeout(() => {
      if (!live) cb.current.onState('offline')
    }, 12000)
    import('maplibre-gl')
      .then(({ Map, NavigationControl, AttributionControl, setWorkerUrl }) => {
        if (cancelled || !box.current) return
        setWorkerUrl(new URL(MAPLIBRE_WORKER_PATH, window.location.origin).href)
        const ink = token('--ink', '#13202c')
        const surface = token('--surface', '#ffffff')
        const style: StyleSpecification = {
          version: 8,
          sources: {
            sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
            dem: { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Elevation: Terrain Tiles (AWS Open Data)' },
            osm: { type: 'geojson', data: features(lines), attribution: '© OpenStreetMap contributors' },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': token('--surface-2', '#eef3f7') } },
            { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.25, 'raster-contrast': 0.08, 'raster-brightness-max': 0.96 } },
            { id: 'runs-case', type: 'line', source: 'osm', filter: ['==', ['get', 'k'], 'run'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': surface, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 8], 'line-opacity': 0.85 } },
            { id: 'runs', type: 'line', source: 'osm', filter: ['==', ['get', 'k'], 'run'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 16, 5] } },
            { id: 'lifts-case', type: 'line', source: 'osm', filter: ['==', ['get', 'k'], 'lift'], paint: { 'line-color': surface, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 16, 6] } },
            { id: 'lifts', type: 'line', source: 'osm', filter: ['==', ['get', 'k'], 'lift'], paint: { 'line-color': ink, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 16, 3], 'line-dasharray': [3, 1.5] } },
            { id: 'sel', type: 'line', source: 'osm', filter: ['in', ['get', 'id'], ['literal', []]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': token('--teal', '#1c6c9c'), 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 9], 'line-opacity': 0.9 } },
            { id: 'hit', type: 'line', source: 'osm', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 } },
          ],
          terrain: { source: 'dem', exaggeration: lines ? 1.8 : 1.4 },
        }
        const cx = bbox ? (bbox[0] + bbox[2]) / 2 : center.lon
        const cy = bbox ? (bbox[1] + bbox[3]) / 2 : center.lat
        map = new Map({
          container: box.current,
          style,
          center: [cx, cy],
          zoom: lines ? 14 : 12.4,
          pitch: lines ? 55 : 60,
          bearing: lines ? 200 : 0,
          maxPitch: 75,
          attributionControl: false,
          scrollZoom: false,
          fadeDuration: 0,
        })
        map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right')
        map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
        if (bbox) {
          const cam = map.cameraForBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 40 })
          if (cam?.zoom) map.jumpTo({ zoom: Math.min(15.5, cam.zoom + 0.35) })
        }
        map.on('sourcedata', (e) => {
          if (!live && e.sourceId === 'sat' && (e as unknown as { tile?: unknown }).tile) {
            live = true
            window.clearTimeout(timer)
            cb.current.onState('live')
          }
        })
        map.on('error', () => {})
        const z0 = map.getZoom()
        let raf = 0
        const report = () => {
          raf = 0
          const m = map
          if (!m || cancelled) return
          cb.current.onCamera?.((lon, lat) => {
            const p = m.project([lon, lat])
            return [p.x, p.y]
          }, 2 ** (m.getZoom() - z0))
        }
        const schedule = () => {
          if (!raf) raf = window.requestAnimationFrame(report)
        }
        map.on('move', schedule)
        map.on('load', schedule)
        map.on('idle', schedule)
        map.on('resize', schedule)
        map.on('click', 'hit', (e) => {
          const f = e.features?.[0]
          if (!f) return
          const id = String(f.properties?.id ?? '')
          const name = String(f.properties?.name ?? '')
          const k = String(f.properties?.k ?? '')
          const all = cb.current.lines ?? []
          cb.current.onSelect(name ? all.filter((l) => l.name === name && l.kind === k).map((l) => l.id) : [id])
        })
        map.on('mouseenter', 'hit', () => {
          if (map) map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'hit', () => {
          if (map) map.getCanvas().style.cursor = ''
        })
        mapRef.current = map
      })
      .catch(() => cb.current.onState('offline'))
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      map?.remove()
      mapRef.current = null
    }
    // Created once; lines and the camera come from the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    map.setFilter('sel', ['in', ['get', 'id'], ['literal', selected]])
  }, [selected])

  useEffect(() => {
    const src = mapRef.current?.getSource('osm') as GeoJSONSource | undefined
    src?.setData(features(lines))
  }, [lines])

  return <div ref={box} style={{ position: 'absolute', inset: 0 }} aria-label="3D terrain map (the list beside it is the text alternative)" role="region" />
}
