/**
 * Trip at a glance: the budget headline (or "Incomplete estimate" with what is known), booking and checklist
 * progress, and the next few things to do — each linking to its section. Sticky beside the plan on wide screens,
 * directly under the header on narrow ones.
 */
import { ArrowRight, CalendarPlus } from 'lucide-react'
import type { TripPage } from '@/lib/data/trip-plan'
import { KindTag } from '@/components/ui/provenance'
import { icsUrl, plural, quoteState, rangeText } from './format'

interface Step {
  text: string
  href: string
  tone?: 'caution' | 'critical'
}

function nextSteps(page: TripPage): Step[] {
  const steps: Step[] = []
  const b = page.budget
  const items = page.detail.items
  const priced = b.missing.filter((m) => {
    const i = items.find((x) => x.id === m.id)
    return i && i.type !== 'resort-day'
  })
  const skiUnpriced = b.missing.length - priced.length
  for (const q of items.map((i) => ({ i, q: quoteState(i, page.today) })).filter((x) => x.q && x.q.state !== 'valid')) {
    steps.push({ text: q.q!.state === 'expired' ? `Quote for ${q.i.title} has expired — re-check it` : `Quote for ${q.i.title} expires ${q.q!.days <= 0 ? 'today' : q.q!.days === 1 ? 'tomorrow' : `in ${q.q!.days} days`}`, href: '#budget', tone: q.q!.state === 'expired' ? 'critical' : 'caution' })
  }
  const unconfirmed = page.detail.dayAccess.filter((d) => d.access.status === 'unconfirmed')
  if (unconfirmed.length) steps.push({ text: `Pass access not confirmed for ${plural(unconfirmed.length, 'ski day')} — check the official page`, href: '#itinerary', tone: 'caution' })
  if (priced.length) steps.push({ text: priced.length === 1 ? `Add a price for ${priced[0].title}` : `Add prices for ${priced.length} items`, href: '#budget-missing' })
  if (skiUnpriced) steps.push({ text: `Price lift access for ${plural(skiUnpriced, 'ski day')}`, href: '#extras' })
  if (b.unconverted.length) steps.push({ text: `Add an exchange rate for ${plural(b.unconverted.length, 'item')}`, href: '#budget-missing' })
  const nights = page.days.length - 1
  const hasTravel = items.some((i) => i.type === 'flight' || i.type === 'drive' || i.type === 'transfer')
  if (!hasTravel && page.detail.resortDays.length) steps.push({ text: 'Plan how you get there', href: '#travel' })
  if (nights > 0 && !items.some((i) => i.type === 'lodging')) steps.push({ text: `Choose where to stay (${plural(nights, 'night')})`, href: '#stay' })
  if (!page.detail.resortDays.length) steps.push({ text: 'Add a ski day to the itinerary', href: '#itinerary' })
  const left = page.detail.checklist.filter((c) => !c.done).length
  if (left) steps.push({ text: `${plural(left, 'checklist item')} to go`, href: '#checklist' })
  return steps.slice(0, 5)
}

