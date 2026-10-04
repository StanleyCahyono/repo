'use client'
/**
 * The journey stage: tries the online MapLibre map and falls back to the offline schematic when tiles are
 * unreachable. Overlays a glass route card (way to go, time, distance, a fill bar while a drive draws in) and a small
 * footer that credits the road data — or, when a road leg has no geometry, says so and links to directions instead of
 * drawing a straight line. The camera padding grows to clear both overlays, measured live.
 *
 * The map is decorative for assistive tech: the sheet carries the same journey as an ordered list.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowUpRight } from 'lucide-react'
import type { UnitPrefs } from '@/lib/domain/types'
import { formatDistance, formatDuration } from '@/lib/domain/units'
import { cn } from '@/lib/ui/cn'
import { SchematicJourney, type MapPadding } from './schematic-journey'
import { missingRoads, type Journey } from './journey-model'

const MapLibreJourney = dynamic(() => import('./maplibre-journey'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-surface-2" />,
})

export interface JourneyMapProps {
  journey: Journey | null
  home: { lat: number; lon: number; name: string }
  context: readonly { lat: number; lon: number }[]
  replay: number
  reduced: boolean
  /** Base camera padding (the side panel); top and bottom grow to clear the overlays. */
  padding: MapPadding
  units: UnitPrefs
  resortName: string | null
  /** Phone / tablet layout: the route card spans the top. */
  compact: boolean
  className?: string
  describedBy?: string
}

export function JourneyMap({ journey, home, context, replay, reduced, padding, units, resortName, compact, className, describedBy }: JourneyMapProps) {
  const [engine, setEngine] = useState<'maplibre' | 'schematic'>('maplibre')
  const [missing, setMissing] = useState(0)
  const bar = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const [clear, setClear] = useState({ top: 0, bottom: 0 })

  const onFail = useCallback(() => setEngine('schematic'), [])
  const onProgress = useCallback((f: number) => {
    if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`
  }, [])

  // Measure the overlays so the camera frames the journey in the clear space between them.
  useEffect(() => {
    const root = box.current
    if (!root) return
    const measure = () => {
      const r = root.getBoundingClientRect()
      const c = card.current?.getBoundingClientRect()
      const f = foot.current?.getBoundingClientRect()
      const top = c && c.height ? Math.round(c.bottom - r.top + 12) : 0
      const bottom = f && f.height ? Math.round(r.bottom - f.top + 10) : 0
      setClear((p) => (Math.abs(p.top - top) > 2 || Math.abs(p.bottom - bottom) > 2 ? { top, bottom } : p))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    if (card.current) ro.observe(card.current)
    if (foot.current) ro.observe(foot.current)
    return () => ro.disconnect()
  }, [journey, compact, missing])

  const pad: MapPadding = {
    left: padding.left,
    right: padding.right,
    top: Math.max(padding.top, clear.top),
    bottom: Math.max(padding.bottom, clear.bottom),
  }

  const drive = journey?.mode === 'drive' ? journey.legs[0] : null
  const air = journey?.legs.find((l) => l.kind === 'air') ?? null
  const groundMinutes = journey?.mode === 'fly' ? journey.legs.filter((l) => l.kind !== 'air').reduce<number | null>((sum, l) => (sum == null || l.minutes == null ? null : sum + l.minutes), 0) : null
  const lostUrl = missingRoads(journey).find((l) => l.directionsUrl)?.directionsUrl ?? null

  const head = !journey ? 'Standing by' : drive ? (drive.geometry === 'road' ? 'Drive · road route' : 'Drive') : air ? `Fly · ${air.fromLabel} → ${air.toLabel}` : 'Fly'
  const time = drive ? formatDuration(drive.minutes) : groundMinutes != null ? formatDuration(groundMinutes) : null
  const route = journey ? `${home.name} → ${resortName ?? ''}` : `${home.name} · where to?`
  const meta = drive ? formatDistance(drive.km, units) : journey?.mode === 'fly' ? (time ? 'time on the ground' : 'flight times not shown') : null

  return (
    <div ref={box} className={cn('absolute inset-0', className)}>
      <div
        className="absolute inset-0"
        role="img"
        aria-label={journey ? `Map of the journey from ${home.name} to ${resortName}. The journey steps are listed beside it.` : `Map centred on ${home.name}.`}
        aria-describedby={describedBy}
      >
        {engine === 'maplibre' ? (
          <MapLibreJourney journey={journey} home={home} replay={replay} reduced={reduced} padding={pad} onFail={onFail} onProgress={onProgress} onMissing={setMissing} />
        ) : (
          <SchematicJourney
            journey={journey}
            home={home}
            context={context}
            replay={replay}
            reduced={reduced}
            padding={pad}
            distanceUnit={units.distance === 'km' ? 'km' : 'mi'}
            onProgress={onProgress}
            onMissing={setMissing}
          />
        )}
      </div>

      {/* Route card */}
      <div
        ref={card}
        aria-hidden
        className={cn(
          'glass-strong pointer-events-none absolute flex flex-col gap-1 rounded-[18px] px-4 py-3',
          compact ? 'top-3 right-3 left-3 sm:right-auto sm:w-[340px]' : 'top-4 right-4 w-[300px] xl:w-[340px]',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="hud flex min-w-0 items-center gap-2 text-[11px] text-teal">
            <span className="size-1.5 shrink-0 rounded-full bg-teal" />
            <span className="min-w-0">{head}</span>
          </span>
          {time ? <span className="tnum shrink-0 text-[15px] font-semibold text-ink">{time}</span> : null}
        </div>
        <p className="m-0 text-[14px] leading-snug font-semibold tracking-[-0.01em] text-ink">
          {route}
          {meta ? <span className="font-normal text-ink-2"> · {meta}</span> : null}
        </p>
        {drive && drive.geometry === 'road' ? (
          <span key={`${journey?.key}-${replay}`} className="relative mt-1 block h-1 overflow-hidden rounded-full bg-ink/10">
            <span ref={bar} className="absolute inset-0 origin-left rounded-full bg-teal" style={{ transform: 'scaleX(0)' }} />
          </span>
        ) : null}
      </div>

      {/* Footer: road credit, or the honest note when a road could not be drawn */}
      <div ref={foot} className={cn('absolute flex max-w-[calc(100%-24px)]', compact ? 'bottom-10 left-3' : 'bottom-4')} style={compact ? undefined : { left: padding.left }}>
        {journey && missing ? (
          <p className="glass-strong m-0 flex flex-wrap items-center gap-x-2 rounded-[12px] px-3 py-1.5 text-[12px] leading-snug text-ink-2">
            <span>Road route not available{engine === 'schematic' ? ' offline' : ''}</span>
            {lostUrl ? (
              <a href={lostUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-teal hover:underline">
                Directions <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            ) : null}
          </p>
        ) : journey ? (
          <p aria-hidden className="glass-strong m-0 rounded-[10px] px-2.5 py-1 text-[12px] leading-snug text-ink-2">
            Roads © OpenStreetMap · OSRM
            {journey.mode === 'fly' ? <span className="hidden sm:inline"> · flight arc illustrative</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  )
}
