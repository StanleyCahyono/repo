'use client'
/**
 * "Details" drawer for server-rendered content. The trigger is built here, on the client: Radix's Slot needs a real
 * element, and a trigger element handed over from a server component can arrive as a streamed (lazy) reference once
 * the drawer's content is large — which fails to slot during server rendering.
 */
import type { ReactNode } from 'react'
import { ReceiptText } from 'lucide-react'
import { Sheet } from '@/components/ui/sheet'

export function DetailsSheet({ title, description, label, children }: { title: string; description?: string; label: string; children: ReactNode }) {
  return (
    <Sheet
      title={title}
      description={description}
      trigger={
        <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[12.5px] font-medium text-teal hover:bg-glacier/60 max-md:h-11" aria-label={label}>
          <ReceiptText aria-hidden className="size-3.5" />
          Details
        </button>
      }
    >
      {children}
    </Sheet>
  )
}
