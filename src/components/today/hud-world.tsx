'use client'
/**
 * World season: a slim glass bar until you hover (with a short intent delay), focus or tap it; then the Sep → Jul
 * timeline slides open, with the answer pinned on "today". Open / announced / Piste-estimate / end-not-known spans,
 * North and South. From 1024px it is a three-column chart (names · tracks · notes); below that each resort is one
 * row (name and note above a full-width track), so phones never scroll it sideways. The spans are decorative; each
 * row's note carries the same facts as text (and a list for screen readers).
 *
 * Motion: the body opens on a grid-rows track while its content fades and settles (transform/opacity); the spans sweep
 * in from the left row by row (scaleX), and everything collapses back quietly. Reduced motion shows it at once.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, Globe2 } from 'lucide-react'
import type { SeasonSpan, WorldRow, WorldSeason } from '@/lib/data/today-hud'
import { cn } from '@/lib/ui/cn'
import { useScrollEdges } from '@/lib/ui/use-scroll-edges'

const SPAN_CLASS: Record<SeasonSpan['kind'], string> = {
  open: 'top-2.5 h-3 bg-teal shadow-[0_4px_12px_color-mix(in_srgb,var(--teal)_35%,transparent)]',
  announced: 'top-2.5 h-3 bg-[color-mix(in_srgb,var(--teal)_32%,transparent)] shadow-[inset_0_1px_0_rgb(255_255_255/0.7)]',
  fade: 'top-2.5 h-3 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--teal)_55%,transparent),transparent)]',
  estimate:
    'top-2.5 h-3 bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--copper)_55%,transparent)_0_3px,transparent_3px_7px)] [mask-image:linear-gradient(90deg,#000_40%,transparent)]',
  past: 'top-[11px] h-2.5 bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]',
}

const LEGEND: { kind: SeasonSpan['kind']; label: string }[] = [
  { kind: 'open', label: 'Open' },
  { kind: 'announced', label: 'Announced' },
  { kind: 'estimate', label: 'Piste estimate' },
  { kind: 'fade', label: 'End not known' },
  { kind: 'past', label: 'Season over' },
]

const HOVER_OPEN_MS = 160
const HOVER_CLOSE_MS = 280

function Track({ row, open, index, todayLeft }: { row: WorldRow; open: boolean; index: number; todayLeft?: number }) {
  return (
    <div className="relative h-8">
      <div className="absolute inset-x-0 top-[15px] h-px bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]" />
      {todayLeft != null ? <div className="absolute inset-y-0 -ml-px w-0.5 rounded-full bg-ink-chip/80" style={{ left: `${todayLeft}%` }} /> : null}
      {row.spans.map((s, i) => (
        <div
          key={i}
          className={cn('absolute origin-left rounded-full transition-transform duration-[450ms] ease-[var(--ease-out-soft)]', SPAN_CLASS[s.kind], open ? 'scale-x-100' : 'scale-x-0')}
          style={{ left: `${s.left}%`, width: `${s.width}%`, transitionDelay: open ? `${140 + index * 35}ms` : '0ms' }}
        />
      ))}
    </div>
  )
}

/** "Today" on the month axis: a dot on the baseline (the line below starts under the labels, never through them). */
function TodayDot({ left }: { left: number }) {
  return <i aria-hidden className="absolute -bottom-[4.5px] -ml-1 size-2 rounded-full bg-ink-chip shadow-[0_0_0_2px_var(--surface)]" style={{ left: `${left}%` }} />
}

function Name({ row }: { row: WorldRow }) {
  return (
    <div className="flex h-8 min-w-0 items-center gap-2 whitespace-nowrap">
      <span className={cn('truncate text-[14px] font-medium', row.home ? 'text-teal' : 'text-ink')}>{row.name}</span>
      <span className="shrink-0 font-mono text-[12px] text-ink-2">{row.place}</span>
    </div>
  )
}

