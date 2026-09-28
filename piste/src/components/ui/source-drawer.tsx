'use client'
/** "Where does this come from?" — a small trigger beside a fact that opens the provenance drawer. */
import { Info, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { Sheet } from './sheet'
import { KindTag } from './provenance'
import type { Provenance } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'

export interface SourceItem {
  label: string
  value?: ReactNode
  prov: Provenance | null
}

const VERIFICATION_TEXT: Record<string, string> = {
  api: 'Retrieved from a documented API',
  'official-page': 'Read from the official page',
  'search-summary': 'Researched via web search — confirm at the source',
  'user-confirmed': 'Confirmed by you',
  unverified: 'Not verified',
}

function fmt(iso: string | null | undefined) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export function SourceList({ items }: { items: SourceItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-divider">
      {items.map((it, i) => (
        <li key={i} className="py-3 first:pt-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[14px] font-semibold text-ink">{it.label}</p>
            {it.prov ? <KindTag kind={it.prov.kind} /> : null}
          </div>
          {it.value ? <div className="mt-0.5 text-[14px] text-ink">{it.value}</div> : null}
          {it.prov ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              {it.prov.provider ? (
                <>
                  <dt className="text-ink-3">Provider</dt>
                  <dd className="text-ink-2">{it.prov.provider}</dd>
                </>
              ) : null}
              {it.prov.season ? (
                <>
                  <dt className="text-ink-3">Season</dt>
                  <dd className="text-ink-2">{it.prov.season}</dd>
                </>
              ) : null}
              {it.prov.publishedAt ? (
                <>
                  <dt className="text-ink-3">Published</dt>
                  <dd className="tnum text-ink-2">{fmt(it.prov.publishedAt)}</dd>
                </>
              ) : null}
              <dt className="text-ink-3">Retrieved</dt>
              <dd className="tnum text-ink-2">{fmt(it.prov.fetchedAt) ?? 'Not recorded'}</dd>
              {it.prov.staleAfter ? (
                <>
                  <dt className="text-ink-3">Stale after</dt>
                  <dd className="tnum text-ink-2">{fmt(it.prov.staleAfter)}</dd>
                </>
              ) : null}
              {it.prov.verification ? (
                <>
                  <dt className="text-ink-3">Verification</dt>
                  <dd className={cn('text-ink-2', it.prov.verification === 'search-summary' && 'font-medium text-caution')}>
                    {VERIFICATION_TEXT[it.prov.verification] ?? it.prov.verification}
                  </dd>
                </>
              ) : null}
              {it.prov.note ? (
                <>
                  <dt className="text-ink-3">Note</dt>
                  <dd className="text-ink-2">{it.prov.note}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p className="mt-1 text-[12.5px] text-ink-3 italic">No source recorded.</p>
          )}
          {it.prov?.sourceUrl ? (
            <a
              href={it.prov.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex max-w-full items-center gap-1 text-[13px] font-medium break-all text-teal hover:underline"
            >
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
              {it.prov.sourceUrl.replace(/^https?:\/\//, '').slice(0, 80)}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** Inline trigger ("i" / "Sources") opening a drawer with provenance for one or more facts. */
export function SourceDrawer({
  title = 'Sources',
  items,
  label = 'Sources',
  compact = true,
  className,
}: {
  title?: string
  items: SourceItem[]
  label?: string
  compact?: boolean
  className?: string
}) {
  return (
    <Sheet
      title={title}
      description="Where these facts come from, when they were retrieved, and how they were verified."
      side="responsive"
      trigger={
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-ink-3 hover:text-teal',
            compact ? 'size-6 justify-center' : 'h-7 px-1.5',
            className,
          )}
          aria-label={compact ? `${label}: ${title}` : undefined}
        >
          <Info aria-hidden className="size-3.5" />
          {compact ? null : label}
        </button>
      }
    >
      <SourceList items={items} />
    </Sheet>
  )
}
