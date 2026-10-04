/**
 * Top-down car glyph for the road draw-in on the journey maps. It points north (up); the map rotates it to the heading.
 * Colours come from tokens: an ink body with a teal halo.
 */
import { cn } from '@/lib/ui/cn'

export function Car({ className }: { className?: string }) {
  return (
    <span className={cn('relative block size-7 drop-shadow-[0_0_10px_var(--teal)]', className)}>
      <span className="absolute inset-0 rounded-full bg-teal/25" />
      <svg viewBox="0 0 24 24" className="relative size-7">
        <rect x="7.2" y="3" width="9.6" height="18" rx="3.4" fill="var(--ink-chip)" stroke="var(--surface)" strokeWidth="1.4" />
        <rect x="8.7" y="7" width="6.6" height="3.4" rx="1.2" fill="var(--on-ink-chip-accent)" />
        <rect x="8.9" y="16" width="6.2" height="2.2" rx="1" fill="var(--on-ink-chip-2)" />
      </svg>
    </span>
  )
}
