/**
 * 02 Getting there — drive vs fly for the trip's main resort. Drive: curated estimate with the explicit winter
 * buffer and a directions link. Fly: door-to-door from home through the chosen origin airport (ITH default; SYR,
 * ELM, ROC, BUF alternatives), airport buffer, your itinerary, arrival buffer and the airport → resort transfer —
 * every leg labelled estimate / assumption / your itinerary / unknown. Then flights (manual itinerary + quotes),
 * the optional offers connector, and arrival transfers from the catalog.
 */
import { ArrowUpRight, Car, Plane, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Missing } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { TripPage, TripResortInfo } from '@/lib/data/trip-plan'
import type { TripItemRow } from '@/lib/db/rows'
import { directionsLink, flightSearchLinks } from '@/lib/providers/links/builders'
import { formatDistance } from '@/lib/domain/units'
import { ConfirmTag, EmptySlot, SubHead, TripSection } from './bits'
import { TRANSFER_LABEL, dayLabel, detailNumber, detailString, duration, plural } from './format'
import { DEFAULT_AIRPORT_BUFFER_MIN, DEFAULT_ARRIVAL_BUFFER_MIN, doorToDoor, itineraryTiming, type DoorLeg, type SegmentLike } from './model'
import { AddItemButton, QuickAdd } from './add-buttons'
import { ItemRow } from './item-row'
import { OriginAirports, type OriginRow } from './origin-airports'
import { FlightOffers } from './flight-offers'

const BASIS_TAG: Record<DoorLeg['basis'], { text: string; cls: string }> = {
  estimate: { text: 'Estimate', cls: 'text-copper' },
  assumption: { text: 'Assumption', cls: 'text-ink-2' },
  itinerary: { text: 'Your itinerary', cls: 'text-teal' },
  unknown: { text: 'Unknown', cls: 'text-ink-3 italic' },
}

/** The resort with the most planned ski days (ties: first in the trip). */
export function mainResort(page: TripPage): TripResortInfo | null {
  const counts = new Map<string, number>()
  for (const d of page.detail.resortDays) counts.set(d.resortId, (counts.get(d.resortId) ?? 0) + 1)
  const ranked = page.resorts.filter((r) => counts.has(r.id)).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
  return ranked[0] ?? page.resorts[0] ?? null
}

function segmentsOf(item: TripItemRow | undefined): SegmentLike[] {
  const raw = item?.details?.segments
  return Array.isArray(raw) ? (raw as SegmentLike[]) : []
}

