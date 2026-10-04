'use client'
/**
 * Date and time fields for the trip editors, on the shared Glass HUD calendar (ui/date-picker):
 * - `TripDateField`: one day. The trip's days are marked on the calendar ("Trip days", text in the legend), its first
 *   and last day are quick picks, and an empty field opens on the trip's month instead of today's.
 * - `TimeField`: a 24-hour time that matches the date trigger (clock icon, same field, tabular numerals).
 * - `DateTimeField`: date + time for airport-local flight times, kept as 'YYYY-MM-DDTHH:mm' like the native
 *   datetime-local input it replaces. A half-filled pair is kept as typed so the server can say what is missing.
 */
import { useMemo } from 'react'
import { Clock3 } from 'lucide-react'
import { DatePicker, type DateMark, type PresetInput } from '@/components/ui/date-picker'
import { TextInput } from '@/components/ui/form'
import { cn } from '@/lib/ui/cn'

export interface TripSpan {
  startDate: string
  endDate: string
  /** App clock's today (demo mode moves it). */
  today: string
}

export function TripDateField({
  id,
  value,
  onChange,
  trip,
  min,
  max,
  invalid,
  label,
  describedBy,
  placeholder,
  clearable = true,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  trip: TripSpan
  min?: string | null
  max?: string | null
  invalid?: boolean
  /** Accessible label when no <label htmlFor> points at the field. */
  label?: string
  describedBy?: string
  placeholder?: string
  clearable?: boolean
}) {
  const { startDate, endDate, today } = trip
  const marks = useMemo<DateMark[]>(() => [{ date: startDate, to: endDate, label: 'Trip days', tone: 'teal', variant: 'rule' }], [startDate, endDate])
  const presets = useMemo<PresetInput[]>(() => (endDate > startDate ? [{ label: 'First day', date: startDate }, { label: 'Last day', date: endDate }] : [{ label: 'Trip day', date: startDate }]), [startDate, endDate])
  const openTo = min && min > startDate ? min : startDate
  return (
    <DatePicker
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      today={today}
      min={min || undefined}
      max={max || undefined}
      marks={marks}
      presets={presets}
      openTo={openTo}
      clearable={clearable}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  )
}

export function TimeField({ id, value, onChange, invalid, label, className }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; label?: string; className?: string }) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Clock3 aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-ink-3" />
      <TextInput
        id={id}
        type="time"
        value={value}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-10 tnum [&::-webkit-calendar-picker-indicator]:hidden aria-[invalid=true]:border-critical"
      />
    </div>
  )
}

/** 'YYYY-MM-DDTHH:mm' → its date and time parts ('' when missing). */
export function splitLocal(v: string): { date: string; time: string } {
  const [d = '', tm = ''] = v.split('T')
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '', time: /^\d{2}:\d{2}/.test(tm) ? tm.slice(0, 5) : '' }
}

/** Date + time parts → 'YYYY-MM-DDTHH:mm'; '' when both are empty, a partial value when one is. */
export function joinLocal(date: string, time: string): string {
  return date || time ? `${date}T${time}` : ''
}

export function DateTimeField({ id, value, onChange, trip, invalid, timeLabel }: { id?: string; value: string; onChange: (v: string) => void; trip: TripSpan; invalid?: boolean; timeLabel: string }) {
  const { date, time } = splitLocal(value)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8.5rem)] gap-2">
      <TripDateField id={id} value={date} onChange={(d) => onChange(joinLocal(d, time))} trip={trip} invalid={invalid} placeholder="Date" />
      <TimeField value={time} onChange={(tm) => onChange(joinLocal(date, tm))} label={timeLabel} invalid={invalid} />
    </div>
  )
}
