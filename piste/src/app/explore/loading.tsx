import { Skeleton } from '@/components/ui/states'

/** Explore skeleton: header, scenario, toolbar, then list rows beside the map column (desktop). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading resorts">
      <div className="mb-6 flex flex-col gap-3">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-10 w-48 md:h-12" />
        <Skeleton className="h-4 w-full max-w-[36rem]" />
        <div className="mt-2 flex gap-2 border-b border-divider pb-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-20 rounded-full" />
        <Skeleton className="h-10 w-24 rounded-full" />
        <Skeleton className="h-10 w-24 rounded-full" />
        <Skeleton className="h-10 w-40 rounded-full" />
      </div>
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-10 flex-1 lg:max-w-[26rem] lg:flex-none lg:basis-[26rem]" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="lg:grid lg:grid-cols-[58fr_24px_42fr] lg:items-start">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <div className="divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-3 p-4">
                <div className="flex gap-3">
                  <Skeleton className="size-14 rounded-[10px]" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-5 w-40" />
                  </div>
                </div>
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        </div>
        <span aria-hidden />
        <Skeleton className="hidden h-[calc(100dvh-9rem)] rounded-[12px] lg:block" />
      </div>
    </div>
  )
}
