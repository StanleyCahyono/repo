'use client'
/** Trips error boundary (list and detail): says what failed, keeps navigation, and offers a retry. */
import Link from 'next/link'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/states'

export default function TripsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[680px] pt-4">
      <h1 className="font-display text-[32px] leading-[1.02] text-ink md:text-[44px]">Trips</h1>
      <Notice tone="error" title="Your trips could not be loaded" className="mt-6" action={null}>
        Nothing was changed — your saved trips are still in the database. {error.digest ? <span className="tnum">Reference {error.digest}.</span> : null}
      </Notice>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" className="h-11 md:h-10" onClick={() => reset()}>
          <RotateCcw aria-hidden className="size-4" /> Try again
        </Button>
        <Link href="/" className="inline-flex h-11 items-center rounded-md px-3 text-[14.5px] font-medium text-teal hover:underline md:h-10">
          Go to Today
        </Link>
      </div>
    </div>
  )
}
