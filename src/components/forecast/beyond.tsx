'use client'
/**
 * A date beyond the forecast horizon (or with no forecast stored): planning information instead of weather.
 * States plainly that no forecast exists for the date, shows each resort's season dates, status and pass access
 * for it, and says that no historical seasonal context is sourced (none is invented).
 */
import { BookX, CalendarClock, CalendarRange } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import { KindTag } from '@/components/ui/provenance'
import { SourceDrawer, type SourceItem } from '@/components/ui/source-drawer'
import { OpeningTag, StatusPill } from '@/components/ui/status'
import type { ResortForecast } from '@/lib/data/forecast'
import type { PlanningView, ResortInfo } from '@/lib/data/forecast-screen'
import { daysBetween, relativeLabel } from '@/lib/domain/time'
import { PASS_FAMILIES, type PassFamilyId } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { dayMedium, dayYear, lastForecastDate, PROVIDER_MAX_DAYS } from './model'

export function BeyondHorizon({
  date,
  selected,
  resorts,
  planning,
  forecasts,
  now,
  stale,
}: {
  date: string
  selected: string[]
  resorts: Record<string, ResortInfo>
  planning: Record<string, PlanningView>
  forecasts: ResortForecast[]
  now: string
  /** Planning facts were computed for another date (a navigation is pending). */
  stale: boolean
}) {
  const ref = selected[0] ? resorts[selected[0]] : null
  const ahead = ref ? daysBetween(ref.today, date) : null
  const lasts = forecasts.map((f) => ({ name: resorts[f.resortId]?.name ?? f.name, last: lastForecastDate(f) }))
  const withRun = lasts.filter((l) => l.last)
  const farOut = ahead !== null && ahead >= PROVIDER_MAX_DAYS

  let why: string
  if (farOut) {
    why = `Weather models reach about ${PROVIDER_MAX_DAYS} days ahead, so no forecast exists for this date and Piste does not extrapolate one.`
  } else if (!withRun.length) {
    why =
      'No forecast is stored for this date yet — weather has not been fetched for these resorts. Forecasts cover up to about 16 days once the refresh job runs.'
  } else {
    why = `The stored forecast ends ${withRun.map((l) => `${dayMedium(l.last!)} for ${l.name}`).join(', ')}; the provider returned nothing later, so there is no forecast for this date.`
  }

  return (
    <section
      id="beyond"
      aria-labelledby="beyond-title"
      className={cn('glass scroll-mt-20 overflow-hidden rounded-[28px] md:rounded-[32px] transition-opacity duration-200', stale && 'opacity-55')}
      aria-busy={stale || undefined}
    >
      <header className="border-b border-divider bg-surface-2 px-4 pt-3.5 pb-3 md:px-5">
        <p className="eyebrow flex items-center gap-1.5">
          <CalendarClock aria-hidden className="size-3.5" />
          {farOut ? 'Beyond the forecast horizon' : withRun.length ? 'Beyond the stored forecast' : 'No forecast stored for this date'}
        </p>
        <h3 id="beyond-title" className="mt-1 font-display text-[26px] leading-none text-ink md:text-[30px]">
          {dayYear(date)}
        </h3>
        <p className="mt-1.5 max-w-[72ch] text-[14px] text-ink-2">
          {ahead !== null && ahead > 0 ? <span className="font-medium text-ink tnum">{ahead} days ahead. </span> : null}
          {why}
        </p>
      </header>

      <div className="px-4 py-4 md:px-5">
        <p className="mb-2 text-[13.5px] font-semibold text-ink">Planning information for {dayMedium(date)}</p>
        <ul className="flex flex-col divide-y divide-divider">
          {selected.map((id) => {
            const p = planning[id]
            const info = resorts[id]
            if (!p) return null
            return (
              <li key={id} className="grid gap-x-6 gap-y-2 py-3 first:pt-1 md:grid-cols-[minmax(140px,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink">{info?.name ?? id}</p>
                  <p className="text-[12.5px] text-ink-3">Season {p.seasonLabel}</p>
                </div>
                <Season p={p} date={date} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-[12.5px] text-ink-2">
                    Status now
                    {p.status.prov ? (
                      <SourceDrawer
                        title={`Operating status — ${info?.name ?? id}`}
                        items={[{ label: 'Operating status', value: p.status.label, prov: p.status.prov }]}
                      />
                    ) : null}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusPill status={p.status.status} size="sm" />
                    {p.status.localDate ? <span className="text-[12.5px] text-ink-3 tnum">since {dayMedium(p.status.localDate)}</span> : null}
                  </div>
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    {p.status.note ? `${p.status.note}. ` : ''}
                    {p.status.ageHours !== null ? `Stated ${relativeLabel(p.status.lastConfirmedAt ?? p.status.since ?? now, now)}. ` : ''}Status on a future
                    date is never assumed.
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[12.5px] text-ink-2">Passes</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {p.passes.length ? (
                      p.passes.map((b) =>
                        (PASS_FAMILIES as readonly string[]).includes(b.familyId) ? (
                          <PassBadge key={b.familyId} family={b.familyId as PassFamilyId} size="sm" detail={b.confirmed ? null : 'unconfirmed'} />
                        ) : (
                          <span key={b.familyId} className="text-[12.5px] text-ink-2">
                            {b.familyName}
                          </span>
                        ),
                      )
                    ) : (
                      <span className="text-[13px] text-ink-3 italic">No pass family recorded</span>
                    )}
                  </div>
                  <p
                    className={cn(
                      'mt-1 text-[12.5px]',
                      p.myPass.status === 'covered' ? 'text-positive' : p.myPass.status === 'not-covered' ? 'text-critical' : 'text-ink-3',
                    )}
                  >
                    {p.myPass.status === 'no-pass' ? 'You have no pass recorded — badges are discovery only.' : p.myPass.headline}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <footer className="flex items-start gap-2.5 border-t border-divider bg-surface-2 px-4 py-3 md:px-5">
        <BookX aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <p className="text-[13px] text-ink-2">
          <span className="font-semibold text-ink">Historical seasonal context: none sourced.</span> Piste holds no licensed snowfall normals or past-season
          records for these resorts, so it shows none rather than unsourced averages.
        </p>
      </footer>
    </section>
  )
}

function Season({ p, date }: { p: PlanningView; date: string }) {
  const o = p.opening
  const items: SourceItem[] = []
  if (o.prov) items.push({ label: 'Opening', value: o.date ? dayYear(o.date) : undefined, prov: o.prov })
  if (o.closing.prov) items.push({ label: 'Closing', value: o.closing.date ? dayYear(o.closing.date) : (o.closing.text ?? undefined), prov: o.closing.prov })

  let position: { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }
  if (p.closure) position = { text: `Closed on this date — ${p.closure.reason}`, tone: 'bad' }
  else if (o.closing.date && date > o.closing.date)
    position = { text: `After the ${o.closing.label === 'closed' ? 'actual' : 'announced'} closing date`, tone: 'warn' }
  else if (o.label === 'opened')
    position = o.closing.date
      ? {
          text: `Between the opening and the ${o.closing.label === 'closed' ? 'actual' : 'announced'} closing — operations on the day are not known yet`,
          tone: 'ok',
        }
      : { text: 'After the opening; the closing date is not announced — operations on the day are unknown', tone: 'muted' }
  else if (o.label === 'announced' && o.date)
    position =
      date < o.date
        ? { text: 'Before the announced opening', tone: 'warn' }
        : { text: 'After the announced opening target — a target, not a confirmed opening', tone: 'muted' }
  else if (o.label === 'estimated' && o.date)
    position =
      date < o.date
        ? { text: 'Before the estimated opening window', tone: 'warn' }
        : { text: 'Inside or after the estimated opening window (estimate)', tone: 'muted' }
  else position = { text: 'Opening not announced for this season', tone: 'muted' }

  const openText =
    o.label === 'opened'
      ? o.date
        ? dayYear(o.date)
        : 'Date not stated'
      : o.label === 'announced'
        ? `${o.date ? dayMedium(o.date) : 'Date not stated'}${o.text ? ` — “${o.text}”` : ''}`
        : o.label === 'estimated'
          ? `${o.date ? dayMedium(o.date) : ''}${o.to ? `–${dayMedium(o.to)}` : ''} (Piste estimate)`
          : ''
  const closeText =
    o.closing.label === 'not-announced'
      ? 'Closing not announced'
      : `${o.closing.label === 'closed' ? 'Closed' : 'Closing'} ${o.closing.date ? dayMedium(o.closing.date) : (o.closing.text ?? '')}`

  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
        <CalendarRange aria-hidden className="size-3.5" />
        Season dates
        {items.length ? <SourceDrawer title="Season dates" items={items} /> : null}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[14px] text-ink">
        <OpeningTag label={o.label} />
        {openText ? <span className="tnum">{openText}</span> : <span className="text-[13px] text-ink-2">Opening date</span>}
      </p>
      <p className="mt-0.5 text-[13px] text-ink-2 tnum">{closeText}</p>
      <p
        className={cn(
          'mt-1 text-[12.5px] font-medium',
          position.tone === 'bad' ? 'text-critical' : position.tone === 'warn' ? 'text-caution' : position.tone === 'ok' ? 'text-positive' : 'text-ink-3',
        )}
      >
        {position.text}
      </p>
      {o.label === 'estimated' ? <KindTag kind="derived" className="mt-1" /> : null}
    </div>
  )
}
