'use client'
/** Designed error state for the Passes & Costs tabs: says what failed, keeps the tabs, and retries. */
import { useEffect } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/button'
import { Notice } from '@/components/ui/states'

export default function PassesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="flex flex-col gap-4">
      <Notice
        tone="error"
        title="This part of Passes & Costs could not be loaded"
        action={
          <Button variant="secondary" onClick={() => retry()} className="min-h-11 md:min-h-0">
            <RotateCcw aria-hidden className="size-4" /> Try again
          </Button>
        }
      >
        Your passes, logged days, rules and prices are unchanged — the page failed to read them.{error.digest ? ` Reference: ${error.digest}.` : ''}
      </Notice>
      <ButtonLink href="/sources" variant="ghost" className="self-start">
        Sources &amp; Sync <ArrowRight aria-hidden className="size-4" />
      </ButtonLink>
    </div>
  )
}
