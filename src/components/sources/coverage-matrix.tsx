'use client'
/**
 * Per-resort coverage: which facts are official, yours, estimated, from the catalog, without a source, stale,
 * failing or missing. A resorts × facts table from 1280px (every cell an icon + state, with its own label for
 * assistive tech), a list with a compact state strip below that. Any cell or row opens the resort's coverage sheet:
 * what is on file, how old it is, and where it comes from.
 */
import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronRight, ExternalLink, Star } from 'lucide-react'
import type { CoverageCell, CoverageField, CoverageRow, CoverageState } from '@/lib/data/sources'
import { formatInstant, relativeLabel } from '@/lib/domain/time'
import { Sheet } from '@/components/ui/sheet'
import { cn } from '@/lib/ui/cn'
import { COVERAGE, COVERAGE_ORDER, StateChip } from './state'

const GROUPS: { label: string; fields: CoverageField[] }[] = [
  { label: 'Mountain', fields: ['location', 'elevation', 'terrain', 'features'] },
  { label: 'Season', fields: ['opening', 'hours'] },
  { label: 'Prices', fields: ['liftPrices', 'rentalPrices'] },
  { label: 'Getting there', fields: ['drive', 'airports'] },
  { label: 'Stay & events', fields: ['hotels', 'events'] },
  { label: 'Conditions', fields: ['report', 'weather', 'status'] },
  { label: 'Passes', fields: ['passes'] },
]

const SHORT: Record<CoverageField, string> = {
  location: 'Place',
  elevation: 'Elev.',
  terrain: 'Terrain',
  features: 'Features',
  opening: 'Opening',
  hours: 'Hours',
  liftPrices: 'Lift',
  rentalPrices: 'Rental',
  drive: 'Drive',
  airports: 'Air',
  hotels: 'Hotels',
  events: 'Events',
  report: 'Report',
  weather: 'Weather',
  status: 'Status',
  passes: 'Access',
}

const ORDERED: CoverageField[] = GROUPS.flatMap((g) => g.fields)

