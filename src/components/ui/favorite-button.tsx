'use client'
/** Favourite toggle: immediate optimistic state, 160ms scale response, toast with undo. */
import { useOptimistic, useTransition } from 'react'
import { motion } from 'motion/react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { toggleFavorite } from '@/lib/actions/favorites'
import { useToast } from './toast'

export function FavoriteButton({ resortId, name, initial, size = 'md', withLabel = false, className }: { resortId: string; name: string; initial: boolean; size?: 'md' | 'lg'; withLabel?: boolean; className?: string }) {
  const [fav, setFav] = useOptimistic(initial)
  const [, start] = useTransition()
  const toast = useToast()
  const flip = (next: boolean, announce = true) =>
    start(async () => {
      setFav(next)
      try {
        await toggleFavorite(resortId, next)
        if (announce)
          toast.show(next ? `${name} saved to favourites` : `${name} removed from favourites`, {
            undo: () => flip(!next, false),
          })
      } catch {
        toast.show('Could not update favourites', { tone: 'error' })
      }
    })
  return (
    <button
      type="button"
      aria-pressed={fav}
      aria-label={fav ? `Remove ${name} from favourites` : `Save ${name} to favourites`}
      onClick={() => flip(!fav)}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px',
        withLabel ? 'h-10 px-4 text-[14px] font-medium' : size === 'lg' ? 'size-11' : 'size-10',
        fav ? 'border-ink-chip bg-ink-chip text-on-ink-chip' : 'glass-strong text-ink-2 hover:border-field-edge hover:text-ink',
        className,
      )}
    >
      <motion.span key={String(fav)} initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={t.favorite} className="inline-flex">
        <Star aria-hidden className="size-[18px]" fill={fav ? 'currentColor' : 'none'} strokeWidth={1.8} />
      </motion.span>
      {withLabel ? (fav ? 'Saved' : 'Save') : null}
    </button>
  )
}
