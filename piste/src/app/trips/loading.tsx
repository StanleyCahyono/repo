import { Skeleton } from '@/components/ui/states'

/** Trips list skeleton: header, KPI strip, the next trip and a few rows. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading trips…</p>
      <Skeleton className="h-3 w-56" />
      <Skeleton className="mt-3 h-10 w-40" />
      <Skeleton className="mt-3 h-4 w-[min(560px,90%)]" />
      <div className="mt-8 grid grid-cols-2 gap-6 border-y border-divider py-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((k) => (
          <div key={k}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-10 h-56 w-full rounded-[14px]" />
      <div className="mt-10 flex flex-col gap-3">
        {[0, 1].map((k) => (
          <Skeleton key={k} className="h-20 w-full rounded-[12px]" />
        ))}
      </div>
    </div>
  )
}
