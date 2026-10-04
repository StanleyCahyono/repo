'use client'
/**
 * Resort map (MapLibre GL + OpenFreeMap vector tiles). Load via `LazyResortMap` so the library is only fetched
 * when a map is shown.
 *
 * - Markers are real <button>s (keyboard + screen-reader reachable); every map has a list alternative elsewhere.
 * - Explicit selection flies to the marker in ~550ms (jump under reduced motion). No automatic camera motion.
 * - If the style or tiles cannot load (offline, blocked), a schematic SVG fallback keeps markers usable.
 * - Lines: a drive with recorded road geometry (`path`) follows the road (solid); a flight (`kind: 'flight'`) is a
 *   static great-circle arc between the airports (dashed, never animated); anything else is a straight dashed line and
 *   is labelled as one — never presented as a route or a driving time.
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
  /** Road geometry ([lon, lat] points, e.g. a bundled OSM route): drawn along the road instead of a straight line. */
  path?: readonly [number, number][]
  /** 'road' (needs `path`), 'flight' (a static arc between airports) or 'straight' (default: a labelled straight line). */
  kind?: 'road' | 'flight' | 'straight'
}

type LineKind = 'road' | 'flight' | 'straight'

function kindOf(l: MapLine): LineKind {
  if (l.path && l.path.length > 1) return 'road'
  return l.kind === 'flight' ? 'flight' : 'straight'
}

/** Great-circle arc between two points ([lon, lat]), longitudes unwrapped so it never jumps across the map. */
function flightArc(a: [number, number], b: [number, number], steps = 48): [number, number][] {
  const rad = Math.PI / 180
  const toV = ([lon, lat]: [number, number]) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)]
  const va = toV(a)
  const vb = toV(b)
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))
  const ang = Math.acos(dot)
  if (ang < 1e-6) return [a, b]
  const out: [number, number][] = []
  let prev = a[0]
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const ka = Math.sin((1 - t) * ang) / Math.sin(ang)
    const kb = Math.sin(t * ang) / Math.sin(ang)
    const x = ka * va[0] + kb * vb[0]
    const y = ka * va[1] + kb * vb[1]
    const z = ka * va[2] + kb * vb[2]
    let lon = Math.atan2(y, x) / rad
    const lat = Math.atan2(z, Math.hypot(x, y)) / rad
    while (lon - prev > 180) lon -= 360
    while (lon - prev < -180) lon += 360
    prev = lon
    out.push([lon, lat])
  }
  return out
}

/** The points a line is drawn through. */
function lineCoords(l: MapLine): [number, number][] {
  const k = kindOf(l)
  if (k === 'road') return l.path!.map((p) => [p[0], p[1]] as [number, number])
  if (k === 'flight') return flightArc(l.from, l.to)
  return [l.from, l.to]
}

/** The note under a map with lines: says what the lines are (only for the kinds present). */
function linesNote(lines: readonly MapLine[] | undefined): string | null {
  if (!lines?.length) return null
  const kinds = new Set(lines.map(kindOf))
  const parts: string[] = []
  if (kinds.has('road')) parts.push('Solid: the road route')
  if (kinds.has('flight')) parts.push('dashed arc: flight, airport to airport')
  if (kinds.has('straight')) parts.push(kinds.size > 1 ? 'dashed: straight line, not a route' : 'Dashed lines are straight lines, not routes')
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A CSS colour token resolved for MapLibre paint (which cannot read CSS variables). */
function cssColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
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
  /**
   * Marker highlighted from elsewhere (e.g. hovering its card in a list). Restyles that marker only — never moves
   * the camera. Default none.
   */
  highlightedId?: string | null
  /**
   * Markers the camera fits when the marker set changes (e.g. leave far-away outliers out of the initial view).
   * Default: all markers. Other markers stay on the map and can still be selected.
   */
  fitIds?: readonly string[] | null
  /**
   * 'pill' (default): labelled pill. 'dot': compact dot whose name appears on hover, focus, highlight or selection —
   * for dense result sets. The accessible name is the same in both styles.
   */
  markerStyle?: 'pill' | 'dot'
}

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'
/** Served by src/app/vendor/maplibre/[file]/route.ts from the installed maplibre-gl package. */
const MAPLIBRE_WORKER_PATH = '/vendor/maplibre/maplibre-gl-worker.mjs'

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

