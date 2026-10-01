/**
 * Evidence tags for a block of data: what kind of evidence it is (Model / Reported / Piste estimate …) and, in demo
 * mode, that it is demo data — so the distinction between model output, reports and Piste-derived values survives
 * the demo label.
 */
import { KindTag } from '@/components/ui/provenance'
import type { DataKind } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'

export function Evidence({ kind, demo, className }: { kind: Exclude<DataKind, 'demo'>; demo: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2.5 gap-y-1', className)}>
      <KindTag kind={kind} />
      {demo ? <KindTag kind="demo" /> : null}
    </span>
  )
}
