/**
 * Expense tiers per resort for one date, from a transparent per-person day basket: lift access + selected rental +
 * lunch + your share of parking. A basket missing a required price is an "Incomplete estimate" (no tier, no total) —
 * the known lines are still itemised, and every gap can be filled with your own estimate (labelled "Your estimate",
 * never a published price). Tier bands are UI classification thresholds, not price estimates.
 */
import Link from 'next/link'
import { PenLine } from 'lucide-react'
import { Missing } from '@/components/ui/provenance'
import { SourceList } from '@/components/ui/source-drawer'
import type { DayCostRow, EstimateDayType, EstimateRental, EstimateView } from '@/lib/data/passes-screen'
import { LINE_KIND_LABEL, type BasketLine, type BasketLineKey, type RentalOption } from '@/lib/domain/costs'
import { formatMoney, formatMoneyRange } from '@/lib/domain/money'
import { cn } from '@/lib/ui/cn'
import { DetailsSheet } from './details-sheet'
import { EstimateButton, RemoveEstimateButton } from './estimate-form'
import { dayLabel, dotJoin, estimateSummary, plural } from './format'

export const LINE_ORDER: BasketLineKey[] = ['lift', 'rental', 'lunch', 'parking']
const LINE_HEAD: Record<BasketLineKey, string> = { lift: 'Lift', rental: 'Rental', lunch: 'Lunch', parking: 'Parking' }

/** What the estimate controls need to know about the page (same for every row). */
export interface EstimateCtx {
  date: string
  rentalOption: RentalOption
  currencies: string[]
  defaultCurrency: string
  seasonLabel: string
}

function lineOf(row: DayCostRow, key: BasketLineKey): BasketLine | undefined {
  return row.basket.lines.find((l) => l.key === key)
}

/** The estimate behind a line, when the price used is one of yours. */
function estimateOf(row: DayCostRow, l: BasketLine | undefined): EstimateView | null {
  if (!l || l.kind !== 'user-estimate' || l.snapshotId == null) return null
  return row.estimates.find((e) => e.id === l.snapshotId) ?? null
}

const SUBJECT: Partial<Record<BasketLineKey, 'lift-ticket' | 'rental' | 'parking'>> = { lift: 'lift-ticket', rental: 'rental', parking: 'parking' }
const DAY_TYPE_WORD: Record<EstimateDayType, string> = { weekday: 'your weekday estimate', weekend: 'your weekend estimate', holiday: 'your holiday estimate', any: 'your any-day estimate' }

/** Add-or-edit control for one line, or null when the line is not something you estimate here. */
function LineEstimate({
  row,
  l,
  ctx,
  trigger = 'link',
  label,
  className,
}: {
  row: DayCostRow
  l: BasketLine | undefined
  ctx: EstimateCtx
  trigger?: 'link' | 'chip' | 'icon'
  label?: string
  className?: string
}) {
  if (!l) return null
  const subject = SUBJECT[l.key]
  if (!subject) return null
  const existing = estimateOf(row, l)
  if (!existing && l.amount) return null
  if (l.key === 'rental' && ctx.rentalOption === 'none') return null
  const dayType = row.basket.dayType as EstimateDayType
  const what = l.key === 'lift' ? 'lift ticket' : l.key === 'rental' ? l.label.toLowerCase() : 'parking'
  return (
    <EstimateButton
      subject={subject}
      subjectId={row.resort.id}
      subjectName={row.resort.name}
      rentalOption={l.key === 'rental' ? (ctx.rentalOption as EstimateRental) : null}
      dayType={dayType}
      currencies={ctx.currencies}
      defaultCurrency={ctx.defaultCurrency}
      seasonLabel={ctx.seasonLabel}
      existing={existing}
      trigger={trigger}
      label={label}
      className={className}
      context={
        existing ? (
          <>
            Prices {row.resort.name} on {dayLabel(ctx.date, true)} ({DAY_TYPE_WORD[existing.dayType]}).
          </>
        ) : (
          <>
            No {row.basket.holidayName ? 'holiday' : dayType} {what} price is on file for {row.resort.name} on {dayLabel(ctx.date, true)}
            {l.required ? ', so its basket is an incomplete estimate.' : ' — it is left out of the total.'}
          </>
        )
      }
    />
  )
}

