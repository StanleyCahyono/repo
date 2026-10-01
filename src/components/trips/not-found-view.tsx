/** Designed "trip not found" view, shared by the route's not-found files. */
import { ArrowLeft } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'

/** A trip id that is not in this database (deleted, or it belongs to the other data mode). */
export function TripNotFoundView() {
  return (
    <div className="mx-auto max-w-[640px] pt-2">
      <h1 className="mb-6 font-display text-[32px] leading-[1.02] text-ink md:text-[44px]">Trip not found</h1>
      <EmptyState
        seed="trip-not-found"
        title="This trip isn’t here"
        body={
          <>
            It may have been deleted, or it belongs to the other data mode — demo trips and your own trips are kept in separate databases and never mix.
          </>
        }
        action={
          <ButtonLink href="/trips" variant="primary" className="h-11 md:h-10">
            <ArrowLeft aria-hidden className="size-4" /> All trips
          </ButtonLink>
        }
      />
    </div>
  )
}
