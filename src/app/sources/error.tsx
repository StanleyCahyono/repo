'use client'
/** Designed error state for Sources & Sync: the page failed to read the refresh log — no data was changed. */
import { useEffect } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Notice } from '@/components/ui/states'

export default function SourcesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div>
      <PageHeader title="Sources & Sync" lead="Source coverage, freshness and refresh health." />
      <Notice
        tone="error"
        title="Source status could not be loaded"
        action={
          <Button variant="secondary" onClick={() => retry()} className="min-h-11 md:min-h-0">
            <RotateCcw aria-hidden className="size-4" /> Try again
          </Button>
        }
      >
        Stored data and refresh history are unchanged — this page failed to read them.{error.digest ? ` Reference: ${error.digest}.` : ''} The health endpoint{' '}
        <code className="rounded-[5px] bg-surface-3 px-1.5 font-mono text-[12.5px]">/api/health</code> reports the scheduler on its own.
      </Notice>
      <div className="mt-4">
        <ButtonLink href="/settings" variant="ghost">
          Settings <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      </div>
    </div>
  )
}
