'use client'
/**
 * Season dates for the focus resort, beside the calendar, in the date picker's language.
 *
 * - When an opening and a closing are both on file, a season track runs between them: the teal band fills up to today
 *   and the dark HUD knob sits on today ("Day 42 of 140", "Opens in 9 days", "Season over"). Ends are drawn by
 *   basis — reported (solid ink), announced (teal), Piste estimate (dashed copper, labelled an estimate).
 * - Each date on file is a row with a calendar leaf (mono month over the day): dark for reported, teal for announced,
 *   dashed copper for estimates — the same marks the calendar draws. Hover or focus a row for its detail line;
 *   choosing it turns the calendar to that month.
 *
 * Nothing on file reads so — no date is invented, and an announced date never turns into "Open" by itself.
 */
import { useState } from 'react'
import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import type { SeasonMarker } from '@/lib/data/forecast-screen'
import { daysBetween, formatLocalDate } from '@/lib/domain/time'
import { cn } from '@/lib/ui/cn'
import { EASE_OUT, t } from '@/lib/ui/motion'
import { DateLeaf, DetailLine, GlassPanel } from './hud'

const TAG: Record<SeasonMarker['basis'], string> = {
  actual: 'bg-ink-chip text-on-ink-chip',
  announced: 'bg-glacier text-teal',
  estimate: 'border border-dashed border-copper text-copper',
}
const BASIS_WORD: Record<SeasonMarker['basis'], string> = { actual: 'Reported', announced: 'Announced', estimate: 'Piste estimate' }

function relative(days: number, inWindow: boolean): string {
  if (inWindow) return 'Within the estimated window'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `In ${days} days` : `${-days} days ago`
}

/** The opening and closing that frame the season around today (same season), when both are on file. */
function seasonSpan(markers: SeasonMarker[], today: string): { open: SeasonMarker; close: SeasonMarker } | null {
  const bySeason = new Map<string, { open?: SeasonMarker; close?: SeasonMarker }>()
  for (const m of markers) {
    const e = bySeason.get(m.seasonId) ?? {}
    if (m.event === 'opening') e.open = m
    else e.close = m
    bySeason.set(m.seasonId, e)
  }
  const spans = [...bySeason.values()].filter((e): e is { open: SeasonMarker; close: SeasonMarker } => !!e.open && !!e.close && e.open.date < e.close.date)
  return spans.find((s) => s.close.date >= today) ?? spans[spans.length - 1] ?? null
}

