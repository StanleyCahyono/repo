/**
 * 06 Stay & après — the curated hotels (tier, brand, distance/transfer as researched, ski-in/ski-out only when
 * verified, parking/shuttle, official link) with "Check rates" unless a sourced dated quote exists, each savable to
 * a trip; and events, dated vs not announced (a previous edition is never rolled forward). Restaurants and venues
 * appear only when the catalog has them — it has none yet, so that block is omitted.
 */
import Link from 'next/link'
import { ArrowRight, BedDouble, CalendarPlus, ExternalLink, Plus } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Disclosure } from '@/components/ui/disclosure'
import { KindTag } from '@/components/ui/provenance'
import type { HotelView, ResortDetail } from '@/lib/data/resort-detail'
import type { ResortPageExtras } from '@/lib/data/resort-page'
import type { EventView } from '@/lib/data/views'
import { formatMoney, formatMoneyRange } from '@/lib/domain/money'
import { formatLocalDate } from '@/lib/domain/time'
import { ConfirmTag, ResortSection, Src, SubHead } from './section'
import { TripSheet } from './trip-sheet'
import { clock, confirmText, dayLabel, dotJoin, EVENT_STATUS_TEXT, hostOf, HOTEL_TIER_LABEL, needsCheck, shortDate, src, type PageView } from './format'

const TIER_ORDER = ['budget', 'comfortable', 'premium']

