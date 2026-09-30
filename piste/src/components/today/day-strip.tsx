'use client'
/**
 * Seven-day strip for the favourites (or the pick when there are none): per resort-local day the conditions score
 * (or "Closed" when a closure is confirmed — never a score), modeled new snow and the high/low. The day headers are a
 * radio group wired to the page's date filter: choosing a day re-ranks "Where to ski" for it, and the highlight
 * glides to the new column (spanning both days for a weekend). Visual cells are hidden from assistive tech; a table
 * twin carries the same values ("Not provided" for unknown, never 0).
 */
import { useRef, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { Ban, CloudOff } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { formatLocalDate } from '@/lib/domain/time'
import type { ScoreKind, UnitPrefs } from '@/lib/domain/types'
import { maxSnow, snowLabel, tempPair } from './format'
import { useTodayNav } from './nav'
import { datesPatch, formatDates } from './params'
import { LongHaulNote } from './long-haul'

export interface StripCellData {
  resortId: string
  name: string
  snowfallCm: { base: number | null; summit: number | null }
  partial: boolean
  tempMinC: number | null
  tempMaxC: number | null
  score: number | null
  scoreKind: ScoreKind | null
  closed: { reason: string } | null
}

export interface StripDayData {
  date: string
  isWeekend: boolean
  cells: StripCellData[]
}

/** Every row spans the seven explicit columns: explicit placement lets the highlight sit underneath instead of pushing rows into implicit columns. */
const FULL = '1 / -1'

function scoreTone(score: number | null, kind: ScoreKind | null) {
  if (score === null || kind !== 'conditions') return 'text-ink-2'
  if (score >= 70) return 'text-positive'
  if (score >= 55) return 'text-caution'
  return 'text-critical'
}

function describeCell(c: StripCellData, units: UnitPrefs): { score: string; snow: string; temp: string } {
  const snow = maxSnow(c.snowfallCm)
  return {
    score: c.closed
      ? 'Closed'
      : c.score === null
        ? 'Not provided'
        : `${c.score}${c.scoreKind === 'weather-potential' ? ' (weather potential)' : c.scoreKind === 'limited' ? ' (limited data)' : ''}`,
    snow: snow === null ? 'Not provided' : `${snowLabel(snow, units, c.partial)}${c.partial ? ' (part of the day)' : ''}`,
    temp: tempPair(c.tempMinC, c.tempMaxC, units) ?? 'Not provided',
  }
}

export function DayStrip({
  days,
  basis,
  units,
  modeLabel,
  today,
  longHaul = [],
  longHaulLimit = null,
}: {
  days: StripDayData[]
  basis: 'favourites' | 'winner' | 'none'
  units: UnitPrefs
  modeLabel: string
  today: string
  /** Favourites left out: more than a long flight from home (planned as trips). */
  longHaul?: readonly string[]
  /** LONG_HAUL_KM in display units. */
  longHaulLimit?: string | null
}) {
  const { dates, navigate } = useTodayNav()
  const groupRef = useRef<HTMLDivElement>(null)
  const selected = new Set(dates)
  const idx = days.map((d, i) => (selected.has(d.date) ? i : -1)).filter((i) => i >= 0)
  const first = idx.length ? idx[0] : -1
  const last = idx.length ? idx[idx.length - 1] : -1
  const contiguous = idx.length > 0 && last - first + 1 === idx.length
  const resorts = days[0]?.cells.map((c) => ({ id: c.resortId, name: c.name })) ?? []
  const anyWeather = days.some((d) => d.cells.some((c) => maxSnow(c.snowfallCm) !== null || c.tempMaxC !== null || c.score !== null || c.closed))
  const rows = anyWeather ? 1 + resorts.length * 2 : 2
  const focusIndex = first >= 0 ? first : 0
  const outside = dates.some((d) => !days.some((x) => x.date === d))
  const choose = (date: string) => navigate(datesPatch(date, null, today))

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = first >= 0 ? first : 0
    const map: Record<string, number> = {
      ArrowRight: cur + 1,
      ArrowDown: cur + 1,
      ArrowLeft: cur - 1,
      ArrowUp: cur - 1,
      Home: 0,
      End: days.length - 1,
    }
    if (!(e.key in map)) return
    e.preventDefault()
    const n = Math.max(0, Math.min(days.length - 1, map[e.key]))
    choose(days[n].date)
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n]?.focus()
  }

  return (
    <section aria-labelledby="strip-title" className="rounded-[12px] border border-divider bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 pb-2 md:px-5">
        <div className="min-w-0">
          <p className="eyebrow mb-1">{basis === 'winner' ? 'The pick' : 'Favourites'} · pick a day</p>
          <h2 id="strip-title" className="text-[17px] leading-snug font-semibold text-ink">
            Next 7 days
          </h2>
        </div>
        <Link href="/forecast" className="inline-flex h-9 items-center rounded-md px-2 text-[13px] font-medium text-teal hover:bg-glacier/60">
          Forecast
        </Link>
      </header>

      <div className="@container px-2 pb-3 md:px-3">
        <div className="relative grid grid-cols-7" style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
          {contiguous ? (
            <motion.div
              layout
              transition={t.select}
              aria-hidden
              className="z-0 border border-teal/40 bg-glacier/70"
              style={{
                gridColumn: `${first + 1} / ${last + 2}`,
                gridRow: anyWeather ? `1 / ${rows + 1}` : '1 / 2',
                borderRadius: 10,
              }}
            />
          ) : null}

          <div
            ref={groupRef}
            role="radiogroup"
            aria-label="Day to rank"
            onKeyDown={onKey}
            className="z-10 grid grid-cols-subgrid"
            style={{ gridRow: 1, gridColumn: FULL }}
          >
            {days.map((d, i) => {
              const on = selected.has(d.date)
              return (
                <button
                  key={d.date}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${d.date === today ? 'Today, ' : ''}${formatLocalDate(d.date, 'cccc d LLLL')}${d.isWeekend ? ', weekend' : ''}`}
                  tabIndex={i === focusIndex ? 0 : -1}
                  onClick={() => choose(d.date)}
                  className={cn(
                    'flex min-h-11 flex-col items-center justify-center rounded-[10px] pt-1.5 pb-1 transition-colors duration-150',
                    on ? 'text-teal' : 'text-ink-2 hover:bg-surface-3/70 hover:text-ink',
                  )}
                >
                  <span className={cn('text-[12px] leading-none font-semibold tracking-[0.04em] uppercase', !on && d.isWeekend && 'text-copper')}>
                    {d.date === today ? 'Today' : formatLocalDate(d.date, 'ccc')}
                  </span>
                  <span className="font-display tnum mt-0.5 text-[20px] leading-none">{formatLocalDate(d.date, 'd')}</span>
                </button>
              )
            })}
          </div>

          {anyWeather ? (
            resorts.map((r, ri) => (
              <div key={r.id} className="contents">
                <p className="z-10 truncate px-2 pt-2.5 text-[12.5px] font-semibold text-ink" style={{ gridRow: 2 + ri * 2, gridColumn: FULL }} aria-hidden>
                  {r.name}
                </p>
                <div className="z-10 grid grid-cols-subgrid" style={{ gridRow: 3 + ri * 2, gridColumn: FULL }} aria-hidden>
                  {days.map((d) => {
                    const c = d.cells[ri]
                    const snow = c ? maxSnow(c.snowfallCm) : null
                    const temps = c ? tempPair(c.tempMinC, c.tempMaxC, units) : null
                    return (
                      <div key={d.date} className="flex min-w-0 flex-col items-center gap-0.5 px-0.5 py-1 text-center">
                        {c?.closed ? (
                          <span className="inline-flex items-center gap-0.5 text-[11.5px] leading-[22px] font-semibold text-critical" title={c.closed.reason}>
                            <Ban className="size-3" /> Closed
                          </span>
                        ) : c && c.score !== null ? (
                          <span className={cn('font-display tnum text-[20px] leading-[22px]', scoreTone(c.score, c.scoreKind))}>
                            {c.score}
                            {c.scoreKind !== 'conditions' ? <span className="align-top text-[11px]">*</span> : null}
                          </span>
                        ) : (
                          <span className="text-[13px] leading-[22px] text-ink-3">–</span>
                        )}
                        <span className={cn('tnum text-[12px] leading-tight whitespace-nowrap', snow ? 'font-medium text-info' : 'text-ink-3')}>
                          {snow === null ? '–' : snow === 0 ? '0' : snowLabel(snow, units, c?.partial)}
                        </span>
                        <span className="tnum hidden text-[12px] leading-tight whitespace-nowrap text-ink-3 @min-[480px]:block">{temps ?? '–'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          ) : (
            <p
              className="z-10 mx-2 mt-2 flex items-start gap-2 rounded-[10px] border border-dashed border-divider-strong bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2"
              style={{ gridRow: 2, gridColumn: FULL }}
            >
              <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              {resorts.length ? (
                <span>
                  No forecast stored for {resorts.map((r) => r.name).join(' or ')} on these days — weather has not been fetched yet, so there is nothing to show
                  (not zero). Pick a day to rank it anyway.{' '}
                  <Link href="/sources" className="font-medium text-teal hover:underline">
                    Sources &amp; Sync
                  </Link>
                </span>
              ) : (
                <span>
                  Star a resort to see its next seven days here. Pick a day to rank it.{' '}
                  <Link href="/explore" className="font-medium text-teal hover:underline">
                    Explore
                  </Link>
                </span>
              )}
            </p>
          )}
        </div>

        {outside ? <p className="mt-2 px-2 text-[12.5px] text-ink-3">Ranking {formatDates(dates)} — beyond this strip.</p> : null}
        {longHaul.length ? <LongHaulNote count={longHaul.length} names={longHaul.length <= 3 ? longHaul : undefined} limit={longHaulLimit} what="in this strip" className="mt-2 px-2" /> : null}
        {anyWeather ? (
          <p className="mt-2 px-2 text-[12px] leading-relaxed text-ink-3">
            Big number: conditions score ({modeLabel}); <span aria-hidden>*</span> weather potential only — terrain and status unknown. Blue: likely new snow{' '}
            {units.snow === 'in' ? '(in)' : '(cm)'}, larger of base and summit, ≥ part of the day.{' '}
            <span className="@min-[480px]:hidden">Temperatures in the table and Forecast.</span>
            <span className="hidden @min-[480px]:inline">High / low °{units.temperature}.</span> Weather-model output, not observations.
          </p>
        ) : null}
      </div>

      {anyWeather ? (
        // A table ignores width: 1px, so the visually-hidden wrapper does the clipping.
        <div className="sr-only">
          <table>
            <caption>Next 7 days by resort: conditions score, likely new snow and high/low temperature</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {resorts.map((r) => (
                  <th key={r.id} scope="col">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <th scope="row">{formatLocalDate(d.date, 'cccc d LLLL')}</th>
                  {d.cells.map((c) => {
                    const x = describeCell(c, units)
                    return (
                      <td key={c.resortId}>
                        Score {x.score}; snow {x.snow}; high / low {x.temp}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
