/**
 * The quieter Today blocks: new-snow watch (weather model, "Likely …", lower bounds said as "at least"), relevant
 * events (favourites and trip resorts, next 14 days) and recent changes (status, opening dates, new reports,
 * official alerts). Each keeps its designed empty state — "not fetched" is never shown as "no snow".
 */
import Link from 'next/link'
import { ArrowRight, BellOff, CalendarClock, CalendarDays, ExternalLink, FileText, Siren, Snowflake, Star } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { KindTag } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { ChangeItem, SnowWatchItem, TodayView } from '@/lib/data/today'
import type { EventView } from '@/lib/data/views'
import { formatMoney } from '@/lib/domain/money'
import { formatLocalDate, relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { formatSnow } from '@/lib/domain/units'
import { Block } from './section'

const linkCls = 'inline-flex h-11 items-center gap-1 rounded-md px-2 text-[13.5px] font-medium text-teal hover:bg-glacier/60 md:h-9'

export function SnowWatch({
  watch,
  units,
  now,
  weatherMissing,
  demo,
}: {
  watch: TodayView['newSnowWatch']
  units: UnitPrefs
  now: string
  weatherMissing: boolean
  demo: boolean
}) {
  const threshold = formatSnow(watch.thresholdCm, units)
  return (
    <Block
      id="snow-title"
      eyebrow={`Weather model · next ${watch.windowHours} h`}
      title="New-snow watch"
      actions={
        <Link href="/forecast" className={linkCls}>
          Forecast <ArrowRight aria-hidden className="size-4" />
        </Link>
      }
    >
      <p className="text-[13px] text-ink-2">
        Resorts likely to get at least <span className="tnum font-medium text-ink">{threshold}</span> of new snow — a forecast, not an observation, and not a
        promise of powder.
      </p>
      {watch.items.length ? (
        <ul className="mt-3 divide-y divide-divider border-t border-divider">
          {watch.items.slice(0, 6).map((s: SnowWatchItem) => {
            const amount = formatSnow(s.next72hCm, units)
            const week = s.next7dCm !== null ? formatSnow(s.next7dCm, units) : null
            return (
              <li key={s.resortId} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[14.5px] font-semibold text-ink">
                    {s.isFavorite ? <Star aria-hidden className="size-3.5 shrink-0 fill-copper text-copper" /> : null}
                    <Link
                      href={`/forecast?r=${encodeURIComponent(s.resortId)}&focus=${encodeURIComponent(s.resortId)}`}
                      className="truncate hover:text-teal hover:underline"
                    >
                      {s.name}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-2">{s.text}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                    <KindTag kind={demo ? 'demo' : 'modeled'} compact />
                    <span className="tnum">fetched {relativeLabel(s.fetchedAt, now)}</span>
                    {week ? (
                      <span className="tnum">
                        · 7 days: {s.next7dComplete ? '' : 'at least '}
                        {week}
                      </span>
                    ) : null}
                  </p>
                </div>
                <p className="font-display tnum shrink-0 text-[26px] leading-none text-info">
                  {s.complete ? '' : '≥'}
                  {amount}
                </p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 flex items-start gap-2 rounded-[10px] border border-dashed border-divider-strong bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
          <Snowflake aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
          {weatherMissing
            ? 'No weather has been fetched yet, so nothing can be watched — this is not a forecast of no snow.'
            : `No resort is forecast to reach ${threshold} in the next ${watch.windowHours} hours.`}
        </p>
      )}
    </Block>
  )
}

function eventWhen(e: EventView): string {
  if (!e.startDate) return 'Dates not announced'
  const end = e.endDate ?? e.startDate
  const time = e.startLocal && e.startLocal.length > 10 ? ` · ${e.startLocal.slice(11, 16)}` : ''
  return (end === e.startDate ? formatLocalDate(e.startDate) : `${formatLocalDate(e.startDate)} – ${formatLocalDate(end)}`) + time
}

export function EventsBlock({ events, names }: { events: EventView[]; names: Record<string, string> }) {
  return (
    <Block
      id="events-title"
      eyebrow="Next 14 days · favourites & trips"
      title="Events"
      actions={
        <Link href="/explore/events" className={linkCls}>
          All events <ArrowRight aria-hidden className="size-4" />
        </Link>
      }
    >
      {events.length ? (
        <ul className="divide-y divide-divider border-t border-divider">
          {events.slice(0, 5).map((e) => (
            <li key={e.id} className="flex gap-3 py-2.5">
              <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold text-ink">{e.title}</p>
                <p className="tnum text-[13px] text-ink-2">
                  {eventWhen(e)}
                  {e.resortId ? ` · ${names[e.resortId] ?? e.resortId}` : ''}
                  {e.status !== 'announced' ? <span className="text-caution"> · {e.status.replace(/-/g, ' ')}</span> : null}
                  {e.price ? ` · ${e.price.amountMinor === 0 ? 'Free' : formatMoney(e.price)}` : ''}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3">
                  {e.officialUrl ? (
                    <a
                      href={e.officialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1 text-[13px] font-medium text-teal hover:underline md:h-7"
                    >
                      Official page <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                  ) : null}
                  <SourceDrawer
                    title={`${e.title} — source`}
                    items={[{ label: 'Event', value: eventWhen(e), prov: e.prov }]}
                    label="Source"
                    compact={false}
                    className="h-9 md:h-7"
                  />
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13.5px] text-ink-2">
          No events on record at your favourites or trip resorts in the next 14 days. Events are never guessed — only announced ones are listed.
        </p>
      )}
    </Block>
  )
}

const CHANGE_ICON = {
  status: CalendarClock,
  'opening-date': CalendarClock,
  report: FileText,
  'official-alert': Siren,
} as const

export function RecentChanges({ changes, now, favourites }: { changes: ChangeItem[]; now: string; favourites: Set<string> }) {
  // Favourites first within the list, then newest first; keep it short.
  const list = [...changes].sort((a, b) => Number(favourites.has(b.resortId)) - Number(favourites.has(a.resortId)) || b.at.localeCompare(a.at)).slice(0, 6)
  return (
    <Block id="changes-title" eyebrow="Last 7 days" title="Recent changes">
      {list.length ? (
        <ul className="divide-y divide-divider border-t border-divider">
          {list.map((c, i) => {
            const Icon = CHANGE_ICON[c.kind]
            return (
              <li key={`${c.at}-${c.resortId}-${i}`} className="flex gap-2.5 py-2.5">
                <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', c.kind === 'official-alert' ? 'text-caution' : 'text-ink-3')} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] text-ink">
                    {favourites.has(c.resortId) ? <Star aria-label="Favourite" className="mr-1 inline size-3.5 fill-copper align-[-2px] text-copper" /> : null}
                    <Link href={`/resorts/${c.resortId}`} className="font-semibold hover:text-teal hover:underline">
                      {c.resortName}
                    </Link>
                    : {c.title.replace(`${c.resortName}: `, '')}
                  </p>
                  {c.detail ? <p className="text-[12.5px] text-ink-2">{c.detail}</p> : null}
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                    <span className="tnum">{relativeLabel(c.at, now)}</span>
                    {c.prov ? <KindTag kind={c.prov.kind} compact /> : null}
                    {c.prov ? <SourceDrawer title={`${c.resortName} — change`} items={[{ label: c.title, value: c.detail, prov: c.prov }]} /> : null}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[13.5px] text-ink-2">No status, opening-date or report changes in the last 7 days.</p>
      )}
      {changes.length > list.length ? (
        <p className="tnum mt-2 text-[12.5px] text-ink-3">
          Showing {list.length} of {changes.length} — favourites first, then the newest.
        </p>
      ) : null}
    </Block>
  )
}

export type QuietFeed = 'alerts' | 'changes' | 'events' | 'snow'

/**
 * The feeds with nothing to show, folded into one quiet block (one honest line each) instead of a stack of empty
 * panels. Feeds with content render as their own blocks.
 */
export function QuietFeeds({
  feeds,
  units,
  thresholdCm,
  weatherMissing,
}: {
  feeds: QuietFeed[]
  units: UnitPrefs
  thresholdCm: number
  weatherMissing: boolean
}) {
  if (!feeds.length) return null
  const threshold = formatSnow(thresholdCm, units)
  const rows: Record<
    QuietFeed,
    {
      Icon: typeof Siren
      title: string
      text: string
      href: string
      link: string
    }
  > = {
    alerts: {
      Icon: BellOff,
      title: 'Unread alerts',
      text: 'You’re up to date.',
      href: '/settings',
      link: 'Alert rules',
    },
    changes: {
      Icon: CalendarClock,
      title: 'Recent changes',
      text: 'No status, opening-date or report changes in the last 7 days.',
      href: '/explore',
      link: 'Explore',
    },
    events: {
      Icon: CalendarDays,
      title: 'Events',
      text: 'None on record at your favourites or trip resorts in the next 14 days — only announced events are listed.',
      href: '/explore/events',
      link: 'All events',
    },
    snow: {
      Icon: Snowflake,
      title: 'New-snow watch',
      text: weatherMissing
        ? 'No weather fetched yet, so nothing can be watched — not a forecast of no snow.'
        : `No resort is likely to reach ${threshold} in the next 72 hours (weather model).`,
      href: '/forecast',
      link: 'Forecast',
    },
  }
  return (
    <Block id="quiet-title" eyebrow="Also watching" title="Nothing new here">
      <ul className="divide-y divide-divider border-t border-divider">
        {feeds.map((f) => {
          const r = rows[f]
          return (
            <li key={f} className="flex items-start gap-2.5 py-2.5">
              <r.Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <p className="min-w-0 flex-1 text-[13.5px] text-ink-2">
                <span className="font-semibold text-ink">{r.title}</span> — {r.text}{' '}
                <Link href={r.href} className="font-medium whitespace-nowrap text-teal hover:underline">
                  {r.link}
                </Link>
              </p>
            </li>
          )
        })}
      </ul>
    </Block>
  )
}
