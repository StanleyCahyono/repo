'use client'
/**
 * Dates card in the planner hero: the trip's range on the designed calendar, with its resorts' season markers.
 * Tapping a new start and end proposes new dates; saving moves the trip (and, by default, every dated item with it —
 * the same rule as Edit trip). Nothing changes until you press Save.
 */
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/form'
import { updateTrip } from '@/lib/actions/trips'
import { daysBetween } from '@/lib/domain/time'
import type { SeasonTrack } from '@/lib/data/trip-seasons'
import { t } from '@/lib/ui/motion'
import { plural, tripDateLabel } from './format'
import { RangeCalendar } from './range-calendar'
import { useTripUi } from './trip-ui'

const MAX_DAYS = 30

export function DatesCard({ tracks }: { tracks: SeasonTrack[] }) {
  const { data, run, pending } = useTripUi()
  const [start, setStart] = useState<string | null>(data.startDate)
  const [end, setEnd] = useState<string | null>(data.endDate)
  const [shift, setShift] = useState(true)
  const changed = start !== data.startDate || end !== data.endDate
  const complete = !!start && !!end
  const delta = start ? daysBetween(data.startDate, start) : 0
  const locked = data.status === 'cancelled'
  const reset = () => {
    setStart(data.startDate)
    setEnd(data.endDate)
  }
  return (
    <section aria-labelledby="dates-card-title" className="glass rounded-[28px] px-4 py-5 sm:px-[22px]">
      <h2 id="dates-card-title" className="sr-only">
        Trip dates
      </h2>
      <RangeCalendar
        start={start}
        end={end}
        onChange={(a, b) => {
          if (locked) return
          setStart(a)
          setEnd(b)
        }}
        today={data.today}
        min={data.startDate < data.today ? data.startDate : data.today}
        maxDays={MAX_DAYS}
        tracks={tracks}
        initialMonth={data.startDate.slice(0, 7)}
        label="Dates"
      />
      <AnimatePresence initial={false}>
        {changed ? (
          <motion.div key="confirm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={t.spring} className="mt-4 flex flex-col gap-3 rounded-[20px] bg-ink-chip p-4 text-on-ink-chip">
            <p className="text-[14px] leading-snug">
              {complete ? (
                <>
                  Move this trip from <span className="tnum">{tripDateLabel(data.startDate, data.endDate)}</span> to{' '}
                  <span className="font-semibold tnum">{tripDateLabel(start!, end!)}</span>?
                </>
              ) : (
                'Tap the last day to finish the new dates.'
              )}
            </p>
            {complete && delta !== 0 ? (
              <Checkbox
                label={<span className="text-on-ink-chip">{`Move every dated item by ${plural(Math.abs(delta), 'day')} ${delta > 0 ? 'later' : 'earlier'}`}</span>}
                hint={<span className="text-on-ink-chip-2">Ski days, bookings and events keep their place in the plan.</span>}
                checked={shift}
                onChange={(e) => setShift(e.target.checked)}
              />
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={reset} className="inline-flex h-11 items-center rounded-full px-4 text-[14px] font-medium text-on-ink-chip-2 hover:text-on-ink-chip md:h-10">
                Keep current dates
              </button>
              <Button
                variant="secondary"
                className="h-11 md:h-10"
                disabled={!complete || pending}
                onClick={() =>
                  run(() => updateTrip({ tripId: data.tripId, startDate: start!, endDate: end!, shiftItems: shift && delta !== 0 }), {
                    success: (d) => (d.shifted ? `Dates saved · moved ${plural(d.shifted, 'item')} by ${plural(Math.abs(delta), 'day')}` : 'Dates saved'),
                  })
                }
              >
                Save dates
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
