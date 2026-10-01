'use client'
/**
 * App-wide error boundary (Today and any screen without its own): says what failed in plain words, that nothing was
 * changed, keeps the navigation, and offers a retry that re-fetches the page (Next 16 `retry`).
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/states'
import { TopoArt } from '@/components/ui/topo'

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="relative mx-auto max-w-[720px] pt-4 md:pt-10">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-50">
        <TopoArt seed="app-error" density={0.5} />
      </div>
      <div className="relative">
        <p className="eyebrow mb-2">Something went wrong</p>
        <h1 className="font-display text-[32px] leading-[1.02] text-ink md:text-[44px]">This page could not be loaded</h1>
        <p className="mt-2 max-w-[60ch] text-[15px] text-ink-2 md:text-[16px]">
          Piste hit an error while putting this screen together. Your saved trips, favourites and preferences are untouched.
        </p>
        <Notice tone="error" title="Nothing was changed" className="mt-6">
          Retrying reads everything again from the database.
          {error.digest ? <span className="tnum"> Reference {error.digest}.</span> : null}
        </Notice>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" className="h-11 md:h-10" onClick={() => retry()}>
            <RotateCcw aria-hidden className="size-4" /> Try again
          </Button>
          <Link href="/explore" className="inline-flex h-11 items-center rounded-md px-3 text-[14.5px] font-medium text-teal hover:underline md:h-10">
            Explore resorts
          </Link>
          <Link href="/sources" className="inline-flex h-11 items-center rounded-md px-3 text-[14.5px] font-medium text-teal hover:underline md:h-10">
            Sources &amp; Sync
          </Link>
        </div>
      </div>
    </div>
  )
}
