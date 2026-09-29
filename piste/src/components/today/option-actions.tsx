'use client'
/**
 * Actions on a recommended resort-day.
 *
 * - <SaveTripButton>: "Save trip from recommendation" — a DRAFT trip for the chosen dates with ski days at that
 *   resort on the days it is eligible (createTrip from the Trips actions; nothing is booked). A toast links to the
 *   trip and offers Undo (deleteTrip).
 * - <QuickLook>: the shared resort card (Explore's <ResortCard/>, not a fork) in a sheet — every fact with its
 *   sources — without leaving Today.
 */
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, Eye, LoaderCircle, Route } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Sheet } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { ResortCard } from '@/components/resort/resort-card'
import type { ResortCardData } from '@/components/resort/card-data'
import { createTrip, deleteTrip } from '@/lib/actions/trips'

export interface SaveTripProps {
  resortId: string
  name: string
  from: string
  to: string
  /** Ski days at the resort (subset of from–to). */
  skiDates: string[]
  variant?: 'primary' | 'secondary' | 'icon'
  className?: string
}

export function SaveTripButton({ resortId, name, from, to, skiDates, variant = 'secondary', className }: SaveTripProps) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState<{ tripId: string; name: string } | null>(null)

  if (saved) {
    return (
      <Link
        href={`/trips/${saved.tripId}`}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-md border border-positive/40 bg-positive-bg font-medium text-positive transition-colors duration-150 hover:border-positive',
          variant === 'icon' ? 'size-11 md:size-9' : 'h-11 px-3.5 text-[14px] md:h-10',
          className,
        )}
        aria-label={variant === 'icon' ? `Draft trip saved — open ${saved.name}` : undefined}
      >
        <Check aria-hidden className="size-4" />
        {variant === 'icon' ? null : 'Saved — open trip'}
      </Link>
    )
  }

  const save = () =>
    start(async () => {
      const res = await createTrip({
        startDate: from,
        endDate: to,
        status: 'draft',
        resorts: [{ resortId, dates: skiDates }],
      })
      if (!res.ok) {
        toast.show(res.error, { tone: 'error' })
        return
      }
      const trip = res.data
      setSaved({ tripId: trip.tripId, name: trip.name })
      toast.show(`Draft trip saved: ${trip.name}`, {
        link: { href: `/trips/${trip.tripId}`, label: 'Open trip' },
        undo: async () => {
          const del = await deleteTrip({ tripId: trip.tripId })
          if (del.ok) {
            setSaved(null)
            toast.show('Draft trip removed', { tone: 'info' })
          } else toast.show(del.error, { tone: 'error' })
        },
      })
    })

  const label = `Save a draft trip to ${name}`
  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={save}
        disabled={pending}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-divider-strong bg-surface text-ink-2 transition-colors duration-150 hover:border-teal hover:text-teal disabled:opacity-60 md:size-9',
          className,
        )}
      >
        {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Route aria-hidden className="size-4" />}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={save}
      disabled={pending}
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-md border px-4 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-60 md:h-10',
        variant === 'primary'
          ? 'border-teal bg-teal text-on-teal shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)] hover:border-teal-strong hover:bg-teal-strong'
          : 'border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal',
        className,
      )}
    >
      {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Route aria-hidden className="size-4" />}
      {pending ? 'Saving…' : 'Save as draft trip'}
    </button>
  )
}

export function QuickLook({
  card,
  label = 'Quick look',
  className,
  iconOnly = false,
}: {
  card: ResortCardData
  label?: string
  className?: string
  iconOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      side="responsive"
      widthClass="md:w-[520px]"
      title={card.name}
      description={`${card.place} · facts for ${card.dateLabel}, with their sources`}
      trigger={
        <button
          type="button"
          aria-label={iconOnly ? `${label}: ${card.name}` : undefined}
          title={iconOnly ? `${label}: ${card.name}` : undefined}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-md text-[14px] font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink',
            iconOnly ? 'size-11 md:size-9' : 'h-11 px-3 md:h-10',
            className,
          )}
        >
          <Eye aria-hidden className="size-4" />
          {iconOnly ? null : (
            <>
              {label}
              <span className="sr-only">: {card.name}</span>
            </>
          )}
        </button>
      }
      footer={
        <Link href={card.href} className="inline-flex h-11 items-center gap-1.5 text-[14px] font-medium text-teal hover:underline md:h-9">
          Open the {card.shortName} page <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      }
    >
      {open ? <ResortCard resort={card} defaultExpanded showCompare headingLevel={3} /> : null}
    </Sheet>
  )
}
