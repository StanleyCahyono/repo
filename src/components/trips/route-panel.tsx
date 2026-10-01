'use client'
/**
 * Route panel for the trip planner hero: a schematic of how you get there — drive or fly — drawn over decorative
 * contours, with HUD chips for the known numbers and Uber-style ride options to switch between the two.
 *
 * Honesty: it is a schematic (labelled "not to scale"), not a map or live routing. Drive times are the curated
 * estimates with your winter buffer; the flight leg is never timed or priced here — only your own itinerary in the
 * travel section can complete the door-to-door total. The glyph glides along the line once per loop; under reduced
 * motion it sits still mid-route.
 */
import { useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { ArrowRight, Car, Plane } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { TopoArt } from '@/components/ui/topo'
import { duration } from './format'

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
}

type P = [number, number]
const cubic = (p0: P, p1: P, p2: P, p3: P, u: number): P => {
  const v = 1 - u
  return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]
}

const DRIVE: P[] = [
  [13, 78],
  [42, 84],
  [50, 26],
  [84, 27],
]
const FLY_GROUND_A: P[] = [
  [9, 82],
  [13, 80],
  [17, 76],
  [21, 71],
]
const FLY_AIR: P[] = [
  [21, 71],
  [30, 8],
  [62, 4],
  [74, 31],
]
const FLY_GROUND_B: P[] = [
  [74, 31],
  [79, 30],
  [84, 28],
  [88, 26],
]
/** Path in pixels for a measured box (so strokes and the draw-in stay uniform at any aspect ratio). */
const pathIn = (c: P[], w: number, h: number) => {
  const p = c.map(([x, y]) => `${((x / 100) * w).toFixed(1)},${((y / 100) * h).toFixed(1)}`)
  return `M${p[0]} C${p[1]} ${p[2]} ${p[3]}`
}

function Node({ at, label, sub, strong, place }: { at: P; label: string; sub?: string; strong?: boolean; place?: 'above' | 'below' }) {
  const above = place ? place === 'above' : at[1] > 50
  return (
    <div className="absolute" style={{ left: `${at[0]}%`, top: `${at[1]}%` }}>
      <span aria-hidden className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-full', strong ? 'size-3.5 bg-teal shadow-[0_0_0_3px_var(--surface),0_0_14px_var(--teal)]' : 'size-2.5 bg-ink-chip shadow-[0_0_0_2.5px_var(--surface)]')} />
      <span className={cn('glass-strong absolute flex -translate-x-1/2 flex-col items-center rounded-[12px] px-2.5 py-1.5 whitespace-nowrap', above ? 'bottom-3' : strong ? 'top-3' : 'top-2.5')}>
        <span className="text-[12.5px] leading-tight font-semibold text-ink">{label}</span>
        {sub ? <span className="font-mono text-[11px] leading-tight tracking-[0.08em] text-ink-2 uppercase">{sub}</span> : null}
      </span>
    </div>
  )
}

function Glyph({ curve, mode, size }: { curve: P[]; mode: 'drive' | 'fly'; size: { w: number; h: number } }) {
  const reduce = useReducedMotion()
  const u = useMotionValue(0.5)
  useEffect(() => {
    if (reduce) {
      u.set(0.5)
      return
    }
    u.set(0)
    const c = animate(u, 1, { duration: mode === 'fly' ? 3.6 : 3, ease: [0.45, 0, 0.2, 1], repeat: Infinity, repeatDelay: 1.4, delay: 0.9 })
    return () => c.stop()
  }, [reduce, mode, u])
  const x = useTransform(u, (v) => (cubic(curve[0], curve[1], curve[2], curve[3], v)[0] / 100) * size.w)
  const y = useTransform(u, (v) => (cubic(curve[0], curve[1], curve[2], curve[3], v)[1] / 100) * size.h)
  const rotate = useTransform(u, (v) => {
    const a = cubic(curve[0], curve[1], curve[2], curve[3], Math.max(0, v - 0.01))
    const b = cubic(curve[0], curve[1], curve[2], curve[3], Math.min(1, v + 0.01))
    return (Math.atan2(((b[1] - a[1]) / 100) * size.h, ((b[0] - a[0]) / 100) * size.w) * 180) / Math.PI
  })
  // Fade in and out at the ends so the glyph never parks on top of a node label.
  const opacity = useTransform(u, [0, 0.06, 0.94, 1], reduce ? [1, 1, 1, 1] : [0, 1, 1, 0])
  const Icon = mode === 'fly' ? Plane : Car
  return (
    <motion.div aria-hidden className="pointer-events-none absolute top-0 left-0" style={{ x, y, opacity }}>
      <motion.span style={{ rotate: mode === 'fly' ? rotate : 0 }} className="absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink-chip text-on-ink-chip shadow-[0_6px_16px_-4px_rgb(19_32_44/0.5)]">
        <Icon className={cn('size-4', mode === 'fly' && 'rotate-45')} strokeWidth={2} />
      </motion.span>
    </motion.div>
  )
}

