/**
 * "Your passes": each pass you (or a companion) hold, with remaining days by resort and by shared pool, what it has
 * cost per day so far (the purchase counted once), and the log of days skied on it. Removing a day or a pass answers
 * with an Undo toast. Server-rendered; the controls are client islands.
 */
import Link from 'next/link'
import { ArrowRight, Layers } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import type { SeasonPassView } from '@/lib/data/season'
import type { OwnedValueBasis, ResortOption } from '@/lib/data/passes-screen'
import { formatMoney } from '@/lib/domain/money'
import { cn } from '@/lib/ui/cn'
import { AccessMark } from './access-mark'
import { dayLabel, dotJoin, familyId, plural, shortDate } from './format'
import { checkerHref } from './params'
import { LogDayButton, RemoveDayButton, RemovePassButton, type ResortChoice } from './pass-forms'
import { PunchMeter } from './punch-meter'
import { HolderTag } from './section'

const COST_SOURCE: Record<string, string> = {
  'linked-expenses': 'the linked purchase expense',
  'matched-expense': 'a matching pass expense',
  'pass-record': 'the price on the pass record',
}

export function OwnedPassCard({
  p,
  resorts,
  today,
  seasonStart,
  basis,
}: {
  p: SeasonPassView
  resorts: ResortOption[]
  today: string
  seasonStart: string
  /** How the logged days' ticket value was priced (your estimates, research-grade prices). */
  basis?: OwnedValueBasis | null
}) {
  const mine = p.holder === 'me'
  // Confirmed allowances get a row each; unconfirmed resorts are summarised (never shown as access).
  const covered = p.byResort.filter((r) => r.status !== 'not-included' && (r.status !== 'unknown' || r.used > 0))
  const unconfirmed = p.byResort.filter((r) => r.status === 'unknown' && r.used === 0)
  const notIncluded = p.byResort.filter((r) => r.status === 'not-included')
  const byId = new Map(p.byResort.map((r) => [r.resortId, r]))
  const choices: ResortChoice[] = [...resorts]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ id: r.id, name: r.name, region: r.region, status: byId.get(r.id)?.statusLabel ?? null }))
  const v = p.value
  const inSeason = p.usage.filter((u) => u.inSeason)
  const outOfSeason = p.usage.length - inSeason.length
  return (
    <article aria-labelledby={`own-${p.ownershipId}`} className="min-w-0 rounded-[12px] border border-divider bg-surface">
      <header className="flex flex-col gap-1.5 border-b border-divider px-4 pt-4 pb-3">
        <p className="flex flex-wrap items-center gap-2">
          <PassBadge family={familyId(p.familyId)} size="sm" />
          {mine ? null : <HolderTag holder={p.holder} />}
        </p>
        <h3 id={`own-${p.ownershipId}`} className="text-[17px] leading-snug font-semibold text-ink">
          {p.productName}
        </h3>
        <p className="text-[13px] text-ink-2">
          {dotJoin(
            mine ? 'Yours' : `Held by ${p.holder}`,
            p.purchasedOn ? `bought ${shortDate(p.purchasedOn)}` : 'purchase date not recorded',
            p.pricePaid ? `${formatMoney(p.pricePaid)} paid` : 'price paid not recorded',
          )}
        </p>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex items-end justify-between gap-3">
          <p className="flex items-baseline gap-2">
            <span className="font-display text-[34px] leading-none text-ink tnum">{p.daysUsed}</span>
            <span className="text-[13.5px] text-ink-2">{p.daysUsed === 1 ? 'day used' : 'days used'} this season</span>
          </p>
          <Link href={checkerHref({ own: p.ownershipId })} scroll={false} className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline max-md:min-h-11">
            Where it works <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>

        {covered.length ? (
          <ul className="flex flex-col gap-3" aria-label="Remaining days by resort">
            {covered.map((r) => (
              <li key={r.resortId} className="flex flex-col gap-1">
                <p className="flex items-baseline justify-between gap-3">
                  <Link href={checkerHref({ own: p.ownershipId, resort: r.resortId })} scroll={false} className="truncate text-[14px] font-medium text-ink hover:text-teal hover:underline">
                    {r.resortName}
                  </Link>
                  <span className={cn('shrink-0 text-[12.5px] tnum', r.status === 'exhausted' ? 'font-medium text-critical' : r.status === 'unknown' ? 'text-ink-3 italic' : 'text-ink-2')}>{r.statusLabel}</span>
                </p>
                {r.cap != null ? (
                  <PunchMeter total={r.cap} used={Math.min(r.cap, r.used)} compact />
                ) : r.status === 'unknown' ? (
                  <p className="text-[12.5px] text-ink-3">{r.used ? `${plural(r.used, 'day')} logged · ` : ''}allowance not recorded — not confirmed</p>
                ) : (
                  <p className="text-[12.5px] text-ink-3 tnum">
                    {dotJoin(r.used ? `${plural(r.used, 'day')} logged` : 'no days logged', r.poolId ? `shared pool: ${r.poolRemaining != null ? `${r.poolRemaining} left` : 'size not recorded'}` : null)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : !unconfirmed.length ? (
          <p className="rounded-[10px] border border-dashed border-divider-strong bg-surface-2 px-3 py-2 text-[13px] text-ink-2">No resort rules with access are recorded for this pass — nowhere is confirmed yet.</p>
        ) : null}

        {unconfirmed.length ? (
          <div className="rounded-[10px] border border-dashed border-divider-strong bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2">
            <p className="flex flex-wrap items-center gap-x-1.5">
              <AccessMark status="unknown" variant="cell" label={`Not confirmed at ${plural(unconfirmed.length, 'resort')}`} />
            </p>
            <p className="mt-0.5">
              {unconfirmed.map((r, i) => (
                <span key={r.resortId}>
                  {i ? ', ' : ''}
                  <Link href={checkerHref({ own: p.ownershipId, resort: r.resortId })} scroll={false} className="hover:text-teal hover:underline">
                    {r.resortName}
                  </Link>
                </span>
              ))}
              <span className="text-ink-3"> — the allowance is not recorded; check it before you rely on it.</span>
            </p>
          </div>
        ) : null}

        {p.byPool.map((pool) => (
          <div key={pool.id} className="rounded-[10px] border border-divider bg-surface-2 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
              <Layers aria-hidden className="size-3.5 text-ink-3" />
              {pool.label ?? 'Shared day pool'}
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              {pool.total != null ? `${plural(pool.total, 'day')} shared between ${pool.memberNames.join(' and ')}` : `Shared between ${pool.memberNames.join(' and ')} — pool size not recorded`}
            </p>
            {pool.total != null ? <PunchMeter className="mt-2" total={pool.total} used={Math.min(pool.total, pool.used)} compact /> : null}
          </div>
        ))}

        {notIncluded.length ? (
          <p className="text-[12.5px] text-ink-3">
            <AccessMark status="not-included" variant="cell" label="Not included:" className="mr-1.5 align-[-2px]" />
            {notIncluded.map((r) => r.resortName).join(', ')}
          </p>
        ) : null}

        {mine && v ? (
          <div className="border-t border-divider pt-3 text-[13px]">
            <p className="eyebrow mb-1.5">Value so far</p>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <dt className="text-ink-2">Cost per day used</dt>
              <dd className="text-right font-medium text-ink tnum">{v.costPerDay ? formatMoney(v.costPerDay) : <span className="font-normal text-ink-3 italic">{v.cost ? 'No days yet' : 'Price unknown'}</span>}</dd>
              <dt className="text-ink-2">Tickets for those days</dt>
              <dd className="text-right font-medium text-ink tnum">
                {v.ticketValue ? (
                  formatMoney(v.ticketValue)
                ) : v.daysUsed === 0 ? (
                  <span className="font-normal text-ink-3 italic">No days yet</span>
                ) : (
                  <span className="font-normal text-ink-3 italic">
                    {v.unknownValueDays === v.daysUsed ? 'Unknown' : `${formatMoney(v.ticketValueKnown)} + ${plural(v.unknownValueDays, 'day')} unknown`}
                  </span>
                )}
              </dd>
            </dl>
            {basis && (basis.estimatedDays || basis.researchedDays) && v.ticketValueKnown.amountMinor > 0 ? (
              <p className="mt-1.5 text-[12px] font-medium text-ink-2">
                {dotJoin(
                  basis.estimatedDays ? `Priced with your estimates on ${plural(basis.estimatedDays, 'day')}` : null,
                  basis.researchedDays ? `${plural(basis.researchedDays, 'researched price')} — confirm at source` : null,
                )}
              </p>
            ) : null}
            <p className="mt-1.5 text-[12px] text-ink-3">
              {v.cost && v.costSource ? `Purchase counted once in your season budget, from ${COST_SOURCE[v.costSource] ?? 'the pass record'} — never again as lift cash.` : 'Record the price paid to see cost per day.'} Ticket value
              is what those days would have cost at each day’s own price — not cash saved unless you would have skied anyway.
            </p>
          </div>
        ) : null}

        <div className="border-t border-divider pt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="eyebrow">Logged days</p>
            <LogDayButton ownershipId={p.ownershipId} productName={p.productName} resorts={choices} today={today} seasonStart={seasonStart} />
          </div>
          {inSeason.length ? (
            <ol className="flex flex-col divide-y divide-divider">
              {inSeason.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 text-[13.5px]">
                    <span className="text-ink tnum">{dayLabel(u.date, true)}</span>
                    <span className="text-ink-2"> · {u.resortName}</span>
                    {u.notes ? <span className="block truncate text-[12px] text-ink-3">{u.notes}</span> : null}
                  </span>
                  <RemoveDayButton usageId={u.id} label={`${u.resortName}, ${dayLabel(u.date, true)}`} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-ink-3">No days logged yet this season.</p>
          )}
          {outOfSeason ? <p className="mt-1 text-[12px] text-ink-3">{plural(outOfSeason, 'logged day')} outside the pass season (not counted).</p> : null}
        </div>
        <div className="flex justify-end">
          <RemovePassButton ownershipId={p.ownershipId} productName={p.productName} />
        </div>
      </div>
    </article>
  )
}
