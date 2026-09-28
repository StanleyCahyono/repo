'use client'
/**
 * Resort map (MapLibre GL + OpenFreeMap vector tiles). Load via `LazyResortMap` so the library is only fetched
 * when a map is shown.
 *
 * - Markers are real <button>s (keyboard + screen-reader reachable); every map has a list alternative elsewhere.
 * - Explicit selection flies to the marker in ~550ms (jump under reduced motion). No automatic camera motion.
 * - If the style or tiles cannot load (offline, blocked), a schematic SVG fallback keeps markers usable.
 * - Straight lines are labelled as straight lines — never presented as routes or driving times.
 * Tile provider: OpenFreeMap (free, no key; attribution required and shown). Override with NEXT_PUBLIC_MAP_STYLE_URL.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl'
import { cn } from '@/lib/ui/cn'

export interface MapMarker {
  id: string
  lat: number
  lon: number
  label: string
  sublabel?: string
  tone?: 'default' | 'favorite' | 'airport' | 'hotel' | 'muted' | 'home'
}

export interface MapLine {
  from: [number, number] // [lon, lat]
  to: [number, number]
  label: string
}

export interface ResortMapProps {
  markers: MapMarker[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  lines?: MapLine[]
  className?: string
  ariaLabel?: string
  /** Initial camera when there are no markers. */
  fallbackCenter?: [number, number]
}

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'

const toneClass: Record<NonNullable<MapMarker['tone']>, string> = {
  default: 'bg-surface text-ink border-teal',
  favorite: 'bg-copper text-surface border-copper',
  airport: 'bg-info-bg text-info border-info',
  hotel: 'bg-glacier text-teal border-teal',
  muted: 'bg-surface-3 text-ink-2 border-divider-strong',
  home: 'bg-ink text-canvas border-ink',
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function markerEl(m: MapMarker, selected: boolean, onSelect?: (id: string) => void): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.setAttribute('aria-label', m.sublabel ? `${m.label}, ${m.sublabel}` : m.label)
  btn.setAttribute('aria-pressed', String(selected))
  btn.dataset.markerId = m.id
  btn.className = cn(
    'piste-marker flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold shadow-lift whitespace-nowrap',
    'transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2',
    toneClass[m.tone ?? 'default'],
    selected && 'ring-2 ring-teal ring-offset-1 ring-offset-surface z-10 scale-105',
  )
  btn.textContent = m.label
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    onSelect?.(m.id)
  })
  return btn
}

/** Offline / blocked-tiles fallback: equirectangular plot of markers with the same interactions. */
function SchematicMap({ markers, selectedId, onSelect, lines, reason }: ResortMapProps & { reason: string }) {
  const pts = markers.length ? markers : []
  const lats = pts.map((p) => p.lat)
  const lons = pts.map((p) => p.lon)
  const pad = 0.6
  const minLat = Math.min(...lats, 90) - pad
  const maxLat = Math.max(...lats, -90) + pad
  const minLon = Math.min(...lons, 180) - pad
  const maxLon = Math.max(...lons, -180) + pad
  const x = (lon: number) => ((lon - minLon) / Math.max(maxLon - minLon, 0.01)) * 100
  const y = (lat: number) => (1 - (lat - minLat) / Math.max(maxLat - minLat, 0.01)) * 100
  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-2">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
        {[20, 40, 60, 80].map((v) => (
          <g key={v}>
            <line x1={v} x2={v} y1={0} y2={100} stroke="var(--divider)" strokeWidth={0.2} />
            <line y1={v} y2={v} x1={0} x2={100} stroke="var(--divider)" strokeWidth={0.2} />
          </g>
        ))}
        {(lines ?? []).map((l, i) => (
          <line key={i} x1={x(l.from[0])} y1={y(l.from[1])} x2={x(l.to[0])} y2={y(l.to[1])} stroke="var(--teal)" strokeWidth={0.4} strokeDasharray="1.2 1" />
        ))}
      </svg>
      {pts.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-label={m.sublabel ? `${m.label}, ${m.sublabel}` : m.label}
          aria-pressed={m.id === selectedId}
          onClick={() => onSelect?.(m.id)}
          style={{ left: `${x(m.lon)}%`, top: `${y(m.lat)}%` }}
          className={cn(
            'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap shadow-lift',
            toneClass[m.tone ?? 'default'],
            m.id === selectedId && 'z-10 ring-2 ring-teal ring-offset-1 ring-offset-surface',
          )}
        >
          {m.label}
        </button>
      ))}
      <p className="absolute right-2 bottom-2 left-2 rounded-md border border-divider bg-surface/95 px-3 py-2 text-[12px] text-ink-2">
        Schematic view — {reason}. Positions are to scale by latitude/longitude only; use the list for details.
      </p>
    </div>
  )
}

