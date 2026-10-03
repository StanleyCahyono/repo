/**
 * 05 Tickets, food & events — lift tickets (with a note when a pass you own covers a ticketed day: you may not need
 * the ticket), food, and events: the ones you saved plus the catalog's events at the trip's resorts — during the trip,
 * with no announced date (never assumed), or at other dates. Dated events export to your calendar (ICS).
 */
import { CalendarDays, CalendarPlus, CircleDashed, Ticket, UtensilsCrossed } from 'lucide-react'
import { Missing } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { EventOption, TripPage } from '@/lib/data/trip-plan'
import { formatMoney } from '@/lib/domain/money'
import { formatLocalDate } from '@/lib/domain/time'
import { SubHead, TripSection } from './bits'
import { EVENT_STATUS_LABEL, dayLabel, eventIcsUrl } from './format'
import { AddItemButton, QuickAdd } from './add-buttons'
import { ItemRow } from './item-row'
import { mainResort } from './travel-section'

const WHEN_HEAD: Record<EventOption['when'], string> = { during: 'During your trip', undated: 'Date not announced', other: 'Other dates this season' }

export function ExtrasSection({ page, index }: { page: TripPage; index: number }) {
  const tickets = page.detail.items.filter((i) => i.type === 'lift-ticket')
  const food = page.detail.items.filter((i) => i.type === 'food')
  const events = page.detail.items.filter((i) => i.type === 'event')
  const main = mainResort(page)
  const firstSki = page.detail.resortDays[0]?.date ?? page.trip.startDate
  const lastSki = page.detail.resortDays.at(-1)?.date ?? page.trip.endDate
  const covered = page.detail.dayAccess.filter((d) => d.access.status === 'covered')
  const unsaved = page.events.filter((e) => e.savedItemId === null)
  const groups = (['during', 'undated', 'other'] as const).map((w) => ({ w, list: unsaved.filter((e) => e.when === w) })).filter((g) => g.list.length)

  return (
    <TripSection id="extras" index={index} title="Tickets, food & events" meta="Lift access, meals and what’s on while you’re there">
      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="tickets-title" className="min-w-0">
          <SubHead id="tickets-title" aside={<AddItemButton type="lift-ticket" defaults={{ refId: main?.id, date: firstSki, endDate: lastSki !== firstSki ? lastSki : undefined }}>Lift ticket</AddItemButton>}>
            <span className="inline-flex items-center gap-2">
              <Ticket aria-hidden className="size-4 text-ink-2" /> Lift tickets
            </span>
          </SubHead>
          {tickets.length ? (
            <ul className="flex flex-col rounded-[20px] border border-divider bg-surface/70 p-1.5">
              {tickets.map((t) => {
                const overlap = covered.filter((c) => c.resortId === t.refId && t.date && c.date >= t.date && c.date <= (t.endDate ?? t.date))
                return (
                  <li key={t.id}>
                    <ItemRow
                      item={t}
                      extra={
                        overlap.length ? (
                          <p className="mt-1 text-[12.5px] font-medium text-positive">
                            {overlap[0].access.productName} covers {overlap.map((o) => dayLabel(o.date)).join(', ')} — you may not need a ticket {overlap.length === 1 ? 'that day' : 'those days'}.
                          </p>
                        ) : null
                      }
                    />
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="rounded-[20px] border border-dashed border-divider-strong px-4 py-3 text-[13.5px] text-ink-2">
              No lift ticket saved.{' '}
              {page.detail.resortDays.length ? (covered.length === page.detail.resortDays.length ? 'Your pass covers every planned ski day.' : 'Ski days without a ticket or a covering pass stay unpriced in the budget.') : null}
            </p>
          )}
          {main?.links.tickets ? (
            <p className="mt-2 text-[13px]">
              <a href={main.links.tickets} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
                Tickets at {main.shortName}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <span className="text-ink-3"> — check the official price for your dates</span>
            </p>
          ) : null}
        </section>

        <section aria-labelledby="food-title" className="min-w-0">
          <SubHead id="food-title" aside={<AddItemButton type="food" defaults={{ refId: main?.id, date: page.trip.startDate, endDate: page.trip.endDate !== page.trip.startDate ? page.trip.endDate : undefined }}>Food</AddItemButton>}>
            <span className="inline-flex items-center gap-2">
              <UtensilsCrossed aria-hidden className="size-4 text-ink-2" /> Food
            </span>
          </SubHead>
          {food.length ? (
            <ul className="flex flex-col rounded-[20px] border border-divider bg-surface/70 p-1.5">
              {food.map((f) => (
                <li key={f.id}>
                  <ItemRow item={f} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-[20px] border border-dashed border-divider-strong px-4 py-3 text-[13.5px] text-ink-2">No food budget yet. The day basket uses your lunch estimate from Settings as a reference only.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="events-title" className="mt-8">
        <SubHead id="events-title" aside={<AddItemButton type="event" defaults={{ date: page.trip.startDate }}>Your own event</AddItemButton>}>
          <span className="inline-flex items-center gap-2">
            <CalendarDays aria-hidden className="size-4 text-ink-2" /> Events
          </span>
        </SubHead>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {events.length ? (
              <ul className="flex flex-col rounded-[20px] border border-divider bg-surface/70 p-1.5">
                {events.map((e) => {
                  const ev = page.events.find((x) => x.id === e.refId)
                  return (
                    <li key={e.id}>
                      <ItemRow
                        item={e}
                        extra={
                          ev ? (
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                              <span className={ev.status === 'announced' ? 'text-ink-2' : 'font-medium text-caution'}>{EVENT_STATUS_LABEL[ev.status] ?? ev.status}</span>
                              {ev.startDate ? (
                                <a href={eventIcsUrl(ev.id)} className="inline-flex items-center gap-1 font-medium text-teal hover:underline" download>
                                  <CalendarPlus aria-hidden className="size-3.5" /> Add to calendar
                                </a>
                              ) : null}
                              {ev.officialUrl ? (
                                <a href={ev.officialUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
                                  Organiser page<span className="sr-only"> (opens in a new tab)</span>
                                </a>
                              ) : null}
                            </p>
                          ) : null
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="rounded-[20px] border border-dashed border-divider-strong px-4 py-3 text-[13.5px] text-ink-2">No events saved. Save one from the calendar on file, or add your own.</p>
            )}
          </div>
          <div className="min-w-0 rounded-[20px] border border-divider bg-ink/[0.03] p-4">
            <p className="text-[13.5px] font-semibold text-ink">On file at {page.resorts.length === 1 ? page.resorts[0].shortName : 'your resorts'}</p>
            {groups.length ? (
              <div className="mt-2 flex flex-col gap-4">
                {groups.map((g) => (
                  <div key={g.w}>
                    <p className="eyebrow mb-1">{WHEN_HEAD[g.w]}</p>
                    <ul className="flex flex-col divide-y divide-divider">
                      {g.list.map((e) => (
                        <EventLine key={e.id} e={e} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-ink-3">{page.events.length ? 'Every event on file is already on this trip.' : 'No events on file for these resorts. Piste never rolls last season’s festival forward.'}</p>
            )}
          </div>
        </div>
      </section>
    </TripSection>
  )
}

function EventLine({ e }: { e: EventOption }) {
  const when = e.startDate
    ? `${formatLocalDate(e.startDate, 'ccc d LLL')}${e.endDate && e.endDate !== e.startDate ? ` – ${formatLocalDate(e.endDate, 'ccc d LLL')}` : ''}${e.startLocal && e.startLocal.length > 10 ? ` · ${e.startLocal.slice(11, 16)} local` : ''}`
    : null
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-1 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink">{e.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-2">
          {when ? <span className="tnum">{when}</span> : <span className="inline-flex items-center gap-1 text-ink-3 italic"><CircleDashed aria-hidden className="size-3.5 not-italic" /> No date announced — not assumed</span>}
          <span className={e.status === 'announced' ? 'text-ink-3' : 'font-medium text-caution'}>· {EVENT_STATUS_LABEL[e.status] ?? e.status}</span>
          {e.price ? <span className="tnum">· {e.price.amountMinor === 0 ? 'Free' : formatMoney(e.price)}</span> : <span>· <Missing label="price not stated" className="text-[12.5px]" /></span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          {e.startDate ? (
            <a href={eventIcsUrl(e.id)} download className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
              <CalendarPlus aria-hidden className="size-3.5" /> .ics
              <span className="sr-only"> — add {e.title} to your calendar</span>
            </a>
          ) : null}
          {e.officialUrl ? (
            <a href={e.officialUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
              Organiser<span className="sr-only"> page for {e.title} (opens in a new tab)</span>
            </a>
          ) : null}
          {e.prov ? <SourceDrawer title={e.title} items={[{ label: e.title, value: when ?? 'Date not announced', prov: e.prov }]} /> : null}
        </div>
      </div>
      <QuickAdd label="Save" input={{ type: 'event', refId: e.id, status: 'idea' }} />
    </li>
  )
}

