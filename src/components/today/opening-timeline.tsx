/**
 * Opening-date timeline. Three kinds of date are drawn differently and always named in text beside the mark:
 *   - Announced — the resort's stated target: a solid teal dot (never becomes "Open" by itself);
 *   - Piste estimate — a window from past seasons' openings: a dashed copper range;
 *   - Opened — an opening that was actually reported: a solid green dot.
 * Resorts with no announced or estimated date are listed by name, never placed on the axis. The marks are
 * decoration beside a real list (each row's text carries the label, the dates and the countdown), and every dated
 * row opens its source.
 */
import Link from 'next/link'
import { ChevronDown, Star } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { OpeningTag } from '@/components/ui/status'
import type { OpeningTimelineItem } from '@/lib/data/today'
import { addDays, daysBetween, formatLocalDate } from '@/lib/domain/time'
import { countdown, openingDates, plural } from './format'

type Item = OpeningTimelineItem

const MIN_SPAN_DAYS = 56

function monthStarts(from: string, to: string): string[] {
  const out: string[] = []
  let d = `${from.slice(0, 7)}-01`
  if (d < from) d = addDays(`${d.slice(0, 8)}28`, 4).slice(0, 7) + '-01'
  while (d <= to) {
    out.push(d)
    d = addDays(`${d.slice(0, 8)}28`, 4).slice(0, 7) + '-01'
  }
  return out
}

/** "From opening dates in 2024-25, 2025-26." — the caveat about weather is said once above the list; the source keeps the full text. */
function shortBasis(basis: string): string {
  return basis
    .replace(/\s*Weather and snowmaking decide the real date\.?\s*$/, '')
    .replace(/^Piste estimate from/, 'From')
    .replace(/(\d{4})-(\d{2})/g, '$1–$2')
}

function when(o: Item, today: string): string | null {
  if (o.label === 'opened') return o.date ? (o.date === today ? 'today' : `${countdown(o.daysAway)}`) : null
  if (o.label === 'announced' && o.daysAway !== null && o.daysAway < 0) return 'target passed — no opening reported'
  if (o.label === 'estimated' && o.date && o.date < today)
    return o.to && o.to >= today ? 'estimate window open now' : 'estimate window passed — no opening reported'
  return countdown(o.daysAway)
}

function Mark({ o, pos }: { o: Item; pos: (d: string) => number }) {
  if (!o.date) return <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-divider-strong" />
  const x = pos(o.date)
  if (o.label === 'estimated') {
    const x2 = pos(o.to && o.to > o.date ? o.to : o.date)
    return (
      <span
        aria-hidden
        className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full border border-dashed border-copper bg-copper/15"
        style={{ left: `${x}%`, width: `max(10px, ${x2 - x}%)` }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface',
        o.label === 'opened' ? 'bg-positive' : 'bg-teal',
      )}
      style={{ left: `${x}%` }}
    />
  )
}

function Row({ o, today, pos, showBasis }: { o: Item; today: string; pos: (d: string) => number; showBasis: boolean }) {
  const dates = openingDates(o.label, o.date, o.to)
  const w = when(o, today)
  const late = w?.includes('no opening reported')
  return (
    <li className="grid grid-cols-1 gap-x-5 gap-y-1.5 py-2.5 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:items-center">
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5">
          {o.isFavorite ? (
            <>
              <Star aria-hidden className="size-3.5 shrink-0 fill-copper text-copper" />
              <span className="sr-only">Favourite: </span>
            </>
          ) : null}
          <Link href={`/resorts/${o.resortId}`} className="truncate text-[14.5px] font-semibold text-ink hover:text-teal hover:underline">
            {o.name}
          </Link>
          {o.prov ? (
            <SourceDrawer
              title={`${o.name} — opening date`}
              items={[
                {
                  label: o.label === 'estimated' ? 'Piste estimate' : o.label === 'opened' ? 'Opening reported' : 'Announced opening',
                  value: [dates, o.basis ?? o.text].filter(Boolean).join(' — '),
                  prov: o.prov,
                },
              ]}
              className="shrink-0"
            />
          ) : null}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-2">
          <OpeningTag label={o.label} />
          {dates ? <span className="tnum font-medium text-ink">{dates}</span> : <span className="text-ink-3">No date yet</span>}
          {w ? <span className={cn('tnum', late ? 'text-caution' : 'text-ink-3')}>· {w}</span> : null}
        </p>
        {showBasis && o.label === 'estimated' && o.basis ? <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{shortBasis(o.basis)}</p> : null}
      </div>
      <div className="relative h-4">
        <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-divider" />
        {pos(today) >= 0 && pos(today) <= 100 ? (
          <span aria-hidden className="absolute inset-y-[-6px] w-px bg-ink-3/50" style={{ left: `${pos(today)}%` }} />
        ) : null}
        <Mark o={o} pos={pos} />
      </div>
    </li>
  )
}

