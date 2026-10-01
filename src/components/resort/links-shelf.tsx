/**
 * 07 Maps & links — the prominent link shelf (trail map, interactive map, OpenSkiMap, webcams, snow report, hours,
 * tickets, lessons, rentals, parking, road info, lodging, tourism, avalanche…) with each link's check status
 * (OK / broken / check failed / not yet checked), always opening externally; then "Sources & data coverage": the
 * honest gaps, research open questions and conflicts, what is reference-only, and every source on file.
 */
import {
  AlertTriangle,
  Backpack,
  BedDouble,
  CableCar,
  CalendarDays,
  Clock3,
  ExternalLink,
  Globe,
  GraduationCap,
  Landmark,
  Map as MapIcon,
  MapPinned,
  Mountain,
  ParkingSquare,
  Route,
  Snowflake,
  Ticket,
  TicketCheck,
  Webcam,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Disclosure } from '@/components/ui/disclosure'
import { KindTag } from '@/components/ui/provenance'
import type { LinkView, ResortDetail } from '@/lib/data/resort-detail'
import { openSkiMapUrl } from '@/lib/providers/links/builders'
import { ResortSection, Src, SubHead } from './section'
import { dotJoin, hostOf, LINK_STATE_LABEL, linkState, linkStateDetail, shortDate, type LinkState, type PageView } from './format'

interface ShelfItem {
  key: string
  label: string
  icon: LucideIcon
  /** Important links show a "not recorded" tile when missing. */
  expected: boolean
  note?: string
}

const GROUPS: { title: string; items: ShelfItem[] }[] = [
  {
    title: 'Maps & cameras',
    items: [
      { key: 'trailMap', label: 'Trail map', icon: MapIcon, expected: true, note: 'Official map (image or PDF)' },
      { key: 'interactiveMap', label: 'Interactive map', icon: MapPinned, expected: false },
      { key: 'openSkiMap', label: 'OpenSkiMap', icon: Mountain, expected: true, note: 'Community map from OpenStreetMap data' },
      { key: 'webcams', label: 'Webcams', icon: Webcam, expected: true },
    ],
  },
  {
    title: 'Conditions & safety',
    items: [
      { key: 'snowReport', label: 'Snow report', icon: Snowflake, expected: true },
      { key: 'liftStatus', label: 'Live lift status', icon: CableCar, expected: false, note: 'Official live lift & run status — Piste cannot read it' },
      { key: 'roadInfo', label: 'Road information', icon: Route, expected: true },
      { key: 'avalanche', label: 'Avalanche information', icon: AlertTriangle, expected: false },
    ],
  },
  {
    title: 'Plan & book',
    items: [
      { key: 'hours', label: 'Hours', icon: Clock3, expected: true },
      { key: 'tickets', label: 'Lift tickets', icon: Ticket, expected: true },
      { key: 'seasonPass', label: 'Season pass', icon: TicketCheck, expected: false },
      { key: 'lessons', label: 'Lessons', icon: GraduationCap, expected: true },
      { key: 'rentals', label: 'Rentals', icon: Backpack, expected: true },
      { key: 'parking', label: 'Parking', icon: ParkingSquare, expected: true },
      { key: 'lodging', label: 'Lodging', icon: BedDouble, expected: true },
      { key: 'events', label: 'Events', icon: CalendarDays, expected: false },
      { key: 'tourism', label: 'Tourism office', icon: Landmark, expected: true },
      { key: 'official', label: 'Official website', icon: Globe, expected: true },
    ],
  },
]

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
function NotRecorded({ items, official }: { items: ShelfItem[]; official: string | null }) {
  if (!items.length) return null
  return (
    <p className="rounded-[20px] border border-dashed border-divider-strong bg-glass-soft px-4 py-3 text-[13.5px] text-ink-2">
      <span className="font-semibold text-ink">Not recorded yet:</span> {items.map((i) => i.label).join(' · ')}
      <span className="text-ink-3">
        {' '}
        —{' '}
        {official ? (
          <>
            look on the{' '}
            <a href={official} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
              official site
              <span className="sr-only"> (opens a new tab)</span>
            </a>
            .
          </>
        ) : (
          'no official site is recorded either.'
        )}
      </span>
    </p>
  )
}

