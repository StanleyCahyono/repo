'use client'
/**
 * The ski-day journal: newest first, grouped by month. Each entry reads like a logbook line — the date, where, my
 * rating, hours and best time of day, the surface I found (and whether it is saved as my personal report), the crowd
 * as my guess, skills practised, a spend note and my notes. Pass days logged in Passes without a journal entry are
 * listed so they can be written up. A newly logged day gets a brief, quiet checkmark.
 */
import { useTransition } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { ArrowUpRight, Check, CircleCheck, PencilLine, Star, Ticket, Users } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Button } from '@/components/ui/button'
import { KindTag } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { useToast } from '@/components/ui/toast'
import { saveDayReport } from '@/lib/actions/season'
import type { SkiDayView } from '@/lib/data/season'
import { formatLocalDate } from '@/lib/domain/time'
import { SURFACE_LABEL, provenance } from '@/lib/domain/types'
import { crowdText, hoursText, money, plural, resortHref, tripHref } from './format'
import { LogDayButton, useSeasonUi } from './season-ui'
import { EmptySlot } from './section'
import { Rise } from './rise'

export interface PassOnlyDay {
  date: string
  resortId: string
  resortName: string
  ownershipId: number
  productName: string
}

function DateBlock({ date }: { date: string }) {
  return (
    <div className="leading-none">
      <p className="font-display text-[34px] text-ink tnum md:text-[40px]">{formatLocalDate(date, 'd')}</p>
      <p className="mt-1.5 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
        {formatLocalDate(date, 'ccc')}
        <span className="sr-only"> {formatLocalDate(date, 'd LLLL yyyy')}</span>
      </p>
    </div>
  )
}

export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} role="img" aria-label={`My rating: ${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden className={cn('size-3.5', n <= rating ? 'fill-copper text-copper' : 'text-divider-strong')} strokeWidth={1.6} />
      ))}
    </span>
  )
}

const personalProv = (date: string) =>
  provenance({ kind: 'manual', provider: 'You — ski-day journal', verification: 'user-confirmed', publishedAt: null, note: `Your own observation on ${formatLocalDate(date, 'ccc d LLL yyyy')}. Personal feedback — never an official report or evidence the resort was open.` })

function ReportAction({ day, saved }: { day: SkiDayView; saved: boolean }) {
  const toast = useToast()
  const [pending, start] = useTransition()
  if (!day.surfaceFeedback.length) return null
  if (saved) {
    return (
      <Link href={`${resortHref(day.resortId)}#conditions`} className="inline-flex h-11 items-center gap-1 rounded-md text-[12.5px] font-medium text-positive hover:underline md:h-7">
        <CircleCheck aria-hidden className="size-3.5" /> Saved as personal report
      </Link>
    )
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await saveDayReport({ id: day.id })
          toast.show(r.ok ? (r.message ?? 'Personal report saved') : r.error, { tone: r.ok ? 'success' : 'error', link: r.ok ? { href: `${resortHref(day.resortId)}#conditions`, label: 'View' } : undefined })
        })
      }
      className="inline-flex h-11 items-center gap-1 rounded-md text-[12.5px] font-medium text-teal hover:underline disabled:opacity-60 md:h-7"
    >
      {pending ? 'Saving…' : 'Save as personal report'}
    </button>
  )
}

