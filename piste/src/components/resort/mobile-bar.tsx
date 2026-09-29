/**
 * Mobile sticky action bar (below md): Save · Compare · Add to trip always one tap away, sitting just above the
 * bottom navigation. A spacer keeps the last section clear of it. Desktop uses the header and the section bar.
 */
import { ResortActions, type ResortActionsProps } from './resort-actions'

export function MobileActionBar({ actions }: { actions: ResortActionsProps }) {
  return (
    <>
      <div aria-hidden className="h-16 md:hidden" />
      <div
        role="region"
        data-mobile-actions
        aria-label={`Actions for ${actions.shortName}`}
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-divider bg-surface/95 px-4 py-2 backdrop-blur-sm md:hidden"
      >
        <ResortActions variant="bar" {...actions} />
      </div>
    </>
  )
}
