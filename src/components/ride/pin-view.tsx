/**
 * Journey map pins, shared by the offline schematic and the MapLibre map. A pin is a zero-size anchor at its point:
 * the dot is centred on it and the label (`[data-pin-label]`) is positioned by the collision-avoiding layout
 * (label-layout.ts) with a whole-pixel translate, so it stays crisp. Until the layout runs the label sits above the dot.
 */
import { cn } from '@/lib/ui/cn'
import type { Pin } from './journey-model'

/** Clearance between a pin's centre and its label, px. */
export const PIN_GAP: Record<Pin['kind'], number> = { resort: 14, home: 12, airport: 11 }

/** Layout priority: the destination's label first, then home, then airports. */
export const PIN_PRIORITY: Record<Pin['kind'], number> = { resort: 0, home: 1, airport: 2 }

export function PinView({ pin, appear = true }: { pin: Pin; appear?: boolean }) {
  const gap = PIN_GAP[pin.kind]
  return (
    <div className="relative size-0" data-pin={pin.id}>
      {pin.kind === 'resort' ? (
        <span className="absolute -top-[7px] -left-[7px] block size-3.5">
          <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: 'piste-beacon 2.2s ease-out infinite' }} />
          <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: 'piste-beacon 2.2s ease-out 1.1s infinite' }} />
          <span className="absolute inset-[2px] rounded-full bg-teal shadow-[0_0_0_2px_var(--surface),0_0_14px_var(--teal)]" />
        </span>
      ) : pin.kind === 'home' ? (
        <span className="absolute -top-1.5 -left-1.5 block size-3 rounded-full border-[2.5px] border-ink bg-surface shadow-lift" />
      ) : (
        <span className="absolute -top-[5px] -left-[5px] block size-2.5 rotate-45 border-2 border-teal bg-surface" />
      )}
      <span
        data-pin-label
        className="absolute top-0 left-0 block transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: `translate(-50%, calc(-100% - ${gap}px))` }}
      >
        <span
          className={cn(
            'flex items-baseline gap-1.5 whitespace-nowrap',
            appear && 'piste-rise',
            pin.kind === 'resort'
              ? 'rounded-[12px] bg-ink-chip px-3 py-1.5 text-[13.5px] leading-tight font-semibold text-on-ink-chip shadow-overlay'
              : 'glass-strong rounded-[10px] px-2.5 py-1 text-[12.5px] leading-tight text-ink',
          )}
        >
          {pin.kind === 'airport' ? (
            <>
              <span className="font-mono text-[12px] font-semibold tracking-[0.08em]">{pin.label}</span>
              {pin.sub ? <span className="text-[12px] text-ink-2">{pin.sub}</span> : null}
            </>
          ) : (
            <span className={pin.kind === 'home' ? 'font-medium' : undefined}>{pin.label}</span>
          )}
        </span>
      </span>
    </div>
  )
}
