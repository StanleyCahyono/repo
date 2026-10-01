/**
 * 03 Lifts & runs — every lift and run OpenStreetMap contributors have mapped at the resort: lifts grouped by type
 * (name, length, hourly capacity), runs grouped by difficulty in the resort's own signs (text + shape) with counts and
 * lists. Community-mapped data: labelled as such, with attribution, never live status — whether a lift runs today is
 * only on the resort's own site, which this section links to once.
 *
 * Favourites and resorts in upcoming trips load on schedule; any other resort loads on demand with the button (the
 * manual-refresh cooldown applies). A failed load never replaces the last good list.
 */
import { ExternalLink, Info, Map as MapIcon } from 'lucide-react'
import { Disclosure } from '@/components/ui/disclosure'
import type { LiftsRunsView } from '@/lib/data/lifts'
import type { ResortDetail } from '@/lib/data/resort-detail'
import { groomingText, liftKindText, liftName, OSM_COPYRIGHT_URL, runName, type LiftGroup, type RunGroup } from '@/lib/domain/lifts'
import type { UnitPrefs } from '@/lib/domain/types'
import { mToFt } from '@/lib/domain/units'
import { cn } from '@/lib/ui/cn'
import { PisteSymbol } from './piste-symbol'
import { RefreshNow } from './refresh-now'
import { ResortSection, Src, SubHead } from './section'
import { ago, plural, shortDate, src, type PageView } from './format'

/** Lists open by default up to this many entries; larger areas show their counts and open on demand. */
const OPEN_UP_TO = 40

/** A mapped length: metres / feet under a kilometre / mile, else one decimal. */
function lengthText(m: number | null, u: UnitPrefs): string | null {
  if (m === null) return null
  if (u.distance === 'mi') {
    const ft = mToFt(m)
    return ft < 5280 ? `${(Math.round(ft / 10) * 10).toLocaleString('en-US')} ft` : `${(ft / 5280).toFixed(1)} mi`
  }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

const capacityText = (n: number) => `${n.toLocaleString('en-US')}/h`

const linkClass =
  'inline-flex min-h-11 items-center gap-2 rounded-md border border-divider-strong bg-surface px-3.5 text-[14px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal md:min-h-9'

export function LiftsSection({ d, lifts, v }: { d: ResortDetail; lifts: LiftsRunsView; v: PageView }) {
  const liftStatusUrl = d.links.find((l) => l.key === 'liftStatus')?.url ?? null
  const snowReportUrl = d.links.find((l) => l.key === 'snowReport')?.url ?? null
  const loaded = lifts.loaded
  const meta = loaded
    ? `${plural(loaded.totals.lifts, 'lift')} · ${plural(loaded.totals.runs, 'named run')} · OpenStreetMap`
    : 'OpenStreetMap — community-mapped'
  return (
    <ResortSection
      id="lifts"
      index={3}
      title="Lifts & runs"
      meta={meta}
      lead="What OpenStreetMap contributors have mapped here, grouped the way the resort signs its runs. A map of what exists, not of what is running today."
    >
      <div className="flex flex-col gap-6">
        <LiveStatusNote liftStatusUrl={liftStatusUrl} snowReportUrl={snowReportUrl} />
        {lifts.demo ? (
          <EmptyPanel title="Not loaded in demo mode">OpenStreetMap is never loaded into demo data. Switch to your live data to load this resort’s lifts and runs.</EmptyPanel>
        ) : lifts.connector.state === 'disabled' ? (
          <EmptyPanel title="The OpenStreetMap connector is off">
            It is turned off on this installation, so lifts and runs are not loaded. Sources &amp; Sync lists every connector.
          </EmptyPanel>
        ) : !loaded ? (
          <NotLoaded lifts={lifts} v={v} />
        ) : (
          <Loaded lifts={lifts} v={v} />
        )}
      </div>
    </ResortSection>
  )
}

function LiveStatusNote({ liftStatusUrl, snowReportUrl }: { liftStatusUrl: string | null; snowReportUrl: string | null }) {
  const url = liftStatusUrl ?? snowReportUrl
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-divider bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex gap-2 text-[13.5px] text-ink-2">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <span>
          <strong className="font-semibold text-ink">Open or closed today is not shown here.</strong> No public source a browser can read publishes live status
          per lift or run, so Piste lists what is mapped, never what is running.
          {liftStatusUrl ? ' The resort’s own live status page opens in a new tab — Piste cannot read it.' : url ? ' The resort’s snow report may list it.' : ''}
        </span>
      </p>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'shrink-0 self-start sm:self-auto')}>
          {liftStatusUrl ? 'Live lift status (official site)' : 'Official snow report'} <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only"> (opens a new tab)</span>
        </a>
      ) : null}
    </div>
  )
}

