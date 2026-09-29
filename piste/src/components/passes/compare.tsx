/**
 * Pass vs tickets on the planned resort-day basket. Baseline = each planned day's OWN ticket price (never one resort's
 * walk-up price multiplied out). Per product: pass price + tickets for the days it cannot cover (blackout, no days
 * left, not included, discount only, not confirmed). Owned passes split into already paid (sunk) and what the plan
 * still costs; the season view adds the purchase back. Break-even appears only when its assumptions fit.
 * Where a price is missing you can add your own estimate — labelled "Your estimate" wherever it is used.
 */
import Link from 'next/link'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import { Missing } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { Legend } from '@/components/charts/legend'
import type { CandidateMeta, PassCompareView, ScenarioDay } from '@/lib/data/passes-screen'
import type { CandidateComparison } from '@/lib/domain/costs'
import { formatMoney, type Money } from '@/lib/domain/money'
import { cn } from '@/lib/ui/cn'
import { AccessMark } from './access-mark'
import { EstimateButton } from './estimate-form'
import { DAY_TYPE_LABEL, dayLabel, dotJoin, familyId, plural, STATUS_META, TONE_TEXT } from './format'
import { checkerHref, type CompareView, type ScenarioDayParam } from './params'
import { GrowBar } from './rise'
import { RemoveAddedDay } from './scenario-editor'
import { ConfirmTag, HolderTag } from './section'

function totalOf(c: CandidateComparison, view: CompareView): Money | null {
  return view === 'season' || !c.owned ? c.seasonTotal : c.incremental
}

function savingsOf(c: CandidateComparison, view: CompareView): Money | null {
  return view === 'season' || !c.owned ? c.seasonSavingsVsTickets : c.savingsVsTickets
}

function Savings({ m }: { m: Money | null }) {
  if (!m) return <span className="text-[12.5px] text-ink-3">vs tickets: not comparable</span>
  if (m.amountMinor === 0) return <span className="text-[12.5px] text-ink-2">same as tickets only</span>
  const saves = m.amountMinor > 0
  return (
    <span className={cn('text-[12.5px] font-medium tnum', saves ? 'text-positive' : 'text-ink-2')}>
      {saves ? `${formatMoney(m)} less than tickets` : `${formatMoney({ amountMinor: -m.amountMinor, currency: m.currency })} more than tickets`}
    </span>
  )
}

const DAY_TYPE_SHORT: Record<string, string> = { weekday: 'weekday', weekend: 'weekend', holiday: 'holiday' }

/** Why a day is a ticket day for this product: "1 blacked out, 3 not confirmed". */
const BLOCKED_WORD: Partial<Record<string, string>> = {
  blackout: 'blacked out',
  'days-exhausted': 'after the pass days run out',
  'not-included': 'not included',
  'discount-only': 'discount only',
  unknown: 'not confirmed',
  'season-mismatch': 'outside the pass season',
}

// ---------------------------------------------------------------------------
// Planned days (the basket) — also the table view of the baseline.

