/**
 * 04 Lessons & rentals — the lesson planner (focus skills from your skills checklist, instructor, booking reference
 * and link, estimated or actual cost; mirrored to My Season's lessons) and rentals, with each resort's own lesson
 * and rental pages. Whether a resort offers lessons/rentals is shown as offered / not offered / unknown.
 */
import { ArrowUpRight, Check, CircleHelp, GraduationCap, Minus } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Missing } from '@/components/ui/provenance'
import type { TripPage } from '@/lib/data/trip-plan'
import type { TripItemRow } from '@/lib/db/rows'
import { EmptySlot, SubHead, TripSection } from './bits'
import { ABILITY_LABEL, LESSON_KIND_LABEL, SKILL_STATUS_LABEL, detailNumber, detailNumbers, detailString, hostOf, plural } from './format'
import { AddItemButton } from './add-buttons'
import { ItemRow } from './item-row'
import { mainResort } from './travel-section'

function Offered({ value, label }: { value: boolean | null; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] whitespace-nowrap',
        value === true && 'border-positive/35 bg-positive-bg text-positive',
        value === false && 'border-divider-strong bg-surface-2 text-ink-2',
        value === null && 'border-dashed border-divider-strong bg-surface text-ink-3',
      )}
    >
      {value === true ? <Check aria-hidden className="size-3.5" strokeWidth={2.4} /> : value === false ? <Minus aria-hidden className="size-3.5" /> : <CircleHelp aria-hidden className="size-3.5" />}
      <span className="font-medium text-ink">{label}</span>
      <span className={cn(value === null && 'italic')}>{value === true ? 'offered' : value === false ? 'not offered' : 'unknown'}</span>
    </span>
  )
}