function EmptyPanel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-4">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="max-w-[70ch] text-[13.5px] text-ink-2">{children}</p>
      {action}
    </div>
  )
}

function scheduleText(lifts: LiftsRunsView): string {
  return lifts.scheduled
    ? 'This resort is a favourite or in an upcoming trip, so its lifts and runs load automatically and are refreshed weekly while Piste runs.'
    : 'Favourites and resorts in upcoming trips load automatically; other resorts load when you ask.'
}

function NotLoaded({ lifts, v }: { lifts: LiftsRunsView; v: PageView }) {
  const a = lifts.lastAttempt
  const title = a?.outcome === 'failed' ? 'Not loaded — the last attempt failed' : a?.outcome === 'running' ? 'Loading…' : 'Not loaded yet — needs internet'
  return (
    <EmptyPanel title={title} action={<RefreshNow resortId={v.id} jobs={['osm']} label="Load lifts & runs from OpenStreetMap" />}>
      {a?.outcome === 'failed' ? (
        <>
          Tried {ago(a.at, v.now)}: {a.error ?? 'the request failed'}. Nothing is stored yet.{' '}
        </>
      ) : null}
      {scheduleText(lifts)} Loading reads the public OpenStreetMap service, so it needs an internet connection.
    </EmptyPanel>
  )
}

function methodText(l: NonNullable<LiftsRunsView['loaded']>): string {
  const named = l.areas.map((a) => a.name).filter((n): n is string => !!n)
  const names = named.length ? `“${named.join('”, “')}”` : 'the mapped ski area'
  if (l.method === 'area') return `Inside the OpenStreetMap ski area ${names}.`
  if (l.areas.length) return `Within the bounding box of ${names} (its boundary is not in the search index) — it may include a neighbouring area.`
  return 'Within about 1.5 km of Piste’s base and summit points (no ski-area boundary is mapped nearby) — it may include a neighbouring area.'
}

