/**
 * Refresh jobs: for each job, the last attempt (what happened, when, why it failed) beside the last SUCCESS — a
 * failed or empty run never advances the latter. Manual refresh per job, and per resort where the job works per
 * resort (weather, official reports). Server-renderable; the refresh buttons are client islands.
 */
import { ChevronDown } from 'lucide-react'
import type { JobView, RefreshHealth, SourcesView } from '@/lib/data/sources'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/ui/cn'
import { Ago } from './ago'
import { errorDigest } from './format'
import { RefreshButton } from './refresh-button'
import { REFRESH_STATE, StateChip } from './state'

/** Jobs POST /api/refresh accepts (prune runs on schedule only). */
const MANUAL = new Set(['weather', 'nws-alerts', 'reports', 'osm', 'status', 'assessments', 'alerts', 'links', 'fx'])
const GLOBAL_ONLY = new Set(['alerts', 'links', 'fx'])
/** Jobs refreshed one resort at a time (the per-resort list, or the resort page). */
const TARGET_ONLY = new Set(['osm'])

const OUTCOME_TEXT: Record<string, string> = {
  ok: 'succeeded',
  partial: 'partly failed',
  failed: 'failed',
  'nothing-fetched': 'fetched nothing',
  running: 'is running',
}

/**
 * `target`: the row is one resort. A run over every resort carries counts and errors for all of them, so for a
 * resort row only its own outcome is shown (the job row above has the details).
 */
function Attempt({ h, now, tz, target = null, job }: { h: RefreshHealth; now: string; tz: string; target?: string | null; job: string }) {
  const a = h.lastAttempt
  if (!a) return <span className="text-[13px] text-ink-3 italic">Never attempted</span>
  const outcome = h.lastAttemptOutcome ?? (a.status === 'error' ? 'failed' : a.status === 'partial' ? 'partial' : 'ok')
  const bad = outcome === 'failed' || outcome === 'partial'
  const own = target === null || a.target === target
  const digest = own ? errorDigest(a.error) : { items: [], truncated: false }
  return (
    <div className="min-w-0 text-[13px]">
      <p className={cn(bad ? 'font-medium text-critical' : outcome === 'nothing-fetched' ? 'text-caution' : 'text-ink')}>
        <Ago at={a.startedAt} now={now} tz={tz} /> {OUTCOME_TEXT[outcome] ?? outcome}
        {a.trigger === 'manual' ? <span className="font-normal text-ink-3"> · manual</span> : null}
      </p>
      {own && a.items.ok + a.items.failed > 0 ? (
        <p className="text-[12.5px] text-ink-3 tnum">
          {job === 'links'
            ? `${a.items.ok + a.items.failed} links checked — results under Link checks`
            : `${a.items.ok} ok · ${a.items.failed} failed${a.items.skipped ? ` · ${a.items.skipped} skipped` : ''}`}
          {a.attempts > 1 ? ` · ${a.attempts} attempts` : ''}
        </p>
      ) : null}
      {digest.items.length ? (
        <ul className="mt-0.5 text-[12.5px] text-ink-2">
          {digest.items.map((d) => (
            <li key={d.text} className="break-words">
              {d.text}
              {d.count > 1 && !digest.truncated ? <span className="text-ink-3 tnum"> ×{d.count}</span> : null}
            </li>
          ))}
        </ul>
      ) : outcome === 'nothing-fetched' && a.notes[0] ? (
        <p className="text-[12.5px] text-ink-2">{a.notes[0]}</p>
      ) : !own ? (
        <p className="text-[12.5px] text-ink-3">In the run for all resorts</p>
      ) : null}
    </div>
  )
}

function Cell({ label, children, className, hideLabel = false }: { label: string; children: React.ReactNode; className?: string; hideLabel?: boolean }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className={cn('mb-0.5 text-[12px] text-ink-3 lg:sr-only', hideLabel && 'sr-only')}>{label}</p>
      {children}
    </div>
  )
}

function refreshBlock(job: JobView, demo: boolean): string | null {
  if (!MANUAL.has(job.job)) return 'Runs on schedule only'
  if (demo && job.external) return 'Demo data is never refreshed from live sources'
  if (TARGET_ONLY.has(job.job)) return job.targets.length ? 'One resort at a time — see Per resort' : 'One resort at a time, from its resort page'
  return null
}

