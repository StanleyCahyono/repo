/**
 * Resort artwork for Explore and Compare: the bundled duotone cut-outs where the design bundle has a real photo
 * (Greek Peak, the Matterhorn above Zermatt), a licensed catalog photo when one exists, otherwise the decorative
 * contour placeholder — clearly not a photo and not the resort's terrain. Never a fetched or invented picture.
 */
import { PhotoCredit } from '@/components/ui/photo-credit'
import { TopoArt } from '@/components/ui/topo'
import { assetUrl, type AssetFile } from '@/lib/ui/assets'
import { cn } from '@/lib/ui/cn'
import type { ResortCardData } from '@/components/resort/card-data'

const DUO: Record<string, { file: AssetFile; alt: string; position: string }> = {
  'greek-peak': { file: 'greek-peak-duo.webp', alt: 'Greek Peak’s trails seen from the base area', position: '58% 40%' },
  zermatt: { file: 'matterhorn-duo.webp', alt: 'The Matterhorn above Zermatt', position: '50% 22%' },
}

export function hasResortPhoto(id: string, media: ResortCardData['media']): boolean {
  return !!media.photo || id in DUO
}

/**
 * `variant="thumb"`: small square (list rows) — the photo credit stays in the accessible name only.
 * `variant="banner"`: wide header (compare columns) — the credit is the compact © chip in the corner (opens to the
 * full credit on hover / focus), and the placeholder says it is not a photo.
 */
export function ResortArt({
  id,
  name,
  media,
  variant = 'thumb',
  className,
}: {
  id: string
  name: string
  media: ResortCardData['media']
  variant?: 'thumb' | 'banner'
  className?: string
}) {
  const duo = DUO[id]
  const base = 'relative overflow-hidden bg-[linear-gradient(170deg,color-mix(in_srgb,var(--sky-1)_85%,var(--surface)),var(--surface-2))]'
  if (media.photo && !duo) {
    return (
      <figure className={cn(base, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- licensed local photo from the catalog */}
        <img src={media.photo.src} alt={media.photo.alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        {variant === 'banner' ? (
          <figcaption className="absolute right-2 bottom-2 flex max-w-[calc(100%-16px)] justify-end">
            <PhotoCredit credit={media.photo.credit} license={media.photo.license} sourceUrl={media.photo.sourceUrl} />
          </figcaption>
        ) : (
          <figcaption className="sr-only">
            Photo: {media.photo.credit} ({media.photo.license})
          </figcaption>
        )}
      </figure>
    )
  }
  if (duo) {
    return (
      <figure className={cn(base, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- bundled local asset (also inlined in the single-file build) */}
        <img
          src={assetUrl(duo.file)}
          alt={duo.alt}
          loading="lazy"
          decoding="async"
          className={cn('absolute inset-0 h-full w-full object-cover', variant === 'banner' && 'scale-[1.04]')}
          style={{ objectPosition: duo.position }}
        />
      </figure>
    )
  }
  return (
    <div className={cn(base, className)}>
      <TopoArt seed={id} density={variant === 'thumb' ? 0.7 : 1} />
      {variant === 'banner' ? (
        <span aria-hidden className="hud absolute bottom-2.5 left-3 text-[11px] text-ink-2">
          Terrain art · no photo
        </span>
      ) : null}
      <span className="sr-only">Decorative contour pattern for {name}; no licensed photo — not a map of the resort.</span>
    </div>
  )
}
