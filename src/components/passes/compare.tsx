/**
 * Pass vs tickets, in three plain steps:
 *   01 Your ski days — the resort-days you plan (trip days and days added here), each with that day's own ticket price;
 *   02 Cheapest way — one answer, then every way to pay for those days ranked by ONE total on a shared scale, each with
 *      a disclosure holding the per-day breakdown, price source and estimate controls;
 *   03 When does a pass pay off? — see payoff.tsx.
 * A day without a ticket price says so and is never guessed; a pass without a published price gets one quiet line.
 */
import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Ticket } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { PassCompareView, ScenarioDay } from '@/lib/data/passes-screen'
import { formatMoney, type Money } from '@/lib/domain/money'
import { cn } from '@/lib/ui/cn'
import { MoneyUp } from './count-up'
import type { CompareModel, CompareOption, QuietProduct } from './compare-model'
import { EstimateButton } from './estimate-form'
import { DAY_TYPE_LABEL, dayLabel, dayMonth, dotJoin, familyId, plural, weekdayShort } from './format'
import css from './hud.module.css'
import { checkerHref, type ScenarioDayParam } from './params'
import { GrowBar } from './rise'
import { RemoveAddedDay } from './scenario-editor'
import { HolderTag } from './section'

// ---------------------------------------------------------------------------------------------------------------------
// Step heading

