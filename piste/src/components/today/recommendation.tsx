/**
 * "Where to ski" — the pick for the chosen date(s), up to three alternatives, the status-unknown group and what was
 * excluded, all from the recommendation engine (eligibility first: a confirmed closure is never offered, unknown
 * status is never treated as open).
 *
 * The pick shows its status basis, the engine's benefits and trade-offs, the evidence limitations right beside them
 * (never hidden), and the factor table that adds up to its ranking total. Every fact with its sources is one tap away
 * in "Quick look" (the shared <ResortCard/>, not a copy). Alternatives say in plain words why they sit where they do.
 */
import Link from 'next/link'
import { ArrowUpRight, Ban, ChevronDown, CircleCheck, CircleHelp, Clock3, MapPinOff, Minus, Plus, Siren, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Badge } from '@/components/ui/badge'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { ResortCardData } from '@/components/resort/card-data'
import { FactorBars } from './factor-bars'
import { QuickLook, SaveTripButton } from './option-actions'
import { formatDates } from './params'
import { explainPosition, ordinal, type OptionView, type RankingView } from './rank-model'
import { Label } from './section'

const cardKey = (id: string, date: string) => `${id}|${date}`

export interface RecommendationProps {
  ranking: RankingView
  dates: string[]
  today: string
  cards: Record<string, ResortCardData>
  resortCount: number
  /** Demo mode: simulated data, labelled beside the title. */
  demo?: boolean
}

/** Ski days for a saved trip: the option's eligible days in the selected range. */
export function skiDatesOf(o: OptionView): string[] {
  return o.days.filter((d) => d.best || d.eligibility === 'confirmed-open' || d.eligibility === 'expected-open').map((d) => d.date)
}

