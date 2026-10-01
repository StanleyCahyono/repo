'use client'
/**
 * The real numbers around the skier: days skied, vertical (only when I recorded it), resorts visited and skills
 * progress — plus the learning checklist as quick ticks and the journal call to action. Nothing is estimated:
 * an unrecorded vertical reads "Not logged", never 0.
 */
import { useTransition } from 'react'
import { motion } from 'motion/react'
import { BadgeCheck, Check } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { setSkillStatus } from '@/lib/actions/season'
import type { ChecklistSkill } from '@/lib/data/season-screen'
import { formatLocalDate } from '@/lib/domain/time'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { CountUp } from './count-up'
import { LogDayButton, useSeasonUi } from './season-ui'
import { hoursText, plural } from './format'

function Card({ label, children, sub, className, index }: { label: string; children: React.ReactNode; sub?: React.ReactNode; className?: string; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      whileHover={{ y: -3 }}
      transition={{ ...t.pageIn, delay: index * 0.05 }}
      className={cn('glass flex min-w-0 flex-col gap-1.5 rounded-[24px] px-5 py-[18px]', className)}
    >
      <dt className="hud tracking-[0.14em] text-ink-2">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-col gap-1.5">
        {children}
        {sub ? <span className="text-[12.5px] leading-snug text-ink-2">{sub}</span> : null}
      </dd>
    </motion.div>
  )
}

const BIG_BASE = 'leading-none font-light tracking-[-0.04em] text-ink tnum'
const BIG = `${BIG_BASE} text-[44px] sm:text-[52px]`

export interface ProfileNumbers {
  skiDays: number
  loggedDays: number
  passDays: number
  hours: number | null
  verticalM: number | null
  daysWithVertical: number
  elevationUnit: 'm' | 'ft'
  resorts: number
  catalogResorts: number
  topResort: { name: string; days: number } | null
  skillsDone: number
  skillsTotal: number
  practising: number
  ability: string
}

export function ProfileStats({ n }: { n: ProfileNumbers }) {
  const vert = n.verticalM != null ? Math.round(n.elevationUnit === 'ft' ? n.verticalM / 0.3048 : n.verticalM) : null
  const pct = n.skillsTotal ? n.skillsDone / n.skillsTotal : 0
  return (
    <dl className="m-0 grid grid-cols-2 gap-3">
      <Card
        index={0}
        label="Days skied"
        sub={
          n.skiDays
            ? [n.passDays ? `${n.passDays} on a pass` : null, hoursText(n.hours) ? `${hoursText(n.hours)} on snow` : null].filter(Boolean).join(' · ') ||
              `${plural(n.loggedDays, 'day')} in your journal`
            : 'None logged yet'
        }
      >
        <CountUp value={n.skiDays} className={BIG} />
      </Card>
      <Card index={1} label="Vertical" sub={vert != null ? `Recorded on ${plural(n.daysWithVertical, 'day')}` : 'Shown only when you log it'}>
        {vert != null ? (
          <span className="flex items-baseline gap-1.5">
            <CountUp value={vert} className={vert >= 100_000 ? `${BIG_BASE} text-[36px] sm:text-[44px]` : BIG} />
            <span className="text-[16px] text-ink-2">{n.elevationUnit}</span>
          </span>
        ) : (
          <span className="text-[28px] leading-[1.2] font-light tracking-[-0.03em] text-ink-2 sm:text-[34px]">Not logged</span>
        )}
      </Card>
      <Card index={2} label="Resorts visited" sub={n.topResort ? `Most: ${n.topResort.name} (${plural(n.topResort.days, 'day')})` : `Of ${n.catalogResorts} in the catalog`}>
        <CountUp value={n.resorts} className={BIG} />
      </Card>
      <Card index={3} label="Skills" sub={`${n.ability} · ${n.practising} practising`}>
        <span className="flex items-baseline gap-1">
          <CountUp value={n.skillsDone} className={BIG} />
          <span className="text-[18px] text-ink-2 tnum">/ {n.skillsTotal}</span>
        </span>
        <span
          role="progressbar"
          aria-label="Skills confirmed"
          aria-valuemin={0}
          aria-valuemax={n.skillsTotal}
          aria-valuenow={n.skillsDone}
          className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_9%,transparent)]"
        >
          <motion.span
            className="block h-full origin-left rounded-full bg-teal"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: pct }}
            viewport={{ once: true }}
            animate={{ scaleX: pct }}
            transition={t.bars}
          />
        </span>
      </Card>
    </dl>
  )
}

