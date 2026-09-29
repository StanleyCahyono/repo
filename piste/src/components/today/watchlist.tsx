/**
 * Favourite watchlist. Each favourite is the shared <ResortCard density="compact"/> (status, opening information,
 * conditions score or its designed missing / limited / closed state, snow, day cost, travel, pass access — never a
 * fork of the card) with a short Today footer: the chosen day's modeled weather and the latest important change
 * (status, opening date, new report, official alert).
 */
import Link from 'next/link'
import { CalendarClock, CloudOff, FileText, LineChart, Siren, Star } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ButtonLink } from '@/components/ui/button'
import { KindTag } from '@/components/ui/provenance'
import { ResortCard } from '@/components/resort/resort-card'
import type { ResortCardData } from '@/components/resort/card-data'
import type { TodayView, WatchItem } from '@/lib/data/today'
import { formatLocalDate, relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { maxSnow, snowLabel, tempPair } from './format'
import { Block } from './section'

const CHANGE_ICON = {
  status: CalendarClock,
  'opening-date': CalendarClock,
  report: FileText,
  'official-alert': Siren,
} as const

/** The chosen day's modeled weather at the resort ("Likely 1.1″ new snow · 27° / 13°F"), or why there is none. */
function DayWeather({ s, units }: { s: WatchItem['summary']; units: UnitPrefs }) {
  const w = s.weather
  const a = w.base ?? w.summit
  const day = s.date === s.today ? 'Today' : formatLocalDate(s.date)
  if (!a) {
    return (
      <p className="flex items-start gap-1.5 text-[13px] text-ink-3">
        <CloudOff aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <span className="font-medium text-ink-2">{day}:</span> {s.freshness.weatherFetchedAt ? 'no modeled weather for this day' : 'weather not fetched yet'}
        </span>
      </p>
    )
  }
  const snow = maxSnow({
    base: w.base?.snowfallCm ?? null,
    summit: w.summit?.snowfallCm ?? null,
  })
  const partial = [w.base, w.summit].some((x) => x && !x.complete)
  const temps = tempPair(a.tempMinC, a.tempMaxC, units)
  const snowText = snow === null ? 'snowfall unknown' : snow === 0 ? 'no new snow' : `${snowLabel(snow, units, partial)} new snow`
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-ink-2">
      <span className="font-medium text-ink">{day}:</span>
      <span>
        Likely {snowText}
        {temps ? (
          <>
            {' '}
            · <span className="tnum">{temps}</span>
            {units.temperature}
          </>
        ) : null}
        {partial ? <span className="text-ink-3"> (part of the day)</span> : null}
      </span>
      <KindTag kind={s.demo ? 'demo' : 'modeled'} compact />
    </p>
  )
}

function LatestChange({ item, now }: { item: WatchItem; now: string }) {
  const change = item.changes[0] ?? null
  if (!change) return <p className="text-[13px] text-ink-3">No status, opening or report changes in the last few days</p>
  const Icon = CHANGE_ICON[change.kind]
  return (
    <p className="flex items-start gap-1.5 text-[13px] text-ink-2">
      <Icon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', change.kind === 'official-alert' ? 'text-caution' : 'text-ink-3')} />
      <span className="min-w-0">
        <span className="text-ink">{change.title.replace(`${change.resortName}: `, '')}</span>
        {change.detail ? ` — ${change.detail}` : ''} <span className="tnum text-ink-3">· {relativeLabel(change.at, now)}</span>
      </span>
    </p>
  )
}

export function Watchlist({ view, cards, units }: { view: TodayView; cards: Record<string, ResortCardData>; units: UnitPrefs }) {
  const date = view.dates[0]
  const label = date === view.today ? 'today' : formatLocalDate(date)
  return (
    <Block
      id="watch-title"
      title="Favourites"
      eyebrow={view.watchlist.length ? `Watchlist · ${label}` : 'Watchlist'}
      bodyClassName="px-0 pb-0 md:px-0"
      actions={
        <Link href="/explore" className="inline-flex h-11 items-center rounded-md px-2 text-[13.5px] font-medium text-teal hover:bg-glacier/60 md:h-9">
          Add in Explore
        </Link>
      }
    >
      {view.watchlist.length ? (
        <ul className="divide-y divide-divider border-t border-divider">
          {view.watchlist.map((w) => {
            const s = w.summary
            const card = cards[`${s.id}|${s.date}`]
            return (
              <li key={s.id} className="pb-3">
                {card ? (
                  <ResortCard resort={card} variant="row" density="compact" showCompare={false} headingLevel={3} />
                ) : (
                  <h3 className="px-4 pt-3 text-[17px] font-semibold text-ink">
                    <Link href={`/resorts/${s.id}`} className="hover:text-teal hover:underline">
                      {s.name}
                    </Link>
                  </h3>
                )}
                <div className="mx-4 flex flex-col gap-1 rounded-[10px] bg-surface-2 px-3 py-2">
                  <DayWeather s={s} units={units} />
                  <LatestChange item={w} now={view.now} />
                  <Link
                    href={`/forecast?r=${encodeURIComponent(s.id)}&focus=${encodeURIComponent(s.id)}&date=${s.date}`}
                    className="-ml-1 inline-flex h-9 w-fit items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-teal hover:underline md:h-7"
                  >
                    <LineChart aria-hidden className="size-3.5" />
                    Forecast for {s.shortName || s.name}
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="border-t border-divider px-4 py-5 md:px-5">
          <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <Star aria-hidden className="size-4 text-ink-3" /> No favourites yet
          </p>
          <p className="mt-1 text-[14px] text-ink-2">Star resorts in Explore to watch their status, conditions, weather and opening dates here.</p>
          <ButtonLink href="/explore" variant="secondary" size="sm" className="mt-3 h-11 md:h-10">
            Browse resorts
          </ButtonLink>
        </div>
      )}
    </Block>
  )
}
