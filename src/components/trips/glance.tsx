/**
 * Planner hero cards (Glass HUD):
 * - BudgetCard: the per-person headline (or "Incomplete estimate" with what is known), then each budget category as
 *   a row — the priced amount for the party with a bar that grows once, or "Not priced" / "Not added" with what to do.
 *   Unknown is never $0.
 * - GlanceCard: booking and checklist progress rings and the next few things to do, each linking to its section.
 */
import { ArrowRight, CalendarPlus } from 'lucide-react'
import type { TripPage } from '@/lib/data/trip-plan'
import { KindTag } from '@/components/ui/provenance'
import { formatMoneyRange, money } from '@/lib/domain/money'
import { CATEGORY_LABEL, CATEGORY_OF, CATEGORY_ORDER, icsUrl, plural, quoteState, rangeText, type CategoryKey } from './format'
import { categoryTotals } from './model'
import { GrowBar, Ring } from './hud-bits'

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

interface CatRow {
  key: CategoryKey
  label: string
  value: string
  note: string
  low: number
  high: number
  muted: boolean
}

function budgetRows(page: TripPage): CatRow[] {
  const b = page.budget
  const items = page.detail.items
  const typeOf = new Map(items.map((i) => [i.id, i.type]))
  const priced = categoryTotals<CategoryKey>(b.lines, (t) => CATEGORY_OF[t as keyof typeof CATEGORY_OF] ?? 'other', CATEGORY_ORDER)
  const top = Math.max(1, ...priced.map((c) => c.max))
  const toPrice = new Map<CategoryKey, number>()
  for (const m of [...b.missing, ...b.unconverted]) {
    const ty = typeof m.id === 'number' ? typeOf.get(m.id) : undefined
    if (!ty) continue
    const k = CATEGORY_OF[ty]
    toPrice.set(k, (toPrice.get(k) ?? 0) + 1)
  }
  const count = new Map<CategoryKey, number>()
  for (const i of items) count.set(CATEGORY_OF[i.type], (count.get(CATEGORY_OF[i.type]) ?? 0) + 1)
  const nights = Math.max(0, page.days.length - 1)
  const always: CategoryKey[] = ['travel', ...(nights ? (['lodging'] as const) : []), 'lift']
  const keys = CATEGORY_ORDER.filter((k) => always.includes(k) || count.has(k))
  return keys.map((k) => {
    const p = priced.find((c) => c.key === k)
    const open = toPrice.get(k) ?? 0
    const n = count.get(k) ?? 0
    const accounted = k === 'lift' ? b.accounted.length : 0
    const label = CATEGORY_LABEL[k]
    if (p) {
      return {
        key: k,
        label,
        value: formatMoneyRange(money(p.min, b.currency), money(p.max, b.currency)) ?? '',
        note: [plural(p.lines, 'priced item'), open ? `${open} to price` : null].filter(Boolean).join(' · '),
        low: p.min / top,
        high: p.max / top,
        muted: false,
      }
    }
    if (k === 'lift' && accounted && !open) return { key: k, label, value: 'Covered', note: 'by your pass', low: 0, high: 0, muted: true }
    if (n) return { key: k, label, value: 'Not priced', note: `${plural(n, 'item')} · add a price`, low: 0, high: 0, muted: true }
    return { key: k, label, value: 'Not added', note: k === 'travel' ? 'drive or fly' : k === 'lodging' ? plural(nights, 'night') : 'ticket or pass', low: 0, high: 0, muted: true }
  })
}