const dotTone: Record<NonNullable<MapMarker['tone']>, string> = {
  default: 'bg-teal border-surface',
  favorite: 'bg-copper border-surface',
  airport: 'bg-info border-surface',
  hotel: 'bg-glacier border-teal',
  muted: 'bg-surface-3 border-divider-strong',
  home: 'bg-ink border-surface',
}

/** Selected / highlighted styling shared by map markers (DOM) — the schematic fallback mirrors it in JSX. */
function applyMarkerState(el: HTMLElement, selected: boolean, highlighted: boolean, style: 'pill' | 'dot') {
  el.setAttribute('aria-pressed', String(selected))
  el.dataset.active = String(selected || highlighted)
  if (style === 'pill') {
    el.classList.toggle('ring-2', selected || highlighted)
    el.classList.toggle('ring-teal', selected)
    el.classList.toggle('ring-teal/50', highlighted && !selected)
    el.classList.toggle('scale-105', selected)
  }
  el.style.zIndex = selected ? '11' : highlighted ? '10' : ''
}

function markerEl(m: MapMarker, selected: boolean, onSelect?: (id: string) => void, style: 'pill' | 'dot' = 'pill', highlighted = false): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.setAttribute('aria-label', m.sublabel ? `${m.label}, ${m.sublabel}` : m.label)
  btn.dataset.markerId = m.id
  if (style === 'dot') {
    btn.className = 'piste-marker group relative flex size-7 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2'
    const dot = document.createElement('span')
    dot.setAttribute('aria-hidden', 'true')
    dot.className = cn(
      'block size-3.5 rounded-full border-2 shadow-lift transition-transform duration-150',
      'group-hover:scale-125 group-data-[active=true]:scale-125 group-data-[active=true]:ring-2 group-data-[active=true]:ring-teal',
      dotTone[m.tone ?? 'default'],
    )
    const label = document.createElement('span')
    label.setAttribute('aria-hidden', 'true')
    label.className = cn(
      'pointer-events-none absolute bottom-full left-1/2 mb-0.5 hidden -translate-x-1/2 rounded-full border px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap shadow-lift',
      'group-hover:block group-focus-visible:block group-data-[active=true]:block',
      toneClass[m.tone ?? 'default'],
    )
    label.textContent = m.label
    btn.append(dot, label)
  } else {
    btn.className = cn(
      'piste-marker flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold shadow-lift whitespace-nowrap',
      'transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2',
      'ring-offset-1 ring-offset-surface',
      toneClass[m.tone ?? 'default'],
    )
    btn.textContent = m.label
  }
  applyMarkerState(btn, selected, highlighted, style)
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    onSelect?.(m.id)
  })
  return btn
}

