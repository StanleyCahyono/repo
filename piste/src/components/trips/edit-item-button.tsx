'use client'
/** Opens the item editor for one item (used by server-rendered lists, e.g. "Add price" in the budget). */
import { PencilLine } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import type { TripItemRow } from '@/lib/db/rows'
import { useTripUi } from './trip-ui'

export function EditItemButton({ item, label, className }: { item: TripItemRow; label: string; className?: string }) {
  const { openEditor } = useTripUi()
  return (
    <button
      type="button"
      onClick={() => openEditor({ mode: 'edit', item })}
      className={cn('inline-flex h-10 items-center gap-1.5 rounded-md whitespace-nowrap border border-divider-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal md:h-8', className)}
    >
      <PencilLine aria-hidden className="size-3.5" />
      {label}
      <span className="sr-only"> — {item.title}</span>
    </button>
  )
}
