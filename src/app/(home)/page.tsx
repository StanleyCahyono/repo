/**
 * Today — the decision dashboard (Glass HUD).
 *
 * The hero answers "where should I ski?" in one line over the home mountain, with the skier avatar beside it. Under it:
 * the world season timeline (collapsed to a slim bar until hovered, focused or tapped), then three glass cards —
 * opening countdown (each resort links to its page), 7-day snow at the home mountain, pass deadlines. Unread in-app alerts follow only when there are
 * any (the navigation's alert dot links here).
 *
 * Everything comes from stored data (src/lib/data/today-hud.ts): unknowns stay "Not announced" / "Not fetched yet",
 * estimates are labelled, modeled weather says so.
 */
import type { CSSProperties } from 'react'
import type { Metadata } from 'next'
import { desc, isNull } from 'drizzle-orm'
import { UnreadAlerts, type AlertItem } from '@/components/today/alerts'
import { CountdownCard, PassDeadlinesCard, SnowCard } from '@/components/today/hud-cards'
import { Freshness, TodayHero, hasHeroArt } from '@/components/today/hud-hero'
import { WorldSeasonCard } from '@/components/today/hud-world'
import { getTodayHud } from '@/lib/data/today-hud'
import { loadAvatar } from '@/lib/data/gear'
import { sceneColors } from '@/components/avatar/presets'
import { alerts as alertsTable } from '@/lib/db/schema'
import { getCtx } from '@/lib/context'
import { formatInstant, formatLocalDate, relativeLabel } from '@/lib/domain/time'

export const metadata: Metadata = { title: 'Today' }

export default async function TodayPage() {
  const ctx = await getCtx()
  const [hud, unread, avatar] = await Promise.all([
    getTodayHud(ctx),
    ctx.db.select().from(alertsTable).where(isNull(alertsTable.readAt)).orderBy(desc(alertsTable.firedAt), desc(alertsTable.id)).limit(20),
    loadAvatar(ctx.db),
  ])
  const demo = ctx.mode === 'demo'
  const alerts: AlertItem[] = unread.map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    body: a.body,
    link: a.link,
    firedAt: a.firedAt,
    age: relativeLabel(a.firedAt, ctx.now),
  }))
  const first = hud.world.months[0]
  const range = `${formatLocalDate(`${ctx.prefs.activeSeasonId.slice(0, 4)}-09-01`, 'LLL yyyy')} → ${formatLocalDate(`${Number(ctx.prefs.activeSeasonId.slice(0, 4)) + 1}-06-01`, 'LLL yyyy')}`
  const snowStatus = hud.snow.fetchedAt
    ? `Modeled · Open-Meteo · ${formatInstant(hud.snow.fetchedAt, ctx.prefs.homeTimezone, 'HH:mm')}`
    : hud.freshness?.state === 'failed'
      ? 'Not fetched · update failed'
      : 'Not fetched yet'

  const rise = (ms: number) => ({ '--rise-delay': `${ms}ms` }) as CSSProperties
  return (
    <div className="flex flex-col">
      <TodayHero hud={hud} look={sceneColors(avatar)} />
      {first ? <WorldSeasonCard world={hud.world} range={range.toUpperCase()} tucked={hasHeroArt(hud.home)} /> : null}
      {/* Cards: one column on phones; the countdown spans the row on tablets (its six rings need the width); three
          columns from 1280px. With nothing left to count down (mid-season) it lists the resorts open now instead. */}
      <div className="grid grid-cols-1 gap-5 pt-5 md:grid-cols-2 xl:grid-cols-3">
        <div className="piste-rise-soft flex min-w-0 md:col-span-2 xl:col-span-1" style={rise(260)}>
          <CountdownCard items={hud.countdowns} openNow={hud.openNow} openCount={hud.world.open.length} />
        </div>
        <div className="piste-rise-soft flex min-w-0" style={rise(320)}>
          <SnowCard
            resortName={hud.snow.resortName}
            days={hud.snow.days}
            status={snowStatus}
            snowUnit={hud.snow.snowUnit}
            tempUnit={hud.snow.tempUnit}
            footer={hud.freshness && !demo ? <Freshness f={hud.freshness} /> : null}
          />
        </div>
        <div className="piste-rise-soft flex min-w-0" style={rise(380)}>
          <PassDeadlinesCard card={hud.passes} />
        </div>
      </div>
      {alerts.length ? (
        <div className="piste-rise-soft mt-6" style={rise(480)}>
          <UnreadAlerts alerts={alerts} demo={demo} />
        </div>
      ) : null}
    </div>
  )
}
