'use client'
/** Footer of a settings form: save state on the left, Discard / Save on the right. Always present (no layout jump). */
import { AnimatePresence, motion } from 'motion/react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'

export function SaveBar({
  dirty,
  pending,
  error,
  onDiscard,
  saveLabel = 'Save changes',
  note,
}: {
  dirty: boolean
  pending: boolean
  error?: string | null
  onDiscard: () => void
  saveLabel?: string
  /** Extra line under the status (e.g. what saving affects). */
  note?: string
}) {
  const status = pending ? 'saving' : error ? 'error' : dirty ? 'dirty' : 'clean'
  return (
    <div className="flex flex-col gap-3 bg-chip-track px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
      <div className="min-w-0 text-[13px]" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={status}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={t.hover}
            className={cn('flex items-center gap-2', status === 'error' ? 'font-medium text-critical' : status === 'dirty' ? 'font-medium text-ink' : 'text-ink-3')}
          >
            {status === 'dirty' ? <span aria-hidden className="size-2 rounded-full bg-copper" /> : null}
            {status === 'clean' ? <Check aria-hidden className="size-3.5 text-positive" strokeWidth={2.4} /> : null}
            {status === 'saving' ? 'Saving…' : status === 'error' ? error : status === 'dirty' ? 'Unsaved changes' : 'Saved'}
          </motion.p>
        </AnimatePresence>
        {note ? <p className="mt-0.5 text-[12.5px] text-ink-3">{note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {dirty && !pending ? (
          <Button type="button" variant="ghost" onClick={onDiscard} className="min-h-11 flex-1 sm:min-h-0 sm:flex-none">
            Discard
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={!dirty || pending} className="min-h-11 flex-1 sm:min-h-0 sm:flex-none">
          {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
          {pending ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </div>
  )
}
