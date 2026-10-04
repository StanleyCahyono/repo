import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import { getTripPage, isTripId } from '@/lib/data/trip-plan'
import { Notice } from '@/components/ui/states'
import { TripUiProvider, type TripUiData } from '@/components/trips/trip-ui'
import { TripHeader } from '@/components/trips/trip-header'
import { BudgetCard, GlanceCard } from '@/components/trips/glance'
import { RoutePanel, type RouteData } from '@/components/trips/route-panel'
import { DatesCard } from '@/components/trips/dates-card'
import { mainResort } from '@/components/trips/travel-section'
import { DEFAULT_AIRPORT_BUFFER_MIN, DEFAULT_ARRIVAL_BUFFER_MIN, doorToDoor, itineraryTiming, type SegmentLike } from '@/components/trips/model'
import { detailNumber, detailString } from '@/components/trips/format'
import { formatDistance } from '@/lib/domain/units'
import { formatLocalDate } from '@/lib/domain/time'
import type { SeasonTrack } from '@/lib/data/trip-seasons'
import { TripSectionNav } from '@/components/trips/section-nav'
import { TripSection } from '@/components/trips/bits'
import { Itinerary } from '@/components/trips/itinerary'
import { PassPicker } from '@/components/trips/pass-picker'
import { TravelSection } from '@/components/trips/travel-section'
import { StaySection } from '@/components/trips/stay-section'
import { LessonsSection } from '@/components/trips/lessons-section'
import { ExtrasSection } from '@/components/trips/extras-section'
import { BudgetSection } from '@/components/trips/budget-section'
import { Checklist } from '@/components/trips/checklist'
import { GearPacking } from '@/components/trips/gear-packing'
import { ownedGearCoverage } from '@/lib/data/gear'
import { PartyAndCompanions, TripNotes } from '@/components/trips/people'
import { FitList } from '@/components/trips/fit-list'
import { Rise } from '@/components/trips/rise'
import { plural } from '@/components/trips/format'
import { routeGeo } from './route-geo'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  if (!isTripId(id)) return { title: 'Trip' }
  const { db } = await getCtx()
  const [t] = await db.select({ name: s.trips.name }).from(s.trips).where(eq(s.trips.id, id))
  return { title: t?.name ?? 'Trip' }
}