export function OpeningTimeline({ items, today, variant, className }: { items: Item[]; today: string; variant: 'preseason' | 'season'; className?: string }) {
  const dated = items.filter((o) => o.date && o.label !== 'not-announced')
  const upcoming = dated.filter((o) => o.label !== 'opened')
  const opened = dated.filter((o) => o.label === 'opened').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const favUndated = items.filter((o) => o.isFavorite && (!o.date || o.label === 'not-announced'))
  const undated = items.filter((o) => !o.isFavorite && (!o.date || o.label === 'not-announced'))

  // Rows: preseason — every announced / estimated date plus undated favourites. In season — upcoming or overdue
  // targets, favourites, and the latest few openings; the rest of the openings sit behind a disclosure.
  const recent = variant === 'season' ? opened.filter((o) => o.isFavorite).concat(opened.filter((o) => !o.isFavorite).slice(0, 3)) : opened
  const shownOpened = new Set(recent.map((o) => o.resortId))
  const rows = [...upcoming, ...recent, ...favUndated].sort((a, b) => {
    const da = a.date ?? '9999'
    const db = b.date ?? '9999'
    return da.localeCompare(db) || Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name)
  })
  const hiddenOpened = opened.filter((o) => !shownOpened.has(o.resortId))

  const markDates = rows.flatMap((o) => [o.date, o.to]).filter((d): d is string => !!d)
  const earliest = [today, ...markDates].sort()[0]
  let to = [today, ...markDates].sort().reverse()[0]
  // Preseason reads forward from today; in season the axis starts with the month of the first opening.
  const from = variant === 'preseason' && earliest === today ? today : `${earliest.slice(0, 7)}-01`
  if (daysBetween(from, to) < MIN_SPAN_DAYS) to = addDays(from, MIN_SPAN_DAYS)
  to = addDays(addDays(`${to.slice(0, 8)}28`, 4).slice(0, 7) + '-01', -1)
  const span = Math.max(1, daysBetween(from, to))
  const pos = (d: string) => Math.max(0, Math.min(100, (daysBetween(from, d) / span) * 100))
  const months = monthStarts(from, to)

  const counts = {
    announced: items.filter((o) => o.label === 'announced').length,
    estimated: items.filter((o) => o.label === 'estimated').length,
    opened: opened.length,
    none: items.filter((o) => o.label === 'not-announced' || !o.date).length,
  }

  return (
    <div className={className}>
      <ul aria-label="How opening dates are drawn" className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-teal" /> Announced — the resort’s target
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-5 rounded-full border border-dashed border-copper bg-copper/15" /> Piste estimate — from past openings
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-positive" /> Opened — reported
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-px bg-ink-3/60" /> Today
        </li>
      </ul>

      {rows.length ? (
        <>
          <div aria-hidden className="mt-3 hidden grid-cols-[minmax(0,17rem)_minmax(0,1fr)] gap-x-5 md:grid">
            <span />
            <span className="relative h-4">
              {months.map((m) => (
                <span key={m} className="absolute top-0 border-l border-divider pl-1 text-[12px] leading-none text-ink-3" style={{ left: `${pos(m)}%` }}>
                  {formatLocalDate(m, 'LLL')}
                </span>
              ))}
            </span>
          </div>
          <div aria-hidden className="relative mt-3 h-4 md:hidden">
            {months.map((m) => (
              <span key={m} className="absolute top-0 border-l border-divider pl-1 text-[12px] leading-none text-ink-3" style={{ left: `${pos(m)}%` }}>
                {formatLocalDate(m, 'LLL')}
              </span>
            ))}
          </div>
          <ul className="divide-y divide-divider">
            {rows.map((o) => (
              <Row key={o.resortId} o={o} today={today} pos={pos} showBasis={variant === 'preseason'} />
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-[14px] text-ink-2">No resort has an announced or estimated opening date on record yet.</p>
      )}

      <div className="mt-2 flex flex-col gap-1 border-t border-divider pt-2">
        {hiddenOpened.length ? (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13.5px] font-medium text-ink-2 hover:text-ink md:min-h-9 [&::-webkit-details-marker]:hidden">
              <span>{plural(hiddenOpened.length, 'more resort')} opened this season</span>
              <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <p className="pb-2 text-[13px] leading-relaxed text-ink-2">
              {hiddenOpened.map((o, i) => (
                <span key={o.resortId}>
                  {i ? ' · ' : ''}
                  <Link href={`/resorts/${o.resortId}`} className="font-medium text-ink hover:text-teal hover:underline">
                    {o.name}
                  </Link>{' '}
                  <span className="tnum text-ink-3">{o.date ? formatLocalDate(o.date, 'd LLL') : ''}</span>
                </span>
              ))}
            </p>
          </details>
        ) : null}
        {undated.length ? (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13.5px] font-medium text-ink-2 hover:text-ink md:min-h-9 [&::-webkit-details-marker]:hidden">
              <span>{plural(undated.length, 'resort')} with no announced or estimated date yet</span>
              <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <p className="pb-2 text-[13px] leading-relaxed text-ink-2">
              Not guessed — these appear on the timeline once the resort announces a date or enough past openings are on record:{' '}
              {undated.map((o, i) => (
                <span key={o.resortId}>
                  {i ? ', ' : ''}
                  <Link href={`/resorts/${o.resortId}`} className="font-medium text-ink hover:text-teal hover:underline">
                    {o.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          </details>
        ) : null}
        <p className="sr-only">
          {counts.announced} announced, {counts.estimated} estimated, {counts.opened} opened, {counts.none} without a date.
        </p>
      </div>
    </div>
  )
}
