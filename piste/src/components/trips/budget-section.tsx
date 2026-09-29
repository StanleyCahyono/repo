/**
 * 06 Budget — computed by the trip-budget engine (src/lib/domain/costs/trip-budget.ts):
 * per-person and whole-party totals in the display currency, original currencies preserved with the conversion rate
 * and its date, per-person vs shared allocation, and every missing, unconverted or expired item listed. Totals exist
 * only when every item is priced — otherwise it says "Incomplete estimate" and shows what is known so far. Every
 * figure is your own estimate, quote or actual; nothing is presented as a live price.
 */
import { CircleDashed, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { KindTag, Missing } from '@/components/ui/provenance'
import { Disclosure } from '@/components/ui/disclosure'
import type { TripPage } from '@/lib/data/trip-plan'
import type { TripBudgetLine } from '@/lib/domain/costs'
import { formatMoney, formatMoneyRange } from '@/lib/domain/money'
import { CostKindTag, SubHead, TripSection } from './bits'
import { CATEGORY_LABEL, CATEGORY_OF, CATEGORY_ORDER, dayLabel, plural, rangeText, spanLabel, type CategoryKey } from './format'
import { categoryTotals } from './model'
import { BudgetBars } from './budget-bars'
import { EditItemButton } from './edit-item-button'

function fxNote(l: TripBudgetLine): string | null {
  if (!l.fx) return null
  const date = l.fx.rateDate ? ` · ${l.fx.rateDate.slice(0, 10)}` : ''
  return `1 ${l.fx.from} = ${Number(l.fx.rate).toFixed(4)} ${l.fx.to}${date} · ${l.fxSource === 'item' ? 'your rate' : (l.fx.provider ?? 'stored rate')}`
}

function Share({ l, party }: { l: TripBudgetLine; party: number }) {
  if (!l.shares) return null
  const min = l.shares.min.reduce((a, b) => (b.amountMinor > a.amountMinor ? b : a))
  const max = l.shares.max.reduce((a, b) => (b.amountMinor > a.amountMinor ? b : a))
  return <>{party > 1 ? formatMoneyRange(min, max) : null}</>
}

export function BudgetSection({ page, index }: { page: TripPage; index: number }) {
  const b = page.budget
  const party = b.partySize
  const itemById = new Map(page.detail.items.map((i) => [i.id, i]))
  const accounted = new Set(b.accounted.map((a) => a.id))
  const lines = b.lines.filter((l) => !accounted.has(l.id))
  const rows = categoryTotals<CategoryKey>(b.lines, (t) => CATEGORY_OF[t as keyof typeof CATEGORY_OF] ?? 'other', CATEGORY_ORDER).map((c) => ({ ...c, label: CATEGORY_LABEL[c.key] }))
  const demo = page.demo
  const kinds = b.kinds

  return (
    <TripSection
      id="budget"
      index={index}
      title="Budget"
      meta={`In ${b.currency} · party of ${party} · your own estimates, quotes and actuals`}
      lead="Per-person items count once for each person; shared items are split evenly and the shares always add up to the total. Original currencies are kept, with the rate and date used to convert them."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-4 rounded-[12px] border border-divider bg-surface p-5">
          {!b.lines.some((l) => l.groupTotal) ? (
            <div>
              <p className="eyebrow">Per person</p>
              <p className="mt-1 font-display text-[34px] leading-none text-ink-2">No costs entered yet</p>
              <p className="mt-2 text-[14px] text-ink-2">Nothing on this trip has a price yet — unknown is never shown as $0. Add prices to items as you get estimates, quotes or receipts.</p>
            </div>
          ) : b.complete && b.total && b.perPersonTotal ? (
            <>
              <div>
                <p className="eyebrow">Per person</p>
                <p className="mt-1 font-display text-[44px] leading-none text-ink tnum">{rangeText(b.perPersonTotal)}</p>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-[14px] text-ink-2">
                  Whole party <span className="font-semibold text-ink tnum">{rangeText(b.total)}</span>
                </p>
                <p className="text-[13px] text-ink-3">every item priced</p>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="eyebrow">Per person</p>
                <p className="mt-1 font-display text-[34px] leading-none text-ink-2">Incomplete estimate</p>
                <p className="mt-2 text-[14px] text-ink-2">
                  Known so far <span className="font-semibold text-ink tnum">{rangeText(b.perPersonMax)}</span> per person ·{' '}
                  <span className="font-semibold text-ink tnum">{rangeText(b.group)}</span> for the party
                </p>
              </div>
              <p className="inline-flex items-start gap-1.5 text-[13.5px] font-medium text-caution">
                <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0" />
                <a href="#budget-missing" className="underline-offset-2 hover:underline">
                  {b.missing.length ? plural(b.missing.length, 'item') + ' without a price' : ''}
                  {b.missing.length && b.unconverted.length ? ' · ' : ''}
                  {b.unconverted.length ? `${plural(b.unconverted.length, 'item')} not converted to ${b.currency}` : ''}
                </a>
              </p>
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-divider pt-3 text-[12.5px] text-ink-2">
            {demo ? <KindTag kind="demo" /> : null}
            {kinds.estimate ? (
              <span className="inline-flex items-center gap-1">
                <CostKindTag kind="estimate" short /> × {kinds.estimate}
              </span>
            ) : null}
            {kinds.quote ? (
              <span className="inline-flex items-center gap-1">
                <CostKindTag kind="quote" /> × {kinds.quote}
              </span>
            ) : null}
            {kinds.actual ? (
              <span className="inline-flex items-center gap-1">
                <CostKindTag kind="actual" /> × {kinds.actual}
              </span>
            ) : null}
            {!kinds.estimate && !kinds.quote && !kinds.actual ? <span className="text-ink-3">No prices entered yet</span> : null}
          </div>
          {b.expiredQuotes.length ? (
            <p className="inline-flex items-start gap-1.5 text-[13px] font-medium text-critical">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {plural(b.expiredQuotes.length, 'quote')} expired — still counted, but re-check: {b.expiredQuotes.map((q) => q.title).join(', ')}
            </p>
          ) : null}
          {b.accounted.length ? (
            <p className="text-[12.5px] text-ink-3">
              {plural(b.accounted.length, 'ski day')} priced through {[...new Set(b.accounted.map((a) => (a.by === 'pass' ? `your ${a.detail}` : `“${a.detail}”`)))].join(' and ')}.
            </p>
          ) : null}
        </div>

        <div className="min-w-0 rounded-[12px] border border-divider bg-surface p-5">
          <SubHead aside={`Whole party, ${b.currency}`}>Where the money goes</SubHead>
          {rows.length ? (
            <BudgetBars rows={rows} currency={b.currency} caption={`Priced items by category, whole party, ${b.currency}. Ranges show your low and high estimates.`} />
          ) : (
            <p className="text-[13.5px] text-ink-3 italic">Nothing priced yet.</p>
          )}
          {rows.some((r) => r.max !== r.min) ? (
            <p className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
              <span aria-hidden className="inline-block h-2 w-5 rounded-r-[3px] bg-teal" /> low end
              <span aria-hidden className="ml-2 inline-block h-2 w-5 rounded-r-[3px] bg-teal/30" /> up to the high end of your range
            </p>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="budget-lines" className="mt-8">
        <SubHead id="budget-lines" aside={plural(lines.length, 'line')}>
          Itemised
        </SubHead>
        {/* Wide screens: table */}
        <div className="hidden overflow-x-auto rounded-[12px] border border-divider bg-surface md:block">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <caption className="sr-only">Every trip item with its price as entered, the converted amount and the party total</caption>
            <thead>
              <tr className="border-b border-divider bg-surface-2 text-left text-[12px] text-ink-3">
                <th scope="col" className="px-4 py-2 font-medium">Item</th>
                <th scope="col" className="px-3 py-2 font-medium">Basis</th>
                <th scope="col" className="px-3 py-2 font-medium">Kind</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">As entered</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Each</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Party ({b.currency})</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const item = typeof l.id === 'number' ? itemById.get(l.id) : undefined
                const fx = fxNote(l)
                return (
                  <tr key={String(l.id)} className="border-b border-divider align-top last:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <p className="font-medium text-ink">{l.title}</p>
                      <p className="text-[12px] text-ink-3 tnum">{item ? (spanLabel(item.date, item.endDate) ?? 'Not scheduled') : l.date ? dayLabel(l.date) : ''}</p>
                      {l.flags.length ? <p className="text-[12px] text-caution">{l.flags.join(' ')}</p> : null}
                    </th>
                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-2">{l.costBasis === 'per-person' ? `Per person × ${party}` : `Shared ÷ ${party}`}</td>
                    <td className="px-3 py-2.5">{l.costKind ? <CostKindTag kind={l.costKind} short /> : <span className="text-ink-3">—</span>}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tnum">
                      {l.original ? formatMoneyRange(l.original.min, l.original.max) : item ? <EditItemButton item={item} label="Add price" /> : <Missing />}
                      {fx ? <p className="text-[12px] text-ink-3">{fx}</p> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tnum">
                      <Share l={l} party={party} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap text-ink tnum">{l.groupTotal ? formatMoneyRange(l.groupTotal.min, l.groupTotal.max) : l.original ? <span className="text-[12.5px] font-normal text-caution">not converted</span> : <Missing />}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-divider-strong bg-surface-2">
                <th scope="row" colSpan={4} className="px-4 py-2.5 text-left text-[13px] font-semibold text-ink">
                  {b.complete ? 'Trip total' : 'Known so far (incomplete)'}
                </th>
                <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tnum">{party > 1 ? rangeText(b.complete ? b.perPersonTotal : b.perPersonMax) : null}</td>
                <td className="px-4 py-2.5 text-right text-[14.5px] font-semibold whitespace-nowrap text-ink tnum">{rangeText(b.complete ? b.total : b.group)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {/* Narrow screens: list */}
        <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface md:hidden">
          {lines.map((l) => {
            const item = typeof l.id === 'number' ? itemById.get(l.id) : undefined
            const fx = fxNote(l)
            return (
              <li key={String(l.id)} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-[14px] font-medium text-ink">{l.title}</p>
                  <p className="shrink-0 text-right text-[14px] font-semibold text-ink tnum">{l.groupTotal ? formatMoneyRange(l.groupTotal.min, l.groupTotal.max) : l.original ? formatMoneyRange(l.original.min, l.original.max) : null}</p>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-2">
                  {l.costKind ? <CostKindTag kind={l.costKind} short /> : null}
                  <span>{l.costBasis === 'per-person' ? `per person × ${party}` : `shared ÷ ${party}`}</span>
                  {l.original && l.groupTotal && ((l.costBasis === 'per-person' && party > 1) || l.fx) ? <span className="tnum">· {formatMoneyRange(l.original.min, l.original.max)} as entered</span> : null}
                  {l.original && !l.groupTotal ? <span className="font-medium text-caution">· not converted to {b.currency}</span> : null}
                </p>
                {fx ? <p className="text-[12px] text-ink-3">{fx}</p> : null}
                {!l.original && item ? <EditItemButton item={item} label="Add price" className="mt-1.5" /> : null}
              </li>
            )
          })}
          <li className={cn('flex items-baseline justify-between gap-3 bg-surface-2 px-4 py-3')}>
            <p className="text-[13px] font-semibold text-ink">{b.complete ? 'Trip total' : 'Known so far (incomplete)'}</p>
            <p className="text-[14.5px] font-semibold text-ink tnum">{rangeText(b.complete ? b.total : b.group)}</p>
          </li>
        </ul>
      </section>

      {b.missing.length || b.unconverted.length ? (
        <section id="budget-missing" aria-labelledby="budget-missing-title" className="mt-8 scroll-mt-[120px] md:scroll-mt-[76px]">
          <SubHead id="budget-missing-title" aside="Unknown is never counted as $0">
            Still to price
          </SubHead>
          <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-dashed border-divider-strong bg-surface-2">
            {b.missing.map((m) => {
              const item = typeof m.id === 'number' ? itemById.get(m.id) : undefined
              return (
                <li key={`m${String(m.id)}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">{m.title}</p>
                    <p className="text-[12.5px] text-ink-2">{m.reason}</p>
                  </div>
                  {item ? <EditItemButton item={item} label={item.type === 'resort-day' ? 'Price this day' : 'Add price'} /> : null}
                </li>
              )
            })}
            {b.unconverted.map((u) => {
              const item = typeof u.id === 'number' ? itemById.get(u.id) : undefined
              return (
                <li key={`u${String(u.id)}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">{u.title}</p>
                    <p className="text-[12.5px] text-ink-2 tnum">
                      {formatMoneyRange(u.original.min, u.original.max)} — no {u.original.min.currency}→{b.currency} rate stored; kept in {u.original.min.currency} and left out of the totals
                    </p>
                  </div>
                  {item ? <EditItemButton item={item} label="Add a rate" /> : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {page.detail.dayBaskets.length ? (
        <section aria-labelledby="baskets-title" className="mt-8">
          <SubHead id="baskets-title" aside={<KindTag kind={demo ? 'demo' : 'derived'} />}>
            Day baskets for reference
          </SubHead>
          {/* Reference only (never added to the trip total), so it stays one click away. */}
          <Disclosure summary={`Show the basket for each ski day (${page.detail.dayBaskets.length})`} className="-mt-1">
            <p className="mt-2 mb-3 max-w-[70ch] text-[13px] text-ink-2">
              Piste’s per-person basket for each ski day — lift access with your pass as planned, your rental setting, lunch and parking — using the same assumptions as Explore. It is not added to the trip total.
            </p>
            <div className="relative overflow-x-auto rounded-[12px] border border-divider bg-surface">
              <table className="w-full min-w-[520px] text-[13.5px]">
                <caption className="sr-only">Per-person day basket for each planned ski day</caption>
                <thead>
                  <tr className="border-b border-divider bg-surface-2 text-left text-[12px] text-ink-3">
                    <th scope="col" className="px-4 py-2 font-medium">Day</th>
                    <th scope="col" className="px-3 py-2 font-medium">Basket</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Per person</th>
                    <th scope="col" className="px-4 py-2 font-medium">Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {page.detail.dayBaskets.map((d) => (
                    <tr key={`${d.resortId}${d.date}`} className="border-b border-divider align-top last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal">
                        <span className="font-medium whitespace-nowrap text-ink tnum">{dayLabel(d.date)}</span>
                        <span className="block text-[12px] text-ink-3">{page.resorts.find((r) => r.id === d.resortId)?.shortName ?? d.resortId}</span>
                      </th>
                      <td className="px-3 py-2.5 whitespace-nowrap text-ink">{d.expense.label}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap tnum">{d.expense.total ? formatMoneyRange(d.expense.total, d.expense.totalMax) : <span className="text-ink-3">{formatMoney(d.expense.knownSubtotal)} known</span>}</td>
                      <td className="px-4 py-2.5 text-[12.5px] text-ink-2">{d.expense.missing.length ? d.expense.missing.join(' ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Disclosure>
        </section>
      ) : null}
    </TripSection>
  )
}
