'use client'
/**
 * World season: a slim glass bar until you hover, focus or tap it; then the Sep → Jul timeline slides open, with the
 * answer pinned on "today". Open / announced / Piste-estimate / end-not-known spans, North and South. The spans are
 * decorative; each row's note carries the same facts as text (and a list for screen readers).
 */
import { useRef, useState } from 'react'
import type { SeasonSpan, WorldRow, WorldSeason } from '@/lib/data/today-hud'
import { cn } from '@/lib/ui/cn'

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

function Track({ row }: { row: WorldRow }) {
  return (
    <div className="relative h-8">
      <div className="absolute inset-x-0 top-[15px] h-px bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]" />
      {row.spans.map((s, i) => (
        <div key={i} className={cn('absolute rounded-full', SPAN_CLASS[s.kind])} style={{ left: `${s.left}%`, width: `${s.width}%` }} />
      ))}
    </div>
  )
}

function Name({ row }: { row: WorldRow }) {
  return (
    <div className="flex h-8 items-center gap-2 overflow-hidden whitespace-nowrap">
      <span className={cn('text-[14px] font-medium', row.home && 'text-teal')}>{row.name}</span>
      <span className="font-mono text-[12px] text-ink-2">{row.place}</span>
    </div>
  )
}

export function WorldSeasonCard({ world, range }: { world: WorldSeason; range: string }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(true)
  }
  const hide = (delay = 250) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), delay)
  }
  const hint = `${world.open.length ? `${world.open.length} open worldwide` : 'No open status on record'} · ${world.todayDetail.split(' · ').pop()}`
  const groups = [
    { label: 'North', rows: world.north },
    { label: 'South', rows: world.south },
  ].filter((g) => g.rows.length)

  return (
    <section aria-labelledby="world-title" className="relative z-[3] -mt-2 md:-mt-[90px]">
      <div
        onMouseEnter={show}
        onMouseLeave={() => hide()}
        onFocus={show}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        className={cn('glass rounded-[32px] shadow-[inset_0_1px_0_var(--glass-shine),var(--glass-shadow-lg)] transition-[padding] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]', open ? 'px-5 pt-6 pb-6 md:px-7' : 'px-5 py-4 md:px-7')}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls="world-body"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[14px] text-left"
        >
          <h2 id="world-title" className="m-0 text-[18px] font-semibold text-ink">
            World season
          </h2>
          <span className="hud text-ink-2">
            {range} · {world.shown} of {world.total} resorts
          </span>
          <span
            className={cn(
              'flex items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--teal)_10%,transparent)] px-3 py-1.5 text-[12.5px] font-medium text-ink transition-opacity duration-300',
              open && 'opacity-0',
            )}
            aria-hidden={open}
          >
            <i aria-hidden className="size-[7px] rounded-full bg-teal" />
            {hint} · <span className="max-md:hidden">hover to expand</span>
            <span className="md:hidden">tap to expand</span>
          </span>
        </button>
        <div
          id="world-body"
          className={cn('grid transition-[grid-template-rows,opacity] duration-[650ms] ease-[cubic-bezier(.2,.8,.2,1)]', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
          inert={!open}
        >
          <div className="min-h-0 overflow-hidden">
            <ul className="flex flex-wrap items-center gap-4 pt-3 text-[12px] text-ink-2" aria-label="Legend">
              {LEGEND.map((l) => (
                <li key={l.kind} className="flex items-center gap-1.5">
                  <i aria-hidden className={cn('relative block h-2 w-[18px] rounded-full', SPAN_CLASS[l.kind].replace(/top-\S+|h-\S+/g, ''))} />
                  {l.label}
                </li>
              ))}
            </ul>
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div className="flex min-w-[720px] pt-1.5" aria-hidden>
                <div className="flex w-[150px] flex-none flex-col md:w-[190px]">
                  <div className="h-[78px]" />
                  <div className="h-[22px]" />
                  {groups.map((g) => (
                    <div key={g.label}>
                      <div className="hud flex h-[28px] items-end text-[12px] tracking-[0.14em] text-ink-2">{g.label}</div>
                      {g.rows.map((r) => (
                        <Name key={r.resortId} row={r} />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="relative flex min-w-0 flex-1 flex-col">
                  <div className="relative h-[78px]">
                    <div
                      className="absolute top-1 ml-3 flex flex-col gap-0.5 rounded-[18px] bg-ink-chip px-3.5 py-2.5 whitespace-nowrap text-on-ink-chip shadow-[0_12px_30px_rgb(19_32_44/0.25)]"
                      style={{ left: `${world.todayLeft}%` }}
                    >
                      <span className="hud text-on-ink-chip-accent">Today</span>
                      <span className="text-[14px] font-medium">{world.todayTitle}</span>
                      <span className="text-[12px] text-on-ink-chip-2">{world.todayDetail}</span>
                    </div>
                  </div>
                  <div className="relative h-[22px] border-b border-[color-mix(in_srgb,var(--ink)_10%,transparent)]">
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
                        <Track key={r.resortId} row={r} />
                      ))}
                    </div>
                  ))}
                  <div className="absolute top-[70px] bottom-0 -ml-px w-0.5 rounded-full bg-ink-chip" style={{ left: `${world.todayLeft}%` }} />
                </div>
                <div className="flex w-[230px] flex-none flex-col pl-5">
                  <div className="h-[100px]" />
                  {groups.map((g) => (
                    <div key={g.label}>
                      <div className="h-[28px]" />
                      {g.rows.map((r) => (
                        <div key={r.resortId} className="flex h-8 items-center overflow-hidden font-mono text-[12px] whitespace-nowrap text-ink-2" title={r.note}>
                          {r.note}
                        </div>
                      ))}
                    </div>
                  ))}
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
