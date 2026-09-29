/**
 * Today — the decision dashboard.
 *
 * In season: "Where to ski" for the chosen date(s) leads, with the favourites watchlist and the seven-day strip
 * (which drives the date filter) beside it; the next trip, weekend finder, opening timeline, new-snow watch, pass
 * deadlines, events, recent changes and unread alerts follow.
 * Preseason (no resort has opened): the opening watch, pass deadlines/sales and trip planning become the hero, and
 * "Where to ski" says plainly that nothing is open and when openings are expected — no scores are invented.
 *
 * All selection state (dates, preset, finder window) is in the URL (components/today/params.ts).
 */
import type { Metadata } from 'next'
import { Notice } from '@/components/ui/states'
import { UnreadAlerts, type AlertItem } from '@/components/today/alerts'
import { loadToday } from '@/components/today/data'
import { DayStrip } from '@/components/today/day-strip'
import { EventsBlock, QuietFeeds, RecentChanges, SnowWatch, type QuietFeed } from '@/components/today/feeds'
import { TodayHeader } from '@/components/today/header'
import { PendingVeil, TodayNav } from '@/components/today/nav'
import { OnboardingPanel } from '@/components/today/onboarding'
import { OpeningTimeline } from '@/components/today/opening-timeline'
import { parseTodayParams, type SearchRecord } from '@/components/today/params'
import { PassWatchBlock } from '@/components/today/pass-watch'
import { PreseasonHero } from '@/components/today/preseason'
import { RecommendationPanel } from '@/components/today/recommendation'
import { Rise } from '@/components/today/rise'
import { Block } from '@/components/today/section'
import { TripPlanning } from '@/components/today/trip-planning'
import { Watchlist } from '@/components/today/watchlist'
import { WeekendFinder } from '@/components/today/weekend-finder'
import { getCtx } from '@/lib/context'
import { relativeLabel } from '@/lib/domain/time'

export const metadata: Metadata = { title: 'Today' }

export default async function TodayPage({ searchParams }: { searchParams: Promise<SearchRecord> }) {
  const [ctx, sp] = await Promise.all([getCtx(), searchParams])
  const params = parseTodayParams(sp, ctx.today)
  const data = await loadToday(ctx, params)
  const { view, ranking } = data
  const preseason = view.preseason
  const units = data.units
  const favourites = new Set(view.watchlist.map((w) => w.summary.id))
  const alerts: AlertItem[] = view.unreadAlerts.map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    body: a.body,
    link: a.link,
    firedAt: a.firedAt,
    age: relativeLabel(a.firedAt, view.now),
  }))
  const resortCount = ranking.options.length + ranking.unknown.length + ranking.excluded.length

  const header = (
    <TodayHeader
      today={view.today}
      dates={view.dates}
      seasonLabel={view.season.label}
      homeName={view.home.name}
      homeTimezone={view.home.timezone}
      demo={view.demo}
      preseason={preseason}
      presets={data.presets}
      fallbackPreset={data.defaultPreset}
      unread={alerts.length}
      freshness={data.freshness}
    />
  )
  const notices = (
    <>
      {data.onboarding ? <OnboardingPanel options={data.onboarding} /> : null}
      {params.ignored ? <Notice tone="info" title={params.ignored} className="mb-6" /> : null}
    </>
  )
  const strip = <DayStrip days={data.strip} basis={view.stripBasis} units={units} modeLabel={data.modeLabel} today={view.today} />
  const watchlist = (
    <PendingVeil>
      <Watchlist view={view} cards={data.cards} units={units} />
    </PendingVeil>
  )
  const finder = (
    <PendingVeil>
      <WeekendFinder
        key={JSON.stringify(data.finder.saved)}
        window={data.finder.window}
        ranking={data.finder.ranking}
        saved={data.finder.saved}
        inputs={data.finder.inputs}
        preseason={preseason}
        demo={view.demo}
      />
    </PendingVeil>
  )
  const trips = <TripPlanning trips={data.trips} planning={data.planning} today={view.today} />
  const passes = <PassWatchBlock passes={data.passes} />

  // Feeds with something to show get their own block; the empty ones fold into one quiet block.
  const quiet: QuietFeed[] = []
  if (!alerts.length) quiet.push('alerts')
  if (!view.newSnowWatch.items.length) quiet.push('snow')
  if (!view.recentChanges.length) quiet.push('changes')
  if (!view.events.length) quiet.push('events')
  const inbox = alerts.length ? <UnreadAlerts alerts={alerts} demo={view.demo} /> : null
  const snow = view.newSnowWatch.items.length ? (
    <SnowWatch watch={view.newSnowWatch} units={units} now={view.now} weatherMissing={data.weatherMissing} demo={view.demo} />
  ) : null
  const changes = view.recentChanges.length ? <RecentChanges changes={view.recentChanges} now={view.now} favourites={favourites} /> : null
  const events = view.events.length ? <EventsBlock events={view.events} names={data.names} /> : null
  const quietBlock = <QuietFeeds feeds={quiet} units={units} thresholdCm={view.newSnowWatch.thresholdCm} weatherMissing={data.weatherMissing} />
  const grid = 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:grid-cols-[minmax(0,1fr)_400px]'
  const column = 'flex min-w-0 flex-col gap-6'
  // In season the next trip sits beside alerts and new snow; pass deadlines join them only when both are quiet, so
  // the row never leaves an empty column.
  const passesUp = !inbox && !snow

  if (preseason) {
    return (
      <TodayNav today={view.today}>
        {header}
        {notices}
        <div className={grid}>
          <Rise index={0}>
            <PendingVeil>
              <PreseasonHero
                items={view.openingTimeline}
                today={view.today}
                dates={view.dates}
                seasonLabel={view.season.label}
                reason={ranking.noWinnerReason}
              />
            </PendingVeil>
          </Rise>
          <div className={column}>
            <Rise index={1}>{passes}</Rise>
            <Rise index={2}>{trips}</Rise>
          </div>
        </div>
        <div className={`mt-6 ${grid}`}>
          <Rise index={3}>{watchlist}</Rise>
          <div className={column}>
            {strip}
            {inbox}
            {changes}
            {events}
            {snow}
            {quietBlock}
          </div>
        </div>
        <div className="mt-6">{finder}</div>
      </TodayNav>
    )
  }

  return (
    <TodayNav today={view.today}>
      {header}
      {notices}
      <div className={grid}>
        <Rise index={0}>
          <PendingVeil>
            <RecommendationPanel ranking={ranking} dates={view.dates} today={view.today} cards={data.cards} resortCount={resortCount} demo={view.demo} />
          </PendingVeil>
        </Rise>
        <div className={column}>
          <Rise index={1}>{strip}</Rise>
          <Rise index={2}>{watchlist}</Rise>
        </div>
      </div>
      <div className={`mt-6 ${grid}`}>
        <Rise index={3}>{trips}</Rise>
        <div className={column}>
          {inbox}
          {snow}
          {passesUp ? passes : null}
        </div>
      </div>
      <div className="mt-6">{finder}</div>
      <div className={`mt-6 ${grid}`}>
        <Block id="openings-title" eyebrow={`Season ${view.season.label}`} title="Opening dates">
          <OpeningTimeline items={view.openingTimeline} today={view.today} variant="season" />
        </Block>
        <div className={column}>
          {passesUp ? null : passes}
          {changes}
          {events}
          {quietBlock}
        </div>
      </div>
    </TodayNav>
  )
}
