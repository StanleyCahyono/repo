/**
 * Connectors: what each adapter is (setup/maturity from providerStatus) and how it is actually doing (its own fetch
 * log and refresh runs). A connector without credentials, turned off, on-demand or in demo mode never looks live.
 * Server-renderable. Table from 1024px, a stacked list below.
 */
import { ExternalLink, TriangleAlert } from 'lucide-react'
import type { ConnectorView, LinksView, SourcesView } from '@/lib/data/sources'
import { Code } from '@/components/settings/section'
import { Ago } from './ago'
import { errorBeyondStatus } from './format'
import { CONNECTOR_HEALTH, CONNECTOR_SETUP, StateChip, type StateSpec } from './state'

/**
 * The link checker "works" when it runs, but if not one checked link answered OK the network is most likely
 * blocking it — never show that as plainly working.
 */
export function linkCheckerBlocked(c: Pick<ConnectorView, 'role'>, links: LinksView, demo: boolean): boolean {
  return c.role === 'link-check' && !demo && links.checked > 0 && links.ok === 0
}

const ROLE_TEXT: Record<ConnectorView['role'], string> = {
  weather: 'Weather model',
  alerts: 'Official alerts',
  'resort-report': 'Resort report',
  'lifts-runs': 'Lifts & runs (community map)',
  fx: 'Exchange rates',
  flights: 'Flight offers',
  'link-check': 'Link checks',
}

function lastSuccessOf(c: ConnectorView) {
  return c.role === 'weather' ? c.lastFetchOkAt : c.jobLastSuccessAt
}

