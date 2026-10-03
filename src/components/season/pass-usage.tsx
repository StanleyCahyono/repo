/**
 * Pass usage for the season (server-rendered): for each pass on file, days used, what is left where I used it, and
 * the purchase counted once with its cost per day. "Ticket value" is what those days would have cost on the day's own
 * ticket price — shown separately, never added to spending, and not cash saved unless I would have skied anyway.
 */
import Link from 'next/link'
import { ArrowRight, Ticket } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { PassBadge } from '@/components/ui/badge'
import { KindTag, Missing } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { SeasonPassView } from '@/lib/data/season'
import { PASS_FAMILIES, type PassFamilyId } from '@/lib/domain/types'
import { PASS_VALUE_PROVENANCE, money, plural } from './format'

const isFamily = (f: string): f is PassFamilyId => (PASS_FAMILIES as readonly string[]).includes(f)

function Allowance({ label, used, remaining, status }: { label: string; used: number; remaining: number | null; status: string }) {
  const out = remaining === 0
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
      <span className="min-w-0 text-ink">{label}</span>
      <span className="shrink-0 text-right tnum">
        <span className="font-semibold text-ink">{used} used</span>
        <span className={cn('ml-2', out ? 'font-medium text-caution' : 'text-ink-2')}>· {status}</span>
      </span>
    </li>
  )
}

function PassCard({ p, demo }: { p: SeasonPassView; demo: boolean }) {
  const usedAt = p.byResort.filter((a) => a.used > 0 && !a.poolId)
  const pools = p.byPool.filter((x) => x.used > 0)
  const unusedAvailable = p.byResort.filter((a) => a.used === 0 && (a.status === 'available' || a.status === 'unlimited')).length
  const v = p.value
  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {isFamily(p.familyId) ? <PassBadge family={p.familyId} size="sm" /> : null}
        {p.holder !== 'me' ? <span className="text-[12.5px] text-ink-3">for {p.holder}</span> : null}
        {demo ? <KindTag kind="demo" /> : null}
      </div>
      <p className="mt-1.5 text-[15px] font-semibold text-ink">{p.productName}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-[30px] leading-none text-ink tnum">{p.daysUsed}</span>
        <span className="text-[13.5px] text-ink-2">{p.daysUsed === 1 ? 'day used' : 'days used'} this season</span>
      </p>
      {usedAt.length || pools.length ? (
        <ul className="mt-2 divide-y divide-divider border-y border-divider">
          {usedAt.map((a) => (
            <Allowance key={a.resortId} label={a.resortName} used={a.used} remaining={a.remaining} status={a.statusLabel} />
          ))}
          {pools.map((x) => (
            <Allowance
              key={x.id}
              label={`${x.label ?? 'Shared days'} (${x.memberNames.join(', ')})`}
              used={x.used}
              remaining={x.remaining}
              status={x.remaining == null ? 'days not recorded' : x.remaining === 0 ? 'no days left' : `${x.remaining} left`}
            />
          ))}
        </ul>
      ) : null}
      {unusedAvailable ? <p className="mt-2 text-[12.5px] text-ink-3">Days still available at {plural(unusedAvailable, 'other resort')} on this pass.</p> : null}
      {v ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div>
            <dt className="text-ink-3">Purchase, counted once</dt>
            <dd className="font-semibold text-ink tnum">{v.cost ? money(v.cost) : <Missing label="Price not recorded" />}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Per day used</dt>
            <dd className="font-semibold text-ink tnum">{v.costPerDay ? money(v.costPerDay) : <span className="font-normal text-ink-3">—</span>}</dd>
          </div>
          <div className="col-span-2">
            <dt className="flex items-center gap-0.5 text-ink-3">
              Ticket value of those days
              <SourceDrawer title={`Ticket value · ${p.productName}`} items={[{ label: 'Ticket value of the days used', value: v.ticketValue ? money(v.ticketValue) : 'Partly unknown', prov: PASS_VALUE_PROVENANCE }]} />
            </dt>
            <dd className="text-ink tnum">
              {v.daysUsed === 0 ? (
                <span className="text-ink-3">No days used yet</span>
              ) : v.ticketValue ? (
                <>
                  <span className="font-semibold">{money(v.ticketValue)}</span>
                  {v.netValue ? (
                    <span className="text-ink-2">
                      {' '}
                      · {v.netValue.amountMinor >= 0 ? `${money(v.netValue)} more than the pass cost` : `${money({ ...v.netValue, amountMinor: -v.netValue.amountMinor })} short of the pass cost`}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-ink-2">
                  {v.ticketValueKnown.amountMinor > 0 ? `${money(v.ticketValueKnown)} known · ` : ''}
                  <Missing label={`ticket price unknown for ${plural(v.unknownValueDays, 'day')}`} />
                </span>
              )}
            </dd>
            <dd className="mt-0.5 text-[12px] text-ink-3">Not cash saved unless you would have skied those days anyway.</dd>
          </div>
        </dl>
      ) : null}
    </li>
  )
}

export function PassUsage({ passes, demo }: { passes: SeasonPassView[]; demo: boolean }) {
  return (
    <section aria-labelledby="pass-usage-title" className="rounded-[12px] border border-divider bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
        <h3 id="pass-usage-title" className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Ticket aria-hidden className="size-4 text-ink-2" /> Pass usage
        </h3>
        <Link href="/passes" className="inline-flex h-11 items-center gap-1 rounded-md px-1 text-[13px] font-medium text-teal hover:underline md:h-8">
          Passes <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </header>
      {passes.length ? (
        <ul className="divide-y divide-divider">
          {passes.map((p) => (
            <PassCard key={p.ownershipId} p={p} demo={demo} />
          ))}
        </ul>
      ) : (
        <div className="px-4 py-4 text-[13.5px] text-ink-2">
          <p className="font-medium text-ink">No pass on file for this season</p>
          <p className="mt-1">A resort’s pass affiliation never means you own that pass. Add the exact pass you bought in Passes &amp; Costs to count its days here.</p>
        </div>
      )}
    </section>
  )
}
