/** Designed "resort not found" view, shared by the route's not-found files. */
import { Compass } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'

export function ResortNotFoundView() {
  return (
    <div className="mx-auto max-w-[720px] pt-4 md:pt-10">
      <p className="eyebrow mb-3">Resort not found</p>
      <EmptyState
        seed="resort-not-found"
        title="There is no resort at this address"
        body={
          <>
            The link may be mistyped, or the resort may have been removed from your catalog. Resort records are never guessed from a name, so nothing is shown
            instead.
          </>
        }
        action={
          <ButtonLink href="/explore" variant="primary">
            <Compass aria-hidden className="size-4" /> Browse resorts in Explore
          </ButtonLink>
        }
      />
    </div>
  )
}