export function LessonsSection({ page, index }: { page: TripPage; index: number }) {
  const lessons = page.detail.items.filter((i) => i.type === 'lesson')
  const rentals = page.detail.items.filter((i) => i.type === 'rental')
  const main = mainResort(page)
  const firstSki = page.detail.resortDays[0]?.date ?? page.trip.startDate
  const skillById = new Map(page.skills.map((k) => [k.id, k]))
  const resortsOnTrip = page.resorts.filter((r) => page.detail.resortDays.some((d) => d.resortId === r.id))
  const planner = (l: TripItemRow) => {
    const row = page.lessons.find((x) => x.id === detailNumber(l.details, 'lessonId')) ?? page.lessons.find((x) => x.resortId === l.refId && x.date === l.date) ?? null
    const skills = detailNumbers(l.details, 'focusSkills')
    return {
      kind: detailString(l.details, 'lessonKind') ?? row?.kind ?? null,
      instructor: detailString(l.details, 'instructor') ?? row?.instructor ?? null,
      skills: (skills.length ? skills : (row?.focusSkills ?? [])).map((id) => skillById.get(id)).filter((k): k is NonNullable<typeof k> => !!k),
      bookingRef: detailString(l.details, 'bookingRef') ?? row?.bookingRef ?? null,
      bookingUrl: detailString(l.details, 'bookingUrl') ?? row?.bookingUrl ?? null,
    }
  }

  return (
    <TripSection
      id="learning"
      index={index}
      title="Lessons & rentals"
      meta={`Your level: ${(ABILITY_LABEL[page.ability] ?? page.ability).toLowerCase()}${page.detail.trip.companions.length ? ` · with ${page.detail.trip.companions.map((c) => c.name).join(', ')}` : ''}`}
      actions={
        <>
          <AddItemButton type="lesson" defaults={{ refId: main?.id, date: firstSki }}>
            Lesson
          </AddItemButton>
          <AddItemButton type="rental" defaults={{ refId: main?.id, date: firstSki, endDate: page.detail.resortDays.at(-1)?.date }}>
            Rental
          </AddItemButton>
        </>
      }
    >
      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="lessons-title" className="min-w-0">
          <SubHead id="lessons-title" aside={lessons.length ? plural(lessons.length, 'lesson') : undefined}>
            Lesson planner
          </SubHead>
          {lessons.length ? (
            <div className="flex flex-col gap-3">
              {lessons.map((l) => {
                const p = planner(l)
                const resort = page.resorts.find((r) => r.id === l.refId)
                return (
                  <article key={l.id} className="rounded-[20px] border border-divider bg-surface/70 p-1.5">
                    <ItemRow item={l} />
                    <div className="mx-2 mb-2 flex flex-col gap-3 border-t border-divider px-1 pt-3 md:mx-3">
                      <div>
                        <p className="mb-1.5 text-[12.5px] font-medium text-ink-2">Focus skills</p>
                        {p.skills.length ? (
                          <ul className="flex flex-wrap gap-1.5">
                            {p.skills.map((k) => (
                              <li key={k.id} className="flex max-w-full min-h-7 items-start gap-1.5 rounded-[14px] border border-teal/40 bg-glacier/60 px-2.5 py-1 text-[12.5px] leading-snug text-ink">
                                <GraduationCap aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal" />
                                <span className="min-w-0">
                                  {k.label} <span className="whitespace-nowrap text-ink-3">· {SKILL_STATUS_LABEL[k.status] ?? k.status}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <Missing label="None chosen yet — pick them in the editor" />
                        )}
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13.5px] sm:grid-cols-4">
                        <div className="min-w-0">
                          <dt className="text-[12px] text-ink-3">Kind</dt>
                          <dd className="text-ink">{p.kind ? (LESSON_KIND_LABEL[p.kind] ?? p.kind) : <Missing label="Not decided" />}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[12px] text-ink-3">Instructor</dt>
                          <dd className="text-ink">{p.instructor ?? <Missing label="Not set" />}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[12px] text-ink-3">Booking ref</dt>
                          <dd className="truncate text-ink tnum">{p.bookingRef ?? <Missing label="None yet" />}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[12px] text-ink-3">Book at</dt>
                          <dd className="truncate">
                            {p.bookingUrl ? (
                              <a href={p.bookingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
                                {hostOf(p.bookingUrl)}
                                <span className="sr-only"> (opens in a new tab)</span>
                              </a>
                            ) : resort?.links.lessons ? (
                              <a href={resort.links.lessons} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
                                Ski school <ArrowUpRight aria-hidden className="size-3.5" />
                                <span className="sr-only"> page (opens in a new tab)</span>
                              </a>
                            ) : (
                              <Missing label="No link on file" />
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                )
              })}
              <p className="text-[12.5px] text-ink-3">Lessons also appear in My Season. Skill progress is self-reported or instructor-confirmed — never inferred from lessons booked.</p>
            </div>
          ) : (
            <EmptySlot
              title="No lesson planned"
              body="Plan one with the skills you want to work on — the planner uses your skills checklist."
              action={
                <AddItemButton type="lesson" defaults={{ refId: main?.id, date: firstSki }}>
                  Plan a lesson
                </AddItemButton>
              }
            />
          )}
        </section>

        <section aria-labelledby="rentals-title" className="min-w-0">
          <SubHead id="rentals-title" aside={rentals.length ? plural(rentals.length, 'rental') : undefined}>
            Rentals
          </SubHead>
          {rentals.length ? (
            <ul className="flex flex-col rounded-[20px] border border-divider bg-surface/70 p-1.5">
              {rentals.map((r) => (
                <li key={r.id}>
                  <ItemRow item={r} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-[20px] border border-dashed border-divider-strong px-4 py-3 text-[13.5px] text-ink-2">No rental saved. Your gear setting in Settings decides what the day basket assumes.</p>
          )}
          {resortsOnTrip.length ? (
            <div className="mt-4 flex flex-col gap-3">
              {resortsOnTrip.map((r) => (
                <div key={r.id} className="rounded-[20px] border border-divider bg-ink/[0.03] p-3.5">
                  <p className="text-[13.5px] font-semibold text-ink">{r.name}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Offered value={r.lessons} label="Lessons" />
                    <Offered value={r.rentals} label="Rentals" />
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    {r.links.lessons ? (
                      <a href={r.links.lessons} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
                        Lessons <ArrowUpRight aria-hidden className="size-3.5" />
                        <span className="sr-only"> at {r.name} (opens in a new tab)</span>
                      </a>
                    ) : null}
                    {r.links.rentals ? (
                      <a href={r.links.rentals} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
                        Rentals <ArrowUpRight aria-hidden className="size-3.5" />
                        <span className="sr-only"> at {r.name} (opens in a new tab)</span>
                      </a>
                    ) : null}
                    {!r.links.lessons && !r.links.rentals ? <Missing label="No lesson or rental page on file" /> : null}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </TripSection>
  )
}
