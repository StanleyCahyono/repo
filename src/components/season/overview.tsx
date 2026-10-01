/**
 * Season at a glance (server-rendered): a small timeline of the season — logged days, pass days,
 * lessons and planned trips on one date axis, with today marked. The timeline is decoration over a real list
 * ("Show as list"), so nothing is colour- or position-only.
 */
import { GraduationCap } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { KindTag } from '@/components/ui/provenance'
import type { SeasonTimeline as Timeline } from '@/lib/data/season-screen'
import { addDays, daysBetween, formatLocalDate } from '@/lib/domain/time'
import { dayLabel, plural, rangeLabel } from './format'
import { TimelineTrips } from './timeline-trips'

// ---------------------------------------------------------------------------
// Timeline

function monthStarts(from: string, to: string): string[] {
  const out: string[] = []
  let m = `${from.slice(0, 7)}-01`
  while (m <= to) {
    out.push(m)
    m = `${addDays(m, 32).slice(0, 7)}-01`
  }
  return out
}

export function SeasonTimeline({ tl, demo, seasonLabel }: { tl: Timeline; demo: boolean; seasonLabel: string }) {
  const total = daysBetween(tl.from, tl.to) + 1
  const pos = (d: string) => (Math.min(Math.max(daysBetween(tl.from, d), 0), total - 1) + 0.5) / total
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`
  const months = monthStarts(tl.from, tl.to)
  const days = tl.marks.filter((m) => m.kind === 'day')
  const lessons = tl.marks.filter((m) => m.kind === 'lesson')
  const showToday = tl.today >= tl.from && tl.today <= tl.to
  const items = [
    ...tl.trips.map((t) => ({ key: `trip-${t.id}`, date: t.startDate, text: `${rangeLabel(t.startDate, t.endDate)} — trip: ${t.name} (${t.status})` })),
    ...days.map((d) => ({ key: `day-${d.date}-${d.resortId}`, date: d.date, text: `${dayLabel(d.date)} — ski day at ${d.label}${d.kind === 'day' && d.pass ? ' (pass day)' : ''}${d.kind === 'day' && d.logId === null ? ', not in the journal yet' : ''}` })),
    ...lessons.map((l) => ({ key: `lesson-${l.date}-${l.resortId}`, date: l.date, text: `${dayLabel(l.date)} — lesson at ${l.label}${l.kind === 'lesson' && l.upcoming ? ' (planned)' : ''}` })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const empty = !items.length

  return (
    <figure aria-labelledby="season-timeline-title" className="glass m-0 rounded-[24px] px-4 pt-4 pb-3 md:px-6 md:pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 id="season-timeline-title" className="text-[15px] font-semibold text-ink">
            Season {seasonLabel}
          </h2>
          {demo ? <KindTag kind="demo" /> : null}
        </div>
        <p className="text-[12.5px] text-ink-3 tnum">
          {formatLocalDate(tl.from, 'd LLL')} – {formatLocalDate(tl.to, 'd LLL yyyy')}
          {showToday ? null : ` · today ${formatLocalDate(tl.today, 'd LLL')}${tl.today < tl.from ? ', before the season' : ''}`}
        </p>
      </div>

      <div aria-hidden className="relative mt-4 h-[96px] select-none">
        {/* Month columns */}
        {months.map((m, i) => (
          <div key={m} className={cn('absolute inset-y-0 border-l border-divider', i === 0 && 'border-l-divider-strong')} style={{ left: pct(Math.max(0, daysBetween(tl.from, m)) / total) }}>
            <span className="absolute bottom-0 left-1.5 text-[12px] font-medium text-ink-3">{formatLocalDate(m, 'LLL')}</span>
          </div>
        ))}
        {/* Trips lane */}
        <TimelineTrips trips={tl.trips} from={tl.from} total={total} today={tl.today} />
        {/* Ski days lane */}
        <div className="absolute inset-x-0 top-[34px] h-3 border-t border-dashed border-divider" />
        {days.map((d) => (
          <span
            key={`${d.date}-${d.resortId}`}
            title={`${dayLabel(d.date)} · ${d.label}`}
            className={cn(
              'absolute top-[28px] size-3 -translate-x-1/2 rounded-full border-2',
              d.kind === 'day' && d.logId === null ? 'border-teal bg-surface' : 'border-surface bg-teal',
              d.kind === 'day' && d.pass && d.logId !== null && 'ring-2 ring-teal/35',
            )}
            style={{ left: pct(pos(d.date)) }}
          />
        ))}
        {/* Lessons lane */}
        {lessons.map((l) => (
          <span
            key={`${l.date}-${l.resortId}`}
            title={`Lesson · ${dayLabel(l.date)} · ${l.label}`}
            className={cn('absolute top-[52px] inline-flex size-[18px] -translate-x-1/2 items-center justify-center rounded-[5px] border', l.kind === 'lesson' && l.upcoming ? 'border-dashed border-copper bg-surface text-copper' : 'border-copper/60 bg-surface text-copper')}
            style={{ left: pct(pos(l.date)) }}
          >
            <GraduationCap className="size-3" strokeWidth={2} />
          </span>
        ))}
        {/* Today */}
        {showToday ? (
          <div className="absolute top-0 bottom-5 w-px bg-ink" style={{ left: pct(pos(tl.today)) }}>
            <span className="absolute -top-1 -left-[3px] size-[7px] rounded-full bg-ink" />
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full border-2 border-surface bg-teal ring-1 ring-divider" /> Ski day
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full border-2 border-surface bg-teal ring-2 ring-teal/35" /> Pass day
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-flex size-[18px] items-center justify-center rounded-[5px] border border-copper/60 text-copper">
              <GraduationCap className="size-3" strokeWidth={2} />
            </span>
            Lesson
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-5 rounded-[3px] border border-teal/60 bg-glacier" /> Booked trip
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-5 rounded-[3px] border border-dashed border-divider-strong bg-surface-2" /> Draft trip
          </li>
          {showToday ? (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-px bg-ink" /> Today, {formatLocalDate(tl.today, 'd LLL')}
            </li>
          ) : null}
        </ul>
      </div>
      {empty ? <p className="mt-2 text-[13px] text-ink-3">Nothing logged or planned for {seasonLabel} yet — logged days, lessons and trips appear here.</p> : null}
      <TimelineList items={items} count={{ days: days.length, lessons: lessons.length, trips: tl.trips.length }} />
    </figure>
  )
}

function TimelineList({ items, count }: { items: { key: string; text: string }[]; count: { days: number; lessons: number; trips: number } }) {
  if (!items.length) return null
  return (
    <details className="mt-1 border-t border-divider pt-1 text-[13px]">
      <summary className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-md px-1 font-medium text-teal hover:underline md:h-9">
        Timeline as a list · {[plural(count.days, 'day'), plural(count.lessons, 'lesson'), plural(count.trips, 'trip')].join(', ')}
      </summary>
      <ol className="mt-1 mb-2 flex flex-col gap-1 text-ink-2 tnum">
        {items.map((it) => (
          <li key={it.key}>{it.text}</li>
        ))}
      </ol>
    </details>
  )
}
