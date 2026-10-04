/**
 * Loading skeletons for the Passes & Costs tabs (the header and tabs stay from the layout): the shape of each tab's
 * content — no spinner, no layout jump.
 */
import { Skeleton } from '@/components/ui/states'

function Heading() {
  return (
    <div className="mb-5 flex flex-col gap-2">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-full max-w-[560px]" />
    </div>
  )
}

/** Toolbar + table (day costs). */
export function TableSkeleton({ label, panels = false }: { label: string; panels?: boolean }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Heading />
      {panels ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Skeleton className="h-48 rounded-[18px]" />
          <Skeleton className="h-48 rounded-[18px]" />
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-3">
        <Skeleton className="h-11 w-44 md:h-10" />
        <Skeleton className="h-11 w-64 md:h-10" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden glass rounded-[24px]">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  )
}

/** Two columns: planned days | results (pass vs tickets). */
export function SplitSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Heading />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-44 rounded-[18px]" />
          <Skeleton className="h-64 rounded-[18px]" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 rounded-[18px]" />
          <Skeleton className="h-28 rounded-[18px]" />
          <Skeleton className="h-72 rounded-[18px]" />
        </div>
      </div>
    </div>
  )
}

/** Editorial list (products & prices). */
export function ListSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Heading />
      <Skeleton className="mb-8 h-24 rounded-[18px]" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="grid gap-6 border-t border-divider py-5 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-full max-w-[480px]" />
            <Skeleton className="h-4 w-2/3 max-w-[360px]" />
          </div>
          <Skeleton className="h-16" />
        </div>
      ))}
    </div>
  )
}

/** Form + side panel (manual rule entry). */
export function FormSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Heading />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[520px] rounded-[18px]" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 rounded-[18px]" />
          <Skeleton className="h-32 rounded-[18px]" />
        </div>
      </div>
    </div>
  )
}
