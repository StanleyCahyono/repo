/**
 * Scheduler health: heartbeat age and mode, why a sleeping machine collects nothing, how to run the worker or cron,
 * and the cadence of every job. Server-renderable.
 */
import { CircleCheck, CircleDashed, Clock3, CloudOff, FlaskConical, Moon, Server, TimerReset } from 'lucide-react'
import type { SourcesView } from '@/lib/data/sources'
import { Code } from '@/components/settings/section'
import { cn } from '@/lib/ui/cn'
import { Ago } from './ago'
import { schedulerSummary } from './status-board'
import { StateChip, TONE_TEXT } from './state'

export function SchedulerPanel({ v, tz }: { v: SourcesView; tz: string }) {
  const s = v.scheduler
  const sum = schedulerSummary(v)
  const Icon = sum.tone === 'positive' ? CircleCheck : sum.tone === 'demo' ? FlaskConical : sum.tone === 'critical' ? CloudOff : sum.tone === 'caution' ? Clock3 : CircleDashed
  const modeText = s.mode === 'worker' ? 'Long-running worker (npm run worker)' : s.mode === 'once' ? 'One-off passes (npm run refresh, e.g. from cron)' : s.mode ? s.mode : 'None yet'

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="glass rounded-[24px]">
        <div className="flex items-start gap-3 border-b border-divider px-4 py-4 md:px-5">
          <Icon aria-hidden className={cn('mt-1 size-5 shrink-0', TONE_TEXT[sum.tone])} />
          <div className="min-w-0">
            <p className="text-[17px] font-semibold text-ink">
              {s.applicable ? (s.heartbeat ? `Scheduler: ${sum.label.toLowerCase()}` : 'The scheduler has never run') : 'Demo mode — nothing is scheduled'}
            </p>
            <p className="mt-0.5 text-[13.5px] text-ink-2">{s.note ?? sum.line}</p>
          </div>
        </div>
        {s.applicable ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 px-4 py-4 text-[13.5px] md:px-5">
            <dt className="text-ink-2">Last heartbeat</dt>
            <dd className="text-ink">
              <Ago at={s.heartbeat} now={v.now} tz={tz} absolute />
            </dd>
            <dt className="text-ink-2">Mode</dt>
            <dd className="text-ink">{modeText}</dd>
            <dt className="text-ink-2">Counts as stale after</dt>
            <dd className="text-ink tnum">
              {s.staleAfterMinutes >= 60 ? `${Math.round(s.staleAfterMinutes / 60)} h` : `${s.staleAfterMinutes} min`} without a heartbeat
            </dd>
            {s.startedAt ? (
              <>
                <dt className="text-ink-2">Worker started</dt>
                <dd className="text-ink">
                  <Ago at={s.startedAt} now={v.now} tz={tz} />
                </dd>
              </>
            ) : null}
            {s.stoppedAt ? (
              <>
                <dt className="text-ink-2">Worker stopped</dt>
                <dd className="text-ink">
                  <Ago at={s.stoppedAt} now={v.now} tz={tz} />
                </dd>
              </>
            ) : null}
            <dt className="text-ink-2">Health check</dt>
            <dd className="text-ink">
              <Code>GET /api/health?strict=1</Code> <span className="text-ink-3">answers 503 when stale</span>
            </dd>
          </dl>
        ) : (
          <p className="px-4 py-4 text-[13.5px] text-ink-2 md:px-5">
            Demo data is a simulated snapshot for Fri 15 Jan 2027. Refresh jobs only ever write to the live database, and live refreshes are refused while demo mode is on.
          </p>
        )}
        <div className="border-t border-divider px-4 py-3 md:px-5">
          <p className="mb-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
            Cadences{s.cadenceSource === 'worker' ? ' reported by the worker' : ' (built-in defaults)'}
          </p>
          <ul className="text-[13px]">
            {v.jobs.map((j) => (
              <li key={j.job} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 border-b border-dotted border-divider py-1.5 last:border-b-0">
                <span className="text-ink-2">{j.title.replace(' (from season dates)', '')}</span>
                <span className="text-ink tnum">{j.cadence.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-[20px] border border-caution/40 bg-caution-bg px-4 py-4 md:px-5">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Moon aria-hidden className="size-4 text-caution" /> A sleeping machine cannot collect data
          </p>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            Piste collects forecasts and reports with server-side jobs, never from your browser. While the computer running Piste sleeps or is off, nothing is
            fetched: forecasts published in that time are simply missing from history, and alerts wait until the next pass. For continuous collection, run the
            worker on an always-on machine.
          </p>
        </div>
        <div className="glass rounded-[24px] px-4 py-4 md:px-5">
          <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
            <Server aria-hidden className="size-4 text-ink-3" /> Always-on host
          </p>
          <p className="mt-1 text-[13px] text-ink-2">Checks every minute which jobs are due and writes a heartbeat.</p>
          <p className="mt-2">
            <Code>npm run worker</Code>
          </p>
          <p className="mt-4 flex items-center gap-2 text-[14.5px] font-semibold text-ink">
            <TimerReset aria-hidden className="size-4 text-ink-3" /> Or one pass from cron
          </p>
          <p className="mt-1 text-[13px] text-ink-2">Every job once, then exit. Example — every 3 hours:</p>
          <pre className="mt-2 overflow-x-auto rounded-[8px] bg-surface-3 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink">
            7 */3 * * * cd /srv/piste &amp;&amp; npm run refresh
          </pre>
          <p className="mt-2 text-[12.5px] text-ink-3">
            More examples (systemd, hourly reports) in <Code>docs/scheduler.md</Code>.
          </p>
          {s.applicable && !s.heartbeat ? (
            <p className="mt-3">
              <StateChip spec={{ label: 'Nothing has been collected yet', tone: 'critical', Icon: CloudOff }} />
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
