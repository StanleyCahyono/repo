'use client'
/**
 * App-wide error boundary (Today and any screen without its own): says what failed in plain words, that nothing was
 * changed, keeps the navigation, and offers a retry that re-fetches the page (Next 16 `retry`).
 */
import { useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/button'
import { Notice } from '@/components/ui/states'
import { TopoArt } from '@/components/ui/topo'

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="relative mx-auto max-w-[760px] pt-4 md:pt-12">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-60 [mask-image:linear-gradient(to_bottom,#000,transparent)]">
        <TopoArt seed="app-error" density={0.5} />
      </div>
      <div className="piste-rise relative">
        <p className="eyebrow-hud mb-3">Something went wrong</p>
        <h1 className="title-hud text-[40px] text-ink md:text-[60px]">This page could not be loaded</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-2 md:text-[16px]">
          Piste hit an error while putting this screen together. Your saved trips, favourites and preferences are untouched.
        </p>
        <Notice tone="error" title="Nothing was changed" className="mt-6">
          Retrying reads everything again from the database.
          {error.digest ? <span className="tnum"> Reference {error.digest}.</span> : null}
        </Notice>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="primary" className="h-11" onClick={() => retry()}>
            <RotateCcw aria-hidden className="size-4" /> Try again
          </Button>
          <ButtonLink href="/explore" variant="secondary" className="h-11">
            Explore resorts
          </ButtonLink>
          <ButtonLink href="/sources" variant="ghost" className="h-11">
            Sources &amp; Sync
          </ButtonLink>
        </div>
      </div>
    </div>
  )
}
