'use client'
/**
 * "Add to trip" for an event: a small popover listing your upcoming trips (the ones whose dates overlap the event
 * first). Saving is a server action; the toast offers Undo. Undated or cancelled events explain why they cannot be
 * added instead of silently disabling the control.
 */
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Popover } from 'radix-ui'
import { CalendarPlus, Check, Route } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { useToast } from '@/components/ui/toast'
import { addEventToTrip, removeEventFromTrip } from '@/lib/actions/events'
import type { EventItem, TripOption } from '@/lib/data/explore'

const trigger = 'inline-flex h-11 items-center gap-1.5 rounded-md border px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150 md:h-9'

export function AddEventToTrip({ event, trips, today }: { event: EventItem; trips: TripOption[]; today: string }) {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<string[]>([])
  const [pending, start] = useTransition()
  const toast = useToast()

  const past = !!event.startDate && (event.endDate ?? event.startDate) < today
  const blocked = !event.dated ? 'No date announced yet' : event.status === 'cancelled' ? 'Cancelled' : past ? 'Already took place' : null
  if (blocked) {
    return (
      <span
        className={cn(trigger, 'cursor-not-allowed border-dashed border-divider-strong text-ink-3')}
        title={`Cannot add to a trip: ${blocked.toLowerCase()}`}
      >
        <Route aria-hidden className="size-4" />
        Add to trip
        <span className="sr-only"> — unavailable: {blocked.toLowerCase()}</span>
      </span>
    )
  }

  const overlap = (t: TripOption) => !!event.startDate && event.startDate <= t.endDate && (event.endDate ?? event.startDate) >= t.startDate
  const sorted = [...trips].sort((a, b) => Number(overlap(b)) - Number(overlap(a)) || a.startDate.localeCompare(b.startDate))

  const add = (t: TripOption) =>
    start(async () => {
      const res = await addEventToTrip({ tripId: t.id, eventId: event.id })
      if (!res.ok) {
        toast.show(res.error, { tone: 'error' })
        return
      }
      setSaved((xs) => [...xs, t.id])
      setOpen(false)
      toast.show(res.message ?? `Saved to ${t.name}`, {
        undo: async () => {
          const u = await removeEventFromTrip({ tripId: res.data.tripId, itemId: res.data.itemId })
          if (u.ok) setSaved((xs) => xs.filter((x) => x !== t.id))
          else toast.show(u.error, { tone: 'error' })
        },
      })
    })

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={cn(trigger, 'border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal')}>
          <Route aria-hidden className="size-4" />
          Add to trip
          <span className="sr-only">: {event.title}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(92vw,22rem)] rounded-[12px] border border-divider bg-surface p-2 text-ink shadow-overlay outline-none data-[state=open]:animate-[piste-pop-in_180ms_cubic-bezier(0.22,0.8,0.26,1)]"
        >
          <p className="px-2 pt-1 pb-2 text-[13.5px] font-semibold">Add “{event.title}” to…</p>
          {sorted.length ? (
            <ul className="flex max-h-[18rem] flex-col gap-0.5 overflow-y-auto scrollbar-thin">
              {sorted.map((t) => {
                const on = overlap(t)
                const done = saved.includes(t.id)
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={pending || done}
                      onClick={() => add(t)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-[8px] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-3 disabled:cursor-default disabled:opacity-70"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{t.name}</span>
                        <span className="tnum block text-[12.5px] text-ink-3">
                          {t.label} · {t.status}
                        </span>
                      </span>
                      {done ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-positive">
                          <Check aria-hidden className="size-3.5" /> Saved
                        </span>
                      ) : on ? (
                        <span className="rounded-sm bg-positive-bg px-1.5 py-0.5 text-[12px] font-medium text-positive">Overlaps</span>
                      ) : (
                        <span className="text-[12px] text-ink-3">Outside dates</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="px-2 pb-2 text-[13.5px] text-ink-2">
              No upcoming trips yet.{' '}
              <Link href="/trips" className="font-medium text-teal hover:underline">
                Plan a trip
              </Link>{' '}
              first, then save events to it.
            </p>
          )}
          <p className="mt-1 border-t border-divider px-2 pt-2 pb-1 text-[12px] text-ink-3">
            <CalendarPlus aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
            Saved as an idea on the trip — no ticket or price is booked.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
