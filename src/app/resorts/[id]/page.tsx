/**
 * Resort detail — /resorts/[id]?date=YYYY-MM-DD&mode=learning|all-mountain|powder
 *
 * One planning date (resort-local; defaults to the resort's own today) and one scoring mode drive every
 * date-specific fact on the page (score, weather, pass access, hours, day basket); both live in the URL so a shared
 * link, the back button and the comparison all reproduce the same view. Unknown ids 404 (checked in the layout, so
 * the status is a real 404). Demo mode reads the isolated demo database and is labelled throughout.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ConditionsSection } from '@/components/resort/conditions'
import type { PageView } from '@/components/resort/format'
import { LiftsSection } from '@/components/resort/lifts-runs'
import { LinksSection } from '@/components/resort/links-shelf'
import { MobileActionBar } from '@/components/resort/mobile-bar'
import { OverviewSection } from '@/components/resort/overview'
import { PlanSection } from '@/components/resort/plan'
import type { ResortActionsProps } from '@/components/resort/resort-actions'
import { ResortHeader } from '@/components/resort/resort-header'
import { RevealNoScript } from '@/components/resort/reveal'
import { SectionNav } from '@/components/resort/section-nav'
import { StaySection } from '@/components/resort/stay'
import { TravelSection } from '@/components/resort/travel'
import { getCtx } from '@/lib/context'
import { getLiftsRuns } from '@/lib/data/lifts'
import { getResortDetail } from '@/lib/data/resort-detail'
import { getResortName, getResortPageExtras } from '@/lib/data/resort-page'
import { daysBetween, isLocalDate, localDateOf } from '@/lib/domain/time'
import { SCORING_MODES, type ScoringMode } from '@/lib/domain/types'

type Params = Promise<{ id: string }>
type Search = Promise<Record<string, string | string[] | undefined>>

const ID = /^[a-z0-9-]{1,100}$/
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** A valid local date within about a year of today; anything else falls back to today. */
function planningDate(raw: string | undefined, today: string): string {
  if (!raw || !isLocalDate(raw)) return today
  return Math.abs(daysBetween(today, raw)) <= 400 ? raw : today
}

function scoringMode(raw: string | undefined, fallback: ScoringMode): ScoringMode {
  return raw && (SCORING_MODES as readonly string[]).includes(raw) ? (raw as ScoringMode) : fallback
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params
  if (!ID.test(id)) return { title: 'Resort not found' }
  const ctx = await getCtx()
  const r = await getResortName(ctx, id)
  if (!r) return { title: 'Resort not found' }
  const where = [r.region, r.stateProvince].filter(Boolean).join(', ')
  return {
    title: r.name,
    description: `${r.name} (${where}): conditions, season dates, lifts and runs, hours, passes and costs, travel from ${ctx.prefs.homeName}, hotels, events and official links.`,
  }
}

export default async function ResortPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  if (!ID.test(id)) notFound()
  const ctx = await getCtx()
  const found = await getResortName(ctx, id)
  if (!found) notFound()
  // "Today" on a resort page is the resort's own local date (a western resort is still on yesterday during the
  // home evening); an explicit ?date= always wins.
  const resortToday = localDateOf(ctx.now, found.timezone)
  const date = planningDate(first(sp.date), resortToday)
  const mode = scoringMode(first(sp.mode), ctx.prefs.scoringMode)

  const detail = await getResortDetail(ctx, id, { date, mode })
  if (!detail) notFound()
  const r = detail.summary
  const [extras, lifts] = await Promise.all([
    getResortPageExtras(ctx, id, { date, mode, destinationIatas: detail.travel.airports.map((a) => a.iata) }),
    getLiftsRuns(ctx, { id: r.id, country: r.country, lat: r.lat, lon: r.lon }),
  ])

  const view: PageView = {
    id: r.id,
    name: r.name,
    shortName: r.shortName,
    date,
    today: r.today,
    homeToday: ctx.today,
    now: ctx.now,
    mode,
    units: ctx.prefs.units,
    tz: r.timezone,
    zone: detail.hours.zoneAbbrev,
    demo: extras.demo,
    homeName: ctx.prefs.homeName,
    homeLat: ctx.prefs.homeLat,
    homeLon: ctx.prefs.homeLon,
  }
  const actions: ResortActionsProps = {
    resortId: r.id,
    name: r.name,
    shortName: r.shortName,
    isFavorite: r.isFavorite,
    trips: extras.trips,
    candidates: extras.compare,
    date,
    mode,
    today: ctx.today,
    flyIn: detail.travel.driveMinutes === null && detail.travel.airports.length > 0,
    demo: extras.demo,
  }

  return (
    <>
      <RevealNoScript />
      <ResortHeader r={r} zoneAbbrev={view.zone} unitPrefs={ctx.prefs.units} actions={actions} />
      <SectionNav date={date} today={resortToday} actions={actions} />
      <div className="mt-8 flex flex-col gap-14 md:mt-10 md:gap-16">
        <OverviewSection d={detail} x={extras} v={view} ability={ctx.prefs.ability} />
        <ConditionsSection d={detail} x={extras} v={view} preferredMode={ctx.prefs.scoringMode} />
        <LiftsSection d={detail} lifts={lifts} v={view} />
        <PlanSection d={detail} v={view} />
        <TravelSection d={detail} x={extras} v={view} />
        <StaySection d={detail} x={extras} v={view} />
        <LinksSection d={detail} v={view} />
      </div>
      <MobileActionBar actions={actions} />
    </>
  )
}
