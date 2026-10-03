'use client'
/**
 * The checker's answer as the hero card. Each new question lands with a spring rise, a one-off specular sheen and the
 * count-up of its number; while the next answer loads, a scan line sweeps the current one. Tone is always shape +
 * label (status chip with icon), never colour alone: teal = covered, copper = covered but outside the announced
 * season, critical = not covered, caution = discount or some days, ink = no access recorded (never permission).
 */
import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarRange, Crosshair, Loader2 } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { CountUp } from './count-up'
import { STATUS_META } from './format'
import { usePassesNav } from './nav'
import { PunchMeter } from './punch-meter'
import css from './hud.module.css'
import type { VerdictModel, VerdictTone } from './verdict-model'

const TONE: Record<VerdictTone, string> = {
  yes: 'bg-teal text-on-teal',
  outside: 'bg-copper text-on-teal',
  caution: 'bg-caution text-on-teal',
  no: 'bg-critical text-on-teal',
  unknown: 'bg-ink-chip text-on-ink-chip',
  idle: 'border border-dashed border-divider-strong bg-glass-soft text-ink',
}

function Corner({ className }: { className: string }) {
  return <span aria-hidden className={cn('pointer-events-none absolute size-3.5 border-current opacity-50', className)} />
}

export function VerdictCard({ model, children }: { model: VerdictModel; children?: ReactNode }) {
  const { pending } = usePassesNav()
  const m = model.status ? STATUS_META[model.status] : null
  const statusLabel = model.chip ?? (model.tone === 'outside' ? 'Covered · outside season' : m?.label)
  return (
    <div className="relative min-h-[300px] min-w-0">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.section
          key={model.key}
          aria-live="polite"
          aria-busy={pending || undefined}
          aria-label="Answer"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.985, transition: { duration: 0.16 } }}
          transition={{ type: 'spring', stiffness: 340, damping: 30, mass: 0.9 }}
          className={cn('relative flex h-full min-h-[300px] flex-col gap-3 overflow-hidden rounded-[28px] p-5 md:p-6', TONE[model.tone])}
        >
          {model.tone !== 'idle' ? <span aria-hidden className={css.sheen} /> : null}
          {pending ? <span aria-hidden className={css.scan} /> : null}
          <Corner className="top-3 left-3 border-t border-l" />
          <Corner className="top-3 right-3 border-t border-r" />
          <Corner className="bottom-3 left-3 border-b border-l" />
          <Corner className="right-3 bottom-3 border-r border-b" />

          <div className="relative flex flex-col items-start gap-2 px-1 sm:flex-row sm:justify-between sm:gap-3">
            <span className="hud min-w-0 tracking-[0.14em] opacity-85 sm:flex-1">{model.query}</span>
            {m ? (
              <span className="hud inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/40 px-2.5 py-1 tracking-[0.08em]">
                <m.Icon aria-hidden className="size-3.5" strokeWidth={2} />
                {statusLabel}
              </span>
            ) : (
              <Crosshair aria-hidden className="size-4 shrink-0 opacity-60" />
            )}
          </div>

          <p className="relative m-0 px-1 text-[clamp(40px,4.6vw,64px)] leading-[1] font-light tracking-[-0.04em] text-balance">
            {model.count ? (
              <>
                <span className="tnum">
                  <CountUp value={model.count.value} />
                  {model.count.of != null ? <span className="opacity-60">/{model.count.of}</span> : null}
                </span>{' '}
                <span className="text-[0.5em] tracking-[-0.02em]">{model.headline}</span>
              </>
            ) : (
              model.headline
            )}
            {m && model.tone === 'unknown' ? <span className="sr-only"> — not permission</span> : null}
          </p>

          {model.detail ? <p className="relative m-0 max-w-[52ch] px-1 text-[15px] leading-[1.5] md:text-[16px]">{model.detail}</p> : null}

          {model.meter ? <PunchMeter onColor total={model.meter.total} used={model.meter.used} label={model.meter.label} className="relative px-1" /> : null}

          {model.days ? (
            <ol className="relative grid grid-cols-7 gap-1.5 px-1" aria-label="Day by day">
              {model.days.map((d, i) => {
                const dm = STATUS_META[d.status]
                return (
                  <li
                    key={d.date}
                    style={{ '--i': i } as CSSProperties}
                    className={cn(css.punch, 'flex flex-col items-center gap-0.5 rounded-[14px] border px-1 py-1.5 text-center', d.canSki ? 'border-current/50 bg-current/20' : d.status === 'unknown' ? 'border-dashed border-current/60' : 'border-current/20 [&>span:nth-child(2)]:line-through')}
                  >
                    <span className="text-[12px]">{d.wd}</span>
                    <span className="text-[14px] font-semibold tnum">{d.n}</span>
                    <dm.Icon aria-hidden className="size-3.5" strokeWidth={2} />
                    <span className="sr-only">{d.label}</span>
                  </li>
                )
              })}
            </ol>
          ) : null}

          {model.season ? (
            <p className="relative m-0 flex items-start gap-2 px-1 text-[14px] leading-[1.45] opacity-90">
              <CalendarRange aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{model.season}</span>
            </p>
          ) : null}

          {children ? <div className="relative px-1">{children}</div> : null}

          <div className="relative mt-auto flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
            <span className="hud tracking-[0.1em] opacity-80">
              {model.tone === 'idle' ? '◇ Answers come from each product’s own rules' : '◇ From the rule on file'}
            </span>
            {pending ? (
              <span className="hud inline-flex items-center gap-1.5 opacity-90">
                <Loader2 aria-hidden className="size-3.5 animate-spin" /> Checking
              </span>
            ) : null}
          </div>
        </motion.section>
      </AnimatePresence>
    </div>
  )
}
