'use client'
/**
 * Facts for one planned ski day: lift access in one line — your pass covers it, a lift ticket in the plan covers it,
 * or it needs a lift ticket (one tap adds one); a chosen "what if" product is checked too. Rules that are not on file
 * are never shown or counted as included, conditions or weather potential inside the forecast horizon (modeled, "likely"), and the
 * per-person day basket as a Piste estimate for reference (not part of the trip total).
 */
import { Ban, CalendarClock, CircleCheck, CloudOff, History, Plus, Ticket, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ScoreChip, ConfidenceTag } from '@/components/ui/score'
import { Freshness, KindTag } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { DayResortView } from '@/lib/data/trip-plan'
import type { TripItemRow } from '@/lib/db/rows'
import type { AccessVerdict } from '@/lib/domain/passes'
import type { UnitPrefs } from '@/lib/domain/types'
import { addDays } from '@/lib/domain/time'
import { formatSnow, formatSpeed, formatTemp } from '@/lib/domain/units'
import { formatMoney, formatMoneyRange } from '@/lib/domain/money'
import { dayLabel } from './format'
import { useTripUi } from './trip-ui'

type AccessStatus = DayResortView['access']['status']

const ACCESS: Record<AccessStatus | 'ticket', { cls: string; Icon: typeof CircleCheck; label: string }> = {
  covered: { cls: 'bg-positive-bg text-positive border-transparent', Icon: CircleCheck, label: 'Pass covers it' },
  ticket: { cls: 'bg-glacier text-teal border-transparent', Icon: Ticket, label: 'Lift ticket planned' },
  'not-covered': { cls: 'bg-surface text-ink-2 border-divider-strong', Icon: Ticket, label: 'Needs a lift ticket' },
  // A rule that is not on file is never shown or counted: to you it reads like any day your pass does not cover.
  unknown: { cls: 'bg-surface text-ink-2 border-divider-strong', Icon: Ticket, label: 'Needs a lift ticket' },
  'no-pass': { cls: 'bg-surface text-ink-2 border-divider-strong', Icon: Ticket, label: 'Needs a lift ticket' },
}

function verdictStatus(v: AccessVerdict): AccessStatus {
  return v.canSki ? 'covered' : v.status === 'unknown' ? 'unknown' : 'not-covered'
}

/** Why a pass does not cover the day, in a few words — only for rules that are on file. */
function notCoveredWhy(v: AccessVerdict | undefined): string | null {
  if (!v) return null
  switch (v.status) {
    case 'blackout':
      return `${v.productName}: blacked out on this date`
    case 'days-exhausted':
      return `${v.productName}: no days left by this date`
    case 'discount-only':
      return `${v.productName}: discount only${v.discountText ? ` — ${v.discountText}` : ''}`
    case 'not-included':
      return `Not included in ${v.productName}`
    case 'season-mismatch':
      return `${v.productName} is for another season`
    default:
      return null
  }
}

export function AccessPill({ status, product, className }: { status: AccessStatus | 'ticket'; product?: string | null; className?: string }) {
  const a = ACCESS[status]
  return (
    <span className={cn('inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-semibold whitespace-nowrap', a.cls)}>
        <a.Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
        {a.label}
      </span>
      {product ? <span className="min-w-0 text-[12.5px] font-medium text-ink-2">{product}</span> : null}
    </span>
  )
}

function Reservation({ v }: { v: AccessVerdict | undefined }) {
  if (!v) return null
  if (v.reservationRequired === true) return <p className="mt-1 text-[12.5px] font-medium text-caution">Reservation required{v.reservationNotes ? ` — ${v.reservationNotes}` : ''}</p>
  if (v.reservationRequired === false) return <p className="mt-1 text-[12.5px] text-ink-2">No reservation needed</p>
  if (v.reservationNotes) return <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">Reservations: {v.reservationNotes}</p>
  return null
}

