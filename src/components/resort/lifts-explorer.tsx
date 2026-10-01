'use client'
/**
 * Lifts & runs, the story view: a terrain map of the ski area beside glass cards for lifts by type and the runs
 * grouped by the resort's own difficulty signs. Where Piste bundles an OpenStreetMap snapshot (Greek Peak), every run
 * and lift is drawn in its sign's colour with the sign's shape, and tapping a line — or a name in the list, the
 * map's text alternative — shows its name, sign and mapped length.
 *
 * The map is layered: a schematic drawn from the bundled lines (or a quiet grid and the resort's position) is always
 * there and needs no network; when online, MapLibre's 3D terrain (open elevation data, satellite imagery) loads
 * lazily on top once it is on screen. Offline is a first-class state, labelled as such. No scroll-wheel zoom, so the
 * page never gets stuck scrolling the map.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { ArrowUpRight, X } from 'lucide-react'
import type { MappedLine } from '@/lib/data/lifts'
import type { PisteShape, PisteTone } from '@/lib/domain/lifts'
import { cn } from '@/lib/ui/cn'
import { PisteSymbol } from './piste-symbol'

const TerrainGl = dynamic(() => import('./terrain-map-gl'), { ssr: false, loading: () => null })

export const TONE_VAR: Record<PisteTone, string> = {
  green: 'var(--positive)',
  blue: 'var(--info)',
  red: 'var(--critical)',
  black: 'var(--ink)',
  orange: 'var(--caution)',
  neutral: 'var(--ink-3)',
}

export interface SignLegend {
  key: string
  label: string
  shape: PisteShape
  tone: PisteTone
  meaning: string
}

export interface RunChipGroup {
  sign: SignLegend
  /** '12 named runs' / '23 mapped sections' */
  count: string
  names: { name: string; ids: string[] }[]
  /** More names than shown (the full list is in the drawer below). */
  more: number
  unnamed: number
}

export interface LiftBar {
  label: string
  n: number
}

export interface LiftsExplorerProps {
  name: string
  center: { lat: number; lon: number }
  /** Bundled OpenStreetMap lines (null: none bundled for this resort). */
  lines: MappedLine[] | null
  bbox: [number, number, number, number] | null
  /** 'OpenStreetMap snapshot · 1 Oct 2026 · built in' */
  linesSource: string | null
  /** Signs that appear on the map (legend). */
  legend: SignLegend[]
  liftBars: { title: string; aside: string | null; bars: LiftBar[]; note: string | null } | null
  runs: { source: string; status: string; groups: RunChipGroup[]; empty: string | null }
  liveStatus: { url: string; label: string } | null
  units: 'metric' | 'imperial'
}

function lengthText(m: number, imperial: boolean): string {
  if (imperial) {
    const ft = m * 3.28084
    return ft < 5280 ? `${(Math.round(ft / 10) * 10).toLocaleString('en-US')} ft` : `${(ft / 5280).toFixed(1)} mi`
  }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

// ---------------------------------------------------------------------------------------------------------------------
// Schematic (always available)

interface Frame {
  vb: [number, number, number, number]
  x: (lon: number) => number
  y: (lat: number) => number
}

/** Equirectangular projection of the bbox, widened to the container's aspect ratio so overlays line up. */
function frameFor(bbox: [number, number, number, number], aspect: number): Frame {
  const [w, s, e, n] = bbox
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180)
  const x = (lon: number) => (lon - w) * k * 1000
  const y = (lat: number) => (n - lat) * 1000
  let bw = x(e)
  let bh = y(s)
  const pad = 0.1
  let ox = -bw * pad
  let oy = -bh * pad
  bw *= 1 + 2 * pad
  bh *= 1 + 2 * pad
  if (bw / bh < aspect) {
    const nw = bh * aspect
    ox -= (nw - bw) / 2
    bw = nw
  } else {
    const nh = bw / aspect
    oy -= (nh - bh) / 2
    bh = nh
  }
  return { vb: [ox, oy, bw, bh], x, y }
}

