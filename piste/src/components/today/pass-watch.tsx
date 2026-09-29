/**
 * Pass deadlines & sales: dated sales deadlines and price-tier deadlines (the price until a date, and the next
 * price when the source lists one), then undated research notes about sales for your favourites' passes. Research
 * facts say "Researched — confirm at source"; each row opens its source. Affiliation never implies ownership: only
 * products recorded as yours are called yours.
 */
import Link from 'next/link'
import { ArrowRight, CircleAlert, Ticket } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { PassBadge } from '@/components/ui/badge'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { formatLocalDate } from '@/lib/domain/time'
import { PASS_FAMILIES, type PassFamilyId, type Provenance } from '@/lib/domain/types'
import { countdown } from './format'
import type { PassWatch } from './data'
import { Block } from './section'

const fam = (id: string | null): PassFamilyId | null => (id && (PASS_FAMILIES as readonly string[]).includes(id) ? (id as PassFamilyId) : null)

interface Row {
  key: string
  name: string
  familyId: PassFamilyId | null
  date: string
  daysLeft: number
  what: string
  owned: boolean
  favourite: boolean
  confirmAtSource: boolean
  prov: Provenance | null
}

function ConfirmTag() {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-caution">
      <CircleAlert aria-hidden className="size-3.5" /> Researched — confirm at source
    </span>
  )
}

export function PassWatchBlock({ passes, className }: { passes: PassWatch; className?: string }) {
  const rows: Row[] = [
    ...passes.deadlines.map((d) => ({
      key: `d-${d.productId}`,
      name: d.name,
      familyId: fam(d.familyId),
      date: d.deadline,
      daysLeft: d.daysLeft,
      what: d.deadlineText ?? `Sales close ${formatLocalDate(d.deadline)}`,
      owned: d.owned,
      favourite: false,
      confirmAtSource: d.prov?.verification === 'search-summary',
      prov: d.prov,
    })),
    ...passes.prices.map((p) => ({
      key: `p-${p.productId}-${p.category ?? ''}-${p.until}`,
      name: p.name,
      familyId: p.familyId,
      date: p.until,
      daysLeft: p.daysLeft,
      what: `${p.category ? `${p.category} ` : ''}${p.price} until ${formatLocalDate(p.until)}${p.next ? `, then ${p.next}` : ''}`,
      owned: p.owned,
      favourite: p.favourite,
      confirmAtSource: p.confirmAtSource,
      prov: p.prov,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))

  return (
    <Block
      id="passes-title"
      eyebrow="Passes"
      title="Pass deadlines & sales"
      className={className}
      actions={
        <Link href="/passes" className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-[13.5px] font-medium text-teal hover:bg-glacier/60 md:h-9">
          Passes &amp; Costs <ArrowRight aria-hidden className="size-4" />
        </Link>
      }
    >
      <div className="flex items-start gap-2 text-[13.5px] text-ink-2">
        <Ticket aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
        {passes.mine.length ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span>Your pass{passes.mine.length > 1 ? 'es' : ''}:</span>
            {passes.mine.map((m) => (
              <span key={m.name} className="inline-flex items-center gap-1.5 font-medium text-ink">
                {m.familyId ? <PassBadge family={m.familyId} size="sm" /> : null}
                {m.name}
              </span>
            ))}
          </p>
        ) : (
          <p className="min-w-0">
            No pass recorded as yours.{' '}
            <Link href="/passes" className="font-medium text-teal hover:underline">
              Check an exact product
            </Link>{' '}
            before relying on a resort’s pass family.
          </p>
        )}
      </div>

      {rows.length ? (
        <ul className="mt-3 divide-y divide-divider border-y border-divider">
          {rows.map((r) => {
            const soon = r.daysLeft <= 7
            return (
              <li key={r.key} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 py-3">
                <div className="text-center" aria-hidden>
                  <p className={cn('font-display tnum text-[26px] leading-none', soon ? 'text-caution' : 'text-ink')}>{formatLocalDate(r.date, 'd')}</p>
                  <p className="mt-0.5 text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{formatLocalDate(r.date, 'LLL')}</p>
                </div>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {r.familyId ? <PassBadge family={r.familyId} size="sm" /> : null}
                    <span className="text-[14.5px] font-semibold text-ink">{r.name}</span>
                    {r.owned ? (
                      <span className="text-[12px] font-medium text-positive">Yours</span>
                    ) : r.favourite ? (
                      <span className="text-[12px] text-ink-3">covers a favourite</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[13.5px] text-ink">
                    <span className="tnum">{r.what}</span>{' '}
                    <span className={cn('tnum font-medium', soon ? 'text-caution' : 'text-ink-3')}>
                      · {r.daysLeft === 0 ? 'last day today' : countdown(r.daysLeft)}
                    </span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {r.confirmAtSource ? <ConfirmTag /> : null}
                    <SourceDrawer
                      title={`${r.name} — sales`}
                      items={[
                        {
                          label: 'Sales deadline',
                          value: r.what,
                          prov: r.prov,
                        },
                      ]}
                      label="Source"
                      compact={false}
                      className="-ml-1.5 h-9 md:h-7"
                    />
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 border-y border-divider py-3 text-[13.5px] text-ink-2">No dated pass sales or price deadlines on record for the next 60 days.</p>
      )}

      {passes.notes.length ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {passes.notes.map((n) => (
            <li key={n.text} className="text-[13.5px] text-ink-2">
              <p>
                <span className="font-medium text-ink">{n.names.join(', ')}:</span> {n.text}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3">
                {n.confirmAtSource ? <ConfirmTag /> : null}
                <SourceDrawer
                  title={`${n.names[0]} — sales note`}
                  items={[{ label: 'Sales note', value: n.text, prov: n.prov }]}
                  label="Source"
                  compact={false}
                  className="-ml-1.5 h-9 md:h-7"
                />
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {passes.moreNotes > 0 ? (
        <p className="mt-2 text-[12.5px] text-ink-3">
          {passes.moreNotes} more sales note{passes.moreNotes === 1 ? '' : 's'} for other passes in{' '}
          <Link href="/passes" className="font-medium text-teal hover:underline">
            Passes &amp; Costs
          </Link>
          .
        </p>
      ) : null}
    </Block>
  )
}
