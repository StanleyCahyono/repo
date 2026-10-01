import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { getCtx } from '@/lib/context'
import * as s from '@/lib/db/schema'
import { getTripPage, isTripId } from '@/lib/data/trip-plan'
import { Notice } from '@/components/ui/states'
import { TripUiProvider, type TripUiData } from '@/components/trips/trip-ui'
import { TripHeader } from '@/components/trips/trip-header'
import { TripGlance } from '@/components/trips/glance'
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
import { PartyAndCompanions, TripNotes } from '@/components/trips/people'
import { FitList } from '@/components/trips/fit-list'
import { Rise } from '@/components/trips/rise'
import { plural } from '@/components/trips/format'

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
  const page = await getTripPage(ctx, id, { pass })
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

  return (
    <TripUiProvider data={ui}>
      <Rise>
        <TripHeader trip={trip} resorts={tripResorts} lead={lead} />
      </Rise>
      {warnings.length ? (
        <Notice tone="stale" title="Check this plan" className="mb-6">
          {warnings.join('. ')}.
        </Notice>
      ) : null}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-10">
        <div className="mb-6 xl:col-start-2 xl:row-start-1 xl:mb-0">
          <Rise index={1} className="xl:sticky xl:top-6">
            <TripGlance page={page} />
          </Rise>
        </div>
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          <TripSectionNav sections={sections} />
          <div className="flex flex-col gap-14">
            <TripSection
              id="itinerary"
              index={1}
              title="Itinerary"
              meta={page.pass.chosen ? `Pass access shown for your passes and, as a what-if, ${page.pass.chosen.name}` : page.pass.ownsAny ? 'Pass access for the passes you own' : 'No pass on file — choose one to check access day by day'}
              actions={<PassPicker products={page.pass.products} chosen={page.pass.chosen?.id ?? null} />}
              lead={
                page.pass.chosen && !page.pass.chosen.owned
                  ? `What-if: you don’t own ${page.pass.chosen.name}. Allotments are counted in date order across this trip; rules not on file stay “not confirmed” — never permission.`
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
        </div>
      </div>
    </TripUiProvider>
  )
}
