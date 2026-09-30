/**
 * A piste difficulty sign in the resort's convention: circle, square, diamond and double diamond (North America,
 * Australia, New Zealand), a colour bar (Europe, Japan), a dashed diamond for freeride routes and itineraries. It is
 * always drawn next to its words (the shape and the text carry the meaning, never colour alone), so it is decorative.
 */
import type { PisteShape, PisteTone } from '@/lib/domain/lifts'
import { cn } from '@/lib/ui/cn'

const TONE: Record<PisteTone, string> = {
  green: 'text-positive',
  blue: 'text-info',
  red: 'text-critical',
  black: 'text-ink',
  orange: 'text-caution',
  neutral: 'text-ink-3',
}

export function PisteSymbol({ shape, tone, className }: { shape: PisteShape; tone: PisteTone; className?: string }) {
  const cls = cn('inline-block shrink-0', TONE[tone], className)
  switch (shape) {
    case 'circle':
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4', cls)}>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" />
        </svg>
      )
    case 'square':
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4', cls)}>
          <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" />
        </svg>
      )
    case 'diamond':
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4', cls)}>
          <path d="M8 .8 15.2 8 8 15.2.8 8Z" fill="currentColor" />
        </svg>
      )
    case 'double-diamond':
      return (
        <svg viewBox="0 0 30 16" aria-hidden className={cn('h-4 w-[30px]', cls)}>
          <path d="M7.5.8 14.2 8 7.5 15.2.8 8ZM22.5.8 29.2 8 22.5 15.2 15.8 8Z" fill="currentColor" />
        </svg>
      )
    case 'bar':
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4', cls)}>
          <rect x="1" y="4.5" width="14" height="7" rx="2" fill="currentColor" />
        </svg>
      )
    case 'route':
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4', cls)}>
          <path d="M8 1.6 14.4 8 8 14.4 1.6 8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.6 1.8" />
        </svg>
      )
    case 'none':
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4', cls)}>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
      )
  }
}