export function WorldSeasonCard({ world, range, tucked = true }: { world: WorldSeason; range: string; tucked?: boolean }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  useScrollEdges(scroller)
  useEffect(() => {
    const t = timer
    return () => {
      if (t.current) clearTimeout(t.current)
    }
  }, [])
  const schedule = (next: boolean, ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }
  const status = [world.open.length ? `${world.open.length} open worldwide` : 'No open status on record', world.nextLabel].filter(Boolean).join(' · ')
  const groups = [
    { label: 'North', rows: world.north },
    { label: 'South', rows: world.south },
  ].filter((g) => g.rows.length)
  // The "today" chip hangs right of its line early in the season and left of it later, so it never runs off the track.
  const chipSide: CSSProperties = world.todayLeft > 55 ? { right: `${100 - world.todayLeft}%`, marginRight: 12 } : { left: `${world.todayLeft}%`, marginLeft: 12 }
  const todaySub = world.nextLabel ?? (world.open.length ? `${world.open.length} open worldwide` : 'No open status on record')
  let rowIndex = 0
  let compactIndex = 0

  return (
    <section
      aria-labelledby="world-title"
      className={cn('piste-rise relative z-[3]', tucked ? '-mt-4 md:-mt-12 lg:-mt-[90px]' : 'mt-6')}
      style={{ '--rise-delay': '200ms' } as CSSProperties}
    >
      <div
        onMouseEnter={() => schedule(true, HOVER_OPEN_MS)}
        onMouseLeave={() => schedule(false, HOVER_CLOSE_MS)}
        onFocus={() => schedule(true, 0)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) schedule(false, 0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') schedule(false, 0)
        }}
        className="glass rounded-[32px] px-5 py-4 shadow-[inset_0_1px_0_var(--glass-shine),var(--glass-shadow-lg)] md:px-7"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls="world-body"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current)
            setOpen((v) => !v)
          }}
          className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[16px] py-1 text-left"
        >
          <h2 id="world-title" className="m-0 flex items-center gap-2 text-[18px] font-semibold text-ink">
            <Globe2 aria-hidden className="size-[18px] text-teal" strokeWidth={1.8} />
            World season
          </h2>
          {/* Below 1024px: title + toggle, then the range and the status. 1024–1279px: title, range and toggle, the
              status below. From 1280px: one row. (A zero-height full-width item forces the wrap.) */}
          <span className="order-1 ml-auto flex shrink-0 items-center gap-2 rounded-full py-0.5 pr-0.5 pl-3 text-[13px] font-medium text-ink-2 xl:order-last">
            <span className="max-sm:sr-only">{open ? 'Hide timeline' : 'Show timeline'}</span>
            <span className={cn('glass-strong grid size-8 place-items-center rounded-full text-ink transition-transform duration-300 ease-[var(--ease-out-soft)]', open && 'rotate-180')}>
              <ChevronDown aria-hidden className="size-4" />
            </span>
          </span>
          <span className="hud order-3 text-ink-2 max-sm:basis-full lg:order-none">
            {range} · {world.shown} of {world.total} resorts
          </span>
          <span aria-hidden className="order-2 h-0 basis-full xl:hidden" />
          <span className="order-4 flex min-w-0 items-center gap-2 rounded-[16px] bg-[color-mix(in_srgb,var(--teal)_10%,transparent)] px-3 py-1.5 text-[13px] leading-snug font-medium text-ink xl:order-none">
            <i aria-hidden className={cn('size-[7px] shrink-0 rounded-full', world.open.length ? 'bg-positive' : 'bg-teal')} />
            <span className="min-w-0">{status}</span>
          </span>
        </button>
        <div
          id="world-body"
          className={cn('grid transition-[grid-template-rows] duration-[480ms] ease-[var(--ease-out-soft)]', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
          inert={!open}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className={cn(
                'pt-3 pb-2 transition-[opacity,transform] ease-[var(--ease-out-soft)]',
                open ? 'translate-y-0 opacity-100 delay-100 duration-300' : '-translate-y-2 opacity-0 duration-150',
              )}
            >
              <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-2 p-0 text-[12px] text-ink-2" aria-label="Legend">
                {LEGEND.map((l) => (
                  <li key={l.kind} className="flex items-center gap-1.5">
                    <i aria-hidden className={cn('relative block h-2 w-[18px] rounded-full', SPAN_CLASS[l.kind].replace(/top-\S+|h-\S+/g, ''))} />
                    {l.label}
                  </li>
                ))}
              </ul>
              {/* Below 1024px: one row per resort (name and note above a full-width track), no sideways scrolling. */}
              <div className="pt-3 lg:hidden" aria-hidden>
                <div
                  className={cn(
                    'flex flex-col gap-0.5 rounded-[16px] bg-ink-chip px-3.5 py-2.5 text-on-ink-chip transition-[opacity,transform] duration-300',
                    open ? 'translate-y-0 opacity-100 delay-200' : 'translate-y-1 opacity-0',
                  )}
                >
                  <span className="hud text-on-ink-chip-accent">Today</span>
                  <span className="text-[14px] font-medium">{world.todayTitle}</span>
                  <span className="text-[12px] text-on-ink-chip-2">{todaySub}</span>
                </div>
                <div className="relative mt-3">
                  <div className="relative h-[22px] border-b border-[color-mix(in_srgb,var(--ink)_10%,transparent)]">
                    <TodayDot left={world.todayLeft} />
                    {world.months.map((m, i) => (
                      <span
                        key={m.label + m.left}
                        className={cn('absolute font-mono text-[12px] tracking-[0.08em] text-ink-2', i % 2 === 1 && 'max-sm:hidden')}
                        style={{ left: `${m.left}%` }}
                      >
                        {m.label}
                      </span>
                    ))}
                  </div>
                  {groups.map((g) => (
                    <div key={g.label}>
                      <div className="hud flex h-[30px] items-end tracking-[0.14em] text-ink-2">{g.label}</div>
                      {g.rows.map((r) => (
                        <div key={r.resortId} className="pt-2">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className={cn('text-[14px] font-medium', r.home ? 'text-teal' : 'text-ink')}>{r.name}</span>
                              <span className="font-mono text-[12px] text-ink-2">{r.place}</span>
                            </span>
                            <span className="font-mono text-[12px] text-ink-2">{r.note}</span>
                          </div>
                          <Track row={r} open={open} index={compactIndex++} todayLeft={world.todayLeft} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div ref={scroller} className="scroll-fade-x -mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] max-lg:hidden">
                <div className="flex min-w-[800px] pt-1.5" aria-hidden>
                  <div className="flex w-[160px] flex-none flex-col pr-2 md:w-[200px]">
                    <div className="h-[94px]" />
                    <div className="h-[22px]" />
                    {groups.map((g) => (
                      <div key={g.label}>
                        <div className="hud flex h-[28px] items-end tracking-[0.14em] text-ink-2">{g.label}</div>
                        {g.rows.map((r) => (
                          <Name key={r.resortId} row={r} />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="relative flex min-w-0 flex-1 flex-col">
                    <div className="relative h-[94px]">
                      <div
                        className={cn(
                          'absolute top-1 flex max-w-[340px] flex-col gap-0.5 rounded-[18px] bg-ink-chip px-3.5 py-2.5 text-on-ink-chip shadow-[0_12px_30px_rgb(19_32_44/0.25)] transition-[opacity,transform] duration-300',
                          open ? 'translate-y-0 opacity-100 delay-200' : 'translate-y-1 opacity-0',
                        )}
                        style={chipSide}
                      >
                        <span className="hud text-on-ink-chip-accent">Today</span>
                        <span className="truncate text-[14px] font-medium">{world.todayTitle}</span>
                        <span className="truncate text-[12px] text-on-ink-chip-2">{todaySub}</span>
                      </div>
                    </div>
                    <div className="relative h-[22px] border-b border-[color-mix(in_srgb,var(--ink)_10%,transparent)]">
                      <TodayDot left={world.todayLeft} />
                      {world.months.map((m) => (
                        <span key={m.label + m.left} className="absolute font-mono text-[12px] tracking-[0.1em] text-ink-2" style={{ left: `${m.left}%` }}>
                          {m.label}
                        </span>
                      ))}
                    </div>
                    {groups.map((g) => (
                      <div key={g.label}>
                        <div className="h-[28px]" />
                        {g.rows.map((r) => (
                          <Track key={r.resortId} row={r} open={open} index={rowIndex++} />
                        ))}
                      </div>
                    ))}
                    <div className="absolute top-[120px] bottom-0 -ml-px w-0.5 rounded-full bg-ink-chip" style={{ left: `${world.todayLeft}%` }} />
                  </div>
                  <div className="flex w-[260px] flex-none flex-col pl-5">
                    <div className="h-[116px]" />
                    {groups.map((g) => (
                      <div key={g.label}>
                        <div className="h-[28px]" />
                        {g.rows.map((r) => (
                          <div key={r.resortId} className="flex h-8 items-center font-mono text-[12px] whitespace-nowrap text-ink-2" title={r.note}>
                            <span className="truncate">{r.note}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <ul className="sr-only">
                <li>
                  Today: {world.todayTitle}. {world.todayDetail}.
                </li>
                {groups.flatMap((g) =>
                  g.rows.map((r) => (
                    <li key={r.resortId}>
                      {r.name} ({r.place}, {g.label.toLowerCase()}): {r.note}
                    </li>
                  )),
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
