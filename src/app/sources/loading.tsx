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
      <div className="glass grid overflow-hidden rounded-[24px] sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 border-glass-line px-5 py-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 lg:[&:not(:first-child)]:border-l">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </div>
        ))}
      </div>
      <div className="glass mt-8 mb-6 flex gap-3 overflow-hidden rounded-full p-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className={i === 0 ? 'h-9 w-28 shrink-0 rounded-full' : 'h-9 w-24 shrink-0 rounded-full opacity-60'} />
        ))}
      </div>
      {[0, 1].map((s) => (
        <section key={s} aria-hidden className="mb-10">
          <Skeleton className="mb-2 h-7 w-44" />
          <Skeleton className="mb-5 h-4 w-80 max-w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="glass-soft h-64 rounded-[24px]" />
            <div className="glass-soft h-64 rounded-[24px]" />
          </div>
        </section>
      ))}
    </div>
  )
}