/** Offline / blocked-tiles fallback: equirectangular plot of markers with the same interactions. */
function SchematicMap({ markers, selectedId, onSelect, lines, reason, highlightedId, fitIds, markerStyle = 'pill' }: ResortMapProps & { reason: string }) {
  const fitSet = fitIds?.length ? new Set(fitIds) : null
  const framed = fitSet ? markers.filter((m) => fitSet.has(m.id)) : markers
  const pts = framed.length ? framed : markers
  const lats = pts.map((p) => p.lat)
  const lons = pts.map((p) => p.lon)
  const pad = 0.6
  const minLat = Math.min(...lats, 90) - pad
  const maxLat = Math.max(...lats, -90) + pad
  const minLon = Math.min(...lons, 180) - pad
  const maxLon = Math.max(...lons, -180) + pad
  const x = (lon: number) => ((lon - minLon) / Math.max(maxLon - minLon, 0.01)) * 100
  const y = (lat: number) => (1 - (lat - minLat) / Math.max(maxLat - minLat, 0.01)) * 100
  const inView = (m: MapMarker) => m.lat >= minLat && m.lat <= maxLat && m.lon >= minLon && m.lon <= maxLon
  const shown = markers.filter(inView)
  const outside = markers.length - shown.length
  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-2">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
        {[20, 40, 60, 80].map((v) => (
          <g key={v}>
            <line x1={v} x2={v} y1={0} y2={100} stroke="var(--divider)" strokeWidth={0.2} />
            <line y1={v} y2={v} x1={0} x2={100} stroke="var(--divider)" strokeWidth={0.2} />
          </g>
        ))}
      </svg>
      {/* Markers and lines share one inset frame so they stay aligned and clear of the edges and the note. */}
      <div className="absolute inset-4 bottom-14">
        {lines?.length ? (
          <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
            {lines.map((l, i) => {
              const k = kindOf(l)
              const pts = lineCoords(l)
                .map(([lo, la]) => `${x(lo).toFixed(2)},${y(la).toFixed(2)}`)
                .join(' ')
              return k === 'road' ? (
                <polyline key={i} points={pts} fill="none" stroke="var(--teal)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              ) : (
                <polyline key={i} points={pts} fill="none" stroke="var(--teal)" strokeWidth={k === 'flight' ? 1.6 : 2} strokeDasharray="5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              )
            })}
          </svg>
        ) : null}
        {shown.map((m) => {
          const selected = m.id === selectedId
          const active = selected || m.id === highlightedId
          return markerStyle === 'dot' ? (
            <button
              key={m.id}
              type="button"
              data-marker-id={m.id}
              data-active={active}
              aria-label={m.sublabel ? `${m.label}, ${m.sublabel}` : m.label}
              aria-pressed={selected}
              onClick={() => onSelect?.(m.id)}
              style={{ left: `${x(m.lon)}%`, top: `${y(m.lat)}%`, zIndex: selected ? 11 : active ? 10 : undefined }}
              className="group absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            >
              <span
                aria-hidden
                className={cn(
                  'block size-3.5 rounded-full border-2 shadow-lift transition-transform duration-150 group-hover:scale-125',
                  dotTone[m.tone ?? 'default'],
                  active && 'scale-125 ring-2 ring-teal',
                )}
              />
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 rounded-full border px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap shadow-lift',
                  active ? 'block' : 'hidden group-hover:block group-focus-visible:block',
                  toneClass[m.tone ?? 'default'],
                )}
              >
                {m.label}
              </span>
            </button>
          ) : (
            <button
              key={m.id}
              type="button"
              data-marker-id={m.id}
              aria-label={m.sublabel ? `${m.label}, ${m.sublabel}` : m.label}
              aria-pressed={selected}
              onClick={() => onSelect?.(m.id)}
              style={{ left: `${x(m.lon)}%`, top: `${y(m.lat)}%` }}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap shadow-lift',
                toneClass[m.tone ?? 'default'],
                selected && 'z-10 ring-2 ring-teal ring-offset-1 ring-offset-surface',
                !selected && m.id === highlightedId && 'z-10 ring-2 ring-teal/50',
              )}
            >
              {m.label}
            </button>
          )
        })}
      </div>
      <p className="absolute right-2 bottom-2 left-2 rounded-md border border-divider bg-surface/95 px-3 py-2 text-[12px] text-ink-2">
        Schematic view — {reason}. Positions are to scale by latitude/longitude only; use the list for details.
        {outside > 0 ? ` ${outside} outside this view.` : ''}
      </p>
    </div>
  )
}

