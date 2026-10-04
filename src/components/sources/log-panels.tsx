/**
 * Failure log (fetch errors and parser failures from source records) and link checks. Server-renderable; long lists sit in native <details> so they stay keyboard- and screen-reader-friendly.
 */
import { ChevronDown, CircleCheck, ExternalLink, FileWarning, ServerCrash } from 'lucide-react'
import type { LinksView, SourceFailureView, SourcesView } from '@/lib/data/sources'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/ui/cn'
import { CountUp } from '@/components/season/count-up'
import { Ago } from './ago'
import { errorBeyondStatus, groupFailures, httpReason, shortUrl } from './format'

function Disclosure({ summary, children, className }: { summary: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <details className={cn('group rounded-[14px] border border-divider bg-surface', className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2 text-[13.5px] font-medium text-ink md:min-h-10 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{summary}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="border-t border-divider">{children}</div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Failures

function FailureItem({ f, now, tz, label }: { f: SourceFailureView; now: string; tz: string; label: string }) {
  return (
    <li className="px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Badge tone={f.kind === 'parser' ? 'caution' : 'critical'} icon={f.kind === 'parser' ? <FileWarning /> : <ServerCrash />}>
          {f.kind === 'parser' ? 'Parser' : 'Fetch'}
        </Badge>
        <span className="text-[14px] font-medium text-ink">{label}</span>
        {f.resortName ? <span className="text-[13px] text-ink-2">· {f.resortName}</span> : null}
        <span className="text-[12.5px] text-ink-3">
          <Ago at={f.fetchedAt} now={now} tz={tz} absolute />
        </span>
      </div>
      <p className="mt-1 text-[13px] break-words text-ink-2">
        {f.httpStatus ? <span className="font-medium text-ink tnum">HTTP {f.httpStatus}</span> : null}
        {errorBeyondStatus(f.error, f.httpStatus) ? `${f.httpStatus ? ' · ' : ''}${errorBeyondStatus(f.error, f.httpStatus)}` : !f.httpStatus ? (f.kind === 'parser' ? 'The page was fetched but its layout was not recognised.' : 'Unknown error') : null}
        {f.httpStatus && httpReason(f.httpStatus) ? <span className="text-ink-3"> — {httpReason(f.httpStatus)}</span> : null}
      </p>
      {f.parserErrors.length ? (
        <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink-2">
          {f.parserErrors.slice(0, 4).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <a href={f.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 text-[12.5px] font-medium break-all text-teal hover:underline">
        <ExternalLink aria-hidden className="size-3 shrink-0" /> {shortUrl(f.url, 80)}
      </a>
    </li>
  )
}

export function FailuresPanel({ v, tz, labels }: { v: SourcesView; tz: string; labels: Record<string, string> }) {
  const { items, byAdapter, windowDays } = v.failures
  const label = (a: string) => labels[a] ?? a
  const anythingRan = v.jobs.some((j) => j.lastAttempt)
  if (!items.length) {
    return (
      <div className="flex items-start gap-3 glass rounded-[24px] px-4 py-4 md:px-5">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <p className="text-[13.5px] text-ink-2">
          <span className="font-semibold text-ink">No fetch or parser failures logged in the last {windowDays} days.</span>{' '}
          {v.demo ? 'Demo mode fetches nothing, so there is nothing to fail.' : anythingRan ? '' : 'Nothing has been fetched yet either — this is not a sign of health.'}
        </p>
      </div>
    )
  }
  const first = items.slice(0, 6)
  const rest = items.slice(6)
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden glass rounded-[24px]">
        <table className="w-full text-left text-[13.5px]">
          <caption className="sr-only">Failures per source in the last {windowDays} days</caption>
          <thead>
            <tr className="border-b border-divider bg-surface-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
              <th scope="col" className="px-4 py-2 font-semibold md:px-5">
                Source
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Fetch
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Parser
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold md:px-5">
                Latest
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {byAdapter.map((a) => (
              <tr key={a.adapter}>
                <th scope="row" className="px-4 py-2 font-medium text-ink md:px-5">
                  {label(a.adapter)}
                </th>
                <td className={cn('px-3 py-2 text-right tnum', a.fetch ? 'font-medium text-critical' : 'text-ink-3')}>{a.fetch}</td>
                <td className={cn('px-3 py-2 text-right tnum', a.parser ? 'font-medium text-caution' : 'text-ink-3')}>{a.parser}</td>
                <td className="px-4 py-2 text-right text-ink-2 md:px-5">
                  <Ago at={a.lastAt} now={v.now} tz={tz} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-hidden glass rounded-[24px]">
        <p className="border-b border-divider bg-surface-2 px-4 py-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase md:px-5">Most recent</p>
        <ul className="divide-y divide-divider">
          {first.map((f) => (
            <FailureItem key={f.id} f={f} now={v.now} tz={tz} label={label(f.adapter)} />
          ))}
        </ul>
        {rest.length ? (
          <Disclosure summary={`${rest.length} more`} className="m-3 mt-0 md:mx-5">
            <ul className="divide-y divide-divider">
              {rest.map((f) => (
                <FailureItem key={f.id} f={f} now={v.now} tz={tz} label={label(f.adapter)} />
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Links

export function LinksPanel({ links, now, tz, demo, names }: { links: LinksView; now: string; tz: string; demo: boolean; names: Record<string, string> }) {
  const stats: { label: string; value: number; tone?: string }[] = [
    { label: 'Links shown in Piste', value: links.total },
    { label: 'Checked', value: links.checked },
    { label: 'Answered OK', value: links.ok, tone: links.ok ? 'text-positive' : undefined },
    { label: 'Check failed', value: links.broken, tone: links.broken ? 'text-critical' : undefined },
    { label: 'Result unknown', value: links.unknown },
    { label: 'Never checked', value: links.unchecked, tone: links.unchecked ? 'text-caution' : undefined },
    { label: 'Older than 7 days', value: links.stale, tone: links.stale ? 'text-caution' : undefined },
  ]
  const groups = groupFailures(links.brokenLinks)
  return (
    <div className="flex flex-col gap-4">
      <div className="glass rounded-[24px]">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-t-[24px] bg-divider sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col justify-between gap-1 bg-surface px-4 py-3">
              <dt className="text-[12.5px] text-ink-2">{s.label}</dt>
              <dd className={cn('font-display text-[26px] leading-none tnum', s.tone ?? 'text-ink')}>
                <CountUp value={s.value} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-divider px-4 py-2.5 text-[12.5px] text-ink-3 md:px-5">
          {demo ? 'Demo mode: links are not checked. ' : ''}Last check: <Ago at={links.lastCheckedAt} now={now} tz={tz} never="never" absolute />. Checks run daily; each link is re-checked
          after 20 h. Private or internal addresses are never requested.
        </p>
      </div>
      {groups.map((g) => {
        const reason = httpReason(g.items[0]?.httpStatus)
        return (
          <Disclosure
            key={g.key}
            summary={
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold tnum">{g.label}</span>
                <span className="font-normal text-ink-2 tnum">
                  {g.items.length} link{g.items.length === 1 ? '' : 's'}
                </span>
                {reason ? <span className="text-[12.5px] font-normal text-ink-3">— {reason}</span> : null}
              </span>
            }
          >
            <ul className="max-h-[420px] divide-y divide-divider overflow-y-auto">
              {g.items.map((l) => (
                <li key={l.url} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2 text-[13px]">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 font-medium break-all text-teal hover:underline">
                    {shortUrl(l.url, 72)}
                  </a>
                  <span className="text-[12.5px] text-ink-3">
                    {l.resortIds.length ? l.resortIds.map((id) => names[id] ?? id).join(', ') : 'Not tied to a resort'}
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )
      })}
    </div>
  )
}