export function BudgetCard({ page }: { page: TripPage }) {
  const b = page.budget
  const anyPriced = b.lines.some((l) => l.groupTotal)
  const rows = budgetRows(page)
  return (
    <section aria-labelledby="budget-card-title" className="glass flex flex-col gap-3 rounded-[28px] px-4 py-5 sm:px-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="budget-card-title" className="hud m-0 text-ink-2">
          Budget · per person
        </h2>
        <span className="hud text-right text-copper">{!anyPriced ? 'Nothing priced' : b.complete ? 'Every item priced' : 'Partly unknown'}</span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {!anyPriced ? (
          <p className="text-[30px] leading-none font-light tracking-[-0.03em] text-ink-2">No costs yet</p>
        ) : b.complete && b.perPersonTotal ? (
          <p className="text-[40px] leading-none font-light tracking-[-0.03em] text-ink tnum">{rangeText(b.perPersonTotal)}</p>
        ) : (
          <p className="text-[30px] leading-none font-light tracking-[-0.03em] text-ink-2">
            Incomplete <span className="text-[15px] tracking-normal text-ink tnum">· {rangeText(b.perPersonMax)} known</span>
          </p>
        )}
        <p className="text-[12.5px] text-ink-2 tnum">
          {anyPriced ? `${rangeText(b.complete ? b.total : b.group)} for ${plural(b.partySize, 'person', 'people')}` : `party of ${b.partySize}`} {page.demo ? <KindTag kind="demo" /> : null}
        </p>
      </div>
      <ul className="flex flex-col">
        {rows.map((r, k) => (
          <li key={r.key} className="border-t border-divider py-2.5">
            <a href={r.key === 'travel' ? '#travel' : r.key === 'lodging' ? '#stay' : r.key === 'lessons' || r.key === 'rentals' ? '#learning' : r.key === 'lift' || r.key === 'events' || r.key === 'food' ? '#extras' : '#budget'} className="group/b flex items-start justify-between gap-3 rounded-[10px] outline-offset-2">
              <span className="min-w-0 text-[14px] text-ink group-hover/b:text-teal">{r.label}</span>
              <span className="text-right">
                <span className={r.muted ? 'block text-[14px] font-medium text-ink-2' : 'block text-[14px] font-semibold text-ink tnum'}>{r.value}</span>
                <span className="block font-mono text-[11px] tracking-[0.08em] text-ink-2 uppercase">{r.note}</span>
              </span>
            </a>
            {r.high > 0 ? <GrowBar low={r.low} high={r.high} delay={0.05 * k} className="mt-1.5" /> : null}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-ink-3">Your estimates, quotes and actuals only — never live prices. Party totals in {b.currency}.</p>
    </section>
  )
}

export function GlanceCard({ page }: { page: TripPage }) {
  const items = page.detail.items
  const booked = items.filter((i) => i.status === 'booked').length
  const cl = page.detail.checklist
  const clDone = cl.filter((c) => c.done).length
  const steps = nextSteps(page)
  const skiDays = new Set(page.detail.resortDays.map((d) => d.date)).size
  return (
    <section aria-labelledby="glance-title" className="glass flex flex-col gap-4 rounded-[28px] px-4 py-5 sm:px-[22px]">
      <h2 id="glance-title" className="hud m-0 text-ink-2">
        Trip at a glance
      </h2>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        <a href="#itinerary" className="flex items-center gap-3 rounded-[18px] bg-ink/[0.04] p-3 transition-transform duration-150 hover:-translate-y-0.5">
          <Ring value={items.length ? booked / items.length : 0} tone="positive">
            {booked}
          </Ring>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-ink">Booked</span>
            <span className="block text-[12.5px] text-ink-2 tnum">of {plural(items.length, 'item')}</span>
          </span>
        </a>
        <a href="#checklist" className="flex items-center gap-3 rounded-[18px] bg-ink/[0.04] p-3 transition-transform duration-150 hover:-translate-y-0.5">
          <Ring value={cl.length ? clDone / cl.length : 0}>{clDone}</Ring>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-ink">Checklist</span>
            <span className="block text-[12.5px] text-ink-2 tnum">{cl.length ? `of ${cl.length} done` : 'empty'}</span>
          </span>
        </a>
      </div>
      <p className="hud text-ink-2">
        {plural(skiDays, 'ski day')} · {plural(Math.max(0, page.days.length - 1), 'night')} · party of {page.trip.partySize}
      </p>
      {steps.length ? (
        <div>
          <p className="hud mb-1 text-teal">Next steps</p>
          <ul className="flex flex-col">
            {steps.map((s) => (
              <li key={s.text} className="border-t border-divider first:border-0">
                <a href={s.href} className="group/step flex min-h-11 items-center justify-between gap-2 py-1.5 text-[14px] text-ink hover:text-teal">
                  <span className="flex items-start gap-2.5">
                    <span aria-hidden className={s.tone === 'critical' ? 'mt-[7px] size-1.5 shrink-0 rounded-full bg-critical' : s.tone === 'caution' ? 'mt-[7px] size-1.5 shrink-0 rounded-full bg-caution' : 'mt-[7px] size-1.5 shrink-0 rounded-full bg-teal'} />
                    <span className={s.tone === 'critical' ? 'text-critical' : undefined}>{s.text}</span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover/step:translate-x-0.5 group-hover/step:text-teal" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-auto border-t border-divider pt-3">
        <a href={icsUrl(page.trip.id)} download className="inline-flex min-h-10 items-center gap-2 text-[13.5px] font-medium text-teal hover:underline">
          <CalendarPlus aria-hidden className="size-4" /> Export to calendar (.ics)
        </a>
        <p className="text-[12px] text-ink-3">Every dated item as an all-day entry; timed events keep their local time.{page.demo ? ' Demo exports are labelled [DEMO].' : ''}</p>
      </div>
    </section>
  )
}
