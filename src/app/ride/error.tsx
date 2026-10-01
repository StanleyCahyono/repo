'use client'
/** Designed error state for Ride there: says what failed, keeps navigation, and retries. */
import { useEffect } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Notice } from '@/components/ui/states'

export default function RideError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div>
      <PageHeader title="Ride there" lead="The drive or the flight from home to any resort." />
      <Notice
        tone="error"
        title="The journey could not be loaded"
        action={
          <Button variant="secondary" onClick={() => retry()} className="min-h-11 md:min-h-0">
            <RotateCcw aria-hidden className="size-4" /> Try again
          </Button>
        }
      >
        Stored travel data is unchanged — this page failed to read it.{error.digest ? ` Reference: ${error.digest}.` : ''}
      </Notice>
      <div className="mt-4">
        <ButtonLink href="/explore" variant="ghost">
          Explore resorts <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      </div>
    </div>
  )
}
