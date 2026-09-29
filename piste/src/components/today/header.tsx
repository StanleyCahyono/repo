/**
 * Today's compact editorial header: season · home location (eyebrow), the title, the local date in the home time
 * zone as the lead's first words, then the two things that decide the ranking below — the dates (Today · Tomorrow ·
 * This weekend · Pick dates) and, once resorts are open, what kind of day to rank for. Both live in the URL.
 */
import Link from 'next/link'
import { DemoBadge } from '@/components/ui/badge'
import { Bell, CircleCheck, Clock3, RefreshCw, TriangleAlert } from 'lucide-react'
import { RefreshButton } from '@/components/sources/refresh-button'
import { FRESHNESS_JOBS, type FreshnessView } from '@/lib/data/freshness'
import { cn } from '@/lib/ui/cn'
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
  freshness,
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
  /** Live mode: when the data was last updated. Null in demo mode (simulated, never fetched). */
  freshness: FreshnessView | null
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
          <DemoBadge />
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
          {freshness ? <FreshnessLine f={freshness} /> : null}
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

const FRESHNESS_ICON = { current: CircleCheck, failed: TriangleAlert, running: RefreshCw, stale: Clock3, never: Clock3 } as const
const FRESHNESS_TONE = { current: 'text-positive', failed: 'text-critical', running: 'text-info', stale: 'text-caution', never: 'text-caution' } as const

/**
 * "Weather updated today 07:02 · Alerts … · Exchange rates …" with an Update now button. Piste refreshes on its
 * own (the worker, or the single-file page while it is open); this line says whether today's refresh has happened.
 */
function FreshnessLine({ f }: { f: FreshnessView }) {
  const Icon = FRESHNESS_ICON[f.state]
  return (
    <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
      <p role="status" className="flex max-w-[68ch] min-w-0 items-start gap-2 pt-1 text-[13.5px] leading-snug text-ink-2">
        <Icon aria-hidden className={cn('mt-px size-4 shrink-0', FRESHNESS_TONE[f.state])} />
        <span className="min-w-0">
          <span className="text-ink">{f.text}.</span> <span className="text-ink-3">{f.detail}.</span>
        </span>
      </p>
      <RefreshButton jobs={FRESHNESS_JOBS} label="Update the weather, alerts and exchange rates now" idleText="Update now" busyText="Updating…" size="sm" />
    </div>
  )
}
