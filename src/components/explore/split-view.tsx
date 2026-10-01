'use client'
/**
 * Desktop list/map split with an adjustable divider (from `lg`; below that the list is full width and the map
 * column is not rendered — the page offers a list/map toggle instead).
 * - Pointer drag (pointer capture, so the drag survives leaving the handle) and keyboard: the separator is focusable
 *   with role="separator" + aria-valuenow; ←/→ move 2% (Shift 10%), Home/End jump to the limits, Enter resets.
 * - The width is remembered in localStorage (wrapped in try/catch; falls back to the default).
 * - The page scrolls the list; the map column and the handle are sticky below the (sticky) toolbar.
 */
import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { usePersistentNumber } from './use-client-state'

const KEY = 'piste:explore:list-width'
export const SPLIT_MIN = 36
export const SPLIT_MAX = 70
export const SPLIT_DEFAULT = 58

export function SplitView({
  list,
  map,
  stickyTop = '16px',
  bottomInset = 16,
  className,
}: {
  list: ReactNode
  /** Only rendered from `lg` (pass null below it to avoid mounting a hidden map). */
  map: ReactNode
  /** CSS length for the sticky offset of the map column (e.g. below a sticky toolbar). */
  stickyTop?: string
  /** Space kept free under the sticky map (px), e.g. for a floating tray. */
  bottomInset?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [saved, save] = usePersistentNumber(KEY, SPLIT_DEFAULT, SPLIT_MIN, SPLIT_MAX)
  const [drag, setDrag] = useState<number | null>(null)
  const pct = drag ?? saved
  const mapId = useId()
  const clamp = (v: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v))
  const fromPointer = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return pct
    return clamp(((clientX - r.left) / r.width) * 100)
  }
  const rounded = Math.round(pct)
  const height = `calc(100dvh - ${stickyTop} - ${bottomInset}px)`
  const vars = { '--list': `${pct}fr`, '--map': `${100 - pct}fr` } as CSSProperties

  return (
    <div
      ref={ref}
      style={vars}
      className={cn(
        'lg:grid lg:grid-cols-[minmax(0,var(--list))_24px_minmax(0,var(--map))] lg:items-start',
        drag !== null && 'cursor-col-resize select-none',
        className,
      )}
    >
      <div className="min-w-0">{list}</div>

      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-controls={mapId}
        aria-label="Resize the list and map"
        aria-valuemin={SPLIT_MIN}
        aria-valuemax={SPLIT_MAX}
        aria-valuenow={rounded}
        aria-valuetext={`List ${rounded}% of the width, map ${100 - rounded}%`}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 2
          let next: number | null = null
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = pct - step
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = pct + step
          else if (e.key === 'Home') next = SPLIT_MIN
          else if (e.key === 'End') next = SPLIT_MAX
          else if (e.key === 'Enter') next = SPLIT_DEFAULT
          if (next === null) return
          e.preventDefault()
          save(clamp(next))
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(fromPointer(e.clientX))
        }}
        onPointerMove={(e) => {
          if (drag === null) return
          setDrag(fromPointer(e.clientX))
        }}
        onPointerUp={(e) => {
          if (drag === null) return
          e.currentTarget.releasePointerCapture(e.pointerId)
          save(fromPointer(e.clientX))
          setDrag(null)
        }}
        onPointerCancel={() => setDrag(null)}
        onDoubleClick={() => save(SPLIT_DEFAULT)}
        title="Drag, or focus and use the arrow keys, to resize. Double-click to reset."
        className="group sticky hidden cursor-col-resize touch-none justify-center self-start rounded-md outline-offset-0 lg:flex"
        style={{ top: stickyTop, height }}
      >
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150',
            drag !== null ? 'bg-teal' : 'bg-divider group-hover:bg-teal/60',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'relative flex h-14 w-4 items-center justify-center self-center rounded-full border bg-surface transition-colors duration-150',
            drag !== null
              ? 'border-teal text-teal'
              : 'border-divider-strong text-ink-3 group-hover:border-teal group-hover:text-teal group-focus-visible:border-teal group-focus-visible:text-teal',
          )}
        >
          <GripVertical className="size-3.5" />
        </span>
      </div>

      <div id={mapId} className="sticky hidden min-w-0 lg:block" style={{ top: stickyTop, height }}>
        {map}
      </div>
    </div>
  )
}
