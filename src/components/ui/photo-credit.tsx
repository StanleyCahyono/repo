/**
 * Compact photo attribution for licensed photos: a small "©" chip in a photo's corner that opens to
 * "Photo: <credit> · <licence>" on hover or keyboard focus (tap on phones focuses it), linking to the file's source
 * page. The full credit is always in the accessible name and the tooltip, so the licence terms stay met without a
 * caption covering the picture.
 */
import { cn } from '@/lib/ui/cn'

export function PhotoCredit({ credit, license, sourceUrl, className }: { credit: string; license: string; sourceUrl: string; className?: string }) {
  const full = `Photo: ${credit} · ${license}`
  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={full}
      aria-label={`${full} (opens the photo's source page)`}
      className={cn(
        'group/credit inline-flex h-6 max-w-6 items-center gap-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink-chip)_55%,transparent)] px-[7px] text-[12px] leading-none whitespace-nowrap text-on-ink-chip backdrop-blur-sm',
        'transition-[max-width,background-color] duration-200 ease-out hover:max-w-[min(420px,80vw)] hover:bg-ink-chip focus-visible:max-w-[min(420px,80vw)] focus-visible:bg-ink-chip',
        className,
      )}
    >
      <span aria-hidden className="shrink-0 font-medium">
        ©
      </span>
      <span aria-hidden className="truncate opacity-0 transition-opacity duration-200 group-hover/credit:opacity-100 group-focus-visible/credit:opacity-100">
        {credit} · {license}
      </span>
    </a>
  )
}
