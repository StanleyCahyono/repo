'use client'
/**
 * Route panel for the trip planner hero: a real map of how you get there — drive or fly — with HUD chips for the
 * known numbers and Uber-style ride options to switch between the two.
 *
 * Honesty: drives follow the road only where a route is on file (OpenStreetMap, bundled) and are never drawn as a
 * straight line; drive times are the curated estimates with your winter buffer; the flight is a still arc, never
 * timed or priced here — only your own itinerary in the travel section can complete the door-to-door total.
 */
import { useState } from 'react'
import { ArrowRight, Car, Plane } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { TopoArt } from '@/components/ui/topo'
import { duration } from './format'
import { TripMap, type TripMapGeo } from './trip-map'

export interface RouteData {
  homeName: string
  resortId: string
  resortName: string
  drive: { minutes: number | null; winterMinutes: number | null; km: string | null; isEstimate: boolean }
  /** null when the resort has no airport on file. */
  fly: {
    origin: string
    originDriveMinutes: number | null
    dest: string | null
    transferMinutes: number | null
    /** Door-to-door when your itinerary times the flight; otherwise null. */
    total: number | null
    /** Ground legs and buffers known before the flight itself. */
    known: number
  } | null
  /** e.g. "Opening est. 28 Nov – 5 Dec" (from the season windows). */
  season: { text: string; tone: 'estimate' | 'announced' | 'opened' | 'unknown' } | null
  initial: 'drive' | 'fly'
  winterPct: number
  geo: TripMapGeo
}

export function RoutePanel({ data }: { data: RouteData }) {
  const [mode, setMode] = useState<'drive' | 'fly'>(data.fly ? data.initial : 'drive')
  const canDrive = data.drive.minutes !== null
  const fly = data.fly
  const chips: string[] = []
  if (mode === 'drive') {
    chips.push(canDrive ? `Drive · ${duration(data.drive.winterMinutes)} (est.)` : 'Drive · no estimate on file')
    if (data.drive.km) chips.push(data.drive.km)
  } else if (fly) {
    chips.push(`Fly · ${fly.origin} → ${fly.dest ?? 'airport not set'}`)
    if (fly.dest) chips.push(fly.transferMinutes !== null ? `${fly.dest} → ${data.resortName} ${duration(fly.transferMinutes)} (est.)` : `${fly.dest} → ${data.resortName} time unknown`)
  }
  const roads = mode === 'drive' ? !!data.geo.roads.drive : !!(data.geo.roads.toOrigin || data.geo.roads.fromDest)
  const mapLabel =
    mode === 'drive'
      ? `Map: drive from ${data.homeName} to ${data.resortName}${canDrive ? `, about ${duration(data.drive.winterMinutes)} with the winter buffer (estimate)` : ''}.`
      : `Map: ${data.homeName} to ${fly?.origin}, flight to ${fly?.dest ?? 'an airport not yet set'}, then ground transfer to ${data.resortName}. No flight times or fares shown.`

  return (
    <section aria-labelledby="route-title" className="glass relative flex min-h-[440px] flex-col overflow-hidden rounded-[32px] md:min-h-[480px]">
      <h2 id="route-title" className="sr-only">
        How you get there
      </h2>
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(160deg,color-mix(in_srgb,var(--glacier)_70%,transparent),transparent_70%)]" />
      <div aria-hidden className="absolute inset-0 opacity-50">
        <TopoArt seed={data.resortId} density={0.9} />
      </div>

      {/* Chips */}
      <div className="relative flex flex-wrap gap-2 px-4 pt-4">
        {chips.map((c) => (
          <motion.span key={c} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={t.select} className="glass-strong rounded-[14px] px-3 py-2 text-[13px] font-medium text-ink tnum">
            {c}
          </motion.span>
        ))}
        {data.season ? (
          <motion.span layout="position" transition={t.select} className="glass-strong inline-flex items-center gap-2 rounded-[14px] px-3 py-2 text-[13px] font-medium text-ink">
            <i aria-hidden className={cn('size-2 rounded-full', data.season.tone === 'estimate' ? 'bg-copper' : data.season.tone === 'opened' ? 'bg-positive' : data.season.tone === 'unknown' ? 'bg-ink-3' : 'bg-teal')} />
            {data.season.text}
          </motion.span>
        ) : null}
      </div>

      {/* Map */}
      <TripMap geo={data.geo} mode={mode} label={mapLabel} className="mx-2 mt-1 min-h-[250px] flex-1 md:mx-3 md:min-h-[280px]" />

      {/* Ride options */}
      <div className="relative m-3 flex flex-col gap-1 rounded-[24px] bg-glass-strong p-1.5 shadow-[0_10px_30px_-12px_rgb(19_32_44/0.35)] md:m-4">
        <div role="radiogroup" aria-label="Show route" className="grid gap-1 sm:grid-cols-2">
          <Option on={mode === 'drive'} onClick={() => setMode('drive')} Icon={Car} title="Drive" value={(canDrive ? duration(data.drive.winterMinutes) : null) ?? 'Unknown'} note={canDrive ? `one way · incl. ${data.winterPct}% winter buffer · estimate` : 'no drive estimate on file'} />
          <Option
            on={mode === 'fly'}
            disabled={!fly}
            onClick={() => setMode('fly')}
            Icon={Plane}
            title={fly ? `Fly from ${fly.origin}` : 'Fly'}
            value={fly ? ((fly.total !== null ? duration(fly.total) : null) ?? 'Unknown') : 'No airport'}
            note={fly ? (fly.total !== null ? 'door to door · your itinerary + estimates' : `${duration(fly.known)}+ before the flight · add your flight`) : 'no airport on file for this resort'}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 pt-1 pb-1">
          <span className="hud text-ink-3">{roads ? 'Roads © OpenStreetMap · estimated times' : 'Estimated times · no live routing'}</span>
          <a href="#travel" className="group/pt inline-flex h-9 items-center gap-1 text-[13px] font-medium text-teal hover:underline">
            Plan travel <ArrowRight aria-hidden className="size-3.5 transition-transform duration-150 group-hover/pt:translate-x-0.5" />
          </a>
        </div>
      </div>
    </section>
  )
}

function Option({ on, disabled, onClick, Icon, title, value, note }: { on: boolean; disabled?: boolean; onClick: () => void; Icon: typeof Car; title: string; value: string; note: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn('relative flex min-h-[60px] items-center gap-3 rounded-[18px] px-3 py-2 text-left transition-colors duration-150 disabled:opacity-50', on ? 'text-on-ink-chip' : 'text-ink hover:bg-ink/[0.05]')}
    >
      {on ? <motion.span layoutId="route-option" transition={t.spring} aria-hidden className="absolute inset-0 rounded-[18px] bg-ink-chip" /> : null}
      <span className={cn('relative flex size-9 shrink-0 items-center justify-center rounded-full', on ? 'bg-on-ink-chip/15' : 'bg-ink/[0.06]')}>
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[14px] font-semibold">{title}</span>
          <span className="text-[15px] font-semibold tnum">{value}</span>
        </span>
        <span className={cn('block text-[12px] leading-snug', on ? 'text-on-ink-chip-2' : 'text-ink-2')}>{note}</span>
      </span>
    </button>
  )
}
