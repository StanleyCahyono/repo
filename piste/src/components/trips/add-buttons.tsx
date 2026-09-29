'use client'
/** Buttons that server-rendered trip sections embed: open the editor with defaults, or add a catalog option in one tap. */
import type { ReactNode } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/ui/cn'
import type { TripItemType } from '@/lib/db/schema'
import { addTripItem, removeTripItem, type AddTripItemInput } from '@/lib/actions/trips'
import { useTripUi, type EditorTarget } from './trip-ui'

export function AddItemButton({
  type,
  defaults,
  children,
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  type: TripItemType
  defaults?: Extract<EditorTarget, { mode: 'add' }>['defaults']
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'quiet'
  size?: 'sm' | 'md'
  className?: string
}) {
  const { data, openEditor } = useTripUi()
  if (data.status === 'cancelled') return null
  return (
    <Button variant={variant} size={size} className={cn(size === 'sm' ? 'h-10 md:h-8' : 'h-11 md:h-10', className)} onClick={() => openEditor({ mode: 'add', type, defaults })}>
      <Plus aria-hidden className="size-4" />
      {children}
    </Button>
  )
}

/** Save a catalog option (hotel, event, transfer…) to the trip in one tap, with Undo. */
export function QuickAdd({ input, label, savedLabel = 'Saved', saved, className }: { input: Omit<AddTripItemInput, 'tripId'>; label: string; savedLabel?: string; saved?: boolean; className?: string }) {
  const { data, run, pending } = useTripUi()
  if (saved) {
    return (
      <span className={cn('inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-[13.5px] font-medium text-positive md:h-8', className)}>
        <Check aria-hidden className="size-4" /> {savedLabel}
      </span>
    )
  }
  if (data.status === 'cancelled') return null
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      className={cn('h-10 md:h-8', className)}
      onClick={() =>
        run(() => addTripItem({ ...input, tripId: data.tripId }), {
          success: (d) => `${d.title} saved to ${data.tripName}`,
          undo: (d) => removeTripItem({ tripId: data.tripId, itemId: d.itemId }),
        })
      }
    >
      <Plus aria-hidden className="size-4" />
      {label}
    </Button>
  )
}

