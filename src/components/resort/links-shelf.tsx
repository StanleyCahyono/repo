/**
 * 07 Snow report — only the resort's official snow report link (with its check status), opening externally.
 */
import { ExternalLink, Snowflake, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import type { LinkView, ResortDetail } from '@/lib/data/resort-detail'
import { ResortSection } from './section'
import { hostOf, LINK_STATE_LABEL, linkState, linkStateDetail, shortDate, type LinkState, type PageView } from './format'

interface ShelfItem {
  key: string
  label: string
  icon: LucideIcon
  /** Important links show a "not recorded" tile when missing. */
  expected: boolean
  note?: string
}

const STATE_DOT: Record<LinkState, string> = {
  ok: 'bg-positive',
  broken: 'bg-critical',
  'check-failed': 'bg-caution',
  unknown: 'bg-divider-strong',
  unchecked: 'bg-surface-3 ring-1 ring-divider-strong ring-inset',
}
const STATE_TEXT: Record<LinkState, string> = {
  ok: 'text-positive',
  broken: 'text-critical',
  'check-failed': 'text-caution',
  unknown: 'text-ink-3',
  unchecked: 'text-ink-3',
}

function StatusLine({ link, now, built }: { link: LinkView | null; now: string; built?: boolean }) {
  if (built) {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATE_DOT.unchecked)} />
        Built from coordinates · not checked
      </p>
    )
  }
  const state = linkState(link?.check)
  return (
    <p className={cn('flex items-center gap-1.5 text-[12px]', STATE_TEXT[state])} title={linkStateDetail(link?.check, now)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATE_DOT[state])} />
      <span className="font-medium">{LINK_STATE_LABEL[state]}</span>
      {link?.check ? (
        <span className="text-ink-3">
          · {link.check.httpStatus ? `HTTP ${link.check.httpStatus}` : link.check.ok ? '' : 'no response'} · {shortDate(link.check.checkedAt.slice(0, 10))}
        </span>
      ) : null}
    </p>
  )
}

function Tile({ item, link, url, now, built }: { item: ShelfItem; link: LinkView | null; url: string; now: string; built?: boolean }) {
  const Icon = item.icon
  const state = built ? 'unchecked' : linkState(link?.check)
  const descId = `link-${item.key}-status`
  return (
    <li className="glass group relative flex min-w-0 items-start gap-3 rounded-[20px] px-4 py-3.5 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-teal focus-within:border-teal has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus">
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={descId}
            className="text-[14.5px] leading-snug font-semibold text-ink after:absolute after:inset-0 after:rounded-[20px] focus-visible:outline-none"
          >
            {item.label}
            <span className="sr-only"> (opens {hostOf(url) ?? 'external site'} in a new tab)</span>
          </a>
          <ExternalLink aria-hidden className="mt-1 size-3.5 shrink-0 text-ink-3 transition-colors group-hover:text-teal" />
        </div>
        <p className="truncate text-[12px] text-ink-3">{item.note ?? hostOf(url)}</p>
        <div id={descId} className="mt-0.5">
          <StatusLine link={link} now={now} built={built} />
          <span className="sr-only">{built ? '' : linkStateDetail(link?.check, now)}</span>
        </div>
        {state === 'broken' ? <p className="mt-0.5 text-[12px] text-ink-2">The page may have moved — try the official site.</p> : null}
      </div>
    </li>
  )
}

/** Expected links with no URL on file, folded into one line instead of a grid of empty tiles. */
export function LinksSection({ d, v, reportUrl = null }: { d: ResortDetail; v: PageView; reportUrl?: string | null }) {
  const link = d.links.find((l) => l.key === 'snowReport') ?? null
  // The catalog's report source (the page Piste reads the report from) when no snow-report link is recorded.
  const url = link?.url ?? reportUrl
  return (
    <ResortSection
      id="links"
      index={7}
      title="Snow report"
      meta={link?.check ? `checked ${shortDate(link.check.checkedAt.slice(0, 10))}` : null}
      headline={url ? 'The official snow report.' : 'No snow report link on file.'}
      lead={url ? 'Opens the resort’s own report in a new tab.' : 'Piste has no official snow report page recorded for this resort yet.'}
    >
      {url ? (
        <ul className="grid max-w-md grid-cols-1">
          <Tile item={{ key: 'snowReport', label: 'Snow report', icon: Snowflake, expected: true }} link={link} url={url} now={v.now} />
        </ul>
      ) : null}
    </ResortSection>
  )
}

