'use client'
/**
 * Calendar marks for My Season's date fields: the days already in your journal and your trip windows, so every
 * picker shows what is on file around the day you are choosing. Each mark carries its own text (legend and the
 * day's accessible name) — never colour alone.
 */
import { useMemo } from 'react'
import type { DateMark } from '@/components/ui/date-picker'
import { useSeasonUi } from './season-ui'

export function useDateMarks({ exceptDayId, days = true }: { exceptDayId?: number | null; days?: boolean } = {}): DateMark[] {
  const { data } = useSeasonUi()
  return useMemo(
    () => [
      ...data.trips.filter((t) => t.status !== 'cancelled').map((t) => ({ date: t.startDate, to: t.endDate, label: `Trip: ${t.name}`, tone: 'teal' as const, variant: 'rule' as const, soft: t.status === 'draft' })),
      ...(days ? data.days.filter((d) => d.id !== exceptDayId).map((d) => ({ date: d.date, label: 'Ski day in your journal', tone: 'copper' as const, variant: 'dot' as const })) : []),
    ],
    [data.trips, data.days, exceptDayId, days],
  )
}
