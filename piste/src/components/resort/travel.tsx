/**
 * 04 Getting there — drive from home (curated estimate vs sourced routing, with the explicit winter buffer and a
 * Google Maps directions link), practical vs closest airports, prefilled flight SEARCH links from ITH and the
 * alternatives (links, never fares or schedules), transfers, a small map with straight dashed lines that are
 * labelled as not routes (plus a list alternative), and winter-road / safety links.
 */
import Link from 'next/link'
import { ArrowUpRight, Car, CloudSnow, ExternalLink, Mountain, Plane, PlaneTakeoff, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Disclosure } from '@/components/ui/disclosure'
import { KindTag, Missing } from '@/components/ui/provenance'
import type { MapLine, MapMarker } from '@/components/map'
import type { ResortDetail } from '@/lib/data/resort-detail'
import type { AirportPlace, ResortPageExtras } from '@/lib/data/resort-page'
import { addDays } from '@/lib/domain/time'
import { directionsLink, flightSearchLinks, nwsForecastPageUrl } from '@/lib/providers/links/builders'
import { ConfirmTag, ResortSection, Src, SubHead } from './section'
import { confirmText, dayLabel, dotJoin, hostOf, needsCheck, src, straightLineKm, TRANSFER_TYPE_LABEL, units, type PageView } from './format'
import { TravelMap } from './travel-map'

const ROLE_TEXT: Record<string, string> = {
  both: 'Closest and most practical',
  practical: 'Most practical',
  closest: 'Closest — not the most practical',
}

