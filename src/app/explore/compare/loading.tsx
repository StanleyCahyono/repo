import { Skeleton } from '@/components/ui/states'
import { LoadingHead } from '@/components/explore/loading-head'

/** Compare skeleton: header, scenario panel, highlight tiles, then the glass comparison grid. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the comparison">
      <LoadingHead titleWidth="w-[min(36rem,90%)]" />
      <Skeleton className="mb-5 h-[112px] w-full rounded-[24px]" />
      <div className="mb-5 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-[24px]" />
        ))}
      </div>
      <div className="grid grid-cols-[180px_repeat(4,1fr)] gap-4 rounded-[32px] p-4 max-lg:grid-cols-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-72 rounded-[20px] max-lg:hidden max-lg:nth-2:block" />
        ))}
      </div>
    </div>
  )
}
