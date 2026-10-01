/**
 * Access matrix: exact products × resorts for one date, each cell answered from that product's own rule (owned rows
 * count logged days). Desktop: a table with a sticky header row and sticky product column inside a scrollable,
 * keyboard-focusable region. Mobile: one disclosure per product listing its resorts. A cell with no rule is a quiet
 * "—" ("No rule recorded"), a rule marked unknown is "Not confirmed" — neither is ever shown as access.
 */
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import type { AccessCellView, AccessRowView, MatrixResort } from '@/lib/data/passes'
import { cn } from '@/lib/ui/cn'
import { AccessMark } from './access-mark'
import { familyId, plural, STATUS_META } from './format'
import { checkerHref } from './params'
import { HolderTag } from './section'

function cellLabel(c: AccessCellView): string {
  const v = c.verdict
  if (c.status === 'included-limited' && v.remainingDays != null) return `${v.remainingDays} left`
  return STATUS_META[c.status].short
}

function cellSr(row: AccessRowView, resort: MatrixResort, c: AccessCellView): string {
  const v = c.verdict
  return `${row.productName} at ${resort.name}: ${c.status === 'unknown' ? 'access not confirmed' : v.headline || STATUS_META[c.status].label}`
}

function rowKey(row: AccessRowView): string {
  return row.ownershipId != null ? `own:${row.ownershipId}` : `product:${row.productId}`
}

function countsText(cells: AccessCellView[]): string {
  const withRule = cells.filter((c) => c.hasRule)
  const can = withRule.filter((c) => c.canSki).length
  const unknown = withRule.filter((c) => c.status === 'unknown').length
  const parts = [`${plural(withRule.length, 'resort')} with a rule`]
  if (can) parts.push(`${can} usable`)
  if (unknown) parts.push(`${unknown} not confirmed`)
  return parts.join(' · ')
}

export function MatrixTable({ date, resorts, rows }: { date: string; resorts: MatrixResort[]; rows: AccessRowView[] }) {
  const colIndex = new Map(resorts.map((r, i) => [r.id, i]))
  return (
    <div
      role="region"
      aria-label="Access matrix — scroll sideways for more resorts"
      tabIndex={0}
      className="relative max-h-[min(74vh,780px)] overflow-auto rounded-[12px] border border-divider bg-surface scrollbar-thin"
    >
      <table className="border-separate border-spacing-0 text-left text-[13px]">
        <caption className="sr-only">Pass products (rows) by resort (columns): access on the chosen date, from each product’s own rules</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky top-0 left-0 z-30 w-[248px] min-w-[248px] border-r border-b border-divider bg-surface px-4 py-3 align-bottom text-[12px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
              Product <span className="font-normal normal-case tracking-normal text-ink-3">× resort</span>
            </th>
            {resorts.map((r) => (
              <th key={r.id} scope="col" className="sticky top-0 z-20 w-[112px] min-w-[112px] border-b border-divider bg-surface px-2.5 py-3 align-bottom font-normal">
                <Link href={`/resorts/${r.id}`} className="block text-[13px] leading-tight font-semibold text-ink hover:text-teal hover:underline">
                  {r.shortName}
                </Link>
                <span className="mt-0.5 block truncate text-[12px] text-ink-3" title={r.region}>
                  {r.region}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = resorts.map((r) => row.cells.find((c) => c.resortId === r.id)!).filter(Boolean)
            return (
              <tr key={row.key} className="group/row">
                <th scope="row" className={cn('sticky left-0 z-10 border-r border-b border-divider px-4 py-2.5 align-top font-normal', row.owned ? 'bg-surface-2' : 'bg-surface')}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <PassBadge family={familyId(row.familyId)} size="sm" />
                    {row.holder ? <HolderTag holder={row.holder} /> : null}
                  </span>
                  <Link href={checkerHref({ pass: rowKey(row), from: date })} className="mt-1 block text-[13.5px] leading-snug font-medium text-ink hover:text-teal hover:underline">
                    {row.productName}
                  </Link>
                </th>
                {cells.map((c) => {
                  const resort = resorts[colIndex.get(c.resortId)!]
                  return (
                    <td key={c.resortId} className={cn('border-b border-divider p-0 align-middle', row.owned && 'bg-surface-2/60')}>
                      {c.hasRule ? (
                        <Link
                          href={checkerHref({ pass: rowKey(row), resort: c.resortId, from: date })}
                          className={cn(
                            'flex h-full min-h-12 items-center px-2.5 py-2 transition-colors duration-150 hover:bg-glacier/50',
                            c.status === 'unknown' && 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--surface-3)_6px_7px)]',
                          )}
                        >
                          <AccessMark status={c.status} variant="cell" label={cellLabel(c)} srSuffix={` — ${cellSr(row, resort, c)}`} />
                        </Link>
                      ) : (
                        <span className="flex min-h-12 items-center px-2.5 text-ink-3">
                          <span aria-hidden>—</span>
                          <span className="sr-only">No rule recorded for {row.productName} at {resort.name}</span>
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Mobile alternative: one disclosure per product listing only the resorts it has a rule for. */
export function MatrixList({ date, resorts, rows }: { date: string; resorts: MatrixResort[]; rows: AccessRowView[] }) {
  const byId = new Map(resorts.map((r) => [r.id, r]))
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const cells = row.cells.filter((c) => c.hasRule && byId.has(c.resortId))
        return (
          <li key={row.key}>
            <details open={row.owned} className="group rounded-[12px] border border-divider bg-surface">
              <summary className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 select-none">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <PassBadge family={familyId(row.familyId)} size="sm" />
                    {row.holder ? <HolderTag holder={row.holder} /> : null}
                  </span>
                  <span className="mt-1 block text-[14.5px] font-medium text-ink">{row.productName}</span>
                  <span className="block text-[12.5px] text-ink-3">{countsText(cells)}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" />
              </summary>
              {cells.length ? (
                <ul className="flex flex-col divide-y divide-divider border-t border-divider">
                  {cells.map((c) => (
                    <li key={c.resortId}>
                      <Link href={checkerHref({ pass: rowKey(row), resort: c.resortId, from: date })} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                        <span className="min-w-0 truncate text-[14px] text-ink">{byId.get(c.resortId)!.name}</span>
                        <AccessMark status={c.status} variant="cell" label={cellLabel(c)} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t border-divider px-4 py-3 text-[13px] text-ink-3">No resort rules recorded — nowhere is confirmed.</p>
              )}
            </details>
          </li>
        )
      })}
    </ul>
  )
}