export function JobsPanel({ v, tz }: { v: SourcesView; tz: string }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-divider bg-surface">
      <div aria-hidden className="hidden grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_9.5rem] gap-x-4 border-b border-divider bg-surface-2 px-5 py-2.5 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase lg:grid">
        <span>Job</span>
        <span>State</span>
        <span>Last attempt</span>
        <span>Last success</span>
        <span>Manual</span>
      </div>
      <ul className="divide-y divide-divider">
        {v.jobs.map((j) => {
          const block = refreshBlock(j, v.demo)
          const spec = REFRESH_STATE[j.state]
          const failingTargets = j.targets.filter((x) => x.state === 'failing').length
          return (
            <li key={j.job} className="px-4 py-3.5 md:px-5">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_9.5rem]">
                <div className="order-1 col-span-2 min-w-0 lg:order-none lg:col-span-1">
                  <h3 className="text-[14.5px] font-semibold text-ink">{j.title}</h3>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
                    <span className="tnum">{j.cadence.text}</span>
                    <Badge tone="neutral" className="h-5">
                      {j.external ? 'External sources' : 'Local computation'}
                    </Badge>
                  </p>
                </div>
                <Cell label="State" className="order-2 lg:order-none">
                  <StateChip spec={spec} spin={j.state === 'running'} />
                  {j.stateLabel !== spec.label ? <p className="mt-1 text-[12.5px] text-ink-2">{j.stateLabel}</p> : null}
                </Cell>
                <Cell label="Last attempt" className="order-4 lg:order-none">
                  <Attempt h={j} now={v.now} tz={tz} job={j.job} />
                </Cell>
                <Cell label="Last success" className="order-5 lg:order-none">
                  <p className="text-[13px] text-ink">
                    <Ago at={j.lastSuccessAt} now={v.now} tz={tz} />
                  </p>
                  {j.lastSuccessAt && j.lastAttemptOutcome === 'failed' ? <p className="text-[12.5px] text-ink-3">Kept — the failed run did not replace it</p> : null}
                </Cell>
                <Cell label="Manual refresh" hideLabel className="order-3 justify-self-end text-right lg:order-none lg:justify-self-auto lg:text-left">
                  {block && (!MANUAL.has(j.job) || TARGET_ONLY.has(j.job)) ? (
                    <p className="text-[12.5px] text-ink-3">{block}</p>
                  ) : (
                    <RefreshButton job={j.job} label={`Refresh ${j.title.toLowerCase()}`} disabledReason={block} size="sm" className="items-end lg:items-start" />
                  )}
                </Cell>
              </div>
              {j.targets.length ? (
                <details className="group mt-3 rounded-[10px] border border-divider bg-surface-2">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[13px] font-medium text-ink md:min-h-9 [&::-webkit-details-marker]:hidden">
                    <span>
                      Per resort · {j.targets.length}
                      {failingTargets ? <span className="font-normal text-critical"> · {failingTargets} failing</span> : null}
                    </span>
                    <ChevronDown aria-hidden className="size-4 text-ink-3 transition-transform duration-150 group-open:rotate-180" />
                  </summary>
                  <ul className="divide-y divide-divider border-t border-divider">
                    {j.targets.map((x) => {
                      const ts = REFRESH_STATE[x.state]
                      const tBlock = !MANUAL.has(j.job) || GLOBAL_ONLY.has(j.job) ? 'Refreshes all resorts at once' : v.demo && j.external ? 'Demo data is never refreshed from live sources' : null
                      return (
                        <li key={x.resortId} className="grid items-start gap-x-4 gap-y-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_auto]">
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-medium text-ink">{x.name}</p>
                            <StateChip spec={ts} className="mt-1" />
                          </div>
                          <Cell label="Last attempt">
                            <Attempt h={x} now={v.now} tz={tz} target={x.resortId} job={j.job} />
                          </Cell>
                          <Cell label="Last success">
                            <p className="text-[13px] text-ink">
                              <Ago at={x.lastSuccessAt} now={v.now} tz={tz} />
                            </p>
                          </Cell>
                          {tBlock ? null : <RefreshButton job={j.job} target={x.resortId} label={`Refresh ${j.title.toLowerCase()} for ${x.name}`} size="sm" />}
                        </li>
                      )
                    })}
                  </ul>
                </details>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
