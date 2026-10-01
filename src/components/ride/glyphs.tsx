/**
 * Top-down car and plane glyphs for the journey maps. Both point north (up); the map rotates them to the heading.
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

export function Plane({ className }: { className?: string }) {
  return (
    <span className={cn('relative block size-9 drop-shadow-[0_0_10px_var(--teal)]', className)}>
      <svg viewBox="0 0 24 24" className="size-9">
        <path
          d="M12 1.6c.85 0 1.35.95 1.35 2.1v5.3l7.9 4.6v2.1l-7.9-2.35v4.5l2.25 1.65v1.7L12 20.2l-3.6 1v-1.7l2.25-1.65v-4.5L2.75 15.7v-2.1l7.9-4.6V3.7c0-1.15.5-2.1 1.35-2.1z"
          fill="var(--ink-chip)"
          stroke="var(--surface)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
