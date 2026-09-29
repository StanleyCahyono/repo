/**
 * Card thumbnail: a licensed photo (with its credit) or the designed contour placeholder. The placeholder is
 * decorative — it is not the resort's terrain — and carries the summit elevation as a quiet caption (hidden when the
 * card's container is narrow and the thumbnail small).
 */
import { TopoArt } from '@/components/ui/topo'
import { cn } from '@/lib/ui/cn'
import type { ResortCardData } from './card-data'

export function CardMedia({ id, name, media, className }: { id: string; name: string; media: ResortCardData['media']; className?: string }) {
  if (media.photo) {
    return (
      <figure className={cn('relative overflow-hidden rounded-[10px] bg-surface-3', className)}>
        {/* Licensed local photo (no remote hotlinking). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={media.photo.src} alt={media.photo.alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        <figcaption className="sr-only">
          Photo: {media.photo.credit} ({media.photo.license})
        </figcaption>
      </figure>
    )
  }
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[10px] border border-divider bg-[linear-gradient(160deg,var(--glacier),var(--surface-2)_75%)]',
        className,
      )}
    >
      <TopoArt seed={id} density={0.8} />
      {media.elevationLabel ? (
        <span aria-hidden className="tnum absolute bottom-1.5 left-2 font-mono text-[12px] leading-none whitespace-nowrap text-ink-2 @max-[459px]:hidden">
          ▲ {media.elevationLabel.replace(' summit', '')}
        </span>
      ) : null}
      <span className="sr-only">Decorative contour pattern for {name}; no licensed photo — not a map of the resort.</span>
    </div>
  )
}