export default function ResortMap(props: ResortMapProps) {
  const { markers, selectedId, onSelect, lines, className, ariaLabel = 'Map of resorts', fallbackCenter = [-76.5, 42.44] } = props
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markerRefs = useRef<Map<string, MlMarker>>(new Map())
  const [failed, setFailed] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  const dark = useMemo(() => {
    if (typeof document === 'undefined') return false
    const attr = document.documentElement.dataset.theme
    if (attr) return attr === 'dark'
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  }, [])

  // Create the map once.
  useEffect(() => {
    let cancelled = false
    let map: MlMap | null = null
    const timeout = window.setTimeout(() => {
      if (!mapRef.current?.isStyleLoaded()) setFailed('map tiles did not load (offline or blocked)')
    }, 12000)
    import('maplibre-gl')
      .then(({ Map, NavigationControl, AttributionControl }) => {
        if (cancelled || !container.current) return
        map = new Map({
          container: container.current,
          style: STYLE_URL,
          center: fallbackCenter,
          zoom: 5,
          attributionControl: false,
          cooperativeGestures: false,
          fadeDuration: 0,
        })
        map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
        map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
        map.on('load', () => {
          window.clearTimeout(timeout)
          setReady(true)
        })
        map.on('error', (e) => {
          const msg = String((e as unknown as { error?: Error }).error?.message ?? '')
          if (!map?.isStyleLoaded() && /style|fetch|Failed|NetworkError|403|404/i.test(msg)) setFailed('map style could not be loaded')
        })
        mapRef.current = map
      })
      .catch(() => setFailed('the map library failed to load'))
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      markerRefs.current.forEach((m) => m.remove())
      markerRefs.current.clear()
      map?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync markers and fit bounds when the marker set changes.
  const markerKey = markers.map((m) => `${m.id}:${m.lat}:${m.lon}:${m.tone}:${m.label}`).join('|')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    let alive = true
    import('maplibre-gl').then(({ Marker, LngLatBounds }) => {
      if (!alive) return
      markerRefs.current.forEach((m) => m.remove())
      markerRefs.current.clear()
      for (const m of markers) {
        const mk = new Marker({ element: markerEl(m, m.id === selectedId, (id) => onSelectRef.current?.(id)), anchor: 'center' }).setLngLat([m.lon, m.lat]).addTo(map)
        markerRefs.current.set(m.id, mk)
      }
      if (markers.length > 1) {
        const b = new LngLatBounds()
        markers.forEach((m) => b.extend([m.lon, m.lat]))
        map.fitBounds(b, { padding: 56, maxZoom: 9, duration: 0 })
      } else if (markers.length === 1) {
        map.jumpTo({ center: [markers[0].lon, markers[0].lat], zoom: 10 })
      }
      // Straight-line overlays (explicitly labelled as not a route).
      const src = map.getSource('piste-lines') as { setData?: (d: unknown) => void } | undefined
      const data = {
        type: 'FeatureCollection',
        features: (lines ?? []).map((l) => ({ type: 'Feature', properties: { label: l.label }, geometry: { type: 'LineString', coordinates: [l.from, l.to] } })),
      }
      if (src?.setData) src.setData(data)
      else if (lines?.length) {
        map.addSource('piste-lines', { type: 'geojson', data: data as never })
        map.addLayer({ id: 'piste-lines', type: 'line', source: 'piste-lines', paint: { 'line-color': '#245d65', 'line-width': 2, 'line-dasharray': [2, 1.5] } })
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerKey, ready, lines])

  // Explicit selection: update pressed state and fly (400–700ms), or jump under reduced motion.
  useEffect(() => {
    const map = mapRef.current
    markerRefs.current.forEach((mk, id) => {
      const el = mk.getElement()
      const on = id === selectedId
      el.setAttribute('aria-pressed', String(on))
      el.classList.toggle('ring-2', on)
      el.classList.toggle('ring-teal', on)
      el.classList.toggle('scale-105', on)
      el.style.zIndex = on ? '10' : ''
    })
    if (!map || !ready || !selectedId) return
    const m = markers.find((x) => x.id === selectedId)
    if (!m) return
    const opts = { center: [m.lon, m.lat] as [number, number], zoom: Math.max(map.getZoom(), 8) }
    if (prefersReducedMotion()) map.jumpTo(opts)
    else map.flyTo({ ...opts, duration: 550, essential: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready])

  if (failed) {
    return (
      <div className={cn('relative overflow-hidden rounded-[12px] border border-divider', className)} role="region" aria-label={`${ariaLabel} (schematic)`}>
        <SchematicMap {...props} reason={failed} />
      </div>
    )
  }

  return (
    <div className={cn('relative overflow-hidden rounded-[12px] border border-divider bg-surface-2', className)} role="region" aria-label={ariaLabel}>
      <div ref={container} className={cn('absolute inset-0', dark && '[&_.maplibregl-canvas]:[filter:invert(0.92)_hue-rotate(180deg)_saturate(0.6)_brightness(0.95)]')} />
      {!ready ? <div className="absolute inset-0 animate-pulse bg-surface-3/60" aria-hidden /> : null}
      {lines?.length ? (
        <p className="absolute top-2 left-2 rounded-sm bg-surface/90 px-2 py-1 text-[11.5px] text-ink-2">Dashed lines are straight lines, not routes.</p>
      ) : null}
    </div>
  )
}
