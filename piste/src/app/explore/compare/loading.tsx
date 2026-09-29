import { Skeleton } from '@/components/ui/states'

/** Compare skeleton: header, scenario panel, highlights, then a four-column table. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the comparison">
      <div className="mb-6 flex flex-col gap-3">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-10 w-44 md:h-12" />
        <Skeleton className="h-4 w-full max-w-[30rem]" />
        <div className="mt-2 flex gap-2 border-b border-divider pb-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <Skeleton className="mb-5 h-[112px] w-full rounded-[12px]" />
      <Skeleton className="mb-5 h-16 w-full rounded-[12px]" />
      <div className="grid grid-cols-[190px_repeat(3,1fr)] gap-3 max-lg:grid-cols-1">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-72 rounded-[12px] max-lg:hidden max-lg:first:block" />
        ))}
      </div>
    </div>
  )
}