export function TravelSection({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const t = d.travel
  const fly = t.airports.length > 0
  return (
    <ResortSection
      id="getting-there"
      index={4}
      title="Getting there"
      meta={`From ${x.home.name}`}
      lead={t.verdict.note ? `${t.verdict.note}.` : undefined}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <DriveBlock d={d} x={x} v={v} />
          {fly ? <AirportsBlock d={d} x={x} v={v} /> : null}
          {fly ? <FlightSearch d={d} x={x} v={v} /> : null}
          <TransfersBlock d={d} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <MapBlock d={d} x={x} v={v} />
          <WinterBlock d={d} />
        </div>
      </div>
    </ResortSection>
  )
}

function DriveBlock({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const t = d.travel
  const u = units(v.units)
  const dir = directionsLink({ lat: x.home.lat, lon: x.home.lon }, { lat: d.summary.lat, lon: d.summary.lon }, `Directions from ${x.home.name}`)
  return (
    <section aria-labelledby="drive-title" className="min-w-0">
      <SubHead id="drive-title" aside={t.prov ? <Src title="Drive from home" items={[src('Drive from home', t.prov, t.basis)]} /> : null}>
        Drive from {x.home.name}
      </SubHead>
      <div className="rounded-[12px] border border-divider bg-surface p-5">
        {t.driveMinutes !== null ? (
          <>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <p className="font-display text-[44px] leading-none text-ink tnum">{u.duration(t.driveMinutes)}</p>
                <p className="mt-1 text-[12.5px] text-ink-3">one way{t.km !== null ? ` · ${u.dist(t.km)}` : ''}</p>
              </div>
              {t.winterMinutes !== null ? (
                <div className="pb-1">
                  <p className="text-[20px] font-semibold text-ink tnum">{u.duration(t.winterMinutes)}</p>
                  <p className="text-[12.5px] text-ink-3">with a {t.winterBufferPct}% winter buffer (your planning assumption)</p>
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className={cn('inline-flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] font-medium', t.isEstimate ? 'bg-caution-bg text-caution' : 'bg-positive-bg text-positive')}>
                <Car aria-hidden className="size-3.5" />
                {t.isEstimate ? 'Curated estimate — not live routing' : 'Sourced routing'}
              </p>
              {needsCheck(t.prov) ? <ConfirmTag text={confirmText(t.prov)} /> : null}
            </div>
            {t.basis ? <p className="mt-2 max-w-[68ch] text-[13px] text-ink-2">{t.basis}</p> : null}
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-[15px] font-semibold text-ink">No drive estimate from {x.home.name}</p>
            <p className="text-[13.5px] text-ink-2">
              {t.airports.length ? 'A fly-in destination: compare airports and search flights below. Door-to-door time is not estimated.' : 'No travel information is recorded for this resort.'}
            </p>
          </div>
        )}
        {dir && t.driveMinutes !== null ? (
          <a
            href={dir.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex h-10 w-fit items-center gap-2 rounded-md border border-divider-strong bg-surface px-3.5 text-[14px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal"
          >
            {dir.label} <ArrowUpRight aria-hidden className="size-4" />
          </a>
        ) : dir ? (
          <a href={dir.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline">
            Driving the whole way? {dir.label} <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : null}
        <p className="mt-2 text-[12px] text-ink-3">Google Maps opens with its own live estimate — that is Google’s number, not Piste data.</p>
      </div>
    </section>
  )
}

function AirportsBlock({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const u = units(v.units)
  const coords = new Map(x.destinationAirports.map((a) => [a.iata, a]))
  return (
    <section aria-labelledby="airports-title" className="min-w-0">
      <SubHead id="airports-title">Airports</SubHead>
      <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
        {d.travel.airports.map((a) => (
          <li key={a.iata} className="grid grid-cols-[56px_minmax(0,1fr)_auto] gap-x-3 px-4 py-3.5">
            <span className="font-display text-[26px] leading-none text-ink">{a.iata}</span>
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium text-ink">{a.name ?? a.iata}</p>
              <p className={cn('text-[12.5px] font-medium', a.role === 'closest' ? 'text-caution' : 'text-teal')}>{ROLE_TEXT[a.role ?? ''] ?? 'Airport'}</p>
              <p className="mt-1 text-[13px] text-ink-2 tnum">
                {a.minutes !== null || a.km !== null ? (
                  <>
                    Transfer {dotJoin(u.duration(a.minutes), u.dist(a.km))} <span className="text-ink-3">· estimate</span>
                  </>
                ) : (
                  <Missing label="Transfer time unknown" />
                )}
              </p>
              {a.basis ? <p className="mt-1 text-[12.5px] text-ink-3">{a.basis}</p> : null}
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {(() => {
                  const at = coords.get(a.iata)
                  const link = at ? directionsLink({ lat: at.lat, lon: at.lon }, { lat: d.summary.lat, lon: d.summary.lon }, `Directions from ${a.iata}`) : null
                  return link ? (
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-teal hover:underline">
                      {link.label} <ArrowUpRight aria-hidden className="size-3" />
                    </a>
                  ) : null
                })()}
                {a.officialUrl ? (
                  <a href={a.officialUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-teal hover:underline">
                    {hostOf(a.officialUrl)} <ExternalLink aria-hidden className="size-3" />
                  </a>
                ) : null}
              </div>
            </div>
            <Src title={`${a.iata} transfer`} items={[src(`${a.iata} → resort`, a.prov, a.basis)]} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Origins listed before "N more origin airports" (the default origin and the next alternative). */
const ORIGINS_SHOWN = 2

function FlightSearch({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const dests = d.travel.airports.filter((a) => a.role !== 'closest').length ? d.travel.airports.filter((a) => a.role !== 'closest') : d.travel.airports
  // Fly in the day before the planning date, back two days after it (never in the past). Editable on the search site.
  const depart = addDays(v.date, -1) >= v.homeToday ? addDays(v.date, -1) : v.homeToday
  const ret = addDays(depart, 3)
  const origins = x.originAirports
  const fold = origins.length > ORIGINS_SHOWN + 1
  return (
    <section aria-labelledby="flights-title" className="min-w-0">
      <SubHead id="flights-title" aside={`Out ${dayLabel(depart)} · back ${dayLabel(ret)}`}>
        Search flights
      </SubHead>
      <p className="-mt-2 mb-3 text-[12.5px] text-ink-3">
        Prefilled search links from {origins[0]?.iata ?? 'ITH'} and the alternatives — not fares, schedules or availability. Change dates on the search site.
      </p>
      <FlightTable origins={origins.slice(0, fold ? ORIGINS_SHOWN : origins.length)} first={0} dests={dests} depart={depart} ret={ret} v={v} />
      {fold ? (
        <Disclosure variant="row" className="mt-1 border-t border-divider" summary={`${origins.length - ORIGINS_SHOWN} more origin airports · ${origins.slice(ORIGINS_SHOWN).map((o) => o.iata).join(', ')}`}>
          <FlightTable origins={origins.slice(ORIGINS_SHOWN)} first={ORIGINS_SHOWN} dests={dests} depart={depart} ret={ret} v={v} />
        </Disclosure>
      ) : null}
      {origins[0]?.notes ? (
        <p className="mt-2 text-[12.5px] text-ink-3">
          {origins[0].iata}: {origins[0].notes.replace(/^Default flight origin\.\s*/, '')}
        </p>
      ) : null}
      <p className="mt-1 text-[12.5px] text-ink-3">
        Ski-bag fees, connections and door-to-door time are not estimated here — plan them on a{' '}
        <Link href="/trips" className="text-teal hover:underline">
          trip
        </Link>
        .
      </p>
    </section>
  )
}

function FlightTable({ origins, first, dests, depart, ret, v }: { origins: AirportPlace[]; first: number; dests: ResortDetail['travel']['airports']; depart: string; ret: string; v: PageView }) {
  const u = units(v.units)
  return (
    <div className="relative -mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[480px] text-left text-[13.5px]">
        <caption className="sr-only">Flight search links from each origin airport to each practical destination airport</caption>
        <thead>
          <tr className="border-b border-divider text-[12px] text-ink-3">
            <th scope="col" className="py-2 pr-3 font-medium">
              From
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Drive to airport
            </th>
            {dests.map((dst) => (
              <th key={dst.iata} scope="col" className="py-2 pr-3 font-medium">
                To {dst.iata}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {origins.map((o: AirportPlace, j) => {
            const i = first + j
            return (
            <tr key={o.iata} className="border-b border-divider align-top last:border-b-0">
              <th scope="row" className="py-2.5 pr-3 font-normal">
                <span className="flex items-center gap-2">
                  <PlaneTakeoff aria-hidden className={cn('size-4', i === 0 ? 'text-teal' : 'text-ink-3')} />
                  <span className="font-semibold text-ink">{o.iata}</span>
                  {i === 0 ? <span className="text-[11.5px] font-medium text-teal">default</span> : null}
                </span>
                <span className="block text-[12px] text-ink-3">{o.city ?? o.name}</span>
              </th>
              <td className="py-2.5 pr-3 text-ink-2 tnum">
                {o.driveFromHome?.minutes != null ? (
                  <>
                    {u.duration(o.driveFromHome.minutes)}
                    <span className="block text-[12px] text-ink-3">estimate{o.parking ? ` · ${o.parking}` : ' · parking unknown'}</span>
                  </>
                ) : (
                  <Missing />
                )}
              </td>
              {dests.map((dst) => {
                const links = flightSearchLinks({ from: o.iata, to: dst.iata, depart, return: ret })
                return (
                  <td key={dst.iata} className="py-2.5 pr-3">
                    {links.length ? (
                      <span className="flex flex-wrap gap-x-3 gap-y-1">
                        {links.map((l) => (
                          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-teal hover:underline" title={l.note}>
                            {l.label.replace('Search ', '')}
                            <ExternalLink aria-hidden className="size-3" />
                            <span className="sr-only">
                              {' '}
                              — search {o.iata} to {dst.iata}, opens a new tab
                            </span>
                          </a>
                        ))}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TransfersBlock({ d }: { d: ResortDetail }) {
  const list = d.travel.transfers
  if (!list.length) return null
  return (
    <section aria-labelledby="transfers-title" className="min-w-0">
      <SubHead id="transfers-title">Transfers and local transport</SubHead>
      <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
        {list.map((t, i) => (
          <li key={`${t.name}-${i}`} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-6 items-center rounded-sm bg-surface-3 px-2 text-[12px] font-medium text-ink-2">{TRANSFER_TYPE_LABEL[t.type ?? ''] ?? t.type ?? 'Transfer'}</span>
              <span className="text-[14.5px] font-medium text-ink">{t.name ?? 'Transfer option'}</span>
              <span className="ml-auto flex items-center gap-1">
                {t.prov ? <KindTag kind={t.prov.kind} compact /> : null}
                <Src title={t.name ?? 'Transfer'} items={[src(t.name ?? 'Transfer', t.prov)]} />
              </span>
            </div>
            {t.notes ? <p className="max-w-[72ch] text-[13px] text-ink-2">{t.notes}</p> : null}
            {t.url ? (
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-teal hover:underline">
                {hostOf(t.url)} <ExternalLink aria-hidden className="size-3" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function MapBlock({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const u = units(v.units)
  const r = d.summary
  const dests = x.destinationAirports
  const fly = d.travel.airports.length > 0
  const markers: MapMarker[] = [
    { id: 'resort', lat: r.lat, lon: r.lon, label: r.shortName, sublabel: 'resort', tone: 'default' },
    ...dests.map((a) => ({ id: `apt-${a.iata}`, lat: a.lat, lon: a.lon, label: a.iata, sublabel: a.name, tone: 'airport' as const })),
    { id: 'home', lat: x.home.lat, lon: x.home.lon, label: 'Home', sublabel: x.home.name, tone: 'home' },
  ]
  const lines: MapLine[] = fly
    ? dests.map((a) => ({ from: [a.lon, a.lat], to: [r.lon, r.lat], label: `${a.iata} to ${r.shortName}: straight line, not a route` }))
    : [{ from: [x.home.lon, x.home.lat], to: [r.lon, r.lat], label: `${x.home.name} to ${r.shortName}: straight line, not a route` }]
  const fitIds = fly ? ['resort', ...dests.map((a) => `apt-${a.iata}`)] : ['resort', 'home']
  const listed = [
    { key: 'resort', label: `${r.shortName} (resort)`, lat: r.lat, lon: r.lon, dist: null as number | null },
    ...dests.map((a) => ({ key: a.iata, label: `${a.iata} — ${a.name}`, lat: a.lat, lon: a.lon, dist: straightLineKm(a, r) })),
    { key: 'home', label: `Home — ${x.home.name}`, lat: x.home.lat, lon: x.home.lon, dist: straightLineKm(x.home, r) },
  ]
  return (
    <section aria-labelledby="map-title" className="min-w-0">
      <SubHead id="map-title" aside="Straight lines, not routes">
        Map
      </SubHead>
      <TravelMap markers={markers} lines={lines} fitIds={fitIds} label={`Map of ${r.shortName}${fly ? ', its airports' : ''} and home`} />
      <ul className="mt-3 flex flex-col gap-1 text-[12.5px] text-ink-2" aria-label="Map points (list alternative)">
        {listed.map((p) => (
          <li key={p.key} className="flex flex-wrap items-baseline gap-x-2">
            {p.key === 'resort' ? <Mountain aria-hidden className="size-3.5 translate-y-0.5 text-teal" /> : p.key === 'home' ? <Car aria-hidden className="size-3.5 translate-y-0.5 text-ink-3" /> : <Plane aria-hidden className="size-3.5 translate-y-0.5 text-info" />}
            <span className="font-medium text-ink">{p.label}</span>
            {p.dist !== null ? <span className="text-ink-3 tnum">{u.dist(p.dist)} in a straight line — not a driving distance</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function WinterBlock({ d }: { d: ResortDetail }) {
  const r = d.summary
  const road = d.links.find((l) => l.key === 'roadInfo')
  const aval = d.links.find((l) => l.key === 'avalanche')
  const nws = r.country === 'US' ? nwsForecastPageUrl(r.lat, r.lon) : null
  const items = [
    road ? { href: road.url, label: 'Road conditions and closures', note: hostOf(road.url) } : null,
    aval ? { href: aval.url, label: 'Avalanche information', note: hostOf(aval.url) } : null,
    nws ? { href: nws, label: 'NWS point forecast and hazards', note: 'forecast.weather.gov' } : null,
  ].filter((i): i is { href: string; label: string; note: string | null } => !!i)
  return (
    <section aria-labelledby="winter-title" className="min-w-0 rounded-[12px] border border-divider bg-surface-2 p-5">
      <SubHead id="winter-title">Winter roads and safety</SubHead>
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.href}>
              <a href={i.href} target="_blank" rel="noopener noreferrer" className="group inline-flex items-start gap-2 text-[14px] font-medium text-teal">
                <CloudSnow aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="group-hover:underline">{i.label}</span>
                  {i.note ? <span className="block text-[12px] font-normal text-ink-3">{i.note}</span> : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-3 italic">No road or avalanche links recorded.</p>
      )}
      <p className="mt-3 flex gap-2 text-[12.5px] text-ink-2">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-caution" />
        Chain and traction rules, canyon closures and avalanche control change daily — check the official sources. Piste never advises on backcountry travel or declares terrain safe.
      </p>
    </section>
  )
}