export default function ResortMap(props: ResortMapProps) {
  const { markers, selectedId, onSelect, lines, className, ariaLabel = 'Map of resorts', fallbackCenter = [-76.5, 42.44], highlightedId = null, fitIds = null, markerStyle = 'pill' } = props
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
    const placed = markerRefs.current
    const timeout = window.setTimeout(() => {
      if (!mapRef.current?.isStyleLoaded()) setFailed('map tiles did not load (offline or blocked)')
    }, 12000)
    import('maplibre-gl')
      .then(({ Map, NavigationControl, AttributionControl, setWorkerUrl }) => {
        if (cancelled || !container.current) return
        // The bundler hides MapLibre's own script URL, so point it at the same-origin worker route explicitly.
        setWorkerUrl(new URL(MAPLIBRE_WORKER_PATH, window.location.origin).href)
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
        let loaded = false
        map.once('load', () => {
          loaded = true
        })
        map.on('error', () => {
          // Before the first load any error (style fetch, style parse, worker) means no usable map: fall back to the
          // schematic view. After that, individual tile errors are left to MapLibre.
          if (!loaded) setFailed('map style could not be loaded')
        })
        mapRef.current = map
      })
      .catch(() => setFailed('the map library failed to load'))
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      placed.forEach((m) => m.remove())
      placed.clear()
      map?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync markers and fit bounds when the marker set changes.
  const markerKey = markers.map((m) => `${m.id}:${m.lat}:${m.lon}:${m.tone}:${m.label}:${m.sublabel ?? ''}`).join('|') + `#${markerStyle}#${(fitIds ?? []).join(',')}`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    let alive = true
    import('maplibre-gl').then(({ Marker, LngLatBounds }) => {
      if (!alive) return
      markerRefs.current.forEach((m) => m.remove())
      markerRefs.current.clear()
      for (const m of markers) {
        const el = markerEl(m, m.id === selectedId, (id) => onSelectRef.current?.(id), markerStyle, m.id === highlightedId)
        const mk = new Marker({ element: el, anchor: 'center' }).setLngLat([m.lon, m.lat]).addTo(map)
        markerRefs.current.set(m.id, mk)
      }
      const fitSet = fitIds?.length ? new Set(fitIds) : null
      const framed = fitSet ? markers.filter((m) => fitSet.has(m.id)) : markers
      const fit = framed.length ? framed : markers
      if (fit.length > 1) {
        const b = new LngLatBounds()
        fit.forEach((m) => b.extend([m.lon, m.lat]))
        map.fitBounds(b, { padding: 56, maxZoom: 9, duration: 0 })
      } else if (fit.length === 1) {
        map.jumpTo({ center: [fit[0].lon, fit[0].lat], zoom: 10 })
      }
      // Line overlays: roads follow their geometry (solid); flights are static arcs and straight lines are dashed
      // (both labelled in the note below the map). Nothing here animates.
      const src = map.getSource('piste-lines') as { setData?: (d: unknown) => void } | undefined
      const data = {
        type: 'FeatureCollection',
        features: (lines ?? []).map((l) => ({ type: 'Feature', properties: { label: l.label, kind: kindOf(l) }, geometry: { type: 'LineString', coordinates: lineCoords(l) } })),
      }
      if (src?.setData) src.setData(data)
      else if (lines?.length) {
        const teal = cssColor('--teal', 'rgb(36 93 101)')
        const halo = cssColor('--surface', 'rgb(255 255 255)')
        map.addSource('piste-lines', { type: 'geojson', data: data as never })
        map.addLayer({
          id: 'piste-lines-road-halo',
          type: 'line',
          source: 'piste-lines',
          filter: ['==', ['get', 'kind'], 'road'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': halo, 'line-width': 6, 'line-opacity': 0.85 },
        })
        map.addLayer({
          id: 'piste-lines-road',
          type: 'line',
          source: 'piste-lines',
          filter: ['==', ['get', 'kind'], 'road'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': teal, 'line-width': 3 },
        })
        map.addLayer({
          id: 'piste-lines',
          type: 'line',
          source: 'piste-lines',
          filter: ['!=', ['get', 'kind'], 'road'],
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': teal, 'line-width': ['match', ['get', 'kind'], 'flight', 1.6, 2], 'line-dasharray': [2, 1.6] },
        })
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
    markerRefs.current.forEach((mk, id) => applyMarkerState(mk.getElement(), id === selectedId, id === highlightedId, markerStyle))
    if (!map || !ready || !selectedId) return
    const m = markers.find((x) => x.id === selectedId)
    if (!m) return
    const opts = { center: [m.lon, m.lat] as [number, number], zoom: Math.max(map.getZoom(), 8) }
    if (prefersReducedMotion()) map.jumpTo(opts)
    else map.flyTo({ ...opts, duration: 550, essential: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready])

  // Highlight from a list (hover/focus): restyle only — no camera motion.
  useEffect(() => {
    markerRefs.current.forEach((mk, id) => applyMarkerState(mk.getElement(), id === selectedId, id === highlightedId, markerStyle))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedId])

  if (failed) {
    return (
      <div className={cn('relative overflow-hidden rounded-[12px] border border-divider', className)} role="region" aria-label={`${ariaLabel} (schematic)`}>
        <SchematicMap {...props} reason={failed} />
      </div>
    )
  }

  return (
    <div className={cn('relative overflow-hidden rounded-[12px] border border-divider bg-surface-2', className)} role="region" aria-label={ariaLabel}>
      <div
        ref={container}
        // Inline position: maplibre-gl.css sets .maplibregl-map { position: relative }, which would override `absolute`
        // and collapse the map to zero height.
        style={{ position: 'absolute', inset: 0 }}
        className={cn('absolute inset-0', dark && '[&_.maplibregl-canvas]:[filter:invert(0.92)_hue-rotate(180deg)_saturate(0.6)_brightness(0.95)]')} />
      {!ready ? <div className="absolute inset-0 animate-pulse bg-surface-3/60" aria-hidden /> : null}
      {linesNote(lines) ? (
        <p className="absolute top-2 left-2 max-w-[calc(100%-64px)] rounded-[8px] bg-surface/90 px-2 py-1 text-[12px] leading-snug text-ink-2">{linesNote(lines)}.</p>
      ) : null}
    </div>
  )
}
