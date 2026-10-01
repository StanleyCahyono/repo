import { getCtx } from '@/lib/context'
import { getSeasonScreen } from '@/lib/data/season-screen'
import { getGearLocker } from '@/lib/data/gear'
import { DemoBadge } from '@/components/ui/badge'
import { SeasonUiProvider, LogDayButton, type DayIntent, type SeasonUiData } from '@/components/season/season-ui'
import { SeasonTimeline } from '@/components/season/overview'
import { SeasonSectionNav } from '@/components/season/section-nav'
import { SeasonSection } from '@/components/season/section'
import { Journal, type PassOnlyDay } from '@/components/season/journal'
import { PassUsage } from '@/components/season/pass-usage'
import { Destinations } from '@/components/season/destinations'
import { Spending } from '@/components/season/spending'
import { Skills } from '@/components/season/skills'
import { Lessons } from '@/components/season/lessons'
import { ExportPanel } from '@/components/season/export-panel'
import { ProfileProvider, ProfileStage, WearingPanel } from '@/components/season/profile'
import { JournalCallout, ProfileStats, QuickSkills } from '@/components/season/profile-stats'
import { GearLocker } from '@/components/season/gear-locker'
import { money, plural } from '@/components/season/format'

export const metadata = { title: 'My Season' }

const ABILITY: Record<string, string> = {
  beginner: 'Beginner',
  novice: 'Novice',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  expert: 'Expert',
}

type SP = Record<string, string | string[] | undefined>

/** ?log=1&resort=&date=&trip= opens "Log a ski day" prefilled; ?day=<id> opens that day for editing. */
function intentFrom(sp: SP): DayIntent | null {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : null)
  const day = Number(one('day'))
  if (Number.isInteger(day) && day > 0) return { dayId: day }
  if (one('log'))
    return {
      prefill: {
        resortId: one('resort'),
        date: one('date'),
        tripId: one('trip'),
      },
    }
  return null
}

