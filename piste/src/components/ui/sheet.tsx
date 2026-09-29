'use client'
/**
 * Accessible overlays built on Radix Dialog (focus trap, Escape, focus return, aria wiring).
 * - `side="bottom"`: mobile bottom sheet (safe-area aware).
 * - `side="right"`: desktop drawer (source drawer, filters, previews).
 * - `side="responsive"`: bottom sheet below md, right drawer at md+.
 * - `side="center"`: dialog.
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
      ? 'piste-sheet inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[18px] safe-bottom'
      : side === 'right'
        ? cn('piste-drawer inset-y-0 right-0 h-dvh w-[min(100vw,440px)]', widthClass)
        : side === 'center'
          ? 'piste-dialog left-1/2 top-1/2 w-[min(94vw,560px)] max-h-[86dvh] -translate-x-1/2 -translate-y-1/2 rounded-[14px]'
          : cn(
              'piste-responsive inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[18px] safe-bottom',
              'md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:h-dvh md:max-h-none md:rounded-none md:rounded-l-[14px]',
              widthClass,
            )
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="piste-overlay fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(
            'fixed z-50 flex flex-col border border-divider bg-surface text-ink shadow-overlay outline-none',
            position,
            className,
          )}
        >
          {side === 'bottom' || side === 'responsive' ? (
            <div aria-hidden className={cn('mx-auto mt-2 h-1 w-10 rounded-full bg-divider-strong', side === 'responsive' && 'md:hidden')} />
          ) : null}
          <div className="flex items-start justify-between gap-3 border-b border-divider px-5 pt-4 pb-3">
            <div className="min-w-0">
              <Dialog.Title className="text-[17px] font-semibold leading-snug">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-[13.5px] text-ink-2">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Details</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface-3 hover:text-ink"
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 scrollbar-thin">{children}</div>
          {footer ? <div className="border-t border-divider px-5 py-3">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export const SheetClose = Dialog.Close
