/**
 * The page's first answer: is anything actually being collected? Scheduler, connectors, refresh jobs, coverage and
 * links in one strip — each a count with a plain sentence and a link to its section. Server-renderable.
 */
import type { ReactNode } from 'react'
import type { SourcesView } from '@/lib/data/sources'
import { cn } from '@/lib/ui/cn'
import { relativeLabel } from '@/lib/domain/time'
import { CountUp } from '@/components/season/count-up'
import { linkCheckerBlocked } from './connectors-panel'
import { TONE_TEXT, type Tone } from './state'

interface Tile {
  href: string
  eyebrow: string
  value: ReactNode
  unit?: string
  line: ReactNode
  tone: Tone
}

export function schedulerSummary(v: SourcesView): { label: string; tone: Tone; line: string } {
  const s = v.scheduler
  if (!s.applicable) return { label: 'Demo', tone: 'demo', line: 'Simulated data at a fixed instant — nothing refreshes.' }
  if (!s.heartbeat) return { label: 'Never ran', tone: 'critical', line: 'No worker or cron pass has run yet.' }
  const ago = relativeLabel(s.heartbeat, v.now)
  if (s.stale) return { label: 'Stale', tone: 'critical', line: `Last heartbeat ${ago} — nothing is being collected.` }
  if (s.running) return { label: 'Running', tone: 'positive', line: `Worker heartbeat ${ago}.` }
  if (s.mode === 'once') return { label: 'Cron', tone: 'neutral', line: `Last one-off pass ${ago}; the next depends on your cron schedule.` }
  return { label: 'Stopped', tone: 'caution', line: `Last heartbeat ${ago}; the worker has stopped.` }
}

/** Fine rules between tiles: stacked (phone), 2 columns (tablet), one row of 5 (desktop). */
const BORDERS = [
  '',
  'border-t sm:border-t-0 sm:border-l',
  'border-t lg:border-t-0 lg:border-l',
  'border-t sm:border-l lg:border-t-0',
  'border-t sm:col-span-2 lg:col-span-1 lg:border-t-0 lg:border-l',
]

export function StatusBoard({ v }: { v: SourcesView }) {
  const sched = schedulerSummary(v)
  const scheduled = v.connectors.filter((c) => c.job !== null && c.health !== 'disabled' && c.health !== 'not-configured')
  const working = scheduled.filter((c) => c.health === 'ok' && !linkCheckerBlocked(c, v.links, v.demo)).length
  const failing = v.connectors.filter((c) => c.health === 'failing').length
  const jobsBad = v.jobs.filter((j) => j.state === 'failing' || j.state === 'never-succeeded' || j.state === 'partial')
  const jobsStale = v.jobs.filter((j) => j.state === 'stale' || j.state === 'nothing-fetched')
  const cells = v.coverage.rows.flatMap((r) => r.cells)
  const missing = cells.filter((c) => c.state === 'missing').length
  const failedLinks = v.links.broken

  const tiles: Tile[] = [
    {
      href: '#scheduler',
      eyebrow: 'Scheduler',
      value: sched.label,
      line: sched.line,
      tone: sched.tone,
    },
    v.demo
      ? { href: '#connectors', eyebrow: 'Connectors', value: '—', line: 'Demo mode fetches nothing.', tone: 'demo' }
      : {
          href: '#connectors',
          eyebrow: 'Scheduled sources working',
          value: (
            <>
              <CountUp value={working} />
              <span className="text-[22px] text-ink-3"> / {scheduled.length}</span>
            </>
          ),
          line: failing ? `${failing} failing — see why below.` : working === scheduled.length && scheduled.length ? 'Every scheduled source fetched recently.' : 'None failing, but not all have succeeded.',
          tone: failing ? 'critical' : working === scheduled.length ? 'positive' : 'caution',
        },
    {
      href: '#jobs',
      eyebrow: 'Refresh jobs',
      value: v.demo ? '—' : jobsBad.length,
      unit: v.demo ? undefined : jobsBad.length === 1 ? 'failing' : 'failing',
      line: v.demo ? 'Demo data is never refreshed.' : jobsBad.length ? `${jobsBad.map((j) => j.title.split(' (')[0]).slice(0, 3).join(', ')}${jobsBad.length > 3 ? '…' : ''}${jobsStale.length ? ` · ${jobsStale.length} stale or empty` : ''}` : jobsStale.length ? `${jobsStale.length} stale or fetched nothing.` : 'All jobs up to date.',
      tone: v.demo ? 'demo' : jobsBad.length ? 'critical' : jobsStale.length ? 'caution' : 'positive',
    },
    {
      href: '#coverage',
      eyebrow: 'Facts on file',
      value: cells.length - missing,
      unit: `of ${cells.length}`,
      line: `${missing} missing across ${v.coverage.rows.length} resorts.`,
      tone: missing ? 'caution' : 'positive',
    },
    {
      href: '#links',
      eyebrow: 'Link checks',
      value: v.demo ? '—' : failedLinks,
      unit: v.demo ? undefined : `failed of ${v.links.checked}`,
      line: v.demo ? 'Not checked in demo mode.' : v.links.checked ? (failedLinks ? 'A failed check is not proof a link is broken — see below.' : 'Every checked link answered.') : 'No link has been checked yet.',
      tone: v.demo ? 'demo' : failedLinks ? 'caution' : v.links.checked ? 'positive' : 'neutral',
    },
  ]

  return (
    <div className="grid overflow-hidden glass rounded-[24px] sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((t, i) => (
        <a
          key={t.href}
          href={t.href}
          className={cn('group flex flex-col gap-1 border-divider px-4 py-3.5 transition-[background-color,transform] duration-150 ease-[var(--ease-out-soft)] hover:bg-surface-2 md:px-5 md:py-4 [&:hover_.tile-value]:-translate-y-px', BORDERS[i])}
        >
          <span className="eyebrow">{t.eyebrow}</span>
          <span className="tile-value flex items-baseline gap-1.5 transition-transform duration-150 ease-[var(--ease-out-soft)]">
            <span className={cn('font-display text-[32px] leading-none tnum', TONE_TEXT[t.tone])}>{typeof t.value === 'number' ? <CountUp value={t.value} /> : t.value}</span>
            {t.unit ? <span className="text-[13px] text-ink-3 tnum">{t.unit}</span> : null}
          </span>
          <span className="text-[13px] leading-snug text-ink-2 group-hover:text-ink">{t.line}</span>
        </a>
      ))}
    </div>
  )
}
