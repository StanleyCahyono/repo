'use client'
/**
 * The trips lane of the season timeline. Bars are placed by date (percentages, so they render on the server); once the
 * lane is measured, each trip's name goes inside its bar when it fits, else beside it when there is room before the
 * next trip, else it is left to the tooltip and the list. Decorative: the timeline's list carries the same facts.
 */
import { cn } from '@/lib/ui/cn'
import { useWidth } from '@/components/charts/use-width'
import type { TimelineTrip } from '@/lib/data/season-screen'
import { daysBetween } from '@/lib/domain/time'
import { rangeLabel } from './format'

const CHAR = 6.9 // ~px per character at 12px IBM Plex Sans medium

export function TimelineTrips({ trips, from, total, today }: { trips: TimelineTrip[]; from: string; total: number; today: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const placed = [...trips]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((t) => {
      const left = Math.max(0, daysBetween(from, t.startDate)) / total
      const span = (Math.min(daysBetween(t.startDate, t.endDate), total) + 1) / total
      return { t, left, span }
    })

  let occupied = -Infinity
  const labels = new Map<string, 'inside' | 'right' | 'left' | null>()
  if (width) {
    placed.forEach((p, i) => {
      const x0 = p.left * width
      const x1 = x0 + Math.max(8, p.span * width)
      const text = p.t.name.length * CHAR + 10
      const next = placed[i + 1] ? placed[i + 1].left * width - 8 : width
      let where: 'inside' | 'right' | 'left' | null = null
      if (x1 - x0 >= text + 6) where = 'inside'
      else if (x1 + 6 + text <= next) where = 'right'
      else if (x0 - 6 - text >= occupied) where = 'left'
      labels.set(p.t.id, where)
      occupied = where === 'right' ? x1 + 6 + text : x1
    })
  }

  return (
    <div ref={ref} className="absolute inset-x-0 top-0 h-6">
      {placed.map(({ t, left, span }) => {
        const where = labels.get(t.id) ?? null
        const booked = t.status === 'booked' || t.status === 'done'
        const past = t.endDate < today
        return (
          <div key={t.id} className="absolute inset-y-0" style={{ left: `${(left * 100).toFixed(3)}%`, width: `max(8px, ${(span * 100).toFixed(3)}%)` }} title={`${t.name} · ${rangeLabel(t.startDate, t.endDate)}`}>
            <div
              className={cn(
                'flex h-full items-center overflow-hidden rounded-[5px] border px-1.5',
                booked ? 'border-teal/60 bg-glacier text-teal' : 'border-dashed border-divider-strong bg-surface-2 text-ink-2',
                past && 'opacity-70',
              )}
            >
              {where === 'inside' ? <span className="truncate text-[12px] font-medium whitespace-nowrap">{t.name}</span> : null}
            </div>
            {where === 'right' ? <span className="absolute top-1/2 left-[calc(100%+6px)] -translate-y-1/2 text-[12px] font-medium whitespace-nowrap text-ink-2">{t.name}</span> : null}
            {where === 'left' ? <span className="absolute top-1/2 right-[calc(100%+6px)] -translate-y-1/2 text-[12px] font-medium whitespace-nowrap text-ink-2">{t.name}</span> : null}
          </div>
        )
      })}
    </div>
  )
}
