/** Designed loading state for a resort: the header, section bar and first sections as quiet placeholders. */
import { Skeleton } from '@/components/ui/states'

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading resort…</p>
      <div className="mb-4 grid gap-4 md:mb-5 md:grid-cols-[minmax(200px,264px)_minmax(0,1fr)] md:gap-6">
        <Skeleton className="h-[160px] rounded-[12px] md:h-[200px]" />
        <div className="flex flex-col justify-between gap-4 py-1">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-10 w-72 max-w-full md:h-12" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-7 w-36" />
          </div>
        </div>
      </div>
      <div className="-mx-4 flex h-12 items-center gap-3 border-b border-divider px-4 md:-mx-8 md:h-14 md:px-8">
        {['w-16', 'w-20', 'w-12', 'w-16', 'w-10', 'w-12'].map((w, i) => (
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
      </div>
      <div className="mt-8 flex flex-col gap-10 md:mt-10">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full max-w-[640px]" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-56 rounded-[12px]" />
            <Skeleton className="h-56 rounded-[12px]" />
            <Skeleton className="h-56 rounded-[12px]" />
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-divider-strong pt-5">
          <Skeleton className="h-6 w-36" />
          <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
            <Skeleton className="h-72 rounded-[12px]" />
            <Skeleton className="h-72 rounded-[12px]" />
          </div>
        </div>
      </div>
    </div>
  )
}
