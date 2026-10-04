import type { Metadata } from 'next'
import { ArrowRight, Info } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { DemoBadge } from '@/components/ui/badge'
import { OfflineBanner } from '@/components/ui/offline-banner'
import { PageHeader } from '@/components/ui/page-header'
import { Rise } from '@/components/settings/rise'
import { ScrollRise } from '@/components/season/scroll-rise'
import { SettingsSection } from '@/components/settings/section'
import { SettingsNav, type NavSection } from '@/components/settings/settings-nav'
import { ConnectorsPanel, ManualSources } from '@/components/sources/connectors-panel'
import { CorrectionsPanel } from '@/components/sources/corrections-panel'
import { CoverageMatrix } from '@/components/sources/coverage-matrix'
import { JobsPanel } from '@/components/sources/jobs-panel'
import { FailuresPanel, LinksPanel } from '@/components/sources/log-panels'
import { SchedulerPanel } from '@/components/sources/scheduler-panel'
import { StatusBoard, schedulerSummary } from '@/components/sources/status-board'
import { getCtx } from '@/lib/context'
import { loadCorrections, loadResortChoices } from '@/lib/data/settings-screen'
import { getSourcesView } from '@/lib/data/sources'
import { formatInstant } from '@/lib/domain/time'

export const metadata: Metadata = { title: 'Sources & Sync' }

export default async function SourcesPage() {
  const ctx = await getCtx()
  const [v, corrections, resorts] = await Promise.all([getSourcesView(ctx), loadCorrections(ctx), loadResortChoices(ctx)])
  const tz = ctx.prefs.homeTimezone
  const names: Record<string, string> = Object.fromEntries(resorts.map((r) => [r.id, r.name]))
  const labels: Record<string, string> = Object.fromEntries(v.connectors.map((c) => [c.id, c.label]))
  // 'unverified' adapters (built without the live page) are passed on as 'new'.
  const adapters: Record<string, string> = Object.fromEntries(
    v.connectors.filter((c) => c.role === 'resort-report' && c.resortId).map((c) => [c.resortId!, c.state === 'unverified' ? 'new' : c.state]),
  )
  const reportAdapters = Object.keys(adapters).length

  const failingConnectors = v.connectors.filter((c) => c.health === 'failing').length
  const badJobs = v.jobs.filter((j) => j.state === 'failing' || j.state === 'never-succeeded' || j.state === 'partial').length
  const sched = schedulerSummary(v)
  const sections: NavSection[] = [
    { id: 'scheduler', label: 'Scheduler', badge: sched.tone === 'critical' ? sched.label : null, tone: 'critical' },
    { id: 'connectors', label: 'Connectors', badge: failingConnectors ? `${failingConnectors} failing` : null, tone: 'critical' },
    { id: 'jobs', label: 'Refresh jobs', short: 'Jobs', badge: badJobs ? `${badJobs} failing` : null, tone: 'critical' },
    { id: 'coverage', label: 'Coverage by resort', short: 'Coverage' },
    { id: 'failures', label: 'Failures', badge: v.failures.items.length ? String(v.failures.items.length) : null, tone: 'caution' },
    { id: 'links', label: 'Link checks', short: 'Links' },
    { id: 'corrections', label: 'Corrections', badge: corrections.length ? String(corrections.length) : null, tone: 'neutral' },
  ]

  return (
    <>
      <OfflineBanner />
      <PageHeader
        eyebrow={
          <>
            <span>Data health</span>
            {v.demo ? (
              <DemoBadge>Demo data — nothing here is fetched</DemoBadge>
            ) : null}
          </>
        }
        title="Sources & Sync"
        lead="Where every fact comes from, when it last refreshed successfully, and what is missing or failing. A disconnected source is never shown as live."
        actions={
          <ButtonLink href="/settings#corrections" variant="ghost" className="max-md:hidden">
            Settings <ArrowRight aria-hidden className="size-4" />
          </ButtonLink>
        }
      >
        <p className="mt-2 text-[12.5px] text-ink-3">
          As of{' '}
          <time dateTime={v.now} className="tnum">
            {formatInstant(v.now, tz, 'ccc d LLL yyyy, HH:mm ZZZZ')}
          </time>
          {v.demo ? ' (simulated demo clock)' : ''} · season {v.season.label}
        </p>
      </PageHeader>

      <Rise index={0}>
        <StatusBoard v={v} />
      </Rise>

      <div className="mt-6 md:mt-8">
        <SettingsNav sections={sections} label="Sources & Sync sections" vertical={false} />
        <div className="flex min-w-0 flex-col gap-10 md:gap-12">
          <Rise index={1}>
            <SettingsSection id="scheduler" index={1} title="Scheduler" meta="Refreshes run on the server, on a schedule — never in your browser.">
              <SchedulerPanel v={v} tz={tz} />
            </SettingsSection>
          </Rise>
          <Rise index={2}>
            <SettingsSection
              id="connectors"
              index={2}
              title="Connectors"
              meta="Setup says what a connector is; status says whether it is actually working. Only a recent successful fetch counts as working."
            >
              <ConnectorsPanel v={v} tz={tz} names={names} />
              <ManualSources v={v} reportAdapters={reportAdapters} resortCount={v.coverage.rows.length} />
            </SettingsSection>
          </Rise>
          <Rise index={3}>
            <SettingsSection id="jobs" index={3} title="Refresh jobs" meta="Last attempt beside last success — a failed or empty run never advances “last successful update”.">
              <JobsPanel v={v} tz={tz} />
            </SettingsSection>
          </Rise>
          <ScrollRise>
            <SettingsSection
              id="coverage"
              index={4}
              title="Coverage by resort"
              meta={`What is on file for each resort in ${v.season.label}: official, yours, estimated, catalog, stale, failing or missing.`}
            >
              <CoverageMatrix rows={v.coverage.rows} fields={v.coverage.fields} now={v.now} tz={tz} seasonLabel={v.season.label} adapters={adapters} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="failures" index={5} title="Failures" meta={`Fetch errors and parser failures from the source log, last ${v.failures.windowDays} days.`}>
              <FailuresPanel v={v} tz={tz} labels={labels} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="links" index={6} title="Link checks" meta="Every external link Piste shows is checked in the background.">
              <LinksPanel links={v.links} now={v.now} tz={tz} demo={v.demo} names={names} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="corrections" index={7} title="Corrections" meta="Catalog facts you corrected by hand, with their sources. Newest first.">
              <CorrectionsPanel items={corrections} resorts={resorts} units={ctx.prefs.units} now={v.now} tz={tz} demo={v.demo} />
            </SettingsSection>
          </ScrollRise>

          <aside aria-label="How to read this page" className="flex gap-3 border-t border-divider pt-5 text-[13px] text-ink-2">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
            <ul className="flex flex-col gap-1">
              {v.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </>
  )
}
