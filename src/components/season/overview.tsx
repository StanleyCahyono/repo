/**
 * Season at a glance (server-rendered): a small timeline of the season — logged days, pass days,
 * lessons and planned trips on one date axis, with today marked. The timeline is decoration over a real list
 * ("Show as list"), so nothing is colour- or position-only.
 */
import { GraduationCap } from 'lucide-react'
import { KindTag } from '@/components/ui/provenance'
import type { SeasonTimeline as Timeline } from '@/lib/data/season-screen'
import { formatLocalDate } from '@/lib/domain/time'
import { dayLabel, plural, rangeLabel } from './format'
import { TimelineCanvas } from './timeline-canvas'

// ---------------------------------------------------------------------------
// Timeline

export function SeasonTimeline({ tl, demo, seasonLabel }: { tl: Timeline; demo: boolean; seasonLabel: string }) {
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

      <TimelineCanvas tl={tl} />

      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3.5 rounded-full border-2 border-surface bg-teal shadow-[0_0_0_1px_var(--divider)]" /> Ski day
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3.5 rounded-full border-2 border-surface bg-teal ring-2 ring-teal/35" /> Pass day
        </li>
        {days.some((d) => d.kind === 'day' && d.logId === null) ? (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-3.5 rounded-full border-2 border-teal bg-surface" /> Pass day, not in the journal
          </li>
        ) : null}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-flex size-[20px] items-center justify-center rounded-[6px] border border-copper/60 text-copper">
            <GraduationCap className="size-3" strokeWidth={2} />
          </span>
          Lesson
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-6 rounded-full bg-teal/[0.16] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--teal)_45%,transparent)]" /> Booked trip
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-6 rounded-full border border-dashed border-teal/50 bg-teal/[0.06]" /> Draft trip
        </li>
        {showToday ? (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3.5 w-[1.5px] rounded-full bg-teal" /> Today, {formatLocalDate(tl.today, 'd LLL')}
          </li>
        ) : null}
      </ul>
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
