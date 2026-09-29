'use client'
/** Designed error state for the resort page: says what failed, keeps stored data untouched, offers a retry. */
import { useEffect } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/states'

export default function ResortError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="mx-auto max-w-[720px] pt-4 md:pt-10">
      <p className="eyebrow mb-3">Resort</p>
      <h1 className="font-display text-[32px] leading-[1.02] text-ink md:text-[40px]">This page could not be loaded</h1>
      <Notice tone="error" title="Something went wrong while reading this resort’s data" className="mt-5">
        Nothing was changed — stored reports, weather and your own entries are untouched. Try again, or check Sources &amp; Sync if a data job is failing.
        {error.digest ? <span className="mt-1 block font-mono text-[12px] text-ink-3">Reference: {error.digest}</span> : null}
      </Notice>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => retry()}>
          <RefreshCw aria-hidden className="size-4" /> Try again
        </Button>
        <Link href="/explore" className="inline-flex h-10 items-center rounded-md px-3 text-[14.5px] font-medium text-teal hover:underline">
          Back to Explore
        </Link>
        <Link href="/sources" className="inline-flex h-10 items-center rounded-md px-3 text-[14.5px] font-medium text-teal hover:underline">
          Sources &amp; Sync
        </Link>
      </div>
    </div>
  )
}