function AccessCell({ r, date, ticket, chosenName }: { r: DayResortView; date: string; ticket: TripItemRow | null; chosenName: string | null }) {
  const { data, openEditor } = useTripUi()
  const covered = r.access.status === 'covered'
  const best = covered ? r.access.verdicts.find((v) => v.canSki) : undefined
  const why = covered ? null : (r.access.verdicts.map(notCoveredWhy).find(Boolean) ?? null)
  const addTicket = () => openEditor({ mode: 'add', type: 'lift-ticket', defaults: { date, refId: r.resortId, title: `${r.shortName} lift ticket` } })
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">Lift access</p>
      {covered ? (
        <>
          <AccessPill status="covered" product={best?.productName ?? r.access.productName} />
          {best && best.remainingAfterVisit !== null ? <p className="mt-1.5 text-[12.5px] text-ink-2 tnum">{best.remainingAfterVisit} day{best.remainingAfterVisit === 1 ? '' : 's'} left after this visit</p> : null}
          <Reservation v={best} />
        </>
      ) : ticket ? (
        <>
          <AccessPill status="ticket" />
          <button type="button" onClick={() => openEditor({ mode: 'edit', item: ticket })} className="mt-1.5 block max-w-full text-left text-[12.5px] font-medium text-ink underline-offset-2 hover:text-teal hover:underline">
            {ticket.title}
          </button>
        </>
      ) : (
        <>
          <AccessPill status={r.access.status} />
          <p className="mt-1.5 text-[12.5px] text-ink-2">{why ?? (r.access.status === 'no-pass' ? 'No pass on file for this day.' : 'Your passes don’t cover this day.')}</p>
          {data.status !== 'cancelled' ? (
            <button
              type="button"
              onClick={addTicket}
              className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full border border-divider-strong bg-surface px-3 text-[13px] font-medium text-ink transition-[transform,border-color,color] duration-150 hover:-translate-y-px hover:border-teal hover:text-teal"
            >
              <Plus aria-hidden className="size-3.5" /> Add a lift ticket
            </button>
          ) : null}
        </>
      )}
      {r.chosen ? (
        <div className="mt-2.5 border-t border-dashed border-divider pt-2">
          <p className="text-[12px] font-semibold text-ink-3">What if · {chosenName}</p>
          <AccessPill className="mt-1" status={verdictStatus(r.chosen)} />
          {r.chosen.canSki ? <Reservation v={r.chosen} /> : notCoveredWhy(r.chosen) ? <p className="mt-1 text-[12.5px] text-ink-2">{notCoveredWhy(r.chosen)}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function ConditionsCell({ r, units, date, now }: { r: DayResortView; units: UnitPrefs; date: string; now: string }) {
  const c = r.conditions
  const sum = c.summary
  const w = sum?.weather.summit ?? sum?.weather.base ?? null
  const run = sum?.weather.summitRun ?? sum?.weather.baseRun ?? null
  const inRange = c.state !== 'beyond-horizon' && c.state !== 'past'
  const sources = [
    ...(sum?.score ? [{ label: 'Conditions score', value: sum.score.descriptor ?? undefined, prov: sum.score.prov }] : []),
    ...(sum?.weather.summitRun ? [{ label: 'Weather, upper mountain (model run)', prov: sum.weather.summitRun.prov }] : []),
    ...(sum?.weather.baseRun ? [{ label: 'Weather, base (model run)', prov: sum.weather.baseRun.prov }] : []),
    ...(sum?.status?.prov ? [{ label: 'Operating status', value: sum.status.label, prov: sum.status.prov }] : []),
  ]
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1">
        <p className="eyebrow">Conditions</p>
        {sources.length ? <SourceDrawer title={`Conditions at ${r.shortName}, ${dayLabel(date)}`} items={sources} className="-my-1" /> : null}
      </div>
      {c.state === 'score' && sum?.score ? (
        <div className="flex flex-col gap-1">
          <ScoreChip scoreKind={sum.score.scoreKind} score={sum.score.score} coverage={sum.score.coverage} size="sm" />
          <ConfidenceTag confidence={sum.score.confidence} />
        </div>
      ) : c.state === 'closed' ? (
        <p className="inline-flex items-start gap-1.5 text-[13.5px] font-medium text-critical">
          <Ban aria-hidden className="mt-0.5 size-4 shrink-0" /> {sum?.closure?.reason ?? 'Closed'}
        </p>
      ) : c.state === 'beyond-horizon' ? (
        <p className="inline-flex items-start gap-1.5 text-[13.5px] text-ink-2">
          <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <span>
            Beyond the 16-day forecast. Weather potential appears from <span className="tnum">{dayLabel(addDays(date, -15))}</span>.
          </span>
        </p>
      ) : c.state === 'past' ? (
        <p className="inline-flex items-center gap-1.5 text-[13.5px] text-ink-3">
          <History aria-hidden className="size-4" /> Past day
        </p>
      ) : (
        <div>
          <p className="text-[13.5px] text-ink-3 italic">{r.inCatalog ? 'No conditions score yet' : 'Resort not in the catalog'}</p>
          {r.inCatalog && sum && !run ? (
            <p className="mt-1 inline-flex items-start gap-1.5 text-[12.5px] text-ink-2">
              <CloudOff aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-3" /> Weather not fetched yet — no weather potential to show.
            </p>
          ) : null}
        </div>
      )}
      {w && inRange ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-2">
          <KindTag kind={run?.kind === 'demo' ? 'demo' : 'modeled'} />
          <span className="tnum">
            Likely {w.snowfallCm !== null ? `${formatSnow(w.snowfallCm, units)} new snow` : 'snow unknown'}
            {w.tempMinC !== null && w.tempMaxC !== null ? ` · ${formatTemp(w.tempMinC, units)} to ${formatTemp(w.tempMaxC, units)}` : ''}
            {w.windMaxKmh !== null ? ` · wind to ${formatSpeed(w.windMaxKmh, units)}` : ''}
          </span>
        </p>
      ) : null}
      {run && inRange ? <Freshness at={run.fetchedAt} now={now} staleHours={12} prefix="Model run fetched" className="mt-0.5 block" /> : null}
      {sum?.officialAlerts.length && inRange ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {sum.officialAlerts.slice(0, 2).map((a) => (
            <li key={a.id} className="flex items-start gap-1.5 text-[12.5px] font-medium text-critical">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {a.url ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                  {a.event} ({a.provider})<span className="sr-only"> — opens in a new tab</span>
                </a>
              ) : (
                <span>
                  {a.event} ({a.provider})
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {c.state === 'beyond-horizon' && c.opening ? <p className="mt-1.5 text-[12.5px] text-ink-2">{openingLine(c.opening)}</p> : null}
      {sum?.status && inRange && sum.status.status === 'unknown' ? <p className="mt-1 text-[12.5px] text-ink-3">Operating status unknown — not assumed open.</p> : null}
    </div>
  )
}

function openingLine(o: NonNullable<DayResortView['conditions']['opening']>): string {
  const d = (x: string | null) => (x ? dayLabel(x) : '')
  const open =
    o.label === 'opened' ? `Season opened ${d(o.date)}` : o.label === 'announced' ? `Opening announced for ${d(o.date)}` : o.label === 'estimated' ? `Opening estimated ${d(o.date)}${o.to ? `–${d(o.to)}` : ''} (Piste estimate)` : 'Opening date not announced'
  const close = o.closing.label === 'announced' && o.closing.date ? ` · closing announced ${d(o.closing.date)}` : o.closing.label === 'closed' ? ' · season closed' : ''
  return `${open}${close}.`
}

function BasketCell({ r }: { r: DayResortView }) {
  const b = r.basket
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">Day basket</p>
      {!b ? (
        <p className="text-[13.5px] text-ink-3 italic">Not available</p>
      ) : b.total ? (
        <>
          <p className="text-[15px] font-semibold text-ink tnum">
            {formatMoneyRange(b.total, b.totalMax)} <span className="text-[12.5px] font-normal text-ink-3">pp · {b.label}</span>
          </p>
          {b.passCoveredBy ? <p className="text-[12.5px] text-positive">Lift access covered by {b.passCoveredBy}</p> : null}
        </>
      ) : (
        <>
          <p className="text-[13.5px] font-medium text-ink">Incomplete estimate</p>
          <p className="text-[12.5px] text-ink-2">
            Known so far <span className="tnum">{formatMoney(b.knownSubtotal)}</span> pp
          </p>
          {b.requiredMissing[0] ? <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{b.requiredMissing.join(' ')}</p> : null}
        </>
      )}
      {b ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-3">
          <KindTag kind={b.lines.some((l) => l.kind === 'demo') ? 'demo' : 'derived'} />
          <span>· for reference, not in your budget</span>
        </p>
      ) : null}
    </div>
  )
}

export function DayResortFacts({ r, units, date, now, chosenName, ticket = null, header }: { r: DayResortView; units: UnitPrefs; date: string; now: string; chosenName: string | null; ticket?: TripItemRow | null; header?: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-divider bg-ink/[0.03]">
      {header ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-3.5 py-2">{header}</div> : null}
      <div className="grid gap-4 p-3.5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        <AccessCell r={r} date={date} ticket={ticket} chosenName={chosenName} />
        <ConditionsCell r={r} units={units} date={date} now={now} />
        <div className="sm:col-span-2 lg:col-span-1">
          <BasketCell r={r} />
        </div>
      </div>
    </div>
  )
}