/** Amount for a line in the basket currency (or its own currency when no stored rate converts it). */
function Amount({ l, compact = false }: { l: BasketLine | undefined; compact?: boolean }) {
  if (!l) return <Missing />
  if (l.kind === 'pass-covered') return <span className="font-medium text-positive">Covered</span>
  const shown = l.display ?? l.amount
  if (!shown) return <Missing label="Unknown" className={compact ? 'text-[12.5px]' : undefined} />
  return (
    <span className="font-medium text-ink tnum">
      {formatMoneyRange(shown, l.displayMax ?? l.amountMax)}
      {!l.display ? <span className="ml-1 text-[12px] font-normal text-ink-3">(not converted)</span> : null}
    </span>
  )
}

function lineNote(l: BasketLine | undefined): string | null {
  if (!l) return null
  if (l.kind === 'pass-covered') return l.source
  if (!l.amount) return l.required ? 'required' : 'excluded'
  if (l.key === 'rental' && l.kind === 'assumption') return 'own gear'
  if (l.kind === 'user-estimate') return 'your estimate'
  return l.kind ? LINE_KIND_LABEL[l.kind].toLowerCase() : null
}

/** Amount plus what kind of number it is — and, for gaps and your estimates, the control to fill or edit them. */
function LineCell({ row, l, ctx, align = 'right' }: { row: DayCostRow; l: BasketLine | undefined; ctx: EstimateCtx; align?: 'right' | 'left' }) {
  const note = lineNote(l)
  const mine = estimateOf(row, l)
  const canAdd = !!l && !l.amount && !!SUBJECT[l.key] && !(l.key === 'rental' && ctx.rentalOption === 'none')
  return (
    <span className={cn('flex flex-col gap-0.5', align === 'right' ? 'items-end' : 'items-start')}>
      <Amount l={l} compact />
      {mine ? (
        <LineEstimate row={row} l={l} ctx={ctx} label="your estimate" className="-mx-1 text-[12px] font-normal text-ink-2 hover:text-teal" />
      ) : canAdd ? (
        <LineEstimate row={row} l={l} ctx={ctx} label="Add estimate" className="-mx-1 text-[12px]" />
      ) : note ? (
        <span className="text-[12px] text-ink-3">{note}</span>
      ) : null}
    </span>
  )
}

export function TierMark({ row, size = 'md' }: { row: DayCostRow; size?: 'md' | 'lg' }) {
  const b = row.basket
  if (b.tier.tier === 'incomplete') {
    return (
      <span className={cn('inline-flex items-center rounded-md border border-dashed border-caution/60 px-2 font-medium whitespace-nowrap text-caution', size === 'lg' ? 'h-8 text-[13.5px]' : 'h-6 text-[12px]')}>
        Incomplete
      </span>
    )
  }
  return (
    <span
      title="Expense tier — a UI band, not a price estimate"
      className={cn('inline-flex items-center rounded-md border border-copper/50 px-2 font-display leading-none text-copper tnum', size === 'lg' ? 'h-8 text-[22px]' : 'h-6 text-[17px]')}
    >
      <span className="sr-only">Expense tier </span>
      {b.tier.tier}
      {b.tierMax ? `–${b.tierMax}` : ''}
    </span>
  )
}

function usesEstimate(row: DayCostRow): boolean {
  return row.basket.lines.some((l) => l.kind === 'user-estimate' && l.snapshotId != null)
}