export function TravelSection({ page, index }: { page: TripPage; index: number }) {
  const main = mainResort(page)
  const pct = page.travelPrefs.winterBufferPct
  const home = page.home
  const flights = page.detail.items.filter((i) => i.type === 'flight')
  const flight = flights[0]
  const origin = detailString(flight?.details, 'origin') ?? page.trip.originAirport ?? 'ITH'
  const dest = flight?.refId ?? main?.airports[0]?.iata ?? null
  const destAirport = main?.airports.find((a) => a.iata === dest) ?? null
  const zones = Object.fromEntries(page.airports.filter((a) => a.timezone).map((a) => [a.iata, a.timezone!]))
  const timing = flight ? itineraryTiming(segmentsOf(flight), zones) : null
  const originOpt = page.detail.originAirports.find((a) => a.iata === origin)
  const d2d = main
    ? doorToDoor({
        originIata: origin,
        homeName: home.name,
        driveToAirport: originOpt?.driveFromHome?.minutes ?? null,
        airportBuffer: detailNumber(flight?.details, 'airportBufferMin') ?? DEFAULT_AIRPORT_BUFFER_MIN,
        flightMinutes: timing?.totalMinutes ?? null,
        arrivalBuffer: detailNumber(flight?.details, 'arrivalBufferMin') ?? DEFAULT_ARRIVAL_BUFFER_MIN,
        destinationIata: dest,
        resortName: main.shortName,
        transferMinutes: destAirport?.minutes ?? null,
        winterPct: pct,
      })
    : null
  const canFly = !!main && main.airports.length > 0
  const drives = page.detail.items.filter((i) => i.type === 'drive')
  const transfers = page.detail.items.filter((i) => i.type === 'transfer')
  const parking = page.detail.items.filter((i) => i.type === 'parking')
  const selectedOrigin = page.trip.originAirport ?? 'ITH'
  const originRows: OriginRow[] = page.detail.originAirports
    .map((a) => ({
      iata: a.iata,
      name: a.name,
      city: a.city,
      driveMinutes: a.driveFromHome?.minutes ?? null,
      winterMinutes: a.driveFromHome?.minutes != null ? Math.round(a.driveFromHome.minutes * (1 + pct / 100)) : null,
      km: a.driveFromHome?.km ?? null,
      basis: a.driveFromHome?.basis ?? null,
      parking: a.parking,
      officialUrl: a.officialUrl,
      prov: a.prov,
      driveProv: a.driveFromHome?.prov ?? null,
      routesKnown: a.airlines.length > 0,
    }))
    .sort((a, b) => (a.iata === 'ITH' ? -1 : b.iata === 'ITH' ? 1 : (a.driveMinutes ?? 1e6) - (b.driveMinutes ?? 1e6)))
  const ret = page.trip.endDate > page.trip.startDate ? page.trip.endDate : null

  return (
    <TripSection
      id="travel"
      index={index}
      title="Getting there"
      meta={main ? `From ${home.name} to ${main.name} · ${pct}% winter buffer on ground legs (your setting)` : `From ${home.name}`}
      actions={
        <>
          <AddItemButton type="flight" defaults={{ refId: dest ?? undefined, date: page.trip.startDate, endDate: ret ?? undefined, details: { origin: selectedOrigin } }}>
            Flight
          </AddItemButton>
          <AddItemButton type="drive" defaults={{ refId: main?.id, date: page.trip.startDate, title: main ? `Drive from ${home.name} to ${main.shortName}` : undefined, details: main?.drive.minutes != null ? { minutes: main.drive.minutes, km: main.drive.km } : undefined }}>
            Drive
          </AddItemButton>
        </>
      }
    >
      {!main ? (
        <EmptySlot title="Add a ski day to compare how to get there" body="Drive and flight options come from the resort you ski — add one in the itinerary above." />
      ) : (
        <div className="flex flex-col gap-10">
          <div className={cn('grid items-start gap-4', main.drive.minutes === null && canFly ? 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : 'lg:grid-cols-2')}>
            <div className={cn('min-w-0', main.drive.minutes === null && canFly && 'order-2 lg:order-1')}>
              <DriveCard main={main} home={home} pct={pct} units={page.units} />
            </div>
            <div className={cn('min-w-0', main.drive.minutes === null && canFly && 'order-1 lg:order-2')}>
              <FlyCard main={main} canFly={canFly} d2d={d2d} origin={origin} dest={dest} timing={timing} hasFlight={!!flight} />
            </div>
          </div>

          {canFly ? (
            <section aria-labelledby="origins-title">
              <SubHead id="origins-title" aside="Your list in Settings · ITH is the default">
                Origin airports
              </SubHead>
              <OriginAirports rows={originRows} selected={selectedOrigin} dest={dest} depart={page.trip.startDate} ret={ret} winterPct={pct} homeName={home.name} />
            </section>
          ) : null}

          {canFly || flights.length ? (
          <section aria-labelledby="flights-title">
            <SubHead id="flights-title" aside={flights.length ? plural(flights.length, 'flight') : undefined}>
              Flights
            </SubHead>
            <div className="flex flex-col gap-3">
              {flights.map((f) => (
                <FlightCard key={f.id} item={f} zones={zones} />
              ))}
              {!flights.length ? (
                <EmptySlot
                  title={canFly ? 'No flight yet' : `${main.shortName} has no airport on file`}
                  body={canFly ? 'Search with the links above, then enter the itinerary and the price you were quoted. Nothing here is a live fare.' : 'Drive, or add a flight you have planned yourself.'}
                  action={
                    <AddItemButton type="flight" defaults={{ refId: dest ?? undefined, date: page.trip.startDate, endDate: ret ?? undefined, details: { origin: selectedOrigin } }}>
                      Enter a flight
                    </AddItemButton>
                  }
                />
              ) : null}
              {canFly ? <FlightOffers state={page.flights.state} testMode={page.flights.testMode} origin={selectedOrigin} dest={dest} depart={page.trip.startDate} ret={ret} adults={Math.min(9, page.trip.partySize)} /> : null}
            </div>
          </section>
          ) : null}

          <section aria-labelledby="arrive-title">
            <SubHead id="arrive-title" aside={destAirport ? `${destAirport.iata} → ${main.shortName}` : undefined}>
              {canFly ? 'Arrival transfer, drives and parking' : 'Drives, transfers and parking'}
            </SubHead>
            <div className="flex min-w-0 flex-col gap-3">
              {[...drives, ...transfers, ...parking].length ? (
                <ul className="flex flex-col rounded-[20px] border border-divider bg-surface/70 p-1.5">
                  {[...drives, ...transfers, ...parking].map((i) => (
                    <li key={i.id}>
                      <ItemRow item={i} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-[20px] border border-dashed border-divider-strong px-4 py-3 text-[13.5px] text-ink-2">No transfer, drive or parking saved yet.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <AddItemButton type="transfer" defaults={{ refId: main.id, date: page.trip.startDate, endDate: ret ?? undefined }}>
                  Transfer
                </AddItemButton>
                <AddItemButton type="parking" defaults={{ date: page.trip.startDate, endDate: ret ?? undefined, details: canFly ? { where: `${selectedOrigin} airport` } : undefined, refId: canFly ? undefined : main.id }}>
                  Parking
                </AddItemButton>
              </div>
              <CatalogTransfers main={main} savedTitles={new Set(transfers.map((t) => t.title))} startDate={page.trip.startDate} endDate={ret} />
            </div>
          </section>
        </div>
      )}
    </TripSection>
  )
}

function DriveCard({ main, home, pct, units }: { main: TripResortInfo; home: TripPage['home']; pct: number; units: TripPage['units'] }) {
  const dir = directionsLink({ lat: home.lat, lon: home.lon }, { lat: main.lat, lon: main.lon }, `Directions to ${main.shortName}`)
  const d = main.drive
  return (
    <section aria-labelledby="drive-card" className="flex flex-col rounded-[20px] border border-divider bg-surface/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 id="drive-card" className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Car aria-hidden className="size-4 text-ink-2" /> Drive
        </h3>
        {d.prov ? <SourceDrawer title="Drive from home" items={[{ label: `${home.name} → ${main.name}`, value: d.basis ?? undefined, prov: d.prov }]} /> : null}
      </div>
      {d.minutes !== null ? (
        <>
          <p className="mt-3 font-light tracking-[-0.03em] text-[40px] leading-none text-ink tnum">{duration(d.winterMinutes)}</p>
          <p className="mt-1 text-[13px] text-ink-2 tnum">
            one way with the {pct}% winter buffer · {duration(d.minutes)} without{d.km !== null ? ` · ${formatDistance(d.km, units)}` : ''}
          </p>
          <p className={cn('mt-3 inline-flex w-fit items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12.5px] font-medium', d.isEstimate ? 'bg-caution-bg text-caution' : 'bg-positive-bg text-positive')}>
            {d.isEstimate ? 'Curated estimate — not live routing' : 'Sourced routing'}
          </p>
          {d.basis ? <p className="mt-2 line-clamp-3 text-[12.5px] text-ink-3">{d.basis}</p> : null}
        </>
      ) : (
        <div className="mt-3">
          <p className="text-[15px] font-semibold text-ink">No drive estimate on file</p>
          <p className="mt-1 text-[13.5px] text-ink-2">{main.airports.length ? `${main.shortName} is a fly-in trip from ${home.name}.` : 'No travel information is recorded for this resort.'} Straight-line distance is never shown as driving time.</p>
        </div>
      )}
      {dir && d.minutes !== null ? (
        <a href={dir.url} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex h-10 w-fit items-center gap-1.5 pt-4 text-[13.5px] font-medium text-teal hover:underline">
          {dir.label} <ArrowUpRight aria-hidden className="size-4" />
          <span className="sr-only"> (Google Maps, opens in a new tab — its time is Google’s estimate)</span>
        </a>
      ) : null}
    </section>
  )
}

function FlyCard({ main, canFly, d2d, origin, dest, timing, hasFlight }: { main: TripResortInfo; canFly: boolean; d2d: ReturnType<typeof doorToDoor> | null; origin: string; dest: string | null; timing: ReturnType<typeof itineraryTiming> | null; hasFlight: boolean }) {
  return (
    <section aria-labelledby="fly-card" className="rounded-[20px] border border-divider bg-surface/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 id="fly-card" className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Plane aria-hidden className="size-4 text-ink-2" /> Fly {canFly ? `${origin} → ${dest ?? '—'}` : ''}
        </h3>
        {canFly ? <span className="text-[12.5px] text-ink-3">door to door, one way</span> : null}
      </div>
      {!canFly || !d2d ? (
        <div className="mt-3">
          <p className="text-[15px] font-semibold text-ink">No airport on file for {main.shortName}</p>
          <p className="mt-1 text-[13.5px] text-ink-2">Flying is not a practical option recorded for this resort.</p>
        </div>
      ) : (
        <>
          {d2d.total !== null ? (
            <p className="mt-3 font-light tracking-[-0.03em] text-[40px] leading-none text-ink tnum">{duration(d2d.total)}</p>
          ) : (
            <div className="mt-3">
              <p className="font-light tracking-[-0.03em] text-[32px] leading-none text-ink-2">Unknown</p>
              <p className="mt-1 text-[13px] text-ink-2 tnum">
                at least {duration(d2d.known)} before the flight itself — {hasFlight ? 'add your flight times' : 'enter a flight'} to complete it
              </p>
            </div>
          )}
          <ol className="mt-4 flex flex-col divide-y divide-divider border-t border-divider">
            {d2d.legs.map((l) => (
              <li key={l.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] text-ink">{l.label}</p>
                  <p className="text-[12px] text-ink-3">
                    <span className={cn('font-medium', BASIS_TAG[l.basis].cls)}>{BASIS_TAG[l.basis].text}</span> · {l.note}
                  </p>
                </div>
                <p className="text-right text-[14px] font-semibold text-ink tnum">{l.minutes !== null ? duration(l.minutes) : <Missing />}</p>
              </li>
            ))}
          </ol>
          {timing?.issues.length ? (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-caution">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" /> {timing.issues[0]}
            </p>
          ) : null}
          <p className="mt-2 text-[12px] text-ink-3">Winter buffers are planning assumptions, not predictions of delays or road closures.</p>
        </>
      )}
    </section>
  )
}

function FlightCard({ item, zones }: { item: TripItemRow; zones: Record<string, string> }) {
  const segs = segmentsOf(item)
  const timing = itineraryTiming(segs, zones)
  const ticketing = detailString(item.details, 'ticketing')
  const skiBag = detailString(item.details, 'skiBag')
  const fare = detailString(item.details, 'fareNotes')
  const origin = detailString(item.details, 'origin')
  const links = origin && item.refId && item.date ? flightSearchLinks({ from: origin, to: item.refId, depart: item.date, return: item.endDate }) : []
  return (
    <article className="rounded-[20px] border border-divider bg-surface/70 p-1.5">
      <ItemRow item={item} hideFacts />
      <div className="mx-2 mb-2 flex flex-col gap-3 border-t border-divider px-1 pt-3 md:mx-3">
        {segs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[13px]">
              <caption className="sr-only">Itinerary you entered for {item.title}</caption>
              <thead>
                <tr className="text-left text-[12px] text-ink-3">
                  <th scope="col" className="py-1 pr-3 font-medium">Flight</th>
                  <th scope="col" className="py-1 pr-3 font-medium">From</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Departs (local)</th>
                  <th scope="col" className="py-1 pr-3 font-medium">To</th>
                  <th scope="col" className="py-1 font-medium">Arrives (local)</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {segs.map((s, k) => (
                  <tr key={k} className="border-t border-divider">
                    <td className="py-1.5 pr-3 font-medium text-ink">{[s.carrier, s.flightNumber].filter(Boolean).join(' ') || <Missing />}</td>
                    <td className="py-1.5 pr-3">{s.from ?? '—'}</td>
                    <td className="py-1.5 pr-3">{s.departLocal ? `${dayLabel(s.departLocal.slice(0, 10))} ${s.departLocal.slice(11, 16)}` : <Missing />}</td>
                    <td className="py-1.5 pr-3">{s.to ?? '—'}</td>
                    <td className="py-1.5">{s.arriveLocal ? `${dayLabel(s.arriveLocal.slice(0, 10))} ${s.arriveLocal.slice(11, 16)}` : <Missing />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">No itinerary entered — add your flight times to complete the door-to-door estimate.</p>
        )}
        <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          <Row label="Journey time">{timing.totalMinutes !== null ? <span className="tnum">{duration(timing.totalMinutes)}</span> : <Missing />}</Row>
          <Row label="Connections">
            {segs.length ? (
              timing.connections ? (
                <span className="tnum">
                  {timing.layovers.map((l) => `${l.at}${l.minutes !== null ? ` ${duration(l.minutes)}` : ''}${l.overnight ? ' (overnight)' : ''}`).join(', ')}
                </span>
              ) : (
                'Nonstop'
              )
            ) : (
              <Missing />
            )}
          </Row>
          <Row label="Tickets">{ticketing === 'single' ? 'One ticket (connections protected)' : ticketing === 'separate' ? <span className="font-medium text-caution">Separate bookings — not protected</span> : <Missing label="Not set" />}</Row>
          <Row label="Ski bag">{skiBag ?? <Missing label="Not noted" />}</Row>
          {fare ? <Row label="Fare rules">{fare}</Row> : null}
        </dl>
        {timing.issues.length ? <p className="text-[12.5px] text-caution">{timing.issues.join(' ')}</p> : null}
        {links.length ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-teal hover:underline" title={l.note}>
                {l.label} <ArrowUpRight aria-hidden className="size-3.5" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1 sm:border-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  )
}

function CatalogTransfers({ main, savedTitles, startDate, endDate }: { main: TripResortInfo; savedTitles: Set<string>; startDate: string; endDate: string | null }) {
  const airport = main.airports[0] ?? null
  return (
    <div className="mt-2 min-w-0 rounded-[20px] border border-divider bg-ink/[0.03] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[14px] font-semibold text-ink">Options on file for {main.shortName}</p>
        {airport ? (
          <p className="flex items-center gap-1 text-[13px] text-ink-2 tnum">
            {airport.iata} → {main.shortName}: {airport.minutes !== null ? `${duration(airport.minutes)} (estimate)` : <Missing label="time unknown" />}
            {airport.prov ? <SourceDrawer title={`${airport.iata} → ${main.shortName}`} items={[{ label: `${airport.iata} → ${main.name}`, value: airport.basis ?? undefined, prov: airport.prov }]} /> : null}
          </p>
        ) : null}
      </div>
      {main.transfers.length ? (
        <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {main.transfers.map((t, k) => {
            const title = t.name ?? `${TRANSFER_LABEL[t.type ?? ''] ?? 'Transfer'} to ${main.shortName}`
            return (
              <li key={k} className="flex min-w-0 flex-col gap-2 rounded-[16px] border border-divider bg-surface/70 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{t.type ? (TRANSFER_LABEL[t.type] ?? t.type) : 'Transfer'}</p>
                  <p className="mt-0.5 text-[14px] leading-snug font-medium text-ink">{title}</p>
                  {t.notes ? <p className="mt-1 line-clamp-3 text-[12.5px] text-ink-2">{t.notes}</p> : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <ConfirmTag />
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-medium text-teal hover:underline">
                        Official site<span className="sr-only"> for {title} (opens in a new tab)</span>
                      </a>
                    ) : null}
                    {t.prov ? <SourceDrawer title={title} items={[{ label: title, value: t.notes ?? undefined, prov: t.prov }]} /> : null}
                  </span>
                  <QuickAdd
                    label="Save"
                    saved={savedTitles.has(title)}
                    input={{ type: 'transfer', refId: main.id, title, date: startDate, endDate, status: 'idea', details: { transferType: (t.type ?? null) as never, url: t.url, note: 'From the catalog — no fare or schedule on file; confirm with the operator.' } }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3 italic">No transfers on file.</p>
      )}
    </div>
  )
}