export function SeasonCard({ name, markers, today, onMonth }: { name: string; markers: SeasonMarker[]; today: string; onMonth: (month: string) => void }) {
  const upcoming = markers.filter((m) => (m.to ?? m.date) >= today)
  const recent = markers.filter((m) => (m.to ?? m.date) < today).slice(-1)
  const rows = [...recent, ...upcoming].slice(0, 4)
  const span = seasonSpan(markers, today)
  const [hi, setHi] = useState<number | null>(null)
  const leave = (i: number) => setHi((v) => (v === i ? null : v))

  return (
    <GlassPanel aria-labelledby="season-dates-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="season-dates-title" className="m-0 text-[16px] font-semibold text-ink">
          Season dates
        </h2>
        <span className="hud text-ink-2">{name}</span>
      </div>

      {span ? <SeasonTrack open={span.open} close={span.close} today={today} /> : null}

      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((m, i) => {
            const days = daysBetween(today, m.date)
            const inWindow = m.to !== null && m.date <= today && today <= m.to
            const on = hi === i
            return (
              <motion.li key={`${m.date}-${m.event}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...t.pageIn, delay: 0.05 + i * 0.05 }}>
                <button
                  type="button"
                  onClick={() => onMonth(m.date.slice(0, 7))}
                  onMouseEnter={() => setHi(i)}
                  onMouseLeave={() => leave(i)}
                  onFocus={() => setHi(i)}
                  onBlur={() => leave(i)}
                  aria-label={`${m.detail} Show ${formatLocalDate(m.date, 'LLLL yyyy')} in the calendar.`}
                  className={cn(
                    'group flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2 text-left outline-offset-2 transition-[background-color,transform,opacity] duration-150 ease-[var(--ease-out-soft)]',
                    on ? '-translate-y-px bg-chip-hover' : 'hover:bg-chip-hover',
                    hi !== null && !on && 'opacity-60',
                  )}
                >
                  <DateLeaf date={m.date} tone={m.basis === 'actual' ? 'reported' : m.basis} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn('rounded-[8px] px-1.5 py-[3px] text-[12px] leading-none font-semibold whitespace-nowrap', TAG[m.basis])}>{m.label}</span>
                      <span className="text-[13px] text-ink tnum">
                        {formatLocalDate(m.date, 'ccc d LLL yyyy')}
                        {m.to ? ` – ${formatLocalDate(m.to, 'ccc d LLL')}` : ''}
                      </span>
                    </span>
                    <span className="text-[12.5px] text-ink-2 tnum">
                      {relative(days, inWindow)} · {BASIS_WORD[m.basis]}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className={cn('size-4 shrink-0 text-ink-3 transition-transform duration-150', on && 'translate-x-0.5 text-ink-2')} />
                </button>
              </motion.li>
            )
          })}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-ink-2">No opening or closing dates on file for {name}. None is estimated without a basis.</p>
      )}
      {rows.length ? (
        <DetailLine active={hi !== null}>{hi !== null ? rows[hi].detail : 'Choose a date to show its month in the calendar. Copper dashed dates are Piste estimates, not announcements.'}</DetailLine>
      ) : null}
    </GlassPanel>
  )
}

/** Opening → closing on one track: band to today, the HUD knob on today, ends drawn by basis. */
function SeasonTrack({ open, close, today }: { open: SeasonMarker; close: SeasonMarker; today: string }) {
  const length = daysBetween(open.date, close.date)
  const at = daysBetween(open.date, today)
  const p = Math.min(1, Math.max(0, at / length))
  const status = at < 0 ? `${open.basis === 'estimate' ? 'Estimated to open' : 'Opens'} in ${-at} ${-at === 1 ? 'day' : 'days'}` : at > length ? 'Season over' : `Day ${at + 1} of ${length + 1}`
  const end = (m: SeasonMarker) => (m.basis === 'estimate' ? 'border-2 border-dashed border-copper bg-surface' : m.basis === 'actual' ? 'bg-ink-chip' : 'bg-teal')
  return (
    <div className="flex flex-col gap-2" role="img" aria-label={`Season ${formatLocalDate(open.date, 'd LLL')} to ${formatLocalDate(close.date, 'd LLL yyyy')}: ${status}.`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[22px] leading-none font-light tracking-[-0.02em] text-ink tnum">{status}</span>
        {at >= 0 && at <= length ? <span className="hud text-ink-3 tnum">{Math.round(p * 100)}%</span> : null}
      </div>
      <div aria-hidden className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-chip-track" />
        <motion.div
          className="absolute top-1/2 left-0 h-2.5 origin-left -translate-y-1/2 rounded-full bg-teal/[0.35]"
          style={{ width: `${p * 100}%` }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
        />
        <span className={cn('absolute top-1/2 left-0 size-3 -translate-y-1/2 rounded-full', end(open))} />
        <span className={cn('absolute top-1/2 right-0 size-3 -translate-y-1/2 rounded-full', end(close))} />
        {at >= 0 && at <= length ? (
          <motion.span
            className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-chip shadow-[0_0_0_2px_var(--surface),0_0_0_3.5px_var(--teal),0_8px_18px_-8px_rgb(19_32_44/0.6)]"
            style={{ left: `${p * 100}%` }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...t.spring, delay: 0.45 }}
          />
        ) : null}
      </div>
      <div className="flex justify-between gap-3 font-mono text-[12px] text-ink-2 uppercase tnum">
        <span>
          {open.label} · {formatLocalDate(open.date, 'd LLL')}
        </span>
        <span className="text-right">
          {close.label} · {formatLocalDate(close.date, 'd LLL')}
        </span>
      </div>
    </div>
  )
}
