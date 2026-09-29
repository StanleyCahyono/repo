'use client'
/** Designed error state for the Forecast route: says what failed, keeps navigation, and retries (re-fetches). */
import { useEffect } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Notice } from '@/components/ui/states'

export default function ForecastError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div>
      <PageHeader title="Forecast" lead="Modeled weather for the resorts you follow." />
      <Notice
        tone="error"
        title="The forecast could not be loaded"
        action={
          <Button variant="secondary" onClick={() => retry()} className="min-h-11 md:min-h-0">
            <RotateCcw aria-hidden className="size-4" /> Try again
          </Button>
        }
      >
        Stored forecasts, reports and history are unchanged — this page failed to read them.{error.digest ? ` Reference: ${error.digest}.` : ''} Check the data
        sources if it keeps happening.
      </Notice>
      <div className="mt-4">
        <ButtonLink href="/sources" variant="ghost">
          Sources &amp; Sync <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      </div>
    </div>
  )
}
