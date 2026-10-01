'use client'
/**
 * Accessible overlays built on Radix Dialog (focus trap, Escape, focus return, aria wiring).
 * - `side="bottom"`: mobile bottom sheet (safe-area aware).
 * - `side="right"`: desktop drawer (source drawer, filters, previews).
 * - `side="responsive"`: bottom sheet below md, right drawer at md+.
 * - `side="center"`: dialog.
 * Glass HUD: every overlay is a glass-strong panel (≥ 90% tint, opaque without backdrop-filter) over a blurred, dimmed
 * page. Bottom sheets have 28px top corners and a grab handle; drawers float 12px off the edges at md+ with 24px
 * corners; dialogs are 24px. Openings use a soft spring (CSS, transform/opacity only; instant under reduced motion).
 */
import type { ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

export interface SheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
  title: ReactNode
  description?: ReactNode
  side?: 'bottom' | 'right' | 'responsive' | 'center'
  children: ReactNode
  footer?: ReactNode
  className?: string
  widthClass?: string
  /**
   * Where focus goes on close. Radix returns it to the Trigger; a sheet opened programmatically (no trigger) should
   * pass this, call `event.preventDefault()` and focus the element that opened it.
   */
  onCloseAutoFocus?: (event: Event) => void
}

export function Sheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  side = 'responsive',
  children,
  footer,
  className,
  widthClass = 'md:w-[440px]',
  onCloseAutoFocus,
}: SheetProps) {
  const position =
    side === 'bottom'
      ? 'piste-sheet inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[28px] border-b-0 safe-bottom'
      : side === 'right'
        ? cn(
            'piste-drawer inset-y-0 right-0 h-dvh w-[min(100vw,440px)] max-w-full',
            'md:inset-y-3 md:right-3 md:h-auto md:max-w-[calc(100vw-24px)] md:rounded-[24px]',
            widthClass,
          )
        : side === 'center'
          ? 'piste-dialog left-1/2 top-1/2 w-[min(94vw,560px)] max-h-[86dvh] -translate-x-1/2 -translate-y-1/2 rounded-[24px]'
          : cn(
              'piste-responsive inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[28px] border-b-0 safe-bottom',
              'md:inset-y-3 md:right-3 md:left-auto md:bottom-auto md:h-auto md:max-h-none md:max-w-[calc(100vw-24px)] md:rounded-[24px] md:border-b',
              widthClass,
            )
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="piste-overlay fixed inset-0 z-50 bg-overlay backdrop-blur-[3px]" />
        <Dialog.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(
            'glass-strong fixed z-50 flex min-w-0 flex-col text-ink shadow-[var(--glass-shadow-lg)] outline-none',
            position,
            className,
          )}
        >
          {side === 'bottom' || side === 'responsive' ? (
            <div aria-hidden className={cn('mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-field-edge', side === 'responsive' && 'md:hidden')} />
          ) : null}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-glass-line px-5 pt-4 pb-3.5 md:px-6">
            <div className="min-w-0 pt-1">
              <Dialog.Title className="text-[18px] leading-snug font-semibold tracking-[-0.01em] break-words">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-[13.5px] text-ink-2">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Details</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-chip-track text-ink-2 transition-colors duration-150 hover:bg-chip-hover hover:text-ink md:size-10"
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 scrollbar-thin md:px-6">{children}</div>
          {footer ? <div className="shrink-0 border-t border-glass-line px-5 py-3 md:px-6">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export const SheetClose = Dialog.Close