function StatusLine({ o, className }: { o: OptionView; className?: string }) {
  const confirmed = o.eligibility === 'confirmed-open'
  const unknown = o.eligibility === 'status-unknown'
  const Icon = confirmed ? CircleCheck : unknown ? CircleHelp : Clock3
  return (
    <p className={cn('flex items-start gap-1.5 text-[13.5px] font-medium', confirmed ? 'text-positive' : unknown ? 'text-ink-2' : 'text-caution', className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{o.statusNote}</span>
    </p>
  )
}

function Bullets({ items, kind }: { items: string[]; kind: 'benefit' | 'tradeoff' | 'limit' | 'warning' }) {
  const Icon = kind === 'benefit' ? Plus : kind === 'tradeoff' ? Minus : kind === 'warning' ? Siren : TriangleAlert
  const tone = kind === 'benefit' ? 'text-positive' : kind === 'tradeoff' ? 'text-ink-2' : 'text-caution'
  return (
    <ul className="mt-1.5 flex flex-col gap-1.5">
      {items.map((x) => (
        <li key={x} className="flex items-start gap-2 text-[14px] leading-snug text-ink">
          <Icon aria-hidden className={cn('mt-[3px] size-3.5 shrink-0', tone)} strokeWidth={2.2} />
          <span className="min-w-0">{x}</span>
        </li>
      ))}
    </ul>
  )
}

function Winner({
  o,
  runnerUp,
  card,
  dates,
  presetLabel,
}: {
  o: OptionView
  runnerUp: OptionView | null
  card: ResortCardData | undefined
  dates: string[]
  presetLabel: string
}) {
  const range = dates.length > 1
  const lines = runnerUp ? explainPosition([o, runnerUp], 0).filter((l) => !/unknown and counted/.test(l)) : []
  const benefits = o.benefits.filter((b) => !/^Ranks \d/.test(b))
  const otherDays = o.days.filter((d) => !d.best)
  return (
    <div className="px-4 pt-4 pb-5 md:px-6 md:pt-5">
      <StatusLine o={o} />
      <div className="mt-1.5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-[34px] leading-[1.02] text-ink md:text-[44px]">
            <span className="sr-only">Top pick: </span>
            <Link href={card?.href ?? `/resorts/${o.resortId}`} className="rounded-sm decoration-teal/50 underline-offset-4 hover:text-teal hover:underline">
              {card?.name ?? o.name}
            </Link>
          </h3>
          <p className="mt-1 text-[14px] text-ink-2">
            {[
              card?.place,
              card && card.travel.mode === 'drive' ? `${card.travel.headline} drive` : card?.travel.mode === 'fly' ? `fly-in ${card.travel.caption}` : null,
              card && card.fit.score !== null ? card.fit.label : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {range ? (
              <>
                {card ? ' · ' : null}
                <span className="font-medium text-ink">Best day {formatDates([o.date])}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display tnum text-[40px] leading-none text-ink md:text-[48px]">{o.total.toFixed(1)}</p>
          <p className="mt-1 text-[12px] leading-tight text-ink-3">
            ranking of 100
            <br />
            {presetLabel}
          </p>
        </div>
      </div>

      {o.warnings.length ? (
        <div className="mt-3 rounded-[10px] bg-caution-bg px-3 py-2 text-[13.5px] text-ink" role="note">
          <p className="flex items-center gap-1.5 font-semibold">
            <Siren aria-hidden className="size-4 text-caution" /> Official alert
            {o.warnings.length > 1 ? 's' : ''} — shown beside the ranking, never scored
          </p>
          <Bullets items={o.warnings} kind="warning" />
        </div>
      ) : null}

      <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
        <div>
          <Label as="h4">Why it ranks first</Label>
          <Bullets items={benefits.length ? benefits : ['Highest total among the resorts that can be skied']} kind="benefit" />
          {lines.length ? <p className="mt-2 text-[13px] text-ink-2">{lines[0]}</p> : null}
        </div>
        <div className="flex flex-col gap-5">
          <div>
            <Label as="h4">Trade-offs</Label>
            {o.tradeoffs.length ? (
              <Bullets items={o.tradeoffs} kind="tradeoff" />
            ) : (
              <p className="mt-1.5 text-[14px] text-ink-2">None of note among the factors weighed.</p>
            )}
          </div>
          <div className="rounded-[10px] border border-caution/30 bg-caution-bg/50 px-3 py-2.5">
            <Label as="h4" className="text-caution">
              Evidence limits · {o.limitations.length}
            </Label>
            {o.limitations.length ? (
              <Bullets items={o.limitations} kind="limit" />
            ) : (
              <p className="mt-1 text-[13.5px] text-ink-2">No known gaps in the evidence behind this pick.</p>
            )}
          </div>
        </div>
      </div>

      {range && otherDays.length ? (
        <p className="mt-4 text-[13px] text-ink-2">
          Other days:{' '}
          {otherDays.map((d, i) => (
            <span key={d.date}>
              {i ? ' · ' : ''}
              <span className="font-medium text-ink">{formatDates([d.date])}</span>{' '}
              {d.total !== null ? <span className="tnum">{d.total.toFixed(1)}</span> : <span className="text-ink-3">{d.note}</span>}
            </span>
          ))}
        </p>
      ) : null}

      <div className="mt-5">
        <Label as="h4">How the ranking adds up</Label>
        <FactorBars className="mt-2" factors={o.factors} total={o.total} caption={`${o.name}: factor weights, values and points (${presetLabel})`} compact />
        <p className="mt-2 text-[12.5px] text-ink-3">
          Weights from “{presetLabel}”. Unknown factors count below neutral, so missing data never helps a resort rank higher. Scores describe suitability, not
          safety.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <SaveTripButton
          resortId={o.resortId}
          name={card?.name ?? o.name}
          from={dates[0]}
          to={dates[dates.length - 1]}
          skiDates={skiDatesOf(o)}
          variant="primary"
        />
        {card ? <QuickLook card={card} /> : null}
        <Link
          href={card?.href ?? `/resorts/${o.resortId}`}
          className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-[14px] font-medium text-teal hover:bg-glacier/60 md:h-10"
        >
          Resort page <ArrowUpRight aria-hidden className="size-4" />
        </Link>
        {card ? (
          <SourceDrawer title={`${card.name} — sources`} items={card.sources} label="Sources" compact={false} className="h-11 px-2 text-[13.5px] md:h-10" />
        ) : null}
      </div>
    </div>
  )
}

function Alternatives({ list, cards, dates }: { list: OptionView[]; cards: Record<string, ResortCardData>; dates: string[] }) {
  const range = dates.length > 1
  return (
    <div className="border-t border-divider">
      <Label as="h3" className="px-4 pt-4 md:px-6">
        Alternatives
      </Label>
      <ol className="divide-y divide-divider">
        {list.slice(1).map((o, i) => {
          const card = cards[cardKey(o.resortId, o.date)]
          const why = explainPosition(list, i + 1)[0]
          return (
            <li key={o.resortId} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3.5 md:px-6">
              <span className="font-display tnum pt-0.5 text-[20px] leading-none text-ink-3" aria-hidden>
                {o.rank}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="sr-only">{ordinal(o.rank)}: </span>
                  <Link href={card?.href ?? `/resorts/${o.resortId}`} className="text-[16px] font-semibold text-ink hover:text-teal hover:underline">
                    {card?.name ?? o.name}
                  </Link>
                  <span className="text-[13px] text-ink-2">
                    {card?.place}
                    {card && card.travel.mode !== 'none' ? ` · ${card.travel.mode === 'fly' ? 'fly-in' : `${card.travel.headline} drive`}` : ''}
                    {range ? ` · best ${formatDates([o.date])}` : ''}
                  </span>
                </p>
                <StatusLine o={o} className="mt-0.5 text-[12.5px]" />
                {why ? <p className="mt-1 text-[13px] text-ink-2">{why}</p> : null}
                {o.warnings.length ? (
                  <p className="mt-1 flex items-start gap-1.5 text-[12.5px] font-medium text-caution">
                    <Siren aria-hidden className="mt-0.5 size-3.5 shrink-0" /> Official alert: {o.warnings[0]}
                  </p>
                ) : null}
                {o.limitations.length ? (
                  <p className="mt-1 flex items-start gap-1.5 text-[12.5px] text-ink-3">
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-caution" />
                    <span>
                      {o.limitations[0]}
                      {o.limitations.length > 1 ? ` · +${o.limitations.length - 1} more evidence limit${o.limitations.length > 2 ? 's' : ''}` : ''}
                    </span>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="font-display tnum text-[26px] leading-none text-ink">
                  {o.total.toFixed(1)}
                  <span className="sr-only"> ranking total</span>
                </span>
                <span className="flex flex-col items-center gap-1 sm:flex-row">
                  {card ? <QuickLook card={card} iconOnly /> : null}
                  <SaveTripButton
                    resortId={o.resortId}
                    name={card?.name ?? o.name}
                    from={dates[0]}
                    to={dates[dates.length - 1]}
                    skiDates={skiDatesOf(o)}
                    variant="icon"
                  />
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function UnknownGroup({ list, cards, compact = false }: { list: OptionView[]; cards: Record<string, ResortCardData>; compact?: boolean }) {
  return (
    <div className={cn('border-t border-dashed border-divider-strong bg-surface-2 px-4 py-4 md:px-6', compact && 'rounded-b-[14px]')}>
      <Label as="h3" className="flex items-center gap-1.5">
        <CircleHelp aria-hidden className="size-3.5" /> Status unknown — check before going
      </Label>
      <p className="mt-1 text-[13px] text-ink-2">
        Ranked for planning only. Unknown operating status is never treated as open, so none of these can be the pick.
      </p>
      <ul className="mt-2 flex flex-col divide-y divide-divider">
        {list.map((o) => {
          const card = cards[cardKey(o.resortId, o.date)]
          return (
            <li key={o.resortId} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link href={card?.href ?? `/resorts/${o.resortId}`} className="text-[15px] font-semibold text-ink hover:text-teal hover:underline">
                  {card?.name ?? o.name}
                </Link>
                <p className="text-[13px] text-ink-2">{o.statusNote}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tnum text-[13px] text-ink-3" title="Planning rank total — not a pick">
                  {o.total.toFixed(1)}
                </span>
                {card ? <QuickLook card={card} iconOnly /> : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const EXCLUDED_TITLE = {
  closed: 'Closed',
  preseason: 'Not open yet',
  travel: 'Outside your travel limits',
} as const

export function Excluded({ list, datesLabel }: { list: RankingView['excluded']; datesLabel: string }) {
  if (!list.length) return null
  const groups = (['closed', 'travel', 'preseason'] as const).map((k) => ({ k, items: list.filter((e) => e.kind === k) })).filter((g) => g.items.length)
  const Icon = { closed: Ban, travel: MapPinOff, preseason: Clock3 }
  return (
    <details className="group border-t border-divider">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[13.5px] font-medium text-ink-2 hover:text-ink md:px-6 [&::-webkit-details-marker]:hidden">
        <span>
          Not available on {datesLabel} · <span className="tnum">{list.length}</span> resort
          {list.length === 1 ? '' : 's'}
          <span className="font-normal text-ink-3"> ({groups.map((g) => `${g.items.length} ${EXCLUDED_TITLE[g.k].toLowerCase()}`).join(', ')})</span>
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="grid gap-4 px-4 pb-4 md:px-6 lg:grid-cols-2">
        {groups.map((g) => {
          const I = Icon[g.k]
          return (
            <div key={g.k}>
              <Label as="h4" className="flex items-center gap-1.5">
                <I aria-hidden className={cn('size-3.5', g.k === 'closed' ? 'text-critical' : '')} /> {EXCLUDED_TITLE[g.k]} · {g.items.length}
              </Label>
              <ul className="mt-1.5 flex flex-col gap-1">
                {g.items.map((e) => (
                  <li key={e.resortId} className="text-[13px] leading-snug text-ink-2">
                    <Link href={`/resorts/${e.resortId}`} className="font-medium text-ink hover:text-teal hover:underline">
                      {e.name}
                    </Link>{' '}
                    — {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </details>
  )
}

export function RecommendationPanel({ ranking, dates, today, cards, resortCount, demo = false }: RecommendationProps) {
  const winner = ranking.preseason ? null : (ranking.options[0] ?? null)
  const top = winner ? ranking.options.slice(0, 4) : []
  const label = formatDates(dates)
  return (
    <section aria-labelledby="where-title" className="rounded-[14px] border border-divider bg-surface">
      <div className="border-b border-divider px-4 pt-4 pb-3 md:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="where-title" className="text-[17px] font-semibold text-ink">
            Where to ski <span className="font-normal text-ink-2">· {dates.length === 1 && dates[0] === today ? `today, ${label}` : label}</span>
            {demo ? (
              <Badge tone="demo" className="ml-2 h-5 px-1.5 align-[2px]">
                Demo
              </Badge>
            ) : null}
          </h2>
          <p className="tnum text-[12.5px] text-ink-3">
            {ranking.options.length} of {resortCount} resorts can be skied
            {ranking.unknown.length ? ` · ${ranking.unknown.length} unknown` : ''}
          </p>
        </div>
        {ranking.weightsNote ? <p className="mt-2 text-[12.5px] font-medium text-caution">{ranking.weightsNote}</p> : null}
      </div>

      {winner ? (
        <Winner
          o={winner}
          runnerUp={ranking.options[1] ?? null}
          card={cards[cardKey(winner.resortId, winner.date)]}
          dates={dates}
          presetLabel={ranking.presetLabel}
        />
      ) : (
        <div className="px-4 py-6 md:px-6">
          <p className="font-display text-[30px] leading-[1.05] text-ink md:text-[36px]">No pick for {label}</p>
          <p className="mt-2 max-w-[60ch] text-[15px] text-ink-2">{ranking.noWinnerReason}</p>
        </div>
      )}
      {top.length > 1 ? <Alternatives list={top} cards={cards} dates={dates} /> : null}
      {ranking.unknown.length ? <UnknownGroup list={ranking.unknown.slice(0, 4)} cards={cards} /> : null}
      <Excluded list={ranking.excluded} datesLabel={label} />
    </section>
  )
}
