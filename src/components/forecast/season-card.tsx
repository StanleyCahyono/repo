'use client'
/**
 * Season dates for the focus resort, beside the calendar: the next openings / closings on file as countdown rings
 * (fuller as the day approaches, on a 60-day scale — the same language as Today's countdown card). Announced dates
 * are teal, Piste estimates copper and labelled as estimates, reported ones dark. Choosing a row turns the calendar
 * to that month. Nothing on file reads so — no date is invented.
 */
import { useState } from 'react'
import type { SeasonMarker } from '@/lib/data/forecast-screen'
import { daysBetween, formatLocalDate } from '@/lib/domain/time'
import { cn } from '@/lib/ui/cn'
import { DetailLine, GlassPanel } from './hud'

const RING_DAYS = 60
const LIFT = 'transition-[opacity,transform] duration-[350ms] ease-[cubic-bezier(.3,1.4,.5,1)]'

export function SeasonCard({ name, markers, today, onMonth }: { name: string; markers: SeasonMarker[]; today: string; onMonth: (month: string) => void }) {
  const upcoming = markers.filter((m) => (m.to ?? m.date) >= today)
  const recent = markers.filter((m) => (m.to ?? m.date) < today).slice(-1)
  const rows = [...recent, ...upcoming].slice(0, 4)
  const [hi, setHi] = useState<number | null>(null)
  const leave = (i: number) => setHi((v) => (v === i ? null : v))

  return (
    <GlassPanel aria-labelledby="season-title" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="season-title" className="m-0 text-[16px] font-semibold text-ink">
          Season dates
        </h2>
        <span className="hud text-ink-2">{name}</span>
      </div>
      {rows.length ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {rows.map((m, i) => {
            const days = daysBetween(today, m.date)
            const inWindow = m.to !== null && m.date <= today && today <= m.to
            const fill = days < 0 ? 1 : Math.max(0.04, Math.min(1, 1 - days / RING_DAYS))
            const tone = m.basis === 'estimate' ? 'var(--copper)' : m.basis === 'actual' ? 'var(--ink-chip)' : 'var(--teal)'
            const on = hi === i
            return (
              <li key={`${m.date}-${m.event}`}>
                <button
                  type="button"
                  onClick={() => onMonth(m.date.slice(0, 7))}
                  onMouseEnter={() => setHi(i)}
                  onMouseLeave={() => leave(i)}
                  onFocus={() => setHi(i)}
                  onBlur={() => leave(i)}
                  aria-label={`${m.detail} Show ${formatLocalDate(m.date, 'LLLL yyyy')} in the calendar.`}
                  className={cn('flex w-full flex-col items-center gap-1.5 rounded-[16px] px-1 py-2 text-center outline-offset-2', LIFT, hi !== null && !on ? 'opacity-45' : 'opacity-100', on && '-translate-y-1')}
                >
                  <span
                    aria-hidden
                    className={cn('flex size-[54px] items-center justify-center rounded-full transition-shadow duration-[250ms]', on && 'shadow-[0_10px_24px_rgb(19_32_44/0.25)]')}
                    style={{ background: `conic-gradient(${tone} ${Math.round(fill * 360)}deg, color-mix(in srgb, var(--teal) 12%, transparent) 0)` }}
                  >
                    <span className="flex size-[44px] flex-col items-center justify-center rounded-full bg-surface-2 leading-none">
                      <span className="text-[15px] font-semibold text-ink tnum">{inWindow ? 'now' : Math.abs(days)}</span>
                      {!inWindow ? <span className="mt-0.5 font-mono text-[12px] text-ink-2">{days < 0 ? 'ago' : days === 1 ? 'day' : 'days'}</span> : null}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'rounded-[6px] px-1.5 py-[3px] text-[12px] leading-none font-semibold',
                      m.basis === 'estimate' ? 'border-[1.5px] border-dashed border-copper text-copper' : m.basis === 'actual' ? 'bg-ink-chip text-on-ink-chip' : 'bg-teal text-on-teal',
                    )}
                  >
                    {m.label}
                  </span>
                  <span className="font-mono text-[12px] text-ink-2 uppercase tnum">
                    {formatLocalDate(m.date, 'd LLL')}
                    {m.to ? `–${formatLocalDate(m.to, 'd LLL')}` : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-ink-2">No opening or closing dates on file for {name}. None is estimated without a basis.</p>
      )}
      {rows.length ? (
        <DetailLine active={hi !== null}>
          {hi !== null ? rows[hi].detail : 'Hover a date for detail; choose it to show its month. Copper dashed dates are Piste estimates, not announcements.'}
        </DetailLine>
      ) : null}
    </GlassPanel>
  )
}
