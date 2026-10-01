import { Skeleton } from '@/components/ui/states'

/**
 * Designed loading state for every Passes & Costs tab (the header and tabs stay from the layout): the checker panel
 * and the "Your passes" rail in skeleton form — no spinner, no layout jump.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading passes and costs" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-10">
      <div className="flex min-w-0 flex-col gap-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-full max-w-[520px]" />
        <div className="glass rounded-[24px]">
          <div className="grid gap-3 border-b border-divider p-4 md:grid-cols-2 md:p-5">
            <Skeleton className="h-11 md:h-10" />
            <Skeleton className="h-11 md:h-10" />
            <div className="flex min-w-0 gap-3 md:col-span-2">
              <Skeleton className="h-11 w-44 md:h-10" />
              <Skeleton className="h-11 w-44 md:h-10" />
            </div>
          </div>
          <div className="flex flex-col gap-3 p-4 md:p-5">
            <Skeleton className="h-24 w-full rounded-[18px]" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-64 w-full rounded-[18px]" />
        <Skeleton className="h-40 w-full rounded-[18px]" />
      </div>
    </div>
  )
}