export function LinksSection({ d, v }: { d: ResortDetail; v: PageView }) {
  const r = d.summary
  const byKey = new Map(d.links.map((l) => [l.key, l]))
  const official = byKey.get('official')?.url ?? null
  const more = d.links.filter((l) => l.key.startsWith('more-'))
  const osm = byKey.get('openSkiMap')?.url ?? openSkiMapUrl(r.lat, r.lon, 13)
  const checked = d.links.filter((l) => l.check)
  const lastChecked = checked.map((l) => l.check!.checkedAt).sort().reverse()[0] ?? null
  const counts = d.links.reduce<Record<LinkState, number>>((acc, l) => ({ ...acc, [linkState(l.check)]: (acc[linkState(l.check)] ?? 0) + 1 }), { ok: 0, broken: 0, 'check-failed': 0, unknown: 0, unchecked: 0 })

  return (
    <ResortSection
      id="links"
      index={7}
      title="Maps & links"
      meta={dotJoin(`${d.links.length} links`, lastChecked ? `checked ${shortDate(lastChecked.slice(0, 10))}` : 'not checked yet')}
      headline="Official pages, one tap away."
      lead="Official pages open in a new tab. Piste doesn’t embed pages that refuse framing and never draws trail geometry from a raster trail map."
    >
      <div className="flex flex-col gap-7">
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2 tnum" aria-label="Link check summary">
          {(['ok', 'check-failed', 'broken', 'unknown', 'unchecked'] as const)
            .filter((s) => counts[s])
            .map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-full', STATE_DOT[s])} />
                {counts[s]} {LINK_STATE_LABEL[s].toLowerCase()}
              </span>
            ))}
          {counts['check-failed'] ? <span className="text-ink-3">“Check failed” means the site or network refused the automated check — the link may still work.</span> : null}
        </p>
        {GROUPS.map((g) => {
          const tiles = g.items.flatMap((item) => {
            if (item.key === 'openSkiMap') return osm ? [<Tile key={item.key} item={item} link={byKey.get('openSkiMap') ?? null} url={osm} now={v.now} built={!byKey.get('openSkiMap')} />] : []
            const l = byKey.get(item.key)
            return l ? [<Tile key={item.key} item={item} link={l} url={l.url} now={v.now} />] : []
          })
          if (!tiles.length) return null
          return (
            <div key={g.title}>
              <p className="eyebrow mb-2">{g.title}</p>
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{tiles}</ul>
            </div>
          )
        })}
        <NotRecorded items={GROUPS.flatMap((g) => g.items.filter((i) => i.expected && i.key !== 'openSkiMap' && !byKey.get(i.key)))} official={official} />
        {more.length ? (
          <div>
            <p className="eyebrow mb-2">More useful pages ({more.length})</p>
            <details className="glass group rounded-[20px]" open={more.length <= 8}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13.5px] font-medium text-teal select-none hover:underline [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show all {more.length} links</span>
                <span className="hidden group-open:inline">Hide</span>
              </summary>
              <ul className="grid gap-x-6 border-t border-divider px-4 py-2 md:grid-cols-2">
                {more.map((l) => {
                  const st = linkState(l.check)
                  return (
                    <li key={l.key} className="flex min-w-0 items-start gap-2 border-b border-divider py-2 last:border-b-0 md:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
                      <span aria-hidden title={LINK_STATE_LABEL[st]} className={cn('mt-[7px] size-2 shrink-0 rounded-full', STATE_DOT[st])} />
                      <span className="min-w-0">
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[13.5px] font-medium text-ink hover:text-teal hover:underline">
                          {l.label}
                          <span className="sr-only"> — {LINK_STATE_LABEL[st]}, opens a new tab</span>
                        </a>
                        <span className="block truncate text-[12px] text-ink-3">{hostOf(l.url)}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </details>
          </div>
        ) : null}
        <Coverage d={d} v={v} />
      </div>
    </ResortSection>
  )
}

// ---------------------------------------------------------------------------
// Sources & data coverage

function Coverage({ d, v }: { d: ResortDetail; v: PageView }) {
  const r = d.summary
  const research = d.research
  const referenceOnly = research?.method === 'reference-only'
  const confirm = d.sources.filter((s) => s.confirmAtSource)
  return (
    <section id="sources" aria-labelledby="coverage-title" className="scroll-mt-[124px] rounded-[12px] border border-divider bg-surface-2 p-5 md:scroll-mt-[84px] md:p-6">
      <SubHead
        id="coverage-title"
        aside={
          <Src
            title={`Sources for ${r.shortName}`}
            items={d.sources.map((s) => ({
              label: s.topic,
              value: s.verificationLabel,
              prov: { kind: s.kind, provider: s.provider, sourceUrl: s.url, fetchedAt: s.checkedAt, verification: s.verification },
            }))}
          />
        }
      >
        Sources &amp; data coverage
      </SubHead>
      {referenceOnly ? (
        <p className="mb-4 rounded-[10px] border border-caution/40 bg-caution-bg px-3 py-2 text-[13.5px] text-ink">
          <strong className="font-semibold">Reference-only record.</strong> The catalog facts here are Piste reference data, not web-verified in this build — confirm everything at the
          official source.
        </p>
      ) : null}
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2 text-[14px] font-semibold text-ink">What’s missing or uncertain</p>
          {r.dataGaps.length ? (
            <ul className="flex flex-col gap-1.5 text-[13.5px] text-ink-2">
              {r.dataGaps.map((g) => (
                <li key={g} className="flex gap-2">
                  <span aria-hidden className="mt-[8px] size-1.5 shrink-0 rounded-full bg-caution" />
                  {g}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-ink-2">No known gaps for this date.</p>
          )}
        </div>
        <div className="min-w-0">
          {research ? (
            <p className="text-[12.5px] text-ink-3 lg:mt-7">
              Catalog: {research.method === 'web-search' ? 'researched from web-search summaries' : research.method === 'reference-only' ? 'reference data' : research.method} on{' '}
              {shortDate(research.date)}. {research.confidenceNotes}
            </p>
          ) : null}
          {r.corrections.length ? (
            <div className="mt-4">
              <p className="mb-1 text-[13px] font-semibold text-ink">Your corrections</p>
              <ul className="flex flex-col gap-1 text-[12.5px] text-ink-2">
                {r.corrections.map((c) => (
                  <li key={`${c.field}-${c.at}`}>
                    <span className="font-medium text-ink">{c.field}</span> {c.applied ? 'applied' : `not applied (${c.reason})`}
                    {c.note ? ` — ${c.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      {/* Research detail stays one click away instead of adding a screen of text to every resort. */}
      <div className="mt-5 flex flex-col divide-y divide-divider border-y border-divider">
        {research?.openQuestions.length ? (
          <Disclosure variant="row" summary={`Open research questions (${research.openQuestions.length})`}>
            <ol className="flex list-decimal flex-col gap-1.5 pb-3 pl-5 text-[13.5px] text-ink-2 marker:text-ink-3 marker:tnum">
              {research.openQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </Disclosure>
        ) : (
          <p className="py-2.5 text-[13.5px] text-ink-2">Open research questions: none recorded.</p>
        )}
        {research?.conflicts.length ? (
          <Disclosure variant="row" summary={`Conflicting sources (${research.conflicts.length})`}>
            <ul className="flex flex-col gap-1.5 pb-3 text-[12.5px] text-ink-2">
              {research.conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
        <Disclosure variant="row" summary={`All sources on file (${d.sources.length})${confirm.length ? ` · ${confirm.length} to confirm at source` : ''}`}>
          <div className="relative -mx-1 overflow-x-auto px-1 pb-3">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <caption className="sr-only">Every source behind the facts on this page</caption>
              <thead>
                <tr className="border-b border-divider text-ink-3">
                  <th scope="col" className="py-1.5 pr-2 font-medium">
                    Fact
                  </th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">
                    Kind
                  </th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">
                    Verification
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.sources.map((s, i) => (
                  <tr key={`${s.topic}-${i}`} className="border-b border-divider align-top last:border-b-0">
                    <td className="py-1.5 pr-2 text-ink">{s.topic}</td>
                    <td className="py-1.5 pr-2">
                      <KindTag kind={s.kind} />
                    </td>
                    <td className={cn('py-1.5 pr-2', s.confirmAtSource ? 'font-medium text-caution' : 'text-ink-2')}>{s.verificationLabel}</td>
                    <td className="py-1.5">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all text-teal hover:underline">
                          {hostOf(s.url) ?? s.url}
                        </a>
                      ) : (
                        <span className="text-ink-3">{s.provider ?? 'No link'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      </div>
      {v.demo ? <p className="mt-3 text-[12.5px] text-demo">Demo mode: operations, reports, weather and scores here are simulated.</p> : null}
    </section>
  )
}
