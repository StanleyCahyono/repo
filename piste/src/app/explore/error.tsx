'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/states'

/** An Explore route (resorts, compare or events) failed to load. Nothing is guessed; offer a retry and a way out. */
export default function ExploreError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="mx-auto flex max-w-[40rem] flex-col gap-4 py-8">
      <h1 className="font-display text-[32px] leading-[1.02] text-ink md:text-[44px]">Explore</h1>
      <Notice
        tone="error"
        title="This part of Explore could not be loaded"
        action={
          <Button variant="primary" onClick={() => retry()}>
            Try again
          </Button>
        }
      >
        Your data is unchanged. If this keeps happening, check Sources &amp; Sync for a failing job{error.digest ? ` (reference ${error.digest})` : ''}.
      </Notice>
      <p className="text-[14px] text-ink-2">
        <Link href="/" className="font-medium text-teal hover:underline">
          Back to Today
        </Link>
      </p>
    </div>
  )
}
