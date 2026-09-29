import { Skeleton } from '@/components/ui/states'

/** Events skeleton: header, filter panel, then a month of timeline rows. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading events">
      <div className="mb-6 flex flex-col gap-3">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-10 w-40 md:h-12" />
        <Skeleton className="h-4 w-full max-w-[34rem]" />
        <div className="mt-2 flex gap-2 border-b border-divider pb-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <Skeleton className="mb-5 h-[92px] w-full rounded-[12px]" />
      <Skeleton className="mb-3 h-4 w-64" />
      <div className="divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex gap-4 p-4">
            <Skeleton className="h-20 w-16 rounded-[10px]" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="mt-1 h-9 w-56" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
