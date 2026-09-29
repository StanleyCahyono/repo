/**
 * Today's compact editorial header: season · home location (eyebrow), the title, the local date in the home time
 * zone as the lead's first words, then the two things that decide the ranking below — the dates (Today · Tomorrow ·
 * This weekend · Pick dates) and, once resorts are open, what kind of day to rank for. Both live in the URL.
 */
import Link from 'next/link'
import { Bell, FlaskConical } from 'lucide-react'
import { formatLocalDate } from '@/lib/domain/time'
import type { RecommendPreset } from '@/lib/domain/recommend'
import { DateChips } from './date-chips'
import { plural } from './format'
import { formatDates, quickRangeOf, relativeDay } from './params'
import { PresetChips, type PresetOption } from './preset-chips'

export function TodayHeader({
  today,
  dates,
  seasonLabel,
  homeName,
  homeTimezone,
  demo,
  preseason,
  presets,
  fallbackPreset,
  unread,
}: {
  today: string
  dates: string[]
  seasonLabel: string
  homeName: string
  homeTimezone: string
  demo: boolean
  preseason: boolean
  presets: PresetOption[]
  fallbackPreset: RecommendPreset
  unread: number
}) {
  const quick = quickRangeOf(dates, today)
  const when =
    quick === 'today' || quick === 'tomorrow'
      ? quick
      : quick === 'weekend'
        ? 'this weekend'
        : dates.length === 1
          ? `on ${relativeDay(dates[0], today)}`
          : `over ${formatDates(dates)}`
  const lead = preseason
    ? 'Preseason — nothing is open yet, so opening dates, pass deadlines and trip planning lead until the first resort reports opening.'
    : `Where to ski ${when}, your favourites, the week ahead and what changed.`
  return (
    <header className="mb-6 md:mb-7">
      <div className="eyebrow mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Season {seasonLabel}</span>
        <span aria-hidden>·</span>
        <span>From {homeName}</span>
        {demo ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-demo-bg px-1.5 py-0.5 tracking-normal text-demo normal-case">
            <FlaskConical aria-hidden className="size-3.5" /> Demo data
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[32px] leading-[1.02] text-ink md:text-[44px]">Today</h1>
          <p className="mt-2 max-w-[68ch] text-[15px] text-ink-2 md:text-[16px]">
            <time dateTime={today} className="font-medium text-ink" title={`Local date at home (${homeTimezone})`}>
              {formatLocalDate(today, 'cccc d LLLL yyyy')}
            </time>{' '}
            — {lead}
          </p>
        </div>
        {unread ? (
          <Link
            href="#alerts"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-divider-strong bg-surface px-3.5 text-[13.5px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal md:h-9"
          >
            <Bell aria-hidden className="size-4 text-caution" />
            <span className="tnum">{plural(unread, 'unread alert')}</span>
          </Link>
        ) : null}
      </div>
      <div className="mt-5 flex flex-col gap-3">
        <DateChips />
        {preseason ? null : (
          <div className="flex min-w-0 flex-col gap-1.5 xl:flex-row xl:items-center xl:gap-3">
            <p aria-hidden className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
              Rank for
            </p>
            <PresetChips presets={presets} fallback={fallbackPreset} className="min-w-0 flex-1" />
          </div>
        )}
      </div>
    </header>
  )
}