export function StepHead({ n, id, title, aside, children }: { n: number; id: string; title: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="hud inline-flex h-7 shrink-0 items-center rounded-full bg-ink-chip px-2.5 tracking-[0.1em] text-on-ink-chip tnum">
            {String(n).padStart(2, '0')}
          </span>
          <h2 id={id} className="m-0 min-w-0 text-[24px] leading-[1.15] font-light tracking-[-0.03em] text-ink md:text-[28px]">
            {title}
          </h2>
        </div>
        {aside ? <div className="flex min-w-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children ? <div className="max-w-[62ch] text-[14px] leading-[1.5] text-ink-2">{children}</div> : null}
    </header>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Step 1 — the days

const DAY_TYPE_SHORT: Record<string, 'weekday' | 'weekend' | 'holiday'> = { weekday: 'weekday', weekend: 'weekend', holiday: 'holiday' }

function DateTile({ date }: { date: string }) {
  return (
    <span aria-hidden className="flex w-12 shrink-0 flex-col items-center rounded-[14px] border border-divider bg-surface py-1.5 leading-none">
      <span className="hud text-[11px] tracking-[0.12em] text-ink-3">{weekdayShort(date)}</span>
      <span className="mt-1 text-[20px] font-light tracking-[-0.02em] text-ink tnum">{Number(date.slice(8, 10))}</span>
      <span className="mt-0.5 text-[11px] text-ink-3">{dayMonth(date).split(' ')[1]}</span>
    </span>
  )
}

export function DayList({ view, model, added }: { view: PassCompareView; model: CompareModel | null; added: ScenarioDayParam[] }) {
  const shownBy = new Map((model?.options.find((o) => o.kind === 'tickets')?.days ?? []).map((d) => [d.key, d.ticket]))
  const b = view.result?.baseline
  return (
    <div className="flex flex-col">
      <ol className="flex flex-col divide-y divide-divider" aria-label="Your ski days">
        {view.days.map((d, i) => (
          <li key={d.key} style={{ '--i': Math.min(i, 8) } as CSSProperties} className={cn(css.rise, 'py-2.5 first:pt-0')}>
            <DayRow d={d} view={view} shown={shownBy.get(`${d.resortId}|${d.date}`) ?? null} added={added} />
          </li>
        ))}
      </ol>
      {b ? (
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-divider-strong pt-3">
          <span className="text-[14px] font-medium text-ink">Tickets for {plural(b.dayCount, 'day')}</span>
          {b.total ? (
            <span className="text-[22px] leading-none font-light tracking-[-0.02em] text-ink tnum">{formatMoney(b.total)}</span>
          ) : (
            <span className="text-right text-[13.5px] text-ink-2 tnum">
              {formatMoney(b.knownTotal)} so far · {plural(b.unknownDays.length, 'day')} without a price
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}

function DayRow({ d, view, shown, added }: { d: ScenarioDay; view: PassCompareView; shown: Money | null; added: ScenarioDayParam[] }) {
  const est = d.ticketEstimate
  const price = shown ?? d.ticket
  const estimate = {
    subject: 'lift-ticket' as const,
    subjectId: d.resortId,
    subjectName: d.resortName,
    dayType: DAY_TYPE_SHORT[d.dayType] ?? ('any' as const),
    currencies: view.entryCurrencies,
    defaultCurrency: view.currencies[0],
    seasonLabel: view.season.label,
  }
  return (
    <div className="flex items-center gap-3">
      <DateTile date={d.date} />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] leading-snug font-medium text-ink">
          <span className="sr-only">{dayLabel(d.date, true)}: </span>
          <Link href={`/resorts/${d.resortId}`} className="hover:text-teal hover:underline">
            {d.resortName}
          </Link>
        </p>
        <p className="m-0 text-[12.5px] leading-snug text-ink-3">{d.source === 'trip' ? `Trip · ${d.tripName}` : `Added · ${d.dayType}`}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {price ? (
          <span className="flex items-center gap-0.5">
            <span className="text-[16px] font-medium text-ink tnum">{formatMoney(price)}</span>
            {d.ticketProv && !est ? (
              <SourceDrawer title={`${d.resortName}: lift ticket`} className="-mr-1.5" items={[{ label: `Lift ticket for ${dayLabel(d.date, true)}`, value: dotJoin(formatMoney(d.ticket), d.ticketBasis), prov: d.ticketProv }]} />
            ) : null}
          </span>
        ) : (
          <span className="text-[13.5px] text-ink-2">No ticket price</span>
        )}
        {est ? (
          <EstimateButton
            {...estimate}
            existing={est}
            label="Your estimate"
            className="-mr-1 text-[12px] font-normal text-ink-2 hover:text-teal"
            context={
              <>
                Prices {d.resortName} on {dayLabel(d.date, true)} — and every {est.dayType === 'any' ? 'day' : `${DAY_TYPE_LABEL[est.dayType].toLowerCase().replace(/s$/, '')} day`} this season.
              </>
            }
          />
        ) : !d.ticket ? (
          <EstimateButton
            {...estimate}
            className="-mr-1 text-[12px]"
            context={
              <>
                No {d.dayType} lift ticket price for {view.season.label} is on file for {d.resortName}, so {dayLabel(d.date, true)} can’t be added up. Your estimate stays labelled as yours.
              </>
            }
          />
        ) : !shown ? (
          <span className="text-[12px] text-ink-3">not converted to {view.currency}</span>
        ) : null}
      </div>
      {d.source === 'added' ? (
        <RemoveAddedDay added={added} day={{ resortId: d.resortId, date: d.date }} label={`${d.resortName}, ${dayLabel(d.date)}`} />
      ) : (
        <span aria-hidden className="w-9 shrink-0 max-md:w-11" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Step 2 — the answer and the ranked options

const ANSWER_TONE: Record<CompareModel['answer']['tone'], string> = {
  pass: 'bg-teal text-on-teal',
  owned: 'bg-teal text-on-teal',
  tickets: 'bg-ink-chip text-on-ink-chip',
  unknown: 'border border-dashed border-divider-strong bg-glass-soft text-ink',
}

export function Answer({ model }: { model: CompareModel }) {
  const a = model.answer
  return (
    <section aria-labelledby="answer-title" aria-live="polite" className={cn(css.rise, 'relative overflow-hidden rounded-[24px] px-5 py-5 md:px-6', ANSWER_TONE[a.tone])}>
      {a.tone !== 'unknown' ? <span aria-hidden className={css.sheen} /> : null}
      <p className="hud relative m-0 tracking-[0.14em] opacity-80">{a.tone === 'unknown' ? 'Not enough prices yet' : `Cheapest for ${plural(model.dayCount, 'day')}`}</p>
      <h3 id="answer-title" className="relative m-0 mt-2 text-[22px] leading-[1.2] font-normal tracking-[-0.02em] text-balance md:text-[26px]">
        {a.headline}
      </h3>
      {a.amount ? (
        <p className="relative m-0 mt-2 text-[44px] leading-none font-light tracking-[-0.04em] md:text-[56px]">
          <MoneyUp amountMinor={a.amount.amountMinor} currency={a.amount.currency} className="tnum" />
        </p>
      ) : null}
      <p className="relative m-0 mt-2 max-w-[56ch] text-[14.5px] leading-[1.5] opacity-90">{a.detail}</p>
    </section>
  )
}

function CostBar({ o, scale }: { o: CompareOption; scale: number }) {
  const pass = o.passPart?.amountMinor ?? 0
  const tickets = (o.ticketPart ?? o.knownSoFar)?.amountMinor ?? 0
  const pct = (n: number) => (scale > 0 ? (n / scale) * 100 : 0)
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-chip-track" aria-hidden>
      <div className="absolute inset-0 flex gap-[2px]">
        {pass > 0 ? <GrowBar pct={pct(pass)} className={cn('h-3 bg-teal', tickets > 0 ? 'rounded-l-full' : 'rounded-full')} /> : null}
        {tickets > 0 ? <GrowBar pct={pct(tickets)} delay={0.06} className={cn('h-3 bg-copper', pass > 0 ? 'rounded-r-full' : 'rounded-full', o.total ? '' : 'opacity-60')} /> : null}
      </div>
    </div>
  )
}

function Savings({ o }: { o: CompareOption }) {
  if (o.kind === 'tickets' || !o.savings) return null
  const v = o.savings.amountMinor
  if (v === 0) return <span className="text-[13px] text-ink-2">same as tickets</span>
  return v > 0 ? (
    <span className="text-[13px] font-medium text-positive tnum">saves {formatMoney(o.savings)}</span>
  ) : (
    <span className="text-[13px] text-ink-2 tnum">{formatMoney({ amountMinor: -v, currency: o.savings.currency })} more</span>
  )
}

function OptionDetails({ o, view }: { o: CompareOption; view: PassCompareView }) {
  const meta = o.kind === 'tickets' ? null : view.meta[o.id]
  const c = o.kind === 'tickets' ? null : view.result?.candidates.find((x) => x.productId === o.id)
  const firstUncovered = o.days.find((d) => !d.covered) ?? o.days[0]
  return (
    <details className="group mt-2">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full text-[13px] font-medium text-teal select-none hover:underline max-md:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden className="size-4 transition-transform duration-200 group-open:rotate-180" />
        <span className="group-open:hidden">Details</span>
        <span className="hidden group-open:inline">Hide details</span>
        <span className="sr-only"> for {o.name}</span>
      </summary>
      <div className="mt-2 flex flex-col gap-3 rounded-[18px] border border-divider bg-surface px-3.5 py-3 md:px-4">
        <table className="w-full text-left text-[13.5px]">
          <caption className="sr-only">Day by day for {o.name}</caption>
          <tbody>
            {o.days.map((d) => (
              <tr key={d.key} className="border-b border-divider align-top last:border-b-0">
                <th scope="row" className="py-1.5 pr-3 font-normal">
                  <span className="text-ink tnum">{dayLabel(d.date)}</span> <span className="text-ink-3">· {d.resortName}</span>
                </th>
                <td className="py-1.5 text-right">
                  {d.covered ? (
                    <span className="inline-flex items-center gap-1 font-medium text-positive">
                      <Check aria-hidden className="size-3.5" strokeWidth={2.4} /> Covered
                    </span>
                  ) : d.ticket ? (
                    <span className="text-ink tnum">
                      {formatMoney(d.ticket)}
                      {d.why ? <span className="text-ink-3"> · {d.why}</span> : null}
                    </span>
                  ) : (
                    <span className="text-ink-2">
                      No ticket price{d.why ? <span className="text-ink-3"> · {d.why}</span> : null}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {o.kind === 'tickets' ? (
          <p className="m-0 text-[12.5px] text-ink-3">Each day at that resort’s own adult full-day ticket for the date.</p>
        ) : (
          <div className="flex flex-col gap-1.5 text-[12.5px] text-ink-2">
            {o.kind === 'owned' ? (
              <p className="m-0">{o.alreadyPaid ? `You paid ${formatMoney(o.alreadyPaid)} — already spent, so it isn’t counted again.` : 'The price you paid isn’t recorded — it isn’t counted.'}</p>
            ) : c?.passPrice ? (
              <p className="m-0 flex flex-wrap items-center gap-x-2">
                <span>
                  Pass price <span className="font-medium text-ink tnum">{formatMoney(c.passPrice)}</span>
                  {c.passPriceOriginal && c.passPriceOriginal.currency !== c.passPrice.currency ? <span className="tnum"> (from {formatMoney(c.passPriceOriginal)})</span> : null}
                  {meta?.priceBasis ? <span className="text-ink-3"> · {meta.priceBasis}</span> : null}
                </span>
                {meta?.priceProv && !meta.priceEstimate ? (
                  <SourceDrawer title={`${o.name}: price`} items={[{ label: `${o.name} price`, value: dotJoin(formatMoney(c.passPriceOriginal), meta.priceBasis), prov: meta.priceProv }]} />
                ) : null}
              </p>
            ) : null}
            {meta?.salesClosed ? <p className="m-0 font-medium text-caution">The sales deadline has passed.</p> : null}
            {c && c.breakEven.status === 'reached' ? <p className="m-0">{c.breakEven.explanation}</p> : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {meta?.priceEstimate && c ? (
                <EstimateButton
                  subject="pass-product"
                  subjectId={o.id}
                  subjectName={o.name}
                  currencies={view.entryCurrencies}
                  defaultCurrency={view.currencies[0]}
                  seasonLabel={view.season.label}
                  existing={meta.priceEstimate}
                  label="Edit your price estimate"
                  context={<>Used as the {o.name} price here, labelled as your estimate.</>}
                />
              ) : null}
              {firstUncovered ? (
                <Link href={checkerHref({ pass: o.id, resort: firstUncovered.resortId, from: firstUncovered.date })} className="inline-flex min-h-9 items-center gap-1 font-medium text-teal hover:underline max-md:min-h-11">
                  Where it works <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </details>
  )
}

function OptionRow({ o, scale, view, index }: { o: CompareOption; scale: number; view: PassCompareView; index: number }) {
  const meta = o.kind === 'tickets' ? null : view.meta[o.id]
  return (
    <li style={{ '--i': Math.min(index + 1, 6) } as CSSProperties} className={cn(css.rise, 'relative py-4')}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
            {o.kind === 'tickets' ? (
              <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-full bg-copper/15 text-copper">
                <Ticket className="size-3.5" />
              </span>
            ) : (
              <PassBadge family={familyId(o.familyId ?? 'regional')} size="sm" />
            )}
            <span className="text-[16px] leading-snug font-semibold text-ink">{o.name}</span>
            {o.kind === 'owned' ? <HolderTag holder="me" /> : null}
            {o.best ? <span className="hud inline-flex h-6 items-center rounded-full bg-ink-chip px-2 tracking-[0.08em] text-on-ink-chip">Cheapest</span> : null}
            {meta?.priceEstimate ? <span className="text-[12px] font-medium text-ink-2">· your price estimate</span> : null}
          </p>
          <p className="m-0 mt-0.5 text-[13.5px] text-ink-2">{o.line}</p>
        </div>
        <div className="flex flex-col items-end text-right">
          {o.total ? (
            <span className="text-[26px] leading-none font-light tracking-[-0.03em] text-ink md:text-[30px]">
              <MoneyUp amountMinor={o.total.amountMinor} currency={o.total.currency} className="tnum" />
            </span>
          ) : o.knownSoFar ? (
            <span className="flex flex-col items-end">
              <span className="text-[20px] leading-none font-light text-ink-2 tnum">{formatMoney(o.knownSoFar)}+</span>
              <span className="mt-1 text-[12px] text-ink-3">{plural(o.unknownDays, 'day')} unpriced</span>
            </span>
          ) : (
            <span className="text-[13.5px] text-ink-2">Can’t add up yet</span>
          )}
          <span className="mt-1">
            <Savings o={o} />
          </span>
        </div>
      </div>
      <div className="mt-2.5">
        <CostBar o={o} scale={scale} />
      </div>
      <OptionDetails o={o} view={view} />
    </li>
  )
}

function QuietLine({ items, view }: { items: QuietProduct[]; view: PassCompareView }) {
  if (!items.length) return null
  const noPrice = items.filter((q) => q.missing === 'price')
  const noTickets = items.filter((q) => q.missing === 'tickets')
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-[1.5] text-ink-3">
      {noPrice.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0">No published price yet for these — add what you expect to pay to compare them:</p>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {noPrice.map((q) => (
              <li key={q.id}>
                <EstimateButton
                  subject="pass-product"
                  subjectId={q.id}
                  subjectName={q.name}
                  currencies={view.entryCurrencies}
                  defaultCurrency={view.currencies[0]}
                  seasonLabel={view.season.label}
                  trigger="chip"
                  label={`${q.name} · ${plural(q.coveredDays, 'day')}`}
                  context={
                    <>
                      No {view.season.label} adult price for {q.name} is published yet. Enter what you expect to pay from the official page — it stays labelled as your estimate, and a
                      published price replaces it once recorded.
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {noTickets.length ? (
        <p className="m-0">
          Can’t add up {noTickets.map((q) => q.name).join(', ')} — a day {noTickets.length === 1 ? 'it doesn’t' : 'they don’t'} cover has no ticket price.
        </p>
      ) : null}
    </div>
  )
}

export function CheapestWay({ model, view }: { model: CompareModel; view: PassCompareView }) {
  const fx = view.fx.filter((f) => f.rate)
  return (
    <div className="flex flex-col gap-4">
      <Answer model={model} />
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-divider pb-2">
          <h3 className="m-0 text-[15px] font-semibold text-ink">Every way to pay, cheapest first</h3>
          <p className="m-0 flex items-center gap-3 text-[12px] text-ink-3" aria-hidden>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-teal" /> pass
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-copper" /> lift tickets
            </span>
          </p>
        </div>
        <ol className="flex flex-col divide-y divide-divider" aria-label="Ways to pay, cheapest first">
          {model.options.map((o, i) => (
            <OptionRow key={o.id} o={o} scale={model.scale} view={view} index={i} />
          ))}
        </ol>
      </div>
      <QuietLine items={model.quiet} view={view} />
      {model.ownedUnused.length || model.noCoverage ? (
        <p className="m-0 text-[13px] text-ink-3">
          {model.ownedUnused.length ? `Your ${model.ownedUnused.join(' and ')} ${model.ownedUnused.length === 1 ? 'doesn’t' : 'don’t'} cover any of these days. ` : ''}
          {model.noCoverage ? `${model.noCoverage === 1 ? '1 other pass doesn’t' : `${model.noCoverage} other passes don’t`} cover any of them.` : ''}
        </p>
      ) : null}
      {fx.length ? <p className="m-0 text-[12px] text-ink-3 tnum">Converted at {fx.map((f) => `${f.rate} (${f.rateDate}${f.demo ? ', demo rate' : ''})`).join(' · ')}</p> : null}
    </div>
  )
}
