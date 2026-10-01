import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/states'

/** Designed loading state: status strip, section bar and the first sections in skeleton form. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading sources and sync status">
      <PageHeader
        eyebrow={<span>Data health</span>}
        title="Sources & Sync"
        lead="Where every fact comes from, when it last refreshed successfully, and what is missing or failing. A disconnected source is never shown as live."
      />
      <div className="grid overflow-hidden rounded-[12px] border border-divider bg-surface sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 border-divider px-5 py-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 lg:[&:not(:first-child)]:border-l">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </div>
        ))}
      </div>
      <div className="mt-8 mb-6 flex gap-3 overflow-hidden border-b border-divider pb-3">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-24 shrink-0" />
        ))}
      </div>
      {[0, 1].map((s) => (
        <section key={s} aria-hidden className="mb-10 border-t border-divider-strong pt-5">
          <Skeleton className="mb-2 h-6 w-40" />
          <Skeleton className="mb-5 h-4 w-80 max-w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 w-full rounded-[12px]" />
            <Skeleton className="h-64 w-full rounded-[12px]" />
          </div>
        </section>
      ))}
    </div>
  )
}