function Schematic({
  lines,
  bbox,
  selected,
  onSelect,
  center,
  name,
  imperial,
}: {
  lines: MappedLine[] | null
  bbox: [number, number, number, number] | null
  selected: Set<string>
  onSelect: (ids: string[]) => void
  center: { lat: number; lon: number }
  name: string
  imperial: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 840, h: 600 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      if (r.width && r.height) setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const aspect = size.w / size.h
  const frame = useMemo(() => (bbox ? frameFor(bbox, aspect) : null), [bbox, aspect])
  // Scale bar: one view unit is 1/1000° of latitude (≈111.3 m).
  const scale = useMemo(() => {
    if (!frame) return null
    const mPerPx = (frame.vb[2] * 111.32) / size.w
    const steps = imperial ? [500, 1000, 2000, 5280, 10560].map((ft) => ({ m: ft * 0.3048, label: ft >= 5280 ? `${ft / 5280} mi` : `${ft.toLocaleString('en-US')} ft` })) : [100, 200, 250, 500, 1000, 2000, 5000].map((m) => ({ m, label: m >= 1000 ? `${m / 1000} km` : `${m} m` }))
    const pick = steps.find((x) => x.m / mPerPx >= 70) ?? steps[steps.length - 1]
    return { px: Math.round(pick.m / mPerPx), label: pick.label }
  }, [frame, size.w, imperial])
  const any = selected.size > 0

  // One shape marker per named run, at the middle of its longest mapped section.
  const markers = useMemo(() => {
    if (!lines || !frame) return []
    const best = new Map<string, MappedLine>()
    for (const l of lines) {
      if (l.kind !== 'run' || !l.name || !l.sign) continue
      const cur = best.get(l.name)
      if (!cur || l.lengthM > cur.lengthM) best.set(l.name, l)
    }
    const [ox, oy, bw, bh] = frame.vb
    return [...best.values()].map((l) => {
      const c = l.coords[Math.floor(l.coords.length / 2)]
      return { l, left: ((frame.x(c[0]) - ox) / bw) * 100, top: ((frame.y(c[1]) - oy) / bh) * 100 }
    })
  }, [lines, frame])

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden bg-[radial-gradient(120%_90%_at_30%_10%,var(--glacier),var(--surface-2)_70%)]">
      <svg aria-hidden className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id="schematic-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="var(--topo-line)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#schematic-grid)" />
      </svg>
      {frame && lines ? (
        <>
          <svg viewBox={frame.vb.join(' ')} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={`Schematic map of ${name}'s mapped runs and lifts (list alternative beside it)`}>
            {lines.map((l) => {
              const d = `M${l.coords.map((c) => `${frame.x(c[0]).toFixed(2)},${frame.y(c[1]).toFixed(2)}`).join('L')}`
              const on = selected.has(l.id)
              const dim = any && !on
              const color = l.kind === 'lift' ? 'var(--ink)' : TONE_VAR[l.sign?.tone ?? 'neutral']
              return (
                <g key={l.id} opacity={dim ? 0.28 : 1} className="transition-opacity duration-200">
                  <path d={d} fill="none" stroke="var(--surface)" strokeWidth={on ? 9 : l.kind === 'lift' ? 5 : 6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={on ? 5 : l.kind === 'lift' ? 2 : 3}
                    strokeDasharray={l.kind === 'lift' ? '6 3' : l.sign?.key === 'unknown' ? '2 3' : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer"
                    onClick={() => onSelect(l.name ? lines.filter((x) => x.name === l.name && x.kind === l.kind).map((x) => x.id) : [l.id])}
                  />
                </g>
              )
            })}
          </svg>
          {scale ? (
            <div aria-hidden className="absolute right-4 bottom-4 flex flex-col items-end gap-2 max-sm:right-3 max-sm:bottom-3">
              <span className="hud flex flex-col items-center leading-none text-ink-2">
                <span className="text-[13px] text-teal">▲</span>N
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="hud text-ink-2">{scale.label}</span>
                <span className="h-1.5 border-x border-b border-ink-2" style={{ width: scale.px }} />
              </span>
            </div>
          ) : null}
          {markers.map(({ l, left, top }) => (
            <span
              key={l.id}
              aria-hidden
              className={cn('pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface p-[1.5px] transition-opacity duration-200 max-sm:hidden', any && !selected.has(l.id) && 'opacity-30')}
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <PisteSymbol shape={l.sign!.shape} tone={l.sign!.tone} className={l.sign!.shape === 'double-diamond' ? 'h-2 w-[15px]' : 'size-2'} />
            </span>
          ))}
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span aria-hidden className="absolute size-40 rounded-full border border-[color-mix(in_srgb,var(--teal)_25%,transparent)]" />
          <span aria-hidden className="absolute size-72 rounded-full border border-dashed border-[color-mix(in_srgb,var(--teal)_18%,transparent)]" />
          <span aria-hidden className="absolute h-px w-24 bg-[color-mix(in_srgb,var(--teal)_45%,transparent)]" />
          <span aria-hidden className="absolute h-24 w-px bg-[color-mix(in_srgb,var(--teal)_45%,transparent)]" />
          <div className="relative flex flex-col items-center gap-2">
            <span aria-hidden className="size-3.5 rounded-full border-[3px] border-teal bg-surface shadow-[0_0_0_6px_color-mix(in_srgb,var(--teal)_18%,transparent)]" />
            <span className="glass-strong hud rounded-[12px] px-3 py-1.5 text-ink">
              {name} · {Math.abs(center.lat).toFixed(3)}°{center.lat >= 0 ? 'N' : 'S'} {Math.abs(center.lon).toFixed(3)}°{center.lon >= 0 ? 'E' : 'W'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

function MapPanel(p: LiftsExplorerProps & { selected: Set<string>; onSelect: (ids: string[]) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '200px 0px' })
  const [gl, setGl] = useState<'loading' | 'live' | 'offline'>('loading')
  const reduce = useReducedMotion()
  const imperial = p.units === 'imperial'
  const sel = p.lines?.filter((l) => p.selected.has(l.id)) ?? []
  const first = sel[0] ?? null
  const total = sel.reduce((m, l) => m + l.lengthM, 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onSelect([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  return (
    <div ref={ref} className="glass relative h-[420px] overflow-hidden rounded-[32px] p-0 md:h-[600px]">
      <Schematic lines={p.lines} bbox={p.bbox} selected={p.selected} onSelect={p.onSelect} center={p.center} name={p.name} imperial={imperial} />
      {inView ? (
        <motion.div initial={false} animate={{ opacity: gl === 'live' ? 1 : 0 }} transition={{ duration: reduce ? 0 : 0.6 }} className={cn('absolute inset-0', gl !== 'live' && 'pointer-events-none')}>
          <TerrainGl center={p.center} lines={p.lines} bbox={p.bbox} selected={[...p.selected]} onSelect={p.onSelect} onState={setGl} />
        </motion.div>
      ) : null}

      <p className="hud absolute top-3 left-3 z-[2] m-0 max-w-[calc(100%-24px)] rounded-[10px] bg-glass-strong px-2.5 py-1.5 text-ink-2 md:max-w-[60%]">
        {gl === 'live'
          ? `3D terrain · open elevation data${p.lines ? ' · OpenStreetMap lines' : ''}`
          : gl === 'offline'
            ? `Offline · schematic${p.lines ? ', lines to scale' : ''}`
            : `Schematic${p.lines ? ', lines to scale' : ''} · 3D terrain loads online`}
      </p>

      {p.legend.length ? (
        <ul aria-label="Map key" className="glass-strong absolute top-3 right-3 z-[2] m-0 hidden list-none flex-col gap-1.5 rounded-[16px] px-3.5 py-3 text-[12px] text-ink sm:flex">
          {p.legend.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <PisteSymbol shape={s.shape} tone={s.tone} />
              {s.label}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <i aria-hidden className="inline-block w-4 border-t-2 border-dashed border-ink" />
            Lift
          </li>
        </ul>
      ) : null}

      <AnimatePresence>
        {first ? (
          <motion.div
            key={first.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            role="status"
            className="absolute bottom-3 left-3 z-[3] flex max-w-[calc(100%-24px)] items-start gap-3 rounded-[18px] bg-ink-chip px-4 py-3 text-on-ink-chip shadow-[0_12px_30px_rgb(19_32_44/0.3)]"
          >
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface">
              {first.sign ? <PisteSymbol shape={first.sign.shape} tone={first.sign.tone} className={first.sign.shape === 'double-diamond' ? 'h-3 w-[22px]' : 'size-3'} /> : <i aria-hidden className="w-3.5 border-t-2 border-dashed border-ink" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{first.name ?? (first.kind === 'lift' ? 'Unnamed lift' : 'Unnamed run section')}</span>
              <span className="block text-[13px] text-on-ink-chip-2">
                {first.label}
                {first.sign ? ` · ${first.sign.meaning}` : ''}
              </span>
              <span className="hud mt-1 block text-on-ink-chip-accent">
                {sel.length > 1 ? `${sel.length} mapped sections · ` : ''}
                {lengthText(total, imperial)} mapped length
              </span>
            </span>
            <button type="button" onClick={() => p.onSelect([])} aria-label="Clear selection" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--on-ink-chip)_12%,transparent)]">
              <X aria-hidden className="size-4" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export function LiftsExplorer(p: LiftsExplorerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const select = (ids: string[]) => setSelected((cur) => (ids.length && ids.every((i) => cur.has(i)) && cur.size === ids.length ? new Set() : new Set(ids)))
  const maxBar = Math.max(1, ...(p.liftBars?.bars.map((b) => b.n) ?? [1]))

  return (
    <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]">
      <MapPanel {...p} selected={selected} onSelect={select} />
      <div className="flex min-w-0 flex-col gap-3.5">
        <section className="glass flex flex-col gap-3.5 rounded-[28px] p-5 md:p-[22px]" aria-labelledby="lift-types-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 id="lift-types-title" className="hud m-0 tracking-[0.14em] text-ink-2">
              {p.liftBars?.title ?? 'Lifts by type'}
            </h3>
            {p.liftBars?.aside ? <span className="hud text-ink-2">{p.liftBars.aside}</span> : null}
          </div>
          {p.liftBars?.bars.length ? (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {p.liftBars.bars.map((b, i) => (
                <li key={b.label} className="grid grid-cols-[96px_minmax(0,1fr)_32px] items-center gap-3">
                  <span className="text-[13px] text-ink">{b.label}</span>
                  <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]">
                    <motion.span
                      className="block h-full origin-left rounded-full bg-teal"
                      style={{ width: `${(b.n / maxBar) * 100}%` }}
                      initial={{ scaleX: 0 }}
                      whileInView={{ scaleX: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.8, delay: i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                  </span>
                  <span className="text-right text-[14px] font-semibold text-ink tnum">{b.n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13.5px] text-ink-2">Lift types are not on file for {p.name}.</p>
          )}
          {p.liftBars?.note ? <p className="m-0 text-[12.5px] text-ink-2">{p.liftBars.note}</p> : null}
        </section>

        <section className="glass flex min-h-0 flex-1 flex-col gap-3 rounded-[28px] p-5 md:p-[22px]" aria-labelledby="runs-chips-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 id="runs-chips-title" className="hud m-0 tracking-[0.14em] text-ink-2">
              {p.runs.source}
            </h3>
            <span className="hud text-ink-2">{p.runs.status}</span>
          </div>
          {p.runs.groups.length ? (
            <div className="flex max-h-[300px] flex-col gap-3.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {p.runs.groups.map((g) => (
                <div key={g.sign.key} className="flex flex-col gap-1.5">
                  <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <PisteSymbol shape={g.sign.shape} tone={g.sign.tone} />
                    {g.sign.label}
                    <span className="hud ml-auto font-normal text-ink-2">{g.count}</span>
                  </p>
                  <ul className="m-0 flex list-none flex-wrap gap-[5px] p-0" aria-label={`${g.sign.label} runs`}>
                    {g.names.map((n) => {
                      const on = n.ids.length > 0 && n.ids.every((i) => selected.has(i))
                      return (
                        <li key={n.name}>
                          {n.ids.length ? (
                            <button
                              type="button"
                              aria-pressed={on}
                              onClick={() => select(n.ids)}
                              className={cn(
                                'rounded-[10px] px-2.5 py-1.5 text-[12.5px] transition-colors duration-150',
                                on ? 'bg-ink-chip text-on-ink-chip' : 'bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-ink hover:bg-[color-mix(in_srgb,var(--teal)_16%,transparent)]',
                              )}
                            >
                              {n.name}
                            </button>
                          ) : (
                            <span className="inline-block rounded-[10px] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-2.5 py-1.5 text-[12.5px] text-ink">{n.name}</span>
                          )}
                        </li>
                      )
                    })}
                    {g.more ? <li className="px-1.5 py-1.5 text-[12.5px] text-ink-2">+{g.more} more in the full list</li> : null}
                    {g.unnamed ? <li className="px-1.5 py-1.5 text-[12.5px] text-ink-2">{g.unnamed} unnamed sections</li> : null}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 text-[13.5px] text-ink-2">{p.runs.empty}</p>
          )}
          {p.lines ? <p className="m-0 text-[12.5px] text-ink-2">Tap a run or lift on the map, or a name here, for its sign and mapped length.</p> : null}
        </section>

        {p.liveStatus ? (
          <a
            href={p.liveStatus.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 items-center justify-between gap-3 rounded-[20px] bg-ink-chip px-[18px] py-3.5 text-[14px] font-semibold text-on-ink-chip transition-transform duration-150 hover:-translate-y-px"
          >
            {p.liveStatus.label}
            <ArrowUpRight aria-hidden className="size-4 shrink-0" />
            <span className="sr-only"> (opens a new tab)</span>
          </a>
        ) : null}
      </div>
    </div>
  )
}