export function CoverageMatrix({
  rows,
  fields,
  now,
  tz,
  seasonLabel,
  adapters,
}: {
  rows: CoverageRow[]
  fields: { key: CoverageField; label: string }[]
  now: string
  tz: string
  seasonLabel: string
  /** Report adapter setup per resort id: 'live' (verified), 'new' (built without the live page) or 'disabled'. */
  adapters: Record<string, string>
}) {
  const [open, setOpen] = useState<{ resortId: string; field: CoverageField | null } | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const label = new Map(fields.map((f) => [f.key, f.label]))
  const cellOf = (r: CoverageRow, f: CoverageField) => r.cells.find((c) => c.field === f)!
  const totals = new Map<CoverageState, number>()
  for (const r of rows) for (const c of r.cells) totals.set(c.state, (totals.get(c.state) ?? 0) + 1)
  const show = (resortId: string, field: CoverageField | null) => (e: React.MouseEvent<HTMLElement>) => {
    opener.current = e.currentTarget
    setOpen({ resortId, field })
  }
  const current = open ? rows.find((r) => r.resortId === open.resortId) : null

  return (
    <div>
      <ul aria-label="Legend" className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
        {COVERAGE_ORDER.filter((s) => totals.get(s)).map((s) => {
          const spec = COVERAGE[s]
          return (
            <li key={s} className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <span aria-hidden className={cn('inline-flex size-5 items-center justify-center rounded-[5px] border', spec.cell)}>
                <spec.Icon className="size-3" strokeWidth={2.2} />
              </span>
              {spec.label}
              <span className="text-ink-3 tnum">{totals.get(s)}</span>
            </li>
          )
        })}
      </ul>

      {/* Table (≥1280px, where all sixteen columns fit) */}
      <div className="hidden overflow-x-auto glass rounded-[24px] xl:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Coverage of {rows.length} resorts across {ORDERED.length} kinds of fact for {seasonLabel}. Each cell names its state; activate it for details and sources.
          </caption>
          <thead>
            <tr className="text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
              <th scope="col" rowSpan={2} className="sticky left-0 z-10 min-w-[190px] border-b border-divider bg-surface-2 px-4 py-2 align-bottom">
                Resort
              </th>
              {GROUPS.map((g) => (
                <th key={g.label} scope="colgroup" colSpan={g.fields.length} className="border-b border-l border-divider bg-surface-2 px-2 pt-2 pb-1 text-center font-semibold whitespace-nowrap">
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="text-[12px] text-ink-2">
              {GROUPS.map((g) =>
                g.fields.map((f, i) => (
                  <th key={f} scope="col" className={cn('border-b border-divider bg-surface-2 px-1 pb-2 text-center font-medium whitespace-nowrap', i === 0 && 'border-l')}>
                    <abbr title={label.get(f)} className="no-underline">
                      {SHORT[f]}
                    </abbr>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.resortId} className="group border-b border-divider last:border-b-0 hover:bg-surface-2">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-1.5 text-left font-normal group-hover:bg-surface-2">
                  <button type="button" onClick={show(r.resortId, null)} className="flex max-w-[210px] items-center gap-1.5 rounded-sm text-left text-[13.5px] font-medium text-ink hover:text-teal">
                    {r.isFavorite ? <Star aria-label="Favourite" className="size-3.5 shrink-0 fill-copper text-copper" /> : null}
                    <span className="min-w-0 leading-snug [overflow-wrap:anywhere]">{r.shortName || r.name}</span>
                  </button>
                </th>
                {GROUPS.map((g) =>
                  g.fields.map((f, i) => {
                    const c = cellOf(r, f)
                    const spec = COVERAGE[c.state]
                    return (
                      <td key={f} className={cn('px-1 py-1.5 text-center', i === 0 && 'border-l border-divider')}>
                        <button
                          type="button"
                          onClick={show(r.resortId, f)}
                          aria-label={`${r.name}, ${label.get(f)}: ${c.label}${c.detail ? `. ${c.detail}` : ''}`}
                          className={cn('inline-flex size-7 items-center justify-center rounded-[6px] border transition-transform duration-150 hover:-translate-y-px hover:shadow-lift', spec.cell)}
                        >
                          <spec.Icon aria-hidden className="size-3.5" strokeWidth={2.2} />
                        </button>
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* List (<1280px) */}
      <ul className="divide-y divide-divider overflow-hidden glass rounded-[24px] md:grid md:grid-cols-2 md:divide-y-0 xl:hidden">
        {rows.map((r) => {
          const counts = COVERAGE_ORDER.filter((s) => r.counts[s]).map((s) => `${r.counts[s]} ${COVERAGE[s].short.toLowerCase()}`)
          return (
            <li key={r.resortId} className="min-w-0 border-divider md:border-b md:odd:border-r md:[&:nth-last-child(-n+2)]:border-b-0">
              <button type="button" onClick={show(r.resortId, null)} className="flex h-full w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2 md:px-5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[14.5px] font-medium text-ink">
                    {r.isFavorite ? <Star aria-label="Favourite" className="size-3.5 shrink-0 fill-copper text-copper" /> : null}
                    <span className="min-w-0 leading-snug [overflow-wrap:anywhere]">{r.name}</span>
                  </span>
                  <span aria-hidden className="mt-1.5 grid max-w-[22rem] grid-cols-[repeat(16,minmax(0,1fr))] gap-[3px]">
                    {ORDERED.map((f) => {
                      const s = cellOf(r, f).state
                      return <span key={f} className={cn('h-2.5 rounded-[2px] border', COVERAGE[s].cell)} />
                    })}
                  </span>
                  <span className="mt-1 block text-[12.5px] text-ink-2">{counts.join(' · ')}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
              </button>
            </li>
          )
        })}
      </ul>

      <Sheet
        open={!!current}
        onOpenChange={(o) => (o ? null : setOpen(null))}
        title={current ? current.name : 'Coverage'}
        description={current ? `What Piste has on file for ${seasonLabel}, how old it is, and where it comes from.` : undefined}
        side="responsive"
        widthClass="md:w-[520px]"
        onCloseAutoFocus={(e) => {
          if (opener.current?.isConnected) {
            e.preventDefault()
            opener.current.focus()
          }
        }}
        footer={
          current ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] text-ink-3">
                {!current.hasReportAdapter
                  ? 'No official report adapter — manual reports only'
                  : adapters[current.resortId] === 'new'
                    ? 'Official report adapter: new parser'
                    : adapters[current.resortId] === 'disabled'
                      ? 'Official report adapter: turned off'
                      : 'Official report adapter: verified'}
              </p>
              <Link href={`/resorts/${current.resortId}`} className="inline-flex min-h-11 items-center gap-1 text-[13.5px] font-medium text-teal hover:underline md:min-h-0">
                Open resort <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
          ) : null
        }
      >
        {current ? (
          <div className="flex flex-col gap-5">
            {GROUPS.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <p className="eyebrow mb-1.5">{g.label}</p>
                <ul className="divide-y divide-divider rounded-[14px] border border-divider">
                  {g.fields.map((f) => (
                    <CellDetail key={f} c={cellOf(current, f)} label={label.get(f) ?? f} now={now} tz={tz} highlight={open?.field === f} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}

function CellDetail({ c, label, now, tz, highlight }: { c: CoverageCell; label: string; now: string; tz: string; highlight: boolean }) {
  const spec = COVERAGE[c.state]
  return (
    <li
      ref={(el) => {
        if (el && highlight) el.scrollIntoView({ block: 'nearest' })
      }}
      className={cn('px-3 py-2.5', highlight && 'bg-glacier/50')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-medium text-ink">{label}</p>
        <StateChip spec={spec}>{c.label}</StateChip>
      </div>
      {c.detail ? <p className="mt-1 text-[13px] break-words text-ink-2">{c.detail}</p> : null}
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
        {c.at ? (
          <time dateTime={c.at} title={formatInstant(c.at, tz, 'ccc d LLL yyyy, HH:mm ZZZZ')} className="tnum">
            {relativeLabel(c.at, now)} · {formatInstant(c.at, tz, 'd LLL yyyy')}
          </time>
        ) : (
          <span>No date recorded</span>
        )}
        {c.sourceUrl ? (
          <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium break-all text-teal hover:underline">
            <ExternalLink aria-hidden className="size-3 shrink-0" />
            {c.sourceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 56)}
          </a>
        ) : null}
      </p>
    </li>
  )
}