const categoryText = (c: string) => {
  const t = c.replace(/-/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function StaySection({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const lodging = d.links.find((l) => l.key === 'lodging')?.url ?? null
  return (
    <ResortSection id="stay" index={6} title="Stay & après" meta={d.hotels.length ? `${d.hotels.length} curated hotel${d.hotels.length === 1 ? '' : 's'}` : null}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Hotels d={d} x={x} v={v} lodging={lodging} />
        <Events d={d} v={v} />
      </div>
    </ResortSection>
  )
}

function HotelRow({ h, d, x, v }: { h: HotelView; d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const quote = h.quotes[0] ?? null
  const rateUrl = h.officialUrl
  return (
    <li className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15.5px] font-semibold text-ink">{h.name}</span>
          {h.brand ? <span className="text-[12.5px] text-ink-3">{h.brand}</span> : null}
          {h.origin === 'user' ? <KindTag kind="manual" /> : null}
          <Src title={h.name} items={[src(h.name, h.prov, h.distanceText)]} />
        </div>
        <p className="mt-1 text-[13.5px] text-ink-2">{h.distanceText ?? 'Distance to the lifts not recorded.'}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {needsCheck(h.prov) ? <ConfirmTag text={confirmText(h.prov)} /> : null}
          <span className={cn('text-[12.5px]', h.skiInOut === 'verified-yes' ? 'font-medium text-positive' : 'text-ink-3')}>
            Ski-in/ski-out: {h.skiInOut === 'verified-yes' ? 'yes (verified)' : h.skiInOut === 'verified-no' ? 'no (verified)' : 'not verified'}
          </span>
        </div>
        {/* Parking, shuttle and the research notes are secondary — one click away. */}
        <Disclosure summary="Parking, shuttle and notes" className="mt-1">
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
            <dt className="text-ink-3">Parking</dt>
            <dd className="text-ink-2">{h.parking ?? <span className="text-ink-3 italic">Unknown</span>}</dd>
            <dt className="text-ink-3">Shuttle</dt>
            <dd className="text-ink-2">{h.shuttle ?? <span className="text-ink-3 italic">Unknown</span>}</dd>
          </dl>
          {h.notes ? <p className="mt-2 max-w-[68ch] text-[12.5px] break-words text-ink-3">{h.notes}</p> : null}
        </Disclosure>
      </div>
      <div className="flex flex-row flex-wrap items-center gap-2 sm:w-[168px] sm:flex-col sm:items-stretch">
        {quote ? (
          <div className="rounded-md border border-divider bg-surface-2 px-2.5 py-1.5 text-[12.5px] sm:mb-1">
            <p className="text-[16px] font-semibold text-ink tnum">{formatMoneyRange(quote.amount, quote.amountMax)}</p>
            <p className="text-ink-3">
              {dotJoin(quote.item, quote.appliesFrom ? `${shortDate(quote.appliesFrom)}${quote.appliesTo ? `–${shortDate(quote.appliesTo)}` : ''}` : null, quote.quoteLabel, quote.includesTax === false ? 'before tax' : null)}
            </p>
          </div>
        ) : null}
        {rateUrl ? (
          <a
            href={rateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-divider-strong bg-surface px-3 text-[14px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal"
          >
            {quote ? 'Official site' : 'Check rates'} <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">on {hostOf(rateUrl)} (opens a new tab)</span>
          </a>
        ) : (
          <span className="text-[12.5px] text-ink-3 italic">No official link</span>
        )}
        <TripSheet
          target={{ kind: 'hotel', resortId: v.id, resortName: v.shortName, hotelId: h.id, hotelName: h.name }}
          trips={x.trips}
          date={v.date}
          today={v.homeToday}
          flyIn={d.travel.airports.length > 0 && d.travel.driveMinutes === null}
          demo={v.demo}
          triggerClassName="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-[14px] font-medium text-teal transition-colors duration-150 hover:bg-glacier/60"
          triggerContent={
            <>
              <Plus aria-hidden className="size-4" /> Save to trip
            </>
          }
        />
      </div>
    </li>
  )
}

function Hotels({ d, x, v, lodging }: { d: ResortDetail; x: ResortPageExtras; v: PageView; lodging: string | null }) {
  const byTier = TIER_ORDER.map((t) => ({ tier: t, hotels: d.hotels.filter((h) => (h.tier ?? 'comfortable') === t) })).filter((g) => g.hotels.length)
  const untiered = d.hotels.filter((h) => h.tier && !TIER_ORDER.includes(h.tier))
  return (
    <section aria-labelledby="hotels-title" className="min-w-0">
      <SubHead
        id="hotels-title"
        aside={
          lodging ? (
            <a href={lodging} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-teal hover:underline">
              Resort lodging page <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null
        }
      >
        Hotels
      </SubHead>
      {d.hotels.length ? (
        <div className="flex flex-col gap-4">
          {[...byTier, ...(untiered.length ? [{ tier: 'other', hotels: untiered }] : [])].map((g) => (
            <div key={g.tier}>
              <p className="eyebrow mb-1.5 flex items-center gap-1.5">
                <BedDouble aria-hidden className="size-3.5" /> {HOTEL_TIER_LABEL[g.tier] ?? 'Other'}
              </p>
              <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
                {g.hotels.map((h) => (
                  <HotelRow key={h.id} h={h} d={d} x={x} v={v} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[13.5px] text-ink-2">
          No hotels are curated for {v.shortName} yet{lodging ? ' — see the resort’s lodging page' : ''}.
        </p>
      )}
      <p className="mt-3 text-[12.5px] text-ink-3">
        Room prices appear only for a sourced quote with dates, occupancy, fees and currency — otherwise “Check rates”. Distances are as researched, not measured.
      </p>
    </section>
  )
}

function eventWhen(e: EventView): string {
  if (!e.startLocal) return 'Date not announced'
  const start = e.startLocal.slice(0, 10)
  const end = e.endLocal?.slice(0, 10) ?? null
  const time = e.startLocal.length > 10 ? clock(e.startLocal.slice(11, 16)) : null
  return dotJoin(end && end !== start ? `${dayLabel(start)} – ${dayLabel(end)}` : formatLocalDate(start, 'cccc d LLL yyyy'), time ? `${time} local` : null)
}

function EventRow({ e, past = false }: { e: EventView; past?: boolean }) {
  const start = e.startDate
  return (
    <li className={cn('grid grid-cols-[52px_minmax(0,1fr)] gap-3 px-4 py-3.5', past && 'opacity-80')}>
      {start ? (
        <span aria-hidden className="flex h-[52px] flex-col items-center justify-center rounded-md border border-divider bg-surface-2 leading-none">
          <span className="text-[11.5px] font-semibold text-ink-3 uppercase">{formatLocalDate(start, 'LLL')}</span>
          <span className="font-display text-[22px] text-ink tnum">{formatLocalDate(start, 'd')}</span>
        </span>
      ) : (
        <span aria-hidden className="flex h-[52px] items-center justify-center rounded-md border border-dashed border-divider-strong text-[11.5px] leading-tight font-semibold text-ink-3">
          TBA
        </span>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px] font-semibold text-ink">{e.title}</span>
          <span
            className={cn(
              'inline-flex h-5 items-center rounded-sm border px-1.5 text-[11.5px] font-medium',
              e.status === 'announced' && 'border-teal/50 text-teal',
              e.status === 'tentative' && 'border-dashed border-caution/60 text-caution',
              e.status === 'not-announced' && 'border-dashed border-divider-strong text-ink-2',
              (e.status === 'postponed' || e.status === 'cancelled') && 'border-critical/50 text-critical',
            )}
          >
            {EVENT_STATUS_TEXT[e.status] ?? e.status}
          </span>
          <Src title={e.title} items={[src(e.title, e.prov, eventWhen(e))]} />
        </div>
        <p className="text-[13px] text-ink-2 tnum">{dotJoin(e.startLocal ? eventWhen(e) : null, e.venue, categoryText(e.category))}</p>
        {!e.startLocal && e.lastEdition ? <p className="text-[12.5px] text-ink-3">Last edition: {e.lastEdition}. Not rolled forward — wait for the organiser to announce it.</p> : null}
        <p className="text-[12.5px] text-ink-3">
          {dotJoin(
            e.price ? `Price ${formatMoney(e.price)}` : e.startLocal ? 'Price not listed' : null,
            e.ageRestriction,
            e.bookingRequired === true ? 'Booking required' : e.bookingRequired === false ? 'No booking needed' : null,
            e.lastVerifiedAt ? `checked ${shortDate(e.lastVerifiedAt.slice(0, 10))}` : null,
          )}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {e.ticketUrl ? (
            <a href={e.ticketUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline">
              Tickets <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
          {e.officialUrl ? (
            <a href={e.officialUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline">
              Official page <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
          {e.startLocal && !past ? (
            <a href={`/api/export/ics?event=${encodeURIComponent(e.id)}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline" download>
              <CalendarPlus aria-hidden className="size-3.5" /> Add to calendar (.ics)
            </a>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function Events({ d, v }: { d: ResortDetail; v: PageView }) {
  const ev = d.events
  const eventsLink = d.links.find((l) => l.key === 'events')?.url ?? null
  const none = !ev.upcoming.length && !ev.undated.length && !ev.past.length
  return (
    <section aria-labelledby="events-title" className="min-w-0">
      <SubHead
        id="events-title"
        aside={
          <Link href="/explore/events" className="inline-flex items-center gap-1 text-teal hover:underline">
            All events <ArrowRight aria-hidden className="size-3" />
          </Link>
        }
      >
        Events
      </SubHead>
      {none ? (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[13.5px] text-ink-2">
          No events are recorded for {v.shortName}.{' '}
          {eventsLink ? (
            <a href={eventsLink} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
              Check the official events page
            </a>
          ) : (
            'Nothing is invented to fill the gap.'
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {ev.upcoming.length ? (
            <div>
              <p className="eyebrow mb-1.5">Dated</p>
              <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
                {ev.upcoming.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            </div>
          ) : null}
          {ev.undated.length ? (
            <div>
              <p className="eyebrow mb-1.5">Not announced yet</p>
              <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-dashed border-divider-strong bg-surface">
                {ev.undated.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            </div>
          ) : null}
          {ev.past.length ? (
            <Disclosure summary={`Past events (${ev.past.length})`}>
              <ul className="mt-2 flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
                {ev.past.map((e) => (
                  <EventRow key={e.id} e={e} past />
                ))}
              </ul>
            </Disclosure>
          ) : null}
          {eventsLink ? (
            <a href={eventsLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-teal hover:underline">
              Resort events calendar <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </div>
      )}
    </section>
  )
}
