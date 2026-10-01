import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/states'

/** Designed loading state: the page's real structure in skeleton form (no spinner, no layout jump). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the forecast">
      <PageHeader
        eyebrow={<span>Weather-model output</span>}
        title="Forecast"
        lead="Modeled weather for the resorts you follow — the next 48 hours, two weeks ahead, and a tracked history of what was forecast, reported and estimated."
      />
      <div className="flex flex-col gap-6 md:gap-8">
        <div className="flex flex-col gap-4 rounded-[12px] border border-divider bg-surface px-4 py-3.5 md:flex-row md:items-end md:justify-between md:px-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-11 w-24 rounded-full md:h-9" />
              <Skeleton className="h-11 w-28 rounded-full md:h-9" />
              <Skeleton className="h-11 w-32 rounded-[10px] md:h-9" />
            </div>
          </div>
          <div className="flex gap-4">
            <Skeleton className="h-11 w-52 rounded-[10px] md:h-9" />
            <Skeleton className="h-11 w-44 rounded-[10px] md:h-9" />
          </div>
        </div>
        <Skeleton className="h-10 w-full rounded-[10px]" />
        <section aria-hidden className="border-t border-divider-strong pt-5">
          <Skeleton className="mb-4 h-6 w-48" />
          <div className="rounded-[12px] border border-divider bg-surface p-4">
            {[0, 1].map((r) => (
              <div key={r} className="mb-4 last:mb-0">
                <Skeleton className="mb-2 h-4 w-40" />
                <div className="grid grid-cols-7 gap-2 md:grid-cols-[repeat(16,minmax(0,1fr))]">
                  {Array.from({ length: 16 }, (_, i) => (
                    <Skeleton key={i} className={`h-14 ${i >= 7 ? 'hidden md:block' : ''}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section aria-hidden className="border-t border-divider-strong pt-5">
          <Skeleton className="mb-4 h-6 w-40" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_236px]">
            <Skeleton className="h-[480px] w-full rounded-[12px]" />
            <Skeleton className="h-40 w-full rounded-[12px] lg:h-[300px]" />
          </div>
        </section>
      </div>
    </div>
  )
}
