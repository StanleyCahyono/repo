'use client'
/**
 * Getting there, the route map: the roads you drive — from home, or from each gateway airport — drawn along the
 * bundled road routes (OSRM over OpenStreetMap), over Natural Earth land and borders with nearby city names so the
 * area is easy to place. Airports are marked, not flown to: no flight arcs, no animation beyond the roads drawing in
 * once. A leg without a bundled route is a straight dashed line and says so. Works offline (no tiles).
 *
 * Colours come from the night card's local tokens (--card-*) so it sits inside the dark journey card in both themes.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { measureText, useFontsReady } from './map-text'
import { labelAnchor, layoutLabels, type MapPlaceLabel, type Rect } from './map-labels'
import type { RouteMapData } from './travel-geo'

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) * (180 / Math.PI)

function projector(bbox: [number, number, number, number], w: number, h: number, pad: { x: number; top: number; bottom: number }) {
  const [W, S, E, N] = bbox
  const y0 = mercY(N)
  const bw = Math.max(E - W, 0.05)
  const bh = Math.max(mercY(N) - mercY(S), 0.05)
  const k = Math.min((w - pad.x * 2) / bw, (h - pad.top - pad.bottom) / bh)
  const ox = (w - bw * k) / 2
  const oy = pad.top + (h - pad.top - pad.bottom - bh * k) / 2
  return (lon: number, lat: number): [number, number] => [ox + (lon - W) * k, oy + (y0 - mercY(lat)) * k]
}

const HALO = '[text-shadow:0_0_2px_var(--card-bg),0_0_4px_var(--card-bg),0_0_8px_var(--card-bg)]'

export function RouteMap({ data, label }: { data: RouteMapData; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box, { once: true, margin: '0px 0px -10% 0px' })
  const reduce = useReducedMotion()
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect
      if (r.width && r.height) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [drawn, setDrawn] = useState(false)
  const drawing = inView && !reduce && !drawn
  useEffect(() => {
    if (!inView || reduce) return
    const id = window.setTimeout(() => setDrawn(true), 1800)
    return () => window.clearTimeout(id)
  }, [inView, reduce])

  const fonts = useFontsReady()
  const view = useMemo(() => {
    if (!size) return null
    void fonts
    const pad = { x: Math.min(90, size.w * 0.14), top: 48, bottom: 36 }
    const p = projector(data.bbox, size.w, size.h, pad)
    const path = (flat: number[], close: boolean) => {
      let d = ''
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const [x, y] = p(flat[i], flat[i + 1])
        d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
      }
      return close ? `${d}Z` : d
    }
    const legs = data.legs.map((l) => ({ ...l, d: path(l.coords.flat(), false) }))
    const resort = p(data.resort.lon, data.resort.lat)
    // Labels: the resort and the starts first, then the biggest cities that fit.
    const near = (a: { lon: number; lat: number }, b: { lon: number; lat: number }, deg: number) => Math.hypot(a.lon - b.lon, a.lat - b.lat) < deg
    const places: MapPlaceLabel[] = [
      { id: 'resort', name: data.resort.name, kind: 'city', lon: data.resort.lon, lat: data.resort.lat, ele: null, eleM: null },
      ...data.legs.map((l) => ({ id: `from-${l.from.key}`, name: l.from.key === 'home' ? l.from.name : l.from.key, kind: 'town' as const, lon: l.from.lon, lat: l.from.lat, ele: null, eleM: null })),
      ...data.cities
        .filter((c) => !near(c, data.resort, 0.03) && !data.legs.some((l) => near(c, l.from, 0.08)))
        .map((c, i) => ({ id: `c${i}`, name: c.name, kind: 'village' as const, lon: c.lon, lat: c.lat, ele: null, eleM: -i })),
    ]
    const obstacles: Rect[] = [{ l: 0, t: 0, r: Math.min(size.w, 200), b: 36 }]
    const placed = layoutLabels(places, { project: (pl) => p(pl.lon, pl.lat), measure: measureText, width: size.w, height: size.h, zoom: 1, obstacles })
    return {
      land: data.land.map((r) => path(r, true)),
      borders: data.borders.map((r) => path(r, false)),
      legs,
      resort,
      starts: data.legs.map((l) => ({ key: l.from.key, pt: p(l.from.lon, l.from.lat) })),
      placed,
    }
  }, [data, size, fonts])

  return (
    <div ref={box} className="relative h-[300px] overflow-hidden rounded-[24px] bg-[color-mix(in_srgb,var(--card-fg)_5%,transparent)] sm:h-[340px] lg:h-[380px]" role="img" aria-label={label}>
      {view && size ? (
        <>
          <svg aria-hidden width={size.w} height={size.h} className={cn('absolute inset-0', drawing && 'rm-draw')}>
            <style>{CSS}</style>
            <g fill="color-mix(in srgb, var(--card-fg) 7%, transparent)">
              {view.land.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
            <g fill="none" stroke="color-mix(in srgb, var(--card-fg) 22%, transparent)" strokeWidth={0.8} strokeDasharray="3 3">
              {view.borders.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
            {view.legs.map((l, i) => (
              <g key={l.id}>
                <path d={l.d} fill="none" stroke="var(--card-bg)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" className="rm-fade" />
                <path
                  d={l.d}
                  fill="none"
                  stroke="var(--card-acc)"
                  strokeWidth={l.road ? 3 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={l.road ? undefined : '5 5'}
                  pathLength={l.road ? 1 : undefined}
                  className={l.road ? 'rm-road' : 'rm-fade'}
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              </g>
            ))}
            {view.starts.map((s) => (
              <g key={s.key} transform={`translate(${s.pt[0].toFixed(1)} ${s.pt[1].toFixed(1)})`}>
                <circle r={6} fill="var(--card-bg)" stroke="var(--card-fg)" strokeWidth={2} />
                {s.key === 'home' ? <circle r={2.2} fill="var(--card-fg)" /> : <path d="M-2.6 1.6 0 -3 2.6 1.6Z" fill="var(--card-fg)" />}
              </g>
            ))}
            <g transform={`translate(${view.resort[0].toFixed(1)} ${view.resort[1].toFixed(1)})`}>
              <circle r={13} fill="color-mix(in srgb, var(--card-acc) 22%, transparent)" className="rm-pulse" />
              <circle r={7} fill="var(--card-acc)" stroke="var(--card-bg)" strokeWidth={2.5} />
            </g>
          </svg>
          <div aria-hidden data-audit-text="yes" className="pointer-events-none absolute inset-0">
            {view.placed
              .filter((pl) => pl.place.kind === 'village')
              .map((pl) => (
                <span key={`dot-${pl.place.id}`} className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--card-fg2)]" style={{ left: pl.x, top: pl.y }} />
              ))}
            {view.placed.map((pl) => {
              const { place } = pl
              const own = place.id === 'resort' || place.id.startsWith('from-')
              return (
                <span
                  key={place.id}
                  className={cn('absolute leading-[1.3] whitespace-nowrap', HALO, own ? 'text-[var(--card-fg)]' : 'text-[var(--card-fg2)]')}
                  style={{ ...labelAnchor(pl), fontSize: place.kind === 'city' ? 15 : place.kind === 'town' ? 14 : 13, fontWeight: place.kind === 'city' ? 650 : place.kind === 'town' ? 600 : 450 }}
                >
                  {place.name}
                </span>
              )
            })}
          </div>
        </>
      ) : null}
      <p className="hud absolute top-3 left-3.5 m-0 text-[var(--card-fg2)]">{data.legs.some((l) => l.road) ? 'Road routes' : 'Straight lines, not routes'}</p>
    </div>
  )
}

/** Roads draw themselves in once; under reduced motion everything is simply there. */
const CSS = `
@keyframes rm-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes rm-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rm-pulse { 0%, 100% { transform: scale(0.85); opacity: 0.9; } 50% { transform: scale(1.25); opacity: 0.35; } }
.rm-draw .rm-road { stroke-dasharray: 1 1; stroke-dashoffset: 1; animation: rm-draw 1200ms cubic-bezier(0.22, 0.8, 0.26, 1) both; }
.rm-draw .rm-fade { animation: rm-fade 500ms ease-out both; }
.rm-pulse { transform-box: fill-box; transform-origin: center; animation: rm-pulse 2.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .rm-draw .rm-road, .rm-draw .rm-fade { animation: none; stroke-dasharray: none; } .rm-pulse { animation: none; } }
`
