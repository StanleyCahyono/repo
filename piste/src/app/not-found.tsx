/** App-wide designed 404: the address does not exist; nothing is guessed in its place. Screens with their own not-found (resorts, trips) keep theirs. */
import type { Metadata } from 'next'
import { Compass, Sun } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'

export const metadata: Metadata = { title: 'Not found' }

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[720px] pt-4 md:pt-10">
      <p className="eyebrow mb-3">Page not found</p>
      <h1 className="font-display mb-5 text-[32px] leading-[1.02] text-ink md:text-[44px]">Off the map</h1>
      <EmptyState
        seed="not-found"
        title="There is nothing at this address"
        body="The link may be mistyped or out of date. Piste never fills a missing page with a guess — start again from Today or browse the resorts."
        action={
          <>
            <ButtonLink href="/" variant="primary" className="h-11 md:h-10">
              <Sun aria-hidden className="size-4" /> Today
            </ButtonLink>
            <ButtonLink href="/explore" variant="secondary" className="h-11 md:h-10">
              <Compass aria-hidden className="size-4" /> Explore
            </ButtonLink>
          </>
        }
      />
    </div>
  )
}