function Loaded({ lifts, v }: { lifts: LiftsRunsView; v: PageView }) {
  const l = lifts.loaded!
  const a = lifts.lastAttempt
  const failedSince = a?.outcome === 'failed' && a.at > l.fetchedAt
  const empty = l.totals.lifts === 0 && l.totals.runs === 0 && l.totals.unnamedSegments === 0
  return (
    <div className="flex flex-col gap-6">
      {failedSince ? (
        <p className="rounded-[10px] border border-caution/40 bg-caution-bg px-3 py-2 text-[13px] text-ink">
          The latest refresh ({ago(a!.at, v.now)}) failed{a!.error ? `: ${a!.error}` : ''}. Showing the list loaded {ago(l.fetchedAt, v.now)} — a failed refresh never
          replaces it.
        </p>
      ) : null}
      {empty ? (
        <EmptyPanel
          title="OpenStreetMap has no lifts or runs mapped here"
          action={
            <a href={l.mapUrl} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'self-start')}>
              <MapIcon aria-hidden className="size-4" /> View the area on OpenStreetMap <ExternalLink aria-hidden className="size-3.5" />
            </a>
          }
        >
          {methodText(l)} That says nothing about what the resort has — only that nobody has mapped it yet. Anyone can add lifts and runs on openstreetmap.org.
        </EmptyPanel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <LiftList groups={l.liftGroups} counts={l.liftCounts} capacity={l.totals} units={v.units} />
          <RunList lifts={lifts} units={v.units} />
        </div>
      )}
      <footer className="flex flex-col gap-3 border-t border-divider pt-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[80ch] text-[12.5px] text-ink-3">
          <p className="flex flex-wrap items-center gap-x-1.5 text-ink-2">
            <span className="font-medium text-ink">Community-mapped</span> — may be incomplete or out of date; never live status.
            <Src title="Lifts & runs" items={[src('Lifts and runs (OpenStreetMap)', l.prov, `${plural(l.totals.lifts, 'lift')} · ${plural(l.totals.runs, 'named run')}`)]} />
          </p>
          <p className="mt-1">
            Loaded {ago(l.fetchedAt, v.now)}
            {l.osmTimestamp ? ` · map data as of ${shortDate(l.osmTimestamp.slice(0, 10))}` : ''}. {methodText(l)} Lengths are measured along the mapped lines, so steep
            ones are a little longer on the ground.
            {l.areaPistes ? ` ${plural(l.areaPistes, 'piste')} mapped only as an outline ${l.areaPistes === 1 ? 'is' : 'are'} not listed.` : ''}
          </p>
          <p className="mt-1">
            Data{' '}
            <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
              © OpenStreetMap contributors (ODbL)
              <span className="sr-only"> (opens a new tab)</span>
            </a>{' '}
            ·{' '}
            <a href={l.mapUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
              View or improve it on OpenStreetMap
              <span className="sr-only"> (opens a new tab)</span>
            </a>
          </p>
          <p className="mt-1">{scheduleText(lifts)}</p>
        </div>
        <RefreshNow resortId={v.id} jobs={['osm']} label="Reload from OpenStreetMap" className="shrink-0" />
      </footer>
    </div>
  )
}