export function PlannedDays({ view, added }: { view: PassCompareView; added: ScenarioDayParam[] }) {
  const b = view.result?.baseline
  const unknown = view.days.filter((d) => !d.ticket).length
  return (
    <div className="overflow-hidden rounded-[12px] border border-divider bg-surface">
      <table className="w-full text-left text-[13.5px]">
        <caption className="sr-only">Planned resort-days and each day’s own lift-ticket price ({view.currency})</caption>
        <thead className="bg-surface-2 text-[12px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5">
              Day and resort
            </th>
            <th scope="col" className="px-3 py-2.5 text-right whitespace-nowrap">
              Ticket<span className="max-sm:sr-only"> that day</span>
            </th>
            {added.length ? (
              <th scope="col" className="w-11 px-1 py-2.5">
                <span className="sr-only">Remove</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {view.days.map((d) => (
            <DayRow key={d.key} d={d} view={view} added={added} />
          ))}
        </tbody>
        {b ? (
          <tfoot>
            <tr className="border-t border-divider-strong bg-surface-2">
              <th scope="row" className="px-4 py-3 font-semibold text-ink">
                Tickets only · {plural(b.dayCount, 'day')}
              </th>
              <td className="px-3 py-3 text-right">
                {b.total ? (
                  <span className="font-display text-[22px] leading-none text-ink tnum">{formatMoney(b.total)}</span>
                ) : (
                  <span className="flex flex-col items-end">
                    <span className="text-[13px] font-medium text-caution">Incomplete</span>
                    <span className="text-[12px] text-ink-3 tnum">
                      {formatMoney(b.knownTotal)} known · {plural(b.unknownDays.length, 'day')} unknown
                    </span>
                  </span>
                )}
              </td>
              {added.length ? <td /> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {unknown ? (
        <p className="border-t border-divider px-4 py-2.5 text-[12.5px] text-ink-3">
          No {view.season.label} ticket price is on file for {unknown === 1 ? 'one day' : `${unknown} days`} — nothing is guessed. Add your own estimate to total them; it stays
          labelled “Your estimate”.
        </p>
      ) : null}
    </div>
  )
}

function DayRow({ d, view, added }: { d: ScenarioDay; view: PassCompareView; added: ScenarioDayParam[] }) {
  const calc = view.result?.candidates[0]?.days.find((x) => x.resortId === d.resortId && x.date === d.date)
  const shown = calc?.ticket ?? null
  const est = d.ticketEstimate
  const estimateProps = {
    subject: 'lift-ticket' as const,
    subjectId: d.resortId,
    subjectName: d.resortName,
    dayType: (DAY_TYPE_SHORT[d.dayType] ?? 'any') as 'weekday' | 'weekend' | 'holiday',
    currencies: view.entryCurrencies,
    defaultCurrency: view.currencies[0],
    seasonLabel: view.season.label,
  }
  return (
    <tr className="border-t border-divider align-top">
      <th scope="row" className="px-4 py-2.5 font-normal">
        <span className="block font-medium text-ink tnum">{dayLabel(d.date)}</span>
        <Link href={`/resorts/${d.resortId}`} className="text-ink hover:text-teal hover:underline">
          {d.resortName}
        </Link>
        <span className="block text-[12px] text-ink-3">{dotJoin(d.dayType, d.source === 'trip' ? `Trip: ${d.tripName}` : 'Added here')}</span>
      </th>
      <td className="px-3 py-2.5 text-right">
        <span className="inline-flex items-center justify-end gap-0.5">
          {shown ? <span className="font-medium text-ink tnum">{formatMoney(shown)}</span> : d.ticket ? <span className="font-medium text-ink tnum">{formatMoney(d.ticket)}</span> : <Missing label="Price unknown" />}
          {d.ticketProv && !est ? (
            <SourceDrawer title={`${d.resortName}: lift ticket`} className="-mr-1.5" items={[{ label: `Lift ticket for ${dayLabel(d.date, true)}`, value: dotJoin(formatMoney(d.ticket), d.ticketBasis), prov: d.ticketProv }]} />
          ) : null}
        </span>
        {d.ticket && !shown ? <span className="block text-[11.5px] text-caution">no stored rate to {view.currency}</span> : null}
        {d.ticket && shown && d.ticket.currency !== shown.currency ? <span className="block text-[11.5px] text-ink-3 tnum">from {formatMoney(d.ticket)}</span> : null}
        {est ? (
          <span className="mt-0.5 flex items-center justify-end">
            <EstimateButton
              {...estimateProps}
              existing={est}
              label="Your estimate"
              className="-mr-1 text-[11.5px] font-normal text-ink-2 hover:text-teal"
              context={
                <>
                  Prices {d.resortName} on {dayLabel(d.date, true)} — and on every {est.dayType === 'any' ? 'day' : `${DAY_TYPE_LABEL[est.dayType].toLowerCase().replace(/s$/, '')} day`} this
                  season.
                </>
              }
            />
          </span>
        ) : d.ticketBasis ? (
          <span className={cn('ml-auto block max-w-[34ch] text-[11.5px] leading-snug', d.ticketConfirmAtSource ? 'text-caution' : 'text-ink-3')}>{d.ticketBasis}</span>
        ) : (
          <span className="mt-0.5 flex justify-end">
            <EstimateButton
              {...estimateProps}
              className="-mr-1 text-[11.5px]"
              context={
                <>
                  No {d.dayType} lift ticket price for the {view.season.label} season is on file for {d.resortName}, so {dayLabel(d.date, true)} can’t be totalled.
                </>
              }
            />
          </span>
        )}
      </td>
      {added.length ? (
        <td className="px-1 py-1.5 text-right">
          {d.source === 'added' ? <RemoveAddedDay added={added} day={{ resortId: d.resortId, date: d.date }} label={`${d.resortName}, ${dayLabel(d.date)}`} /> : null}
        </td>
      ) : null}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Candidates

function DayGlyphs({ c }: { c: CandidateComparison }) {
  return (
    <ol className="flex flex-wrap gap-0.5" aria-label="Planned days">
      {c.days.map((d) => {
        const m = STATUS_META[d.verdict.status]
        return (
          <li key={`${d.resortId}-${d.date}`} title={`${dayLabel(d.date)} · ${m.label}`}>
            <m.Icon aria-hidden className={cn('size-3.5', TONE_TEXT[m.tone])} strokeWidth={2} />
            <span className="sr-only">
              {dayLabel(d.date)}: {m.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function CostBar({ c, view, scale, baseline }: { c: CandidateComparison; view: CompareView; scale: number; baseline: Money | null }) {
  const showPass = !(c.owned && view === 'incremental')
  const pass = showPass ? (c.passPrice?.amountMinor ?? 0) : 0
  const tickets = c.uncoveredTicketCost?.amountMinor ?? 0
  const pct = (n: number) => (scale > 0 ? (n / scale) * 100 : 0)
  return (
    <div className="relative h-4" aria-hidden>
      <div className="absolute inset-y-1 right-0 left-0 rounded-full bg-surface-3" />
      <div className="absolute inset-y-0 left-0 flex w-full gap-[2px]">
        {pass > 0 ? (
          <GrowBar
            pct={pct(pass)}
            className={cn('h-4 rounded-l-[4px]', tickets > 0 ? '' : 'rounded-r-[4px]', c.owned ? 'bg-[repeating-linear-gradient(135deg,var(--teal)_0_3px,transparent_3px_6px)] ring-1 ring-teal ring-inset' : 'bg-teal')}
          />
        ) : null}
        {tickets > 0 ? <GrowBar pct={pct(tickets)} delay={0.05} className={cn('h-4 rounded-r-[4px] bg-copper', pass > 0 ? '' : 'rounded-l-[4px]')} /> : null}
      </div>
      {baseline && scale > 0 ? <span className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-ink" style={{ left: `calc(${pct(baseline.amountMinor)}% - 1px)` }} /> : null}
    </div>
  )
}

/** Pass price estimate control for a product you don't hold (add when missing, edit when it is yours). */
function PassPriceEstimate({ c, meta, view, trigger = 'chip' }: { c: CandidateComparison; meta: CandidateMeta | undefined; view: PassCompareView; trigger?: 'chip' | 'link' }) {
  if (c.owned) return null
  const existing = meta?.priceEstimate ?? null
  if (!existing && c.passPriceOriginal) return null
  return (
    <EstimateButton
      subject="pass-product"
      subjectId={c.productId}
      subjectName={c.productName}
      currencies={view.entryCurrencies}
      defaultCurrency={view.currencies[0]}
      seasonLabel={view.season.label}
      existing={existing}
      trigger={trigger}
      label={existing ? 'Edit your estimate' : 'Add your price estimate'}
      context={
        existing ? (
          <>Used as the {c.productName} price in this comparison, labelled “Your estimate”.</>
        ) : (
          <>
            No {view.season.label} adult price for {c.productName} is recorded — check the official page, then enter what you expect to pay. It stays labelled “Your estimate” and a
            published price replaces it once recorded.
          </>
        )
      }
    />
  )
}

function CandidateRow({
  c,
  meta,
  view,
  mode,
  scale,
  baseline,
  index,
}: {
  c: CandidateComparison
  meta: CandidateMeta | undefined
  view: PassCompareView
  mode: CompareView
  scale: number
  baseline: Money | null
  index: number
}) {
  const total = totalOf(c, mode)
  const n = c.days.length
  const blocked = Object.entries(c.uncovered.byStatus) as [keyof typeof STATUS_META, number][]
  return (
    <li className="grid gap-x-6 gap-y-2 px-4 py-4 md:grid-cols-[minmax(0,1fr)_200px] md:px-5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12px] text-ink-3 tnum" aria-hidden>
            {String(index + 1).padStart(2, '0')}
          </span>
          <PassBadge family={familyId(c.familyId)} size="sm" />
          <Link href={checkerHref({ pass: c.productId })} className="text-[15px] font-semibold text-ink hover:text-teal hover:underline">
            {c.productName}
          </Link>
          {c.owned ? <HolderTag holder="me" /> : null}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
          <span className="tnum">
            Covers <strong className="font-semibold text-ink">{c.coveredDays}</strong> of {n} planned {n === 1 ? 'day' : 'days'}
          </span>
          <DayGlyphs c={c} />
        </div>
        {blocked.length ? (
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            Tickets on {plural(c.uncovered.count, 'day')}: {blocked.map(([st, k]) => `${k} ${BLOCKED_WORD[st] ?? STATUS_META[st].label.toLowerCase()}`).join(', ')}
            {c.uncoveredUnknownDays ? ` · ${plural(c.uncoveredUnknownDays, 'ticket price')} unknown` : ''}
          </p>
        ) : null}
        <div className="mt-2.5">
          <CostBar c={c} view={mode} scale={scale} baseline={baseline} />
        </div>
        <p className="mt-2 text-[12.5px] text-ink-2">
          {c.breakEven.status === 'reached' ? <span className="font-medium text-positive">Break-even: </span> : <span className="text-ink-3">Break-even: </span>}
          {c.breakEven.explanation}
        </p>
      </div>
      <div className="flex flex-col items-start gap-1 md:items-end md:text-right">
        {total ? <p className="font-display text-[30px] leading-none text-ink tnum">{formatMoney(total)}</p> : <p className="text-[15px] font-medium text-caution">Can’t total</p>}
        <p className="text-[12.5px] text-ink-3 tnum">
          {dotJoin(
            c.owned && mode === 'incremental' ? (c.alreadyPaid ? `+ ${formatMoney(c.alreadyPaid)} already paid` : 'price paid not recorded') : c.passPrice ? `pass ${formatMoney(c.passPrice)}` : 'pass price not recorded',
            c.uncoveredTicketCost ? `tickets ${formatMoney(c.uncoveredTicketCost)}` : c.uncovered.count ? 'tickets unknown' : null,
          )}
        </p>
        <Savings m={savingsOf(c, mode)} />
        {meta?.priceEstimate ? (
          <p className="text-[12px] font-medium text-ink-2">Pass price: your estimate — not a published price</p>
        ) : meta?.priceBasis ? (
          <p className="text-[12px] text-ink-3">{meta.priceBasis}</p>
        ) : null}
        {meta?.priceConfirmAtSource ? <ConfirmTag /> : null}
        {meta?.priceProv && !meta.priceEstimate ? (
          <SourceDrawer title={`${c.productName}: price`} label="Price source" compact={false} className="-mr-1.5" items={[{ label: `${c.productName} price`, value: dotJoin(formatMoney(c.passPriceOriginal), meta.priceBasis), prov: meta.priceProv }]} />
        ) : null}
        {meta?.salesClosed ? <p className="text-[12px] font-medium text-caution">Sales deadline passed</p> : null}
        {meta?.priceEstimate ? <PassPriceEstimate c={c} meta={meta} view={view} trigger="link" /> : null}
      </div>
    </li>
  )
}

/** Why a product can't be totalled yet, in one line. */
function cantTotalReason(c: CandidateComparison): string {
  const reasons: string[] = []
  if (!c.passPrice) reasons.push(c.owned ? 'price paid not recorded' : c.passPriceOriginal ? 'no stored exchange rate for the pass price' : 'pass price not recorded')
  if (c.uncoveredUnknownDays) reasons.push(`ticket price unknown on ${plural(c.uncoveredUnknownDays, 'day')} it doesn’t cover`)
  return reasons.join(' · ')
}

function CantTotalRow({ c, meta, view }: { c: CandidateComparison; meta: CandidateMeta | undefined; view: PassCompareView }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <PassBadge family={familyId(c.familyId)} size="sm" />
          <Link href={checkerHref({ pass: c.productId })} className="text-[14px] font-medium text-ink hover:text-teal hover:underline">
            {c.productName}
          </Link>
          {c.owned ? <HolderTag holder="me" /> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
          <span className="tnum">
            covers {c.coveredDays}/{c.days.length}
          </span>
          <DayGlyphs c={c} />
          <span className="text-ink-3">{cantTotalReason(c)}</span>
        </div>
      </div>
      <PassPriceEstimate c={c} meta={meta} view={view} />
    </li>
  )
}

export function CompareResults({ view, mode }: { view: PassCompareView; mode: CompareView }) {
  const r = view.result
  if (!r) return null
  const baseline = r.baseline.total
  const ranked = r.candidates
    .filter((c) => totalOf(c, mode))
    .sort((a, b) => Number(b.owned) - Number(a.owned) || totalOf(a, mode)!.amountMinor - totalOf(b, mode)!.amountMinor || a.productName.localeCompare(b.productName))
  const cannot = r.candidates.filter((c) => !totalOf(c, mode))
  // Can't total but the product covers some planned days (a price is the only gap) — worth an estimate.
  const partial = cannot
    .filter((c) => c.coveredDays > 0 || c.owned)
    .sort((a, b) => Number(b.owned) - Number(a.owned) || b.coveredDays - a.coveredDays || a.productName.localeCompare(b.productName))
  // No confirmed access on any planned day: not confirmed (rule unknown or missing) or not included — buying it
  // would mean tickets for every day as far as the records go.
  const noAccess = cannot.filter((c) => c.coveredDays === 0 && !c.owned).sort((a, b) => a.productName.localeCompare(b.productName))
  const unconfirmed = noAccess.filter((c) => c.days.some((d) => d.verdict.status === 'unknown' && d.verdict.accessType !== null))
  const scale = Math.max(baseline?.amountMinor ?? 0, ...ranked.map((c) => (c.passPrice?.amountMinor ?? 0) + (c.uncoveredTicketCost?.amountMinor ?? 0)))
  const planned = r.baseline.dayCount

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="baseline-title" className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 rounded-[12px] border border-divider bg-surface px-4 py-4 md:px-5">
        <div>
          <h3 id="baseline-title" className="text-[13.5px] font-medium text-ink-2">
            Tickets only · {plural(planned, 'planned day')}
          </h3>
          {baseline ? (
            <p className="mt-1 font-display text-[36px] leading-none text-ink tnum">{formatMoney(baseline)}</p>
          ) : (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[28px] leading-none text-caution">Incomplete</span>
              <span className="text-[13px] text-ink-3 tnum">
                {formatMoney(r.baseline.knownTotal)} known · {plural(r.baseline.unknownDays.length, 'day')} without a ticket price
              </span>
            </p>
          )}
        </div>
        <p className="max-w-[46ch] text-[12.5px] text-ink-3">Each planned day at its own ticket price for that resort and date — the line every pass is measured against.</p>
      </section>

      {ranked.length ? (
        <section aria-labelledby="ranked-title" className="rounded-[12px] border border-divider bg-surface">
          <header className="flex flex-col gap-2 border-b border-divider px-4 py-3 md:px-5">
            <h3 id="ranked-title" className="text-[16px] font-semibold text-ink">
              {mode === 'season' ? 'Season total' : 'What the plan still costs'} · {plural(ranked.length, 'option')}
            </h3>
            <Legend
              items={[
                { label: 'Pass price', tone: 'teal', shape: 'bar' },
                { label: 'Tickets on days it doesn’t cover', tone: 'copper', shape: 'bar' },
                { label: 'Tickets only', tone: 'ink', shape: 'rule' },
              ]}
            />
          </header>
          <ol className="divide-y divide-divider">
            {ranked.map((c, i) => (
              <CandidateRow key={c.productId} c={c} meta={view.meta[c.productId]} view={view} mode={mode} scale={scale} baseline={baseline} index={i} />
            ))}
          </ol>
        </section>
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-4 py-4 text-[13.5px] text-ink-2 md:px-5">
          No option can be totalled yet: every product is missing its price or a ticket price for a day it doesn’t cover. Add your own estimates below and in Planned days —
          nothing is filled in for you.
        </p>
      )}

      {partial.length ? (
        <section aria-labelledby="partial-title" className="rounded-[12px] border border-divider bg-surface">
          <header className="border-b border-divider px-4 py-3 md:px-5">
            <h3 id="partial-title" className="text-[15px] font-semibold text-ink">
              Can’t total yet · {plural(partial.length, 'product')}
            </h3>
            <p className="text-[12.5px] text-ink-3">Covers some of your planned days, but a price is missing — coverage is shown, the total is not guessed.</p>
          </header>
          <ul className="divide-y divide-divider">
            {partial.map((c) => (
              <CantTotalRow key={c.productId} c={c} meta={view.meta[c.productId]} view={view} />
            ))}
          </ul>
        </section>
      ) : null}

      {noAccess.length ? (
        <details className="group rounded-[12px] border border-divider bg-surface">
          <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 select-none md:px-5">
            <span>
              <span className="block text-[15px] font-semibold text-ink">No confirmed access on your planned days · {plural(noAccess.length, 'product')}</span>
              <span className="block text-[12.5px] text-ink-3">
                {unconfirmed.length ? `${plural(unconfirmed.length, 'rule')} not confirmed, the rest not recorded or not included` : 'No rule recorded or not included'} — never assumed
                covered. Confirm a rule in the checker to compare it.
              </span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" />
          </summary>
          <ul className="divide-y divide-divider border-t border-divider">
            {noAccess.map((c) => {
              const firstDay = c.days[0]
              const top = firstDay?.verdict
              return (
                <li key={c.productId} className="flex flex-col gap-1.5 px-4 py-2.5 md:flex-row md:items-center md:justify-between md:px-5">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <PassBadge family={familyId(c.familyId)} size="sm" />
                    <span className="text-[14px] font-medium text-ink">{c.productName}</span>
                  </span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
                    <DayGlyphs c={c} />
                    {top ? <AccessMark status={top.status} variant="cell" label={top.status === 'unknown' ? (top.accessType ? 'Not confirmed' : 'No rule recorded') : undefined} /> : null}
                    {firstDay ? (
                      <Link href={checkerHref({ pass: c.productId, resort: firstDay.resortId, from: firstDay.date })} className="inline-flex items-center gap-1 font-medium text-teal hover:underline max-md:min-h-11">
                        Check <ArrowRight aria-hidden className="size-3.5" />
                      </Link>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </details>
      ) : null}

      <ul className="flex flex-col gap-1 text-[12.5px] text-ink-3">
        {r.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        <li>Days a pass rule leaves unconfirmed are priced as tickets — never assumed covered. Discount-only days are priced at the full ticket.</li>
      </ul>
    </div>
  )
}
