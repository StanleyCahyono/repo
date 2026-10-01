'use client'
/** Designed error state for Settings: says what failed (nothing was changed), keeps navigation, and retries. */
import { useEffect } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Notice } from '@/components/ui/states'

export default function SettingsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div>
      <PageHeader title="Settings" lead="Your home, ability and planning defaults." />
      <Notice
        tone="error"
        title="Settings could not be loaded"
        action={
          <Button variant="secondary" onClick={() => retry()} className="min-h-11 md:min-h-0">
            <RotateCcw aria-hidden className="size-4" /> Try again
          </Button>
        }
      >
        Your saved preferences are unchanged — this page failed to read them.{error.digest ? ` Reference: ${error.digest}.` : ''}
      </Notice>
      <div className="mt-4">
        <ButtonLink href="/sources" variant="ghost">
          Sources &amp; Sync <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      </div>
    </div>
  )
}