function Source({ c, names }: { c: ConnectorView; names: Record<string, string> }) {
  return (
    <div className="min-w-0">
      <p className="text-[14.5px] font-semibold text-ink">
        {c.label}
        {c.resortId ? <span className="font-normal text-ink-2"> · {names[c.resortId] ?? c.resortId}</span> : null}
      </p>
      <p className="mt-0.5 text-[12.5px] text-ink-3">
        {ROLE_TEXT[c.role]} — {c.coverage}
      </p>
      {c.notes.length ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-2">
          {c.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {c.sourceUrl ? (
        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-teal hover:underline">
          {c.role === 'resort-report' ? 'Official page' : 'Documentation'} <ExternalLink aria-hidden className="size-3" />
        </a>
      ) : null}
    </div>
  )
}

function Setup({ c }: { c: ConnectorView }) {
  const spec = CONNECTOR_SETUP[c.state]
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span title={spec.hint}>
        <StateChip spec={spec} />
      </span>
      {c.envVars.length ? (
        <p className="text-[12.5px] text-ink-3">
          {c.state === 'needs-credentials' ? 'Set ' : c.auth === 'optional-key' ? 'Optional ' : ''}
          {c.envVars.map((e, i) => (
            <span key={e}>
              {i ? ', ' : ''}
              <Code className="text-[12px]">{e}</Code>
            </span>
          ))}
          {c.auth !== 'none' ? <span>{c.credentialSet ? ' · set' : ' · not set'}</span> : null}
        </p>
      ) : null}
    </div>
  )
}

function Health({ c, links, demo }: { c: ConnectorView; links: LinksView; demo: boolean }) {
  const blocked = linkCheckerBlocked(c, links, demo)
  const spec: StateSpec = blocked ? { label: 'Runs — nothing answered', tone: 'caution', Icon: TriangleAlert } : CONNECTOR_HEALTH[c.health]
  const text = blocked ? `None of the ${links.checked} checked links answered OK — most likely the network blocks the checks. See Link checks.` : c.healthLabel
  return (
    <div className="flex flex-col items-start gap-1">
      <StateChip spec={spec} />
      {text !== spec.label ? <p className="text-[12.5px] text-ink-2">{text}</p> : null}
    </div>
  )
}

function LastFetch({ c, now, tz, links }: { c: ConnectorView; now: string; tz: string; links: LinksView }) {
  if (c.role === 'link-check') {
    // Link checks are logged in link_checks, not the fetch log.
    if (!links.lastCheckedAt) return <span className="text-[13px] text-ink-3 italic">No link checked yet</span>
    return (
      <p className="text-[13px] text-ink">
        {links.checked} links checked, latest <Ago at={links.lastCheckedAt} now={now} tz={tz} />
      </p>
    )
  }
  if (!c.lastFetch) return <span className="text-[13px] text-ink-3 italic">{c.job ? 'Never fetched' : 'No search yet'}</span>
  const f = c.lastFetch
  const extra = f.ok ? null : errorBeyondStatus(f.error, f.httpStatus)
  return (
    <div className="text-[13px]">
      <p className={f.ok ? 'text-ink' : 'font-medium text-critical'}>
        {f.ok ? 'Fetched' : 'Failed'} <Ago at={f.at} now={now} tz={tz} />
        {f.httpStatus ? <span className="tnum"> · HTTP {f.httpStatus}</span> : null}
      </p>
      {extra ? <p className="mt-0.5 line-clamp-2 text-[12.5px] break-words text-ink-2">{extra}</p> : null}
    </div>
  )
}

export function ConnectorsPanel({ v, tz, names }: { v: SourcesView; tz: string; names: Record<string, string> }) {
  const rows = v.connectors
  return (
    <div className="overflow-hidden rounded-[12px] border border-divider bg-surface">
      <table className="hidden w-full text-left lg:table">
        <caption className="sr-only">Connectors: setup, current status, last fetch and last successful update</caption>
        <thead>
          <tr className="border-b border-divider bg-surface-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
            <th scope="col" className="px-5 py-2.5 font-semibold">
              Source
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold">
              Setup
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold">
              Status
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold">
              Last fetch
            </th>
            <th scope="col" className="px-5 py-2.5 font-semibold">
              Last success
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {rows.map((c) => (
            <tr key={c.id} className="align-top">
              <th scope="row" className="w-[34%] px-5 py-3.5 font-normal">
                <Source c={c} names={names} />
              </th>
              <td className="w-[15%] px-3 py-3.5">
                <Setup c={c} />
              </td>
              <td className="w-[19%] px-3 py-3.5">
                <Health c={c} links={v.links} demo={v.demo} />
              </td>
              <td className="w-[18%] px-3 py-3.5">
                <LastFetch c={c} now={v.now} tz={tz} links={v.links} />
              </td>
              <td className="px-5 py-3.5 text-[13px] text-ink">
                {c.job ? <Ago at={lastSuccessOf(c)} now={v.now} tz={tz} /> : <span className="text-ink-3">Not scheduled</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-divider lg:hidden">
        {rows.map((c) => (
          <li key={c.id} className="px-4 py-3.5 md:px-5">
            <Source c={c} names={names} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Health c={c} links={v.links} demo={v.demo} />
              <Setup c={c} />
            </div>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-ink-3">Last fetch</dt>
              <dd className="min-w-0">
                <LastFetch c={c} now={v.now} tz={tz} links={v.links} />
              </dd>
              <dt className="text-ink-3">Last success</dt>
              <dd className="text-ink">{c.job ? <Ago at={lastSuccessOf(c)} now={v.now} tz={tz} /> : <span className="text-ink-3">Not scheduled</span>}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Sources with no automated connector: entered by hand or offered as links (the "manual" connector state). */
export function ManualSources({ v, reportAdapters, resortCount }: { v: SourcesView; reportAdapters: number; resortCount: number }) {
  const flights = v.connectors.find((c) => c.role === 'flights')
  const items = [
    {
      title: 'Official snow reports',
      scope: `${resortCount - reportAdapters} of ${resortCount} resorts`,
      text: 'No report adapter: open the official report from the resort page and enter it by hand, with the link. It is labelled as typed from an official source.',
    },
    {
      title: 'Hotel rates',
      scope: 'All hotels',
      text: 'Links to official and booking pages only. A price appears only from a dated quote you enter, and expires.',
    },
    ...(flights && flights.health !== 'ok'
      ? [{ title: 'Flight prices', scope: 'All trips', text: 'Search links (Google Flights, KAYAK) and your own itinerary and quote entries, until Duffel is configured.' }]
      : []),
    {
      title: 'Catalog facts',
      scope: 'All resorts',
      text: 'Researched or reference data from the catalog. Correct anything you have checked below — it is labelled as your correction.',
    },
  ]
  return (
    <div className="mt-4 rounded-[12px] border border-divider bg-surface-2">
      <p className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-2.5 text-[13.5px] font-semibold text-ink md:px-5">
        <StateChip spec={CONNECTOR_SETUP.manual} /> Manual and link-only sources
      </p>
      <ul className="grid divide-y divide-divider md:grid-cols-2 md:divide-y-0">
        {items.map((it, i) => (
          <li key={it.title} className={`px-4 py-3 md:px-5 ${i >= 2 ? 'md:border-t md:border-divider' : ''} ${i % 2 === 1 ? 'md:border-l md:border-divider' : ''}`}>
            <p className="text-[14px] font-medium text-ink">
              {it.title} <span className="font-normal text-ink-3">· {it.scope}</span>
            </p>
            <p className="mt-0.5 text-[13px] text-ink-2">{it.text}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