function DayEntry({ day, index, saved, fresh, demo }: { day: SkiDayView; index: number; saved: boolean; fresh: boolean; demo: boolean }) {
  const { openDay, data } = useSeasonUi()
  const vert = day.verticalM != null ? `${Math.round(data.elevationUnit === 'ft' ? day.verticalM / 0.3048 : day.verticalM).toLocaleString('en-US')} ${data.elevationUnit} vertical` : null
  const meta = [hoursText(day.hoursSkied), vert, day.preferredTime ? `Best time: ${day.preferredTime.charAt(0).toLowerCase()}${day.preferredTime.slice(1)}` : null].filter(Boolean)
  const crowd = crowdText(day.crowdGuess)
  return (
    <Rise as="li" index={index} className="relative">
      {fresh ? (
        <motion.span aria-hidden initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.6, ease: 'easeOut', delay: 0.5 }} className="pointer-events-none absolute inset-0 bg-glacier/70" />
      ) : null}
      <article aria-labelledby={`day-${day.id}`} className="relative grid grid-cols-[44px_minmax(0,1fr)_auto] gap-x-3 px-4 py-5 sm:gap-x-4 md:grid-cols-[64px_minmax(0,1fr)_auto] md:gap-x-5 md:px-5">
        <div className="relative">
          <DateBlock date={day.date} />
          {fresh ? (
            <motion.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...t.favorite, delay: 0.12 }}
              className="absolute -top-1.5 left-8 inline-flex size-5 items-center justify-center rounded-full bg-positive text-surface md:left-11"
            >
              <Check aria-hidden className="size-3.5" strokeWidth={3} />
              <span className="sr-only">Just logged</span>
            </motion.span>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h4 id={`day-${day.id}`} className="text-[16.5px] leading-snug font-semibold text-ink">
              <Link href={resortHref(day.resortId)} className="underline-offset-4 hover:text-teal hover:underline">
                {day.resortName}
              </Link>
            </h4>
            {day.rating ? <Stars rating={day.rating} /> : <span className="text-[12.5px] text-ink-3 italic">Not rated</span>}
            {demo ? <KindTag kind="demo" /> : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-ink-2">
            {meta.length ? <span className="tnum">{meta.join(' · ')}</span> : <span className="text-ink-3">Hours not recorded</span>}
            {day.tripId && day.tripName ? (
              <>
                <span aria-hidden className="text-ink-3">·</span>
                <Link href={tripHref(day.tripId)} className="font-medium text-teal hover:underline">
                  {day.tripName}
                </Link>
              </>
            ) : null}
            {day.passDay ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-sm border border-divider bg-surface-2 px-1.5 text-[12px] font-medium text-ink-2">
                <Ticket aria-hidden className="size-3.5" /> Pass day · {day.passDay.productName}
              </span>
            ) : null}
          </p>

          <dl className="mt-3 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13.5px] sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-x-5">
            <dt className="pt-1 text-ink-3">Surface</dt>
            <dd className="min-w-0">
              {day.surfaceFeedback.length ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {day.surfaceFeedback.map((tag) => (
                      <span key={tag} className="inline-flex h-7 items-center rounded-full border border-divider bg-surface-2 px-2.5 text-[12.5px] font-medium text-ink">
                        {SURFACE_LABEL[tag]}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-3">
                    <span className="inline-flex items-center gap-0.5">
                      My observation
                      <SourceDrawer title={`Surface at ${day.resortName}, ${formatLocalDate(day.date, 'd LLL')}`} items={[{ label: 'Surface I found', value: day.surfaceFeedback.map((x) => SURFACE_LABEL[x]).join(', '), prov: personalProv(day.date) }]} />
                    </span>
                    <ReportAction day={day} saved={saved} />
                  </div>
                </>
              ) : (
                <span className="text-ink-3 italic">Not noted</span>
              )}
            </dd>
            {crowd ? (
              <>
                <dt className="text-ink-3">
                  <span className="inline-flex items-center gap-1">
                    <Users aria-hidden className="size-3.5" /> Crowds
                  </span>
                </dt>
                <dd className="text-ink">
                  {crowd} <span className="ml-1 inline-block rounded-sm border border-dashed border-divider-strong px-1.5 text-[12px] leading-5 font-medium whitespace-nowrap text-ink-2">your guess</span>
                </dd>
              </>
            ) : null}
            {day.skillsPracticed.length ? (
              <>
                <dt className="text-ink-3">Practised</dt>
                <dd className="text-ink">{day.skillsPracticed.map((k) => k.label).join(' · ')}</dd>
              </>
            ) : null}
            {day.spend ? (
              <>
                <dt className="text-ink-3">Spend</dt>
                <dd className="text-ink tnum">
                  {money(day.spend)} <span className="text-[12.5px] text-ink-3">· a journal note, not in the budget</span>
                </dd>
              </>
            ) : null}
          </dl>
          {day.notes ? <p className="mt-3 max-w-[68ch] border-l-2 border-divider-strong pl-3 text-[14px] leading-relaxed text-ink-2">{day.notes}</p> : null}
        </div>
        <div className="col-start-3 row-start-1 -mt-2 -mr-2 md:mt-0 md:mr-0">
          <Button
            size="sm"
            variant="secondary"
            className="size-11 border-transparent px-0 md:h-8 md:w-auto md:border-divider-strong md:px-3"
            onClick={(e) => openDay({ dayId: day.id }, e.currentTarget)}
            aria-label={`Edit ${day.resortName}, ${formatLocalDate(day.date, 'd LLL')}`}
          >
            <PencilLine aria-hidden className="size-4" />
            <span className="hidden md:inline">Edit</span>
          </Button>
        </div>
      </article>
    </Rise>
  )
}

export function Journal({ passOnly }: { passOnly: PassOnlyDay[] }) {
  const { data, justLogged, openDay } = useSeasonUi()
  const days = data.days
  const saved = new Set(data.personalReports)
  const months = new Map<string, SkiDayView[]>()
  for (const d of days) months.set(d.date.slice(0, 7), [...(months.get(d.date.slice(0, 7)) ?? []), d])
  let n = 0

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {passOnly.length ? (
        <div className="rounded-[12px] border border-divider bg-surface-2 px-4 py-3">
          <p className="text-[13.5px] font-semibold text-ink">
            {plural(passOnly.length, 'pass day')} without a journal entry
          </p>
          <ul className="mt-2 flex flex-col divide-y divide-divider">
            {passOnly.map((p) => (
              <li key={`${p.resortId}|${p.date}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-[13.5px] text-ink">
                  <span className="font-medium tnum">{formatLocalDate(p.date, 'ccc d LLL')}</span> · {p.resortName} <span className="text-ink-3">· {p.productName}</span>
                </span>
                <Button size="sm" variant="quiet" className="h-11 md:h-8" onClick={(e) => openDay({ prefill: { resortId: p.resortId, date: p.date, passOwnershipId: p.ownershipId } }, e.currentTarget)}>
                  Write it up
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {days.length ? (
        [...months].map(([ym, list]) => (
          <section key={ym} aria-labelledby={`m-${ym}`}>
            <h3 id={`m-${ym}`} className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
              {formatLocalDate(`${ym}-01`, 'LLLL yyyy')}
              <span className="font-normal tracking-normal text-ink-3 normal-case tnum">· {plural(list.length, 'day')}</span>
            </h3>
            <ol className="divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface">
              {list.map((d) => (
                <DayEntry key={d.id} day={d} index={n++} saved={saved.has(`${d.resortId}|${d.date}`)} fresh={justLogged === d.id} demo={data.demo} />
              ))}
            </ol>
          </section>
        ))
      ) : (
        <EmptySlot
          title="No ski days logged yet"
          body={
            <>
              Log a day after you ski: where, how it went, the surface you found and what you practised. Days feed your season totals, cost per ski day and
              learning checklist. <Link href="/trips" className="font-medium text-teal hover:underline">Plan upcoming days in Trips</Link>
              <ArrowUpRight aria-hidden className="ml-0.5 inline size-3.5 text-teal" />
            </>
          }
          action={<LogDayButton />}
        />
      )}
    </div>
  )
}
