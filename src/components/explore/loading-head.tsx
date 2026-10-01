import { Skeleton } from '@/components/ui/states'

/** Skeleton of the Explore header: eyebrow, big title and the tabs pill. */
export function LoadingHead({ titleWidth = 'w-48' }: { titleWidth?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3">
      <Skeleton className="h-3 w-64" />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Skeleton className={`h-12 md:h-14 ${titleWidth}`} />
        <Skeleton className="h-[50px] w-[330px] max-w-full rounded-full" />
      </div>
    </div>
  )
}