function LiftList({ groups, counts, capacity, units }: { groups: LiftGroup[]; counts: string; capacity: { capacityPerHour: number | null; capacityKnown: number; lifts: number }; units: UnitPrefs }) {
  const open = groups.reduce((n, g) => n + g.lifts.length, 0) <= OPEN_UP_TO
  return (
    <section aria-labelledby="lifts-list-title" className="min-w-0">
      <SubHead id="lifts-list-title" aside={capacity.capacityPerHour !== null ? `${capacityText(capacity.capacityPerHour)} mapped (${capacity.capacityKnown} of ${capacity.lifts} lifts state it)` : null}>
        Lifts
      </SubHead>
      {groups.length ? <p className="mb-3 text-[13.5px] text-ink-2 tnum">{counts}</p> : <p className="text-[13.5px] text-ink-3 italic">No lifts mapped.</p>}
      <div className="overflow-hidden rounded-[12px] border border-divider bg-surface">
        {groups.map((g) => (
          <Disclosure
            key={g.key}
            variant="row"
            defaultOpen={open}
            className="border-b border-divider px-4 last:border-b-0"
            summary={
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-semibold text-ink">{g.label}</span>
                <span className="text-ink-3 tnum">· {g.lifts.length}</span>
                {g.capacityPerHour !== null ? <span className="hidden text-[12.5px] font-normal text-ink-3 tnum sm:inline">· {capacityText(g.capacityPerHour)}</span> : null}
              </span>
            }
          >
            <table className="mb-3 w-full text-left text-[13.5px]">
              <caption className="sr-only">{g.label}: name, type, mapped length and hourly capacity</caption>
              <thead>
                <tr className="border-b border-divider text-[12px] text-ink-3">
                  <th scope="col" className="py-1.5 pr-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                    Length
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Capacity
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.lifts.map((lift) => (
                  <tr key={lift.osm} className="border-b border-divider last:border-b-0">
                    <th scope="row" className="py-2 pr-2 font-normal">
                      <span className="block font-medium text-ink">
                        {liftName(lift)}
                        {lift.name && lift.ref ? <span className="font-normal text-ink-3"> ({lift.ref})</span> : null}
                      </span>
                      <span className="block text-[12px] text-ink-3">
                        {liftKindText(lift)}
                        {lift.durationMin !== null ? ` · ${lift.durationMin} min ride` : ''}
                      </span>
                    </th>
                    <td className="py-2 pr-2 text-right text-ink tnum">{lengthText(lift.lengthM, units) ?? <span className="text-ink-3 italic">Unknown</span>}</td>
                    <td className="py-2 text-right text-ink tnum">{lift.capacityPerHour !== null ? capacityText(lift.capacityPerHour) : <span className="text-ink-3 italic">Not mapped</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Disclosure>
        ))}
      </div>
    </section>
  )
}

function RunList({ lifts, units }: { lifts: LiftsRunsView; units: UnitPrefs }) {
  const l = lifts.loaded!
  const groups: RunGroup[] = l.runGroups
  const open = l.totals.runs <= OPEN_UP_TO
  const used = new Set(groups.map((g) => g.style.key))
  return (
    <section aria-labelledby="runs-list-title" className="min-w-0">
      <SubHead id="runs-list-title" aside={lifts.conventionLabel}>
        Runs
      </SubHead>
      {groups.length ? (
        <p className="mb-3 text-[13.5px] text-ink-2 tnum">
          {l.runCounts || 'No named runs'}
          {l.totals.unnamedSegments ? ` · plus ${plural(l.totals.unnamedSegments, 'unnamed piste section')}` : ''}
        </p>
      ) : (
        <p className="text-[13.5px] text-ink-3 italic">No runs mapped.</p>
      )}
      <div className="overflow-hidden rounded-[12px] border border-divider bg-surface">
        {groups.map((g) => (
          <Disclosure
            key={g.style.key}
            variant="row"
            defaultOpen={open}
            className="border-b border-divider px-4 last:border-b-0"
            summary={
              <span className="flex min-w-0 items-center gap-2">
                <PisteSymbol shape={g.style.shape} tone={g.style.tone} />
                <span className="font-semibold text-ink">{g.style.label}</span>
                <span className="text-ink-3 tnum">· {g.runs.length}</span>
                <span className="hidden truncate text-[12.5px] font-normal text-ink-3 sm:inline">· {g.style.meaning}</span>
              </span>
            }
          >
            {g.runs.length ? (
              <ul className="mb-2 flex flex-col">
                {g.runs.map((r) => {
                  const groomed = groomingText(r.grooming)
                  return (
                    <li key={r.osm} className="flex items-baseline justify-between gap-3 border-b border-divider py-2 text-[13.5px] last:border-b-0">
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{runName(r)}</span>
                        {groomed || r.segments > 1 ? (
                          <span className="block text-[12px] text-ink-3">{[groomed, r.segments > 1 ? `${r.segments} mapped sections` : null].filter(Boolean).join(' · ')}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-ink tnum">{lengthText(r.lengthM, units) ?? <span className="text-ink-3 italic">Unknown</span>}</span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {g.unnamed ? (
              <p className="mb-3 text-[12.5px] text-ink-3 tnum">
                {g.runs.length ? 'Plus ' : ''}
                {plural(g.unnamed.segments, 'unnamed section')}
                {g.unnamed.lengthM ? ` (${lengthText(g.unnamed.lengthM, units)})` : ''} — not counted as runs.
              </p>
            ) : null}
          </Disclosure>
        ))}
      </div>
      {groups.length ? (
        <ul aria-label={`${lifts.conventionLabel}: what each sign means`} className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-3">
          {lifts.legend
            .filter((s) => used.has(s.key))
            .map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <PisteSymbol shape={s.shape} tone={s.tone} className="scale-90" />
                <span>
                  <span className="text-ink-2">{s.label}</span> — {s.meaning.charAt(0).toLowerCase() + s.meaning.slice(1)}
                </span>
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  )
}