function Total({ row }: { row: DayCostRow }) {
  const b = row.basket
  if (b.total) {
    return (
      <span className="flex flex-col items-end">
        <span className="text-[15px] font-semibold text-ink tnum">{formatMoneyRange(b.total, b.totalMax)}</span>
        {usesEstimate(row) ? <span className="text-[12px] text-ink-3">includes your estimates</span> : null}
      </span>
    )
  }
  const known = b.knownSubtotal.amountMinor > 0
  return (
    <span className="flex flex-col items-end">
      <span className="text-[13px] font-medium text-caution">Incomplete estimate</span>
      {known ? <span className="text-[12px] text-ink-3 tnum">{formatMoney(b.knownSubtotal)} known so far</span> : null}
    </span>
  )
}

/** Full basket breakdown in a drawer: every line with its kind, source, notes; gaps to fill; your estimates here. */
export function BasketSheet({ row, ctx }: { row: DayCostRow; ctx: EstimateCtx }) {
  const b = row.basket
  const date = ctx.date
  // "Excludes parking (unknown)" repeats the missing line above it.
  const caveats = b.caveats.filter((c) => !b.missing.some((m) => !m.required && c === `Excludes ${m.key} (unknown)`))
  // Lines backed by a recorded price or a pass rule; assumptions (lunch, own gear) are explained in the table above.
  const sources = b.lines
    .filter((l) => row.lineProv[l.key])
    .map((l) => ({
      label: `${l.label}${l.kind === 'pass-covered' ? ' — covered by pass' : l.display ? ` — ${formatMoneyRange(l.display, l.displayMax)}` : l.amount ? ` — ${formatMoneyRange(l.amount, l.amountMax)}` : ''}`,
      value: dotJoin(l.kind ? LINE_KIND_LABEL[l.kind] : null, l.source) || undefined,
      prov: row.lineProv[l.key] ?? null,
    }))
  return (
    <DetailsSheet title={`${row.resort.name}: day basket`} description={`${dayLabel(date, true)} · per person · ${b.holidayName ?? b.dayType}`} label={`Basket details for ${row.resort.name}`}>
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3 border-b border-divider pb-3">
          <div>
            {b.total ? (
              <p className="font-display text-[36px] leading-none text-ink tnum">{formatMoneyRange(b.total, b.totalMax)}</p>
            ) : (
              <p className="font-display text-[26px] leading-none text-caution">Incomplete estimate</p>
            )}
            <p className="mt-1 text-[12.5px] text-ink-3">lift + rental + lunch + your share of parking{usesEstimate(row) ? ' · includes your estimates' : ''}</p>
          </div>
          <TierMark row={row} size="lg" />
        </div>
        <table className="w-full text-left text-[13.5px]">
          <caption className="sr-only">Basket lines</caption>
          <tbody>
            {LINE_ORDER.map((k) => {
              const l = lineOf(row, k)
              if (!l) return null
              const mine = estimateOf(row, l)
              return (
                <tr key={k} className="border-b border-divider align-top last:border-b-0">
                  <th scope="row" className="py-2.5 pr-3 font-normal">
                    <span className="block text-ink">{l.label}</span>
                    <span className="block text-[12px] text-ink-3">
                      {mine
                        ? estimateSummary(mine)
                        : dotJoin(
                            (l.kind === 'user-estimate' && l.source) || (l.kind && l.source?.startsWith(LINE_KIND_LABEL[l.kind])) ? null : l.kind ? LINE_KIND_LABEL[l.kind] : l.required ? 'Required — price unknown' : 'Optional — unknown',
                            l.source,
                            l.note,
                          )}
                    </span>
                    {mine?.note ? <span className="block text-[12px] text-ink-3">“{mine.note}”</span> : null}
                    {!l.amount || mine ? (
                      <span className="mt-1.5 block">
                        <LineEstimate row={row} l={l} ctx={ctx} trigger="chip" label={mine ? 'Edit your estimate' : 'Add your estimate'} />
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <Amount l={l} />
                    {l.fx && l.amount ? (
                      <span className="block text-[12px] text-ink-3 tnum">
                        from {formatMoney(l.amount)} · 1 {l.fx.from} = {Number(l.fx.rate).toFixed(4)} {l.fx.to}
                        {l.fx.rateDate ? ` (${l.fx.rateDate})` : ''}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {b.missing.length || caveats.length ? (
          <ul className="flex flex-col gap-1 rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
            {b.missing.map((m) => (
              <li key={m.message} className={m.required ? 'font-medium text-caution' : undefined}>
                {m.message}
              </li>
            ))}
            {caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        {b.lesson ? (
          <div className="rounded-[14px] border border-divider px-3 py-2.5">
            <p className="eyebrow m-0 mb-1">Not in the total</p>
            <p className="m-0 flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="min-w-0 text-ink">
                {b.lesson.label}
                {b.lesson.note ? <span className="block text-[12px] text-ink-3">{b.lesson.note}</span> : null}
              </span>
              <span className="shrink-0 font-medium text-ink tnum">{formatMoneyRange(b.lesson.display ?? b.lesson.amount, b.lesson.displayMax ?? b.lesson.amountMax)}</span>
            </p>
            {b.lesson.source ? <p className="m-0 mt-1 text-[12px] text-ink-3">{b.lesson.source}</p> : null}
          </div>
        ) : null}
        {row.pass ? (
          <p className="text-[12.5px] text-ink-2">
            Priced with your {row.pass.productName}: {row.pass.canSki ? row.pass.headline : `${row.pass.headline} — tickets priced instead`}.
          </p>
        ) : null}
        {row.estimates.length ? (
          <section aria-labelledby={`est-${row.resort.id}`}>
            <p id={`est-${row.resort.id}`} className="eyebrow mb-1.5 flex items-center gap-1.5">
              <PenLine aria-hidden className="size-3.5" /> Your estimates at {row.resort.shortName}
            </p>
            <ul className="flex flex-col divide-y divide-divider rounded-md border border-divider">
              {row.estimates.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="min-w-0 text-[13px]">
                    <span className="text-ink">{estimateWhatLabel(e)}</span>
                    <span className="block text-[12px] text-ink-3 tnum">{estimateSummary(e)}</span>
                  </span>
                  <span className="flex shrink-0 items-center">
                    <EstimateButton
                      subject={e.subject}
                      subjectId={row.resort.id}
                      subjectName={row.resort.name}
                      rentalOption={e.rentalOption}
                      currencies={ctx.currencies}
                      defaultCurrency={ctx.defaultCurrency}
                      seasonLabel={ctx.seasonLabel}
                      existing={e}
                      trigger="icon"
                    />
                    <RemoveEstimateButton id={e.id} label={`${estimateWhatLabel(e)} at ${row.resort.name}`} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12px] text-ink-3">Each applies to its day type all season. A published price or observed quote, once recorded, takes precedence.</p>
          </section>
        ) : null}
        {sources.length ? (
          <div>
            <p className="eyebrow mb-2">Where each line comes from</p>
            <SourceList items={sources} />
          </div>
        ) : null}
        <Link href={`/resorts/${row.resort.id}#plan`} className="text-[13px] font-medium text-teal hover:underline">
          All prices on the {row.resort.shortName} page
        </Link>
      </div>
    </DetailsSheet>
  )
}

const ESTIMATE_LABEL: Record<string, string> = { 'lift-ticket': 'Lift ticket', parking: 'Parking (per vehicle)', 'full-package': 'Rental package', 'skis-only': 'Ski rental', 'boots-only': 'Boot rental' }

function estimateWhatLabel(e: EstimateView): string {
  return (e.subject === 'rental' ? ESTIMATE_LABEL[e.rentalOption ?? ''] : ESTIMATE_LABEL[e.subject]) ?? 'Estimate'
}

function TableHead() {
  return (
    <thead className="bg-surface-2 text-[12px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
      <tr>
        <th scope="col" className="px-4 py-2.5">
          Resort
        </th>
        {LINE_ORDER.map((k) => (
          <th key={k} scope="col" className="px-3 py-2.5 text-right">
            {LINE_HEAD[k]}
          </th>
        ))}
        <th scope="col" className="px-3 py-2.5 text-right">
          Per person
        </th>
        <th scope="col" className="px-4 py-2.5">
          <span className="sr-only">Tier and details</span>
        </th>
      </tr>
    </thead>
  )
}

export function CostsTable({ rows, ctx, currency, caption }: { rows: DayCostRow[]; ctx: EstimateCtx; currency: string; caption?: string }) {
  return (
    <div className="overflow-hidden glass rounded-[24px]">
      <table className="w-full text-left text-[13.5px]">
        <caption className="sr-only">{caption ?? `Per-person day basket by resort on ${dayLabel(ctx.date, true)}, in ${currency}`}</caption>
        <TableHead />
        <tbody>
          {rows.map((row) => (
            <tr key={row.resort.id} className="border-t border-divider align-top">
              <th scope="row" className="px-4 py-3 font-normal">
                <Link href={`/resorts/${row.resort.id}`} className="font-medium text-ink hover:text-teal hover:underline">
                  {row.resort.name}
                </Link>
                <span className="block text-[12px] text-ink-3">{dotJoin(row.resort.region, row.resort.isFavorite ? 'favourite' : null)}</span>
              </th>
              {LINE_ORDER.map((k) => (
                <td key={k} className="px-3 py-3 text-right">
                  <LineCell row={row} l={lineOf(row, k)} ctx={ctx} />
                </td>
              ))}
              <td className="px-3 py-3 text-right">
                <Total row={row} />
              </td>
              <td className="px-4 py-3">
                <span className="flex items-center justify-end gap-2">
                  {row.basket.total ? <TierMark row={row} /> : <span className="sr-only">No tier</span>}
                  <BasketSheet row={row} ctx={ctx} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CostsList({ rows, ctx }: { rows: DayCostRow[]; ctx: EstimateCtx }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.resort.id} className="glass rounded-[24px] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/resorts/${row.resort.id}`} className="text-[15px] font-medium text-ink hover:text-teal">
                {row.resort.name}
              </Link>
              <p className="text-[12px] text-ink-3">{dotJoin(row.resort.region, row.resort.isFavorite ? 'favourite' : null)}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {row.basket.total ? <TierMark row={row} /> : null}
              <Total row={row} />
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-divider pt-2 text-[13px]">
            {LINE_ORDER.map((k) => (
              <div key={k} className="flex min-w-0 flex-col">
                <dt className="text-[12px] text-ink-3">{LINE_HEAD[k]}</dt>
                <dd>
                  <LineCell row={row} l={lineOf(row, k)} ctx={ctx} align="left" />
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-1 flex justify-end">
            <BasketSheet row={row} ctx={ctx} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The four bands as a ruler, with how many resorts land in each on this date. */
export function BandRuler({ bands, rows, currency }: { bands: { tier: string; range: string }[]; rows: DayCostRow[]; currency: string }) {
  const count = (t: string) => rows.filter((r) => r.basket.tier.tier === t).length
  const incomplete = rows.filter((r) => r.basket.tier.tier === 'incomplete').length
  return (
    <div className="flex flex-col gap-2">
      <ol className="grid grid-cols-4 gap-1.5" aria-label={`Expense tier bands (${currency}, per person per day)`}>
        {bands.map((b, i) => (
          <li key={b.tier} className="flex min-w-0 flex-col gap-1">
            <span aria-hidden className={cn('h-1.5 rounded-full bg-copper', ['opacity-25', 'opacity-45', 'opacity-70', 'opacity-100'][i])} />
            <span className="mt-0.5 font-display text-[20px] leading-none text-copper">{b.tier}</span>
            <span className="text-[12px] leading-tight text-ink-2 tnum">{b.range}</span>
            <span className="text-[12px] text-ink-3 tnum">{plural(count(b.tier), 'resort')}</span>
          </li>
        ))}
      </ol>
      <p className="m-0 text-[12px] text-ink-3">
        Bands per person per day, in {currency}.{incomplete ? ` ${plural(incomplete, 'resort')} missing a price get no band.` : ''}
      </p>
    </div>
  )
}
