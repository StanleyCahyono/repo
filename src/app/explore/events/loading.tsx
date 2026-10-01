import { Skeleton } from '@/components/ui/states'
import { LoadingHead } from '@/components/explore/loading-head'

/** Events skeleton: header, filter panel, then a month of timeline rows. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading events">
      <LoadingHead titleWidth="w-44" />
      <Skeleton className="mb-5 h-[150px] w-full rounded-[24px]" />
      <Skeleton className="mb-3 h-4 w-64" />
      <div className="glass divide-y divide-divider overflow-hidden rounded-[24px]">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex gap-4 p-4 md:p-5">
            <Skeleton className="h-20 w-16 rounded-[16px]" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="mt-1 h-9 w-56 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
