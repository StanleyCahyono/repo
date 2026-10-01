/** App-wide designed 404: the address does not exist; nothing is guessed in its place. Screens with their own not-found (resorts, trips) keep theirs. */
import type { Metadata } from 'next'
import { Compass, MapPinOff, Sun } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'

export const metadata: Metadata = { title: 'Not found' }

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[760px] pt-4 md:pt-12">
      <p className="eyebrow-hud mb-3">404 · Page not found</p>
      <h1 className="title-hud mb-7 text-[44px] text-ink md:text-[64px]">Off the map</h1>
      <EmptyState
        seed="not-found"
        icon={<MapPinOff />}
        title="There is nothing at this address"
        body="The link may be mistyped or out of date. Piste never fills a missing page with a guess — start again from Today or browse the resorts."
        action={
          <>
            <ButtonLink href="/" variant="primary" className="h-11">
              <Sun aria-hidden className="size-4" /> Today
            </ButtonLink>
            <ButtonLink href="/explore" variant="secondary" className="h-11">
              <Compass aria-hidden className="size-4" /> Explore
            </ButtonLink>
          </>
        }
      />
    </div>
  )
}