export function RoutePanel({ data }: { data: RouteData }) {
  const [mode, setMode] = useState<'drive' | 'fly'>(data.fly ? data.initial : 'drive')
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const d = (c: P[]) => pathIn(c, size.w, size.h)
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

  return (
    <section aria-labelledby="route-title" className="glass relative flex min-h-[420px] flex-col overflow-hidden rounded-[32px] md:min-h-[460px]">
      <h2 id="route-title" className="sr-only">
        How you get there
      </h2>
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(160deg,color-mix(in_srgb,var(--glacier)_70%,transparent),transparent_70%)]" />
      <div aria-hidden className="absolute inset-0 opacity-80">
        <TopoArt seed={data.resortId} density={1.1} />
      </div>

      {/* Chips */}
      <div className="relative flex flex-wrap gap-2 px-4 pt-4">
        {chips.map((c) => (
          <span key={c} className="glass-strong rounded-[14px] px-3 py-2 text-[13px] font-medium text-ink tnum">
            {c}
          </span>
        ))}
        {data.season ? (
          <span className="glass-strong inline-flex items-center gap-2 rounded-[14px] px-3 py-2 text-[13px] font-medium text-ink">
            <i aria-hidden className={cn('size-2 rounded-full', data.season.tone === 'estimate' ? 'bg-copper' : data.season.tone === 'opened' ? 'bg-positive' : data.season.tone === 'unknown' ? 'bg-ink-3' : 'bg-teal')} />
            {data.season.text}
          </span>
        ) : null}
      </div>

      {/* Schematic */}
      <div ref={boxRef} className="relative mx-4 min-h-[230px] flex-1 md:min-h-[260px]" role="img" aria-label={mode === 'drive' ? `Schematic: drive from ${data.homeName} to ${data.resortName}${canDrive ? `, about ${duration(data.drive.winterMinutes)} with the winter buffer (estimate)` : ''}. Not to scale.` : `Schematic: ${data.homeName} to ${fly?.origin}, flight to ${fly?.dest ?? 'an airport not yet set'}, then ground transfer to ${data.resortName}. Not to scale; no flight times or fares shown.`}>
        {size.w ? (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden className="absolute inset-0 h-full w-full overflow-visible">
          {mode === 'drive' ? (
            <g key="drive">
              <path d={d(DRIVE)} fill="none" stroke="var(--teal)" strokeOpacity={0.25} strokeWidth={10} strokeLinecap="round" />
              <motion.path d={d(DRIVE)} fill="none" stroke="var(--teal)" strokeWidth={3} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.22, 0.8, 0.26, 1] }} />
            </g>
          ) : (
            <g key="fly">
              <motion.path d={d(FLY_GROUND_A)} fill="none" stroke="var(--teal)" strokeWidth={3} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} />
              <path d={d(FLY_AIR)} fill="none" stroke="var(--ink)" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="2 6" strokeLinecap="round" />
              <motion.path d={d(FLY_AIR)} fill="none" stroke="var(--ink-chip)" strokeWidth={2} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, delay: 0.3, ease: [0.45, 0, 0.2, 1] }} />
              <motion.path d={d(FLY_GROUND_B)} fill="none" stroke="var(--teal)" strokeWidth={3} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 1.4 }} />
            </g>
          )}
        </svg>
        ) : null}
        {mode === 'drive' ? (
          <>
            <Node at={DRIVE[0]} label={data.homeName} sub="Home" />
            <Node at={DRIVE[3]} label={data.resortName} sub="Resort" strong />
            <Glyph key="g-drive" curve={DRIVE} mode="drive" size={size} />
          </>
        ) : fly ? (
          <>
            <Node at={FLY_GROUND_A[0]} label={data.homeName} />
            <Node at={FLY_AIR[0]} label={fly.origin} sub="Origin" />
            {fly.dest ? <Node at={FLY_AIR[3]} label={fly.dest} sub="Arrive" /> : null}
            <Node at={FLY_GROUND_B[3]} label={data.resortName} strong place="above" />
            <Glyph key="g-fly" curve={FLY_AIR} mode="fly" size={size} />
          </>
        ) : null}
      </div>

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
          <span className="hud text-[11px] text-ink-3">Schematic · not to scale · no live routing</span>
          <a href="#travel" className="inline-flex h-9 items-center gap-1 text-[13px] font-medium text-teal hover:underline">
            Plan travel <ArrowRight aria-hidden className="size-3.5" />
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
