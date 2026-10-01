/**
 * Official weather alerts (NWS) for the compared resorts — shown on their own, above everything else, and never
 * folded into or offset by a score. With no active alert the block collapses to one honest line: when alerts were
 * last checked, or that they have not been checked, or that no official feed covers a resort.
 */
import { BadgeCheck, ExternalLink, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { JobHealth, ResortInfo } from '@/lib/data/forecast-screen'
import type { AlertView } from '@/lib/data/views'
import { relativeLabel } from '@/lib/domain/time'
import type { AppMode } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { instantLocal, severityTone } from './model'

const TONE = {
  critical: { box: 'border-critical/35 bg-critical-bg', icon: 'text-critical', label: 'text-critical' },
  caution: { box: 'border-caution/35 bg-caution-bg', icon: 'text-caution', label: 'text-caution' },
  info: { box: 'border-info/30 bg-info-bg', icon: 'text-info', label: 'text-info' },
} as const

const providerName = (p: string) => (/nws|weather\.gov/i.test(p) ? 'National Weather Service' : p === 'demo' ? 'Demo data' : p)

export function OfficialAlerts({
  alerts,
  resorts,
  selected,
  job,
  now,
  mode,
}: {
  alerts: AlertView[]
  resorts: Record<string, ResortInfo>
  selected: string[]
  job: JobHealth
  now: string
  mode: AppMode
}) {
  if (!selected.length) return null
  const name = (id: string) => resorts[id]?.name ?? id
  const uncovered = selected.filter((id) => !resorts[id]?.alerts.covered)
  const covered = selected.filter((id) => resorts[id]?.alerts.covered)

  if (alerts.length) {
    return (
      <section aria-labelledby="alerts-title" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="alerts-title" className="flex items-center gap-2 text-[16px] font-semibold text-ink">
            <ShieldAlert aria-hidden className="size-[18px] text-critical" />
            Official alerts
            <span className="text-[13px] font-normal text-ink-2 tnum">({alerts.length})</span>
          </h2>
          <p className="text-[12.5px] text-ink-3">Shown separately from every score — a better score never offsets a warning.</p>
        </div>
        <ul className="flex flex-col gap-2">
          {alerts.map((a) => {
            const tone = TONE[severityTone(a.severity)]
            const tz = resorts[a.resortId]?.timezone ?? 'UTC'
            return (
              <li key={a.id} className={cn('rounded-[20px] border px-4 py-3 shadow-[var(--glass-shadow)]', tone.box)}>
                <div className="flex items-start gap-3">
                  <TriangleAlert aria-hidden className={cn('mt-0.5 size-[18px] shrink-0', tone.icon)} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[15px] font-semibold text-ink">{a.event}</span>
                      <span className={cn('text-[12.5px] font-semibold', tone.label)}>{a.severity ?? 'Severity not stated'}</span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-2 tnum">
                      <span className="font-medium text-ink">{name(a.resortId)}</span>
                      {' · '}
                      {a.onset ? (a.upcoming ? `from ${instantLocal(a.onset, tz)}` : `in effect since ${instantLocal(a.onset, tz)}`) : 'start not stated'}
                      {' · '}
                      {a.ends ? `until ${instantLocal(a.ends, tz)}` : 'end not stated'}
                    </p>
                    {a.headline ? <p className="mt-1.5 max-w-[80ch] text-[14px] text-ink">{a.headline}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
                      <span className="inline-flex items-center gap-1 font-medium text-ink-2">
                        <BadgeCheck aria-hidden className="size-3.5" /> Official warning
                      </span>
                      <span className="text-ink-3">
                        {providerName(a.provider)} · checked {relativeLabel(a.fetchedAt, now)}
                      </span>
                      {a.url ? (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-teal hover:underline"
                        >
                          Full alert <ExternalLink aria-hidden className="size-3.5" />
                        </a>
                      ) : null}
                      <SourceDrawer title={`${a.event} — ${name(a.resortId)}`} items={[{ label: a.event, value: a.headline, prov: a.prov }]} />
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
        {uncovered.length ? (
          <p className="text-[12.5px] text-ink-3">No official alert feed for {uncovered.map(name).join(', ')} — NWS covers US resorts only.</p>
        ) : null}
      </section>
    )
  }

  // Quiet state: one line, still explicit about what was (and was not) checked.
  let Icon = ShieldCheck
  let text: string
  if (mode === 'demo') {
    Icon = ShieldQuestion
    text = 'Demo mode: official alerts are never fetched into demo data, so none are shown.'
  } else if (!covered.length) {
    Icon = ShieldQuestion
    text = `No official alert feed for ${uncovered.map(name).join(', ')} — NWS covers US resorts only.`
  } else {
    const checks = covered.map((id) => resorts[id]!.alerts.checkedAt)
    const allChecked = checks.every((c): c is string => !!c)
    const oldest = allChecked ? [...checks].sort()[0] : null
    if (!allChecked) {
      Icon = ShieldQuestion
      const unchecked = covered.filter((id) => !resorts[id]!.alerts.checkedAt)
      const failed = job.lastAttemptStatus === 'error' && job.lastAttemptAt ? ` (last attempt ${relativeLabel(job.lastAttemptAt, now)} failed)` : ''
      text = `Official alerts not checked yet for ${unchecked.map(name).join(', ')}${failed}. NWS warnings appear here once the alerts job has run.`
    } else {
      text = `No active official alerts for ${covered.map(name).join(', ')} · NWS checked ${relativeLabel(oldest!, now)}.`
    }
    if (uncovered.length) text += ` ${uncovered.map(name).join(', ')}: no official feed (US only).`
  }
  return (
    <section
      aria-label="Official alerts"
      className="glass flex items-start gap-2.5 rounded-[18px] px-4 py-2.5 text-[13px] text-ink-2"
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', Icon === ShieldCheck ? 'text-positive' : 'text-ink-3')} />
      <p className="min-w-0">
        <span className="hud mr-1.5 text-ink">Official alerts</span>
        {text}
      </p>
    </section>
  )
}
