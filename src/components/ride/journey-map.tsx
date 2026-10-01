'use client'
/**
 * The journey stage: tries the online MapLibre map and falls back to the offline schematic (same choreography) when
 * tiles are unreachable. Overlays a mission-control telemetry card (current leg, segmented progress) and a status
 * badge that always says how precise the line is ("approximate route", "illustrative flight arc", "road geometry").
 *
 * The map is decorative for assistive tech: the sheet carries the same journey as an ordered list.
 */
import { useCallback, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/ui/cn'
import { SchematicJourney, type MapPadding } from './schematic-journey'
import { LEG_TITLE, type Journey } from './journey-model'

const MapLibreJourney = dynamic(() => import('./maplibre-journey'), { ssr: false, loading: () => <div className="absolute inset-0 animate-pulse bg-surface-3/50" /> })

export interface JourneyMapProps {
  journey: Journey | null
  home: { lat: number; lon: number; name: string }
  context: readonly { lat: number; lon: number }[]
  replay: number
  reduced: boolean
  padding: MapPadding
  distanceUnit: 'km' | 'mi'
  resortName: string | null
  /** Where the telemetry card sits (desktop: top-right; phone: top-left under the bar). */
  compact: boolean
  className?: string
  describedBy?: string
}

type Phase = 'overview' | 'leg' | 'approach' | 'done'

export function JourneyMap({ journey, home, context, replay, reduced, padding, distanceUnit, resortName, compact, className, describedBy }: JourneyMapProps) {
  const [engine, setEngine] = useState<'maplibre' | 'schematic'>('maplibre')
  const [badge, setBadge] = useState<string>('')
  const [phase, setPhase] = useState<{ phase: Phase; leg: number }>({ phase: 'overview', leg: 0 })
  const bars = useRef<(HTMLSpanElement | null)[]>([])

  const onFail = useCallback(() => setEngine('schematic'), [])
  const onPhase = useCallback((p: { phase: Phase; leg: number }) => setPhase(p), [])
  const onProgress = useCallback((leg: number, f: number) => {
    const b = bars.current[leg]
    if (b) b.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`
  }, [])

  const schematicBadge = journey
    ? journey.mode === 'fly'
      ? 'Offline schematic · illustrative flight arc · ground legs approximate'
      : 'Offline schematic · approximate route, straight line'
    : 'Offline schematic · map tiles unavailable'
  const status = engine === 'schematic' ? schematicBadge : badge

  const leg = journey?.legs[Math.min(phase.leg, (journey?.legs.length ?? 1) - 1)]
  const head =
    !journey
      ? 'Standing by'
      : phase.phase === 'overview'
        ? 'Plotting route'
        : phase.phase === 'leg' && leg
          ? `Leg ${phase.leg + 1}/${journey.legs.length} · ${LEG_TITLE[leg.kind]}`
          : phase.phase === 'done'
            ? 'Arrived'
            : 'Approach'
  const sub =
    !journey
      ? `${home.name} · where to?`
      : phase.phase === 'leg' && leg
        ? `${leg.fromLabel} → ${leg.toLabel}`
        : phase.phase === 'overview'
          ? `${journey.legs[0].fromLabel} → ${resortName ?? ''}`
          : `${phase.phase === 'done' ? 'At' : 'Arriving'} · ${resortName ?? ''}`

  return (
    <div className={cn('absolute inset-0', className)} role="img" aria-label={journey ? `Animated map of the journey from ${home.name} to ${resortName}. The journey steps are listed beside it.` : `Map centred on ${home.name}.`} aria-describedby={describedBy}>
      {engine === 'maplibre' ? (
        <MapLibreJourney journey={journey} home={home} replay={replay} reduced={reduced} padding={padding} onFail={onFail} onBadge={setBadge} onPhase={onPhase} onProgress={onProgress} />
      ) : (
        <SchematicJourney journey={journey} home={home} context={context} replay={replay} reduced={reduced} padding={padding} distanceUnit={distanceUnit} onPhase={onPhase} onProgress={onProgress} />
      )}

      {/* Telemetry */}
      <div
        aria-hidden
        className={cn(
          'glass-strong pointer-events-none absolute flex flex-col gap-2 rounded-[18px] px-3.5 py-3',
          compact ? 'top-3 right-3 left-3 sm:right-auto sm:w-[300px]' : 'top-4 right-4 w-[min(340px,calc(100%-500px))] min-w-[260px]',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="hud flex items-center gap-2 text-[11px] text-teal">
            <span className={cn('size-1.5 rounded-full bg-teal', phase.phase !== 'done' && journey ? 'animate-pulse' : '')} />
            {head}
          </span>
          {journey ? <span className="hud text-[11px] text-ink-2">{journey.mode === 'fly' ? 'Fly' : 'Drive'}</span> : null}
        </div>
        <span className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">{sub}</span>
        {journey ? (
          <div className="flex gap-1">
            {journey.legs.map((l, i) => (
              <span key={`${journey.key}-${replay}-${i}`} className="relative h-1 flex-1 overflow-hidden rounded-full bg-ink/10" style={{ flexGrow: l.kind === 'air' ? 2 : 1 }}>
                <span
                  ref={(n) => void (bars.current[i] = n)}
                  className="absolute inset-0 origin-left rounded-full bg-teal shadow-[0_0_8px_var(--teal)]"
                  style={{ transform: 'scaleX(0)' }}
                />
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Precision badge */}
      {status ? (
        <p
          className={cn(
            'hud glass-strong absolute max-w-[calc(100%-24px)] rounded-[10px] px-2.5 py-1.5 text-[10.5px] text-ink-2',
            compact ? 'bottom-12 left-3' : 'bottom-4',
          )}
          style={compact ? undefined : { left: padding.left }}
        >
          {status}
        </p>
      ) : null}
    </div>
  )
}