export default async function SeasonPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const [data, locker] = await Promise.all([getSeasonScreen(ctx), getGearLocker(ctx)])
  const v = data.view
  const demo = v.demo

  const myPasses = v.passes.filter((p) => p.holder === 'me')
  const logged = new Set(v.skiDays.map((d) => `${d.resortId}|${d.date}`))
  const passDays = new Set(myPasses.flatMap((p) => p.usage.filter((u) => u.inSeason).map((u) => u.date))).size
  const passOnly: PassOnlyDay[] = myPasses
    .flatMap((p) =>
      p.usage
        .filter((u) => u.inSeason && !logged.has(`${u.resortId}|${u.date}`))
        .map((u) => ({
          date: u.date,
          resortId: u.resortId,
          resortName: u.resortName,
          ownershipId: p.ownershipId,
          productName: p.productName,
        })),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
  const lessonCount = v.lessons.upcoming.length + v.lessons.past.length + v.lessons.undated.length

  const ui: SeasonUiData = {
    today: data.today,
    seasonId: v.season.id,
    seasonLabel: v.season.label,
    demo,
    currency: data.currency,
    resorts: data.resorts,
    trips: data.trips,
    passOptions: data.passOptions,
    skills: data.skills.map((k) => ({
      id: k.id,
      label: k.label,
      category: k.category,
    })),
    personalReports: data.personalReports,
    days: v.skiDays,
    elevationUnit: ctx.prefs.units.elevation === 'm' ? 'm' : 'ft',
  }
  const ability = ABILITY[ctx.prefs.ability] ?? ctx.prefs.ability
  const top = v.destinations[0]
  const last = v.skiDays[0]
  const headline = v.totals.skiDays ? `${plural(v.totals.skiDays, 'day')} on snow.` : 'Your season starts at zero.'
  const intent = intentFrom(sp)

  return (
    <SeasonUiProvider data={ui} initialIntent={intent}>
      <ProfileProvider
        initial={locker.avatar}
        items={locker.items.map((g) => ({
          id: g.id,
          brandModel: g.brandModel,
        }))}
      >
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-7">
          <div className="flex min-w-0 flex-col gap-4 max-lg:contents">
            <div className="order-1 flex flex-col gap-2">
              <p className="hud m-0 flex flex-wrap items-center gap-x-2 gap-y-1 tracking-[0.16em] text-teal">
                <span>You · skier profile</span>
                <span aria-hidden className="text-ink-3">
                  ·
                </span>
                <span className="text-ink-2">Season {v.season.label}</span>
                {demo ? <DemoBadge /> : null}
              </p>
              <h1 id="season-title" className="m-0 text-[clamp(40px,5vw,72px)] leading-none font-light tracking-[-0.04em] text-ink">
                {headline}
              </h1>
              <p className="sr-only">My Season: your skier, gear locker, ski-day journal, spending, learning checklist and lessons — recorded by you, never inferred.</p>
            </div>
            <div className="order-2">
              <ProfileStage ability={ability} caption={`${plural(v.totals.skiDays, 'day')} · ${plural(locker.items.length, 'item')} in the locker`} />
            </div>
            <div className="order-4">
              <WearingPanel />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-[18px] max-lg:contents lg:pt-1">
            <div className="order-3">
              <ProfileStats
                n={{
                  skiDays: v.totals.skiDays,
                  loggedDays: v.totals.loggedDays,
                  passDays,
                  hours: v.totals.hoursSkied,
                  verticalM: v.totals.verticalM,
                  daysWithVertical: v.totals.daysWithVertical,
                  elevationUnit: ui.elevationUnit,
                  resorts: v.totals.resorts,
                  catalogResorts: data.resorts.length,
                  topResort: top ? { name: top.name, days: top.days } : null,
                  skillsDone: v.skills.confirmed,
                  skillsTotal: v.skills.total,
                  practising: v.skills.practicing,
                  ability,
                }}
              />
            </div>
            <div className="order-5">
              <QuickSkills skills={data.skills} total={data.skills.length} />
            </div>
            <div className="order-6">
              <JournalCallout last={last ? { resortName: last.resortName, date: last.date } : null} days={v.skiDays.length} />
            </div>
          </div>
        </div>

        <div className="mt-7">
          <GearLocker items={locker.items} coverage={locker.coverage} rentalOption={ctx.prefs.gear.rentalOption} />
        </div>

        <div className="mt-10">
          <SeasonSectionNav
            sections={[
              { id: 'journal', label: 'Journal', count: v.skiDays.length },
              { id: 'spending', label: 'Spending' },
              { id: 'learning', label: 'Learning', count: v.skills.total },
              { id: 'lessons', label: 'Lessons', count: lessonCount },
              { id: 'export', label: 'Export & backup' },
            ]}
          />
          <div className="flex flex-col gap-14">
            <SeasonSection
              id="journal"
              index={1}
              title="Ski-day journal"
              meta={v.skiDays.length ? `${plural(v.skiDays.length, 'day')} logged${v.totals.hoursSkied != null ? ` · ${v.totals.hoursSkied} h recorded` : ''}` : 'Nothing logged yet'}
              actions={v.skiDays.length ? <LogDayButton variant="secondary">Log a day</LogDayButton> : null}
            >
              <div className="mb-8">
                <SeasonTimeline tl={data.timeline} demo={demo} seasonLabel={v.season.label} />
              </div>
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
                <Journal passOnly={passOnly} />
                <aside aria-label="Pass usage and destinations" className="grid min-w-0 content-start items-start gap-6 md:grid-cols-2 lg:grid-cols-1">
                  <PassUsage passes={v.passes} demo={demo} />
                  <Destinations destinations={v.destinations} home={data.home.name} />
                </aside>
              </div>
            </SeasonSection>

            <SeasonSection
              id="spending"
              index={2}
              title="Spending"
              meta={
                data.expenses.length
                  ? `${money(v.budget.actualTotal)} spent · ${plural(data.expenses.length, 'expense')} · in ${v.budget.currency}`
                  : `No expenses recorded yet · amounts in ${v.budget.currency}`
              }
              lead="Actual is what you recorded as expenses; planned is your share of priced items on your trips. A season pass is counted once, and days skied on it add no lift cost."
            >
              <Spending view={v} expenses={data.expenses} trips={data.trips} currency={data.currency} today={data.today} demo={demo} />
            </SeasonSection>

            <SeasonSection id="learning" index={3} title="Learning checklist" meta={`${v.skills.confirmed} of ${plural(v.skills.total, 'skill')} confirmed · ${v.skills.practicing} practising`}>
              <Skills skills={data.skills} categories={data.skillCategories} today={data.today} note={v.skills.note} />
            </SeasonSection>

            <SeasonSection
              id="lessons"
              index={4}
              title="Lessons"
              meta={
                lessonCount ? `${v.lessons.upcoming.length} coming up · ${v.lessons.past.length} past${v.lessons.undated.length ? ` · ${v.lessons.undated.length} not scheduled` : ''}` : 'None yet'
              }
            >
              <Lessons lessons={v.lessons} resorts={data.resorts} skills={data.skills} currency={data.currency} demo={demo} />
            </SeasonSection>

            <SeasonSection id="export" index={5} title="Export & backup" meta={demo ? 'Demo mode — downloads contain demo data only' : 'Your records, in open formats'}>
              <ExportPanel demo={demo} trips={data.trips} />
            </SeasonSection>
          </div>
        </div>
      </ProfileProvider>
    </SeasonUiProvider>
  )
}
