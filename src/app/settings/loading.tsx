import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/states'

/** Designed loading state: the page's real structure in skeleton form (index, numbered sections, setting rows). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading settings">
      <PageHeader
        eyebrow={<span>Personal defaults</span>}
        title="Settings"
        lead="Your home, ability and planning defaults. Units and currency only change how values are shown — nothing stored is ever converted."
      />
      <div className="xl:grid xl:grid-cols-[208px_minmax(0,1fr)] xl:gap-10">
        <div className="mb-6 flex gap-2 overflow-hidden xl:mb-0 xl:flex-col">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24 shrink-0 xl:w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-10 md:gap-12">
          {[4, 3, 5].map((rows, s) => (
            <section key={s} aria-hidden className="border-t border-divider-strong pt-5">
              <Skeleton className="mb-2 h-6 w-44" />
              <Skeleton className="mb-5 h-4 w-72 max-w-full" />
              <div className="divide-y divide-divider rounded-[12px] border border-divider bg-surface">
                {Array.from({ length: rows }, (_, r) => (
                  <div key={r} className="grid gap-3 px-4 py-4 md:grid-cols-[15rem_1fr] md:px-5">
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-48 max-w-full" />
                    </div>
                    <Skeleton className="h-10 w-full max-w-sm" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