const CONFIRMED = new Set<ChecklistSkill['status']>(['self-confirmed', 'instructor-confirmed'])

/** The checklist as quick ticks: tick = confirmed by you (today); an instructor's confirmation is kept. */
export function QuickSkills({ skills, total }: { skills: ChecklistSkill[]; total: number }) {
  const { celebrate, data } = useSeasonUi()
  const toast = useToast()
  const [pending, start] = useTransition()
  const shown = skills.slice(0, 8)
  return (
    <section aria-labelledby="quick-skills-title" className="glass flex flex-col gap-3 rounded-[28px] px-5 py-5 sm:px-[22px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="quick-skills-title" className="hud m-0 tracking-[0.14em] text-ink-2">
          Learning checklist
        </h2>
        <p className="m-0 text-[12.5px] text-ink-2">Ticking a skill makes your skier celebrate</p>
      </div>
      {shown.length ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
          {shown.map((k) => {
            const on = CONFIRMED.has(k.status)
            const byInstructor = k.status === 'instructor-confirmed'
            return (
              <li key={k.id} className="min-w-0">
                <motion.button
                  type="button"
                  aria-pressed={on}
                  disabled={pending || byInstructor}
                  whileHover={byInstructor ? undefined : { y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={t.hover}
                  title={byInstructor ? 'Confirmed by an instructor — change it under Learning' : undefined}
                  onClick={() =>
                    start(async () => {
                      const next = on ? 'practicing' : 'self-confirmed'
                      const r = await setSkillStatus({
                        id: k.id,
                        status: next,
                        confirmedOn: on ? null : data.today,
                        notes: k.notes,
                      })
                      if (!r.ok) return toast.show(r.error, { tone: 'error' })
                      if (!on) celebrate('Skill confirmed')
                      const prev = r.data.previous
                      toast.show(on ? `${k.label}: back to practising` : `${k.label}: confirmed by you`, {
                        undo: async () => {
                          const back = await setSkillStatus({
                            id: k.id,
                            status: prev.status,
                            confirmedOn: prev.confirmedOn,
                            notes: prev.notes,
                          })
                          if (!back.ok) toast.show(back.error, { tone: 'error' })
                        },
                      })
                    })
                  }
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2.5 rounded-[14px] border px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors duration-150',
                    on ? 'border-teal/30 bg-glacier' : 'border-divider bg-glass-strong hover:border-teal/50',
                    byInstructor && 'cursor-default',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-[22px] shrink-0 items-center justify-center rounded-[7px] border-[1.5px] transition-colors duration-150',
                      on ? 'border-teal bg-teal text-on-teal' : 'border-[color-mix(in_srgb,var(--ink)_30%,transparent)]',
                    )}
                  >
                    {byInstructor ? <BadgeCheck className="size-3.5" strokeWidth={2.4} /> : on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0">
                    {k.label}
                    {byInstructor ? <span className="block text-[12px] font-normal text-ink-2">Instructor confirmed</span> : null}
                  </span>
                </motion.button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="m-0 text-[13.5px] text-ink-2">No skills on your checklist yet — add them under Learning.</p>
      )}
      {total > shown.length || shown.length ? (
        <a href="#learning" className="self-start text-[13px] font-medium text-teal hover:underline">
          {total > shown.length ? `All ${total} skills, with statuses and notes →` : 'Statuses, instructor confirmations and notes →'}
        </a>
      ) : null}
    </section>
  )
}

export function JournalCallout({ last, days }: { last: { resortName: string; date: string } | null; days: number }) {
  return (
    <section aria-labelledby="journal-callout-title" className="glass flex flex-col gap-4 rounded-[28px] px-5 py-5 sm:flex-row sm:items-center sm:px-[22px]">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="journal-callout-title" className="hud m-0 tracking-[0.14em] text-ink-2">
          Ski-day journal
        </h2>
        <p className="m-0 text-[16px] font-medium text-ink">{last ? `Last out: ${last.resortName}, ${formatLocalDate(last.date, 'ccc d LLL')}` : 'No ski days yet'}</p>
        <p className="m-0 text-[13px] leading-snug text-ink-2">
          {last
            ? `${plural(days, 'day')} in your journal this season. Logging a day makes your skier celebrate.`
            : 'Log a day once you have skied it — lessons, pass days and spending appear here as you record them.'}
        </p>
      </div>
      <LogDayButton className="h-11 shrink-0 self-start sm:self-auto" />
    </section>
  )
}