export default async function TripDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const sp = await searchParams
  if (!isTripId(id)) notFound()
  const ctx = await getCtx()
  const pass = typeof sp.pass === 'string' ? sp.pass : null
  const [page, gear] = await Promise.all([getTripPage(ctx, id, { pass }), ownedGearCoverage(ctx.db)])
  if (!page) notFound()

  const { trip, detail } = page
  const onTrip = new Set(page.resorts.map((r) => r.id))
  const skiDays = new Set(detail.resortDays.map((d) => d.date)).size
  const flies = detail.items.some((i) => i.type === 'flight')
  const drives = detail.items.some((i) => i.type === 'drive')
  const lead = [
    `${plural(page.days.length, 'day')}${skiDays ? `, ${skiDays} on snow` : ''}`,
    `party of ${trip.partySize}`,
    flies ? `flying from ${trip.originAirport ?? 'ITH'}` : drives ? `driving from ${page.home.name}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const tripResorts = [...new Map(detail.resortDays.map((d) => [d.resortId, { id: d.resortId, name: d.name }])).values()]

  const ui: TripUiData = {
    tripId: trip.id,
    tripName: trip.name,
    status: trip.status,
    startDate: trip.startDate,
    endDate: trip.endDate,
    partySize: trip.partySize,
    currency: page.currency,
    today: page.today,
    demo: page.demo,
    originAirport: trip.originAirport,
    resorts: [
      ...page.resorts.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName, onTrip: true })),
      ...page.catalog.filter((r) => !onTrip.has(r.id)).map((r) => ({ id: r.id, name: r.name, shortName: r.shortName, onTrip: false })),
    ],
    skills: page.skills,
    lessons: page.lessons.map((l) => ({ id: l.id, resortId: l.resortId, date: l.date, kind: l.kind, instructor: l.instructor, focusSkills: l.focusSkills, bookingRef: l.bookingRef, bookingUrl: l.bookingUrl })),
    airports: page.airports.map((a) => ({ iata: a.iata, name: a.name, timezone: a.timezone })),
    rates: page.rates,
    conversions: page.conversions,
  }

  // Structural problems only — budget gaps and quote expiry are shown where they apply.
  const warnings = detail.warnings.filter((w) => !w.startsWith('Budget incomplete') && !w.includes('quote(s) expired'))
  const count = (types: string[]) => detail.items.filter((i) => types.includes(i.type)).length
  const sections = [
    { id: 'itinerary', label: 'Itinerary', count: page.days.length },
    { id: 'travel', label: 'Travel', count: count(['flight', 'drive', 'transfer', 'parking']) },
    { id: 'stay', label: 'Stay', count: count(['lodging']) },
    { id: 'learning', label: 'Lessons', count: count(['lesson', 'rental']) },
    { id: 'extras', label: 'Tickets & events', count: count(['lift-ticket', 'food', 'event']) },
    { id: 'budget', label: 'Budget' },
    { id: 'checklist', label: 'Checklist', count: detail.checklist.filter((c) => !c.done).length },
    { id: 'people', label: 'People' },
  ]

  // Season markers for the calendars: the trip's resorts (or, before any ski day, none).
  const tracks: SeasonTrack[] = tripResorts.map((r) => {
    const c = page.catalog.find((x) => x.id === r.id)
    return { resortId: r.id, name: c?.shortName || r.name, windows: c?.seasons ?? [] }
  })
  const route = await routeData(ctx, page)

  return (
    <TripUiProvider data={ui}>
      <Rise>
        <TripHeader trip={trip} resorts={tripResorts} lead={lead} tracks={tracks} />
      </Rise>
      {warnings.length ? (
        <Notice tone="stale" title="Check this plan" className="mb-6">
          {warnings.join('. ')}.
        </Notice>
      ) : null}
      <div className="mb-10 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* Phones: route, dates, budget, glance — one column in reading order. */}
        <div className="flex min-w-0 flex-col gap-5 max-lg:contents">
          <Rise index={1} className="max-lg:order-1">
            {route ? <RoutePanel data={route} /> : <NoRoute />}
          </Rise>
          <Rise index={3} className="max-lg:order-4">
            <GlanceCard page={page} />
          </Rise>
        </div>
        <div className="flex min-w-0 flex-col gap-5 max-lg:contents">
          <Rise index={2} className="max-lg:order-2">
            <DatesCard tracks={tracks} />
          </Rise>
          <Rise index={3} className="max-lg:order-3">
            <BudgetCard page={page} />
          </Rise>
        </div>
      </div>
      <TripSectionNav sections={sections} />
      <div className="flex flex-col gap-5">
        <TripSection
          id="itinerary"
          index={1}
          title="Itinerary"
          meta={
            page.pass.chosen
              ? `Lift access for your passes and, as a what-if, ${page.pass.chosen.name}`
              : page.pass.ownsAny
                ? 'Each ski day shows whether your pass or a lift ticket covers it'
                : 'No pass on file — each ski day shows the lift ticket it needs'
          }
          actions={<PassPicker products={page.pass.products} chosen={page.pass.chosen?.id ?? null} />}
          lead={
            page.pass.chosen && !page.pass.chosen.owned
              ? `What-if: you don’t own ${page.pass.chosen.name}. Its days are counted in date order across this trip.`
              : undefined
          }
        >
          <Itinerary days={page.days} unscheduled={page.unscheduled} outside={page.outside} units={page.units} now={page.now} chosenName={page.pass.chosen?.name ?? null} />
        </TripSection>
        <TravelSection page={page} index={2} />
        <StaySection page={page} index={3} />
        <LessonsSection page={page} index={4} />
        <ExtrasSection page={page} index={5} />
        <BudgetSection page={page} index={6} />
        <TripSection id="checklist" index={7} title="Checklist" meta="Gear, bookings, travel and the day itself — from your editable templates">
          <GearPacking gear={gear} />
          <Checklist items={detail.checklist} templates={page.templates} />
        </TripSection>
        <TripSection id="people" index={8} title="People & notes">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <PartyAndCompanions partySize={trip.partySize} companions={trip.companions} saved={page.savedCompanion} ability={page.ability} />
            </div>
            <div className="flex flex-col gap-6">
              <FitList page={page} />
              <TripNotes notes={trip.notes} />
            </div>
          </div>
        </TripSection>
      </div>
    </TripUiProvider>
  )
}

function NoRoute() {
  return (
    <section aria-labelledby="route-title" className="glass flex min-h-[300px] flex-col items-start justify-end gap-2 rounded-[32px] p-6">
      <p className="hud text-teal">Getting there</p>
      <h2 id="route-title" className="text-[28px] leading-tight font-light tracking-[-0.03em] text-ink">
        Add a ski day to see the route
      </h2>
      <p className="max-w-[48ch] text-[14px] text-ink-2">Drive and fly options come from the resort you ski. Add one in the itinerary below.</p>
      <a href="#itinerary" className="mt-2 inline-flex h-11 items-center rounded-full bg-ink-chip px-5 text-[14px] font-medium text-on-ink-chip">
        Go to the itinerary
      </a>
    </section>
  )
}

/** Hero route data for the main resort: drive (estimate + winter buffer) and fly (door to door, flight leg from your itinerary only). */
async function routeData(ctx: Awaited<ReturnType<typeof getCtx>>, page: NonNullable<Awaited<ReturnType<typeof getTripPage>>>): Promise<RouteData | null> {
  const main = mainResort(page)
  if (!main) return null
  const pct = page.travelPrefs.winterBufferPct
  const flight = page.detail.items.find((i) => i.type === 'flight')
  const origin = detailString(flight?.details, 'origin') ?? page.trip.originAirport ?? 'ITH'
  const dest = flight?.refId ?? main.airports[0]?.iata ?? null
  const destAirport = main.airports.find((a) => a.iata === dest) ?? null
  const zones = Object.fromEntries(page.airports.filter((a) => a.timezone).map((a) => [a.iata, a.timezone!]))
  const raw = flight?.details?.segments
  const timing = flight ? itineraryTiming(Array.isArray(raw) ? (raw as SegmentLike[]) : [], zones) : null
  const originOpt = page.detail.originAirports.find((a) => a.iata === origin)
  const d2d = main.airports.length
    ? doorToDoor({
        originIata: origin,
        homeName: page.home.name,
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
  const season = page.catalog.find((c) => c.id === main.id)?.seasons.find((w) => w.to >= page.today) ?? null
  const fmt = (d: string) => formatLocalDate(d, 'd LLL')
  const hasFlight = !!flight
  const drives = page.detail.items.some((i) => i.type === 'drive')
  const maxDrive = page.travelPrefs.maxDriveHours
  const preferFly = hasFlight || (!drives && (main.drive.minutes === null || (maxDrive !== null && main.drive.minutes > maxDrive * 60)) && main.airports.length > 0)
  const geo = await routeGeo(ctx, { home: page.home, resort: { id: main.id, name: main.shortName, lat: main.lat, lon: main.lon }, origin: d2d ? origin : null, dest: d2d ? dest : null })
  return {
    homeName: page.home.name.split(',')[0],
    resortId: main.id,
    resortName: main.shortName,
    drive: { minutes: main.drive.minutes, winterMinutes: main.drive.winterMinutes, km: formatDistance(main.drive.km, page.units), isEstimate: main.drive.isEstimate },
    fly: d2d ? { origin, originDriveMinutes: originOpt?.driveFromHome?.minutes ?? null, dest, transferMinutes: destAirport?.minutes ?? null, total: d2d.total, known: d2d.known } : null,
    season: season
      ? {
          tone: season.kind,
          text:
            season.kind === 'opened'
              ? `Season opened ${fmt(season.from)}`
              : season.kind === 'announced'
                ? `Season from ${fmt(season.from)} (announced)`
                : `Opening est. ${fmt(season.from)} (Piste estimate)`,
        }
      : { tone: 'unknown', text: 'Opening not announced' },
    initial: preferFly ? 'fly' : 'drive',
    winterPct: pct,
    geo,
  }
}