export function TripGlance({ page }: { page: TripPage }) {
  const b = page.budget
  const items = page.detail.items
  const count = { booked: items.filter((i) => i.status === 'booked').length, draft: items.filter((i) => i.status === 'draft').length, idea: items.filter((i) => i.status === 'idea').length }
  const total = items.length || 1
  const cl = page.detail.checklist
  const clDone = cl.filter((c) => c.done).length
  const steps = nextSteps(page)
  const skiDays = new Set(page.detail.resortDays.map((d) => d.date)).size

  return (
    <aside aria-labelledby="glance-title" className="rounded-[14px] border border-divider bg-surface">
      <h2 id="glance-title" className="sr-only">
        Trip at a glance
      </h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-4 xl:grid-cols-1 xl:p-5">
        <div className="col-span-2 sm:col-span-2 xl:col-span-1">
          <p className="eyebrow flex items-center gap-2">
            Per person {page.demo ? <KindTag kind="demo" /> : null}
          </p>
          {!b.lines.some((l) => l.groupTotal) ? (
            <>
              <p className="mt-1 font-display text-[26px] leading-none text-ink-2 xl:text-[30px]">No costs entered yet</p>
              <p className="mt-1 text-[12.5px] text-ink-2">{b.accounted.some((a) => a.by === 'pass') ? 'Lift access is covered by your pass; add travel, lodging or food to build the budget.' : 'Add a price to any item to start the budget.'}</p>
            </>
          ) : b.complete && b.perPersonTotal ? (
            <>
              <p className="mt-1 font-display text-[34px] leading-none text-ink tnum xl:text-[40px]">{rangeText(b.perPersonTotal)}</p>
              <p className="mt-1 text-[12.5px] text-ink-2 tnum">
                {rangeText(b.total)} for {plural(b.partySize, 'person', 'people')}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 font-display text-[26px] leading-none text-ink-2 xl:text-[30px]">Incomplete estimate</p>
              <p className="mt-1 text-[12.5px] text-ink-2 tnum">
                {rangeText(b.perPersonMax)} known · {b.missing.length + b.unconverted.length} to price
              </p>
            </>
          )}
          <p className="mt-1 text-[12px] text-ink-3">Your estimates, quotes and actuals — never live prices</p>
        </div>
        <div>
          <p className="eyebrow">Booked</p>
          <p className="mt-1 text-[15px] font-semibold text-ink tnum">
            {count.booked} <span className="font-normal text-ink-3">of {items.length}</span>
          </p>
          <div aria-hidden className="mt-1.5 flex h-1.5 gap-[2px] overflow-hidden rounded-full">
            <span className="h-full rounded-l-full bg-positive" style={{ width: `${(count.booked / total) * 100}%` }} />
            <span className="h-full bg-ink-3/45" style={{ width: `${(count.draft / total) * 100}%` }} />
            <span className="h-full rounded-r-full bg-surface-3" style={{ width: `${(count.idea / total) * 100}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-ink-3">
            {count.draft} draft · {count.idea} idea{count.idea === 1 ? '' : 's'}
          </p>
        </div>
        <div>
          <p className="eyebrow">Checklist</p>
          <p className="mt-1 text-[15px] font-semibold text-ink tnum">
            {clDone} <span className="font-normal text-ink-3">of {cl.length}</span>
          </p>
          <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-teal" style={{ width: `${cl.length ? (clDone / cl.length) * 100 : 0}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-ink-3">
            {plural(skiDays, 'ski day')} · {plural(Math.max(0, page.days.length - 1), 'night')}
          </p>
        </div>
      </div>
      {steps.length ? (
        <div className="border-t border-divider px-4 py-3 xl:px-5">
          <p className="eyebrow mb-1.5">Next steps</p>
          <ul className="flex flex-col">
            {steps.map((s) => (
              <li key={s.text}>
                <a href={s.href} className="group/step flex min-h-10 items-center justify-between gap-2 rounded-md py-1.5 text-[13.5px] text-ink hover:text-teal">
                  <span className="flex items-start gap-2">
                    <span aria-hidden className={s.tone === 'critical' ? 'mt-[7px] size-1.5 shrink-0 rounded-full bg-critical' : s.tone === 'caution' ? 'mt-[7px] size-1.5 shrink-0 rounded-full bg-caution' : 'mt-[7px] size-1.5 shrink-0 rounded-full bg-divider-strong'} />
                    <span className={s.tone === 'critical' ? 'text-critical' : undefined}>{s.text}</span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover/step:translate-x-0.5 group-hover/step:text-teal" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="border-t border-divider px-4 py-3 xl:px-5">
        <a href={icsUrl(page.trip.id)} download className="inline-flex min-h-10 items-center gap-2 text-[13.5px] font-medium text-teal hover:underline">
          <CalendarPlus aria-hidden className="size-4" /> Export to calendar (.ics)
        </a>
        <p className="text-[12px] text-ink-3">Every dated item as an all-day entry; timed events keep their local time.{page.demo ? ' Demo exports are labelled [DEMO].' : ''}</p>
      </div>
    </aside>
  )
}
