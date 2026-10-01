import { forwardRef, type ButtonHTMLAttributes, type AnchorHTMLAttributes } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/ui/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger'
type Size = 'sm' | 'md' | 'lg'

/*
 * Glass HUD buttons: pills. Primary is the dark HUD chip; secondary is a glass-strong pill; ghost/quiet sit on a chip
 * track. Hover lifts by 1px (transform only, 150ms; collapses under reduced motion). Disabled is a designed state —
 * a flat track with readable ink-3 text — never a washed-out primary that looks broken.
 */
const base =
  'inline-flex min-w-0 items-center justify-center gap-2 font-medium select-none whitespace-nowrap rounded-full border ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out-soft)] ' +
  'not-disabled:hover:-translate-y-px not-disabled:active:translate-y-0 not-disabled:active:scale-[0.98] ' +
  'disabled:border-transparent disabled:bg-chip-track disabled:text-ink-3 disabled:shadow-none'

const variants: Record<Variant, string> = {
  primary:
    'bg-ink-chip text-on-ink-chip border-ink-chip shadow-[0_8px_20px_-8px_rgb(19_32_44/0.5)] not-disabled:hover:shadow-[0_12px_26px_-10px_rgb(19_32_44/0.6)]',
  secondary:
    'glass-strong text-ink shadow-[0_6px_18px_-10px_rgb(19_32_44/0.35)] not-disabled:hover:border-field-edge not-disabled:hover:text-ink',
  ghost: 'bg-transparent text-ink border-transparent not-disabled:hover:bg-chip-hover',
  quiet: 'bg-glacier/70 text-teal border-transparent not-disabled:hover:bg-glacier',
  danger: 'glass-strong text-critical not-disabled:hover:border-critical',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13.5px]',
  md: 'h-10 px-4 text-[14.5px]',
  lg: 'h-12 px-5 text-[15px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest} />
})

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  variant?: Variant
  size?: Size
  external?: boolean
}

/** Link styled as a button. External links open in a new tab with rel=noopener. */
export function ButtonLink({ href, variant = 'secondary', size = 'md', className, external, children, ...rest }: ButtonLinkProps) {
  const cls = cn(base, variants[variant], sizes[size], className)
  if (external || /^https?:/.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'ghost' | 'secondary'
}

/** Icon-only button; `label` becomes the accessible name. lg = 44px touch target. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', variant = 'ghost', className, type = 'button', children, ...rest },
  ref,
) {
  const dims = size === 'sm' ? 'size-8' : size === 'md' ? 'size-10' : 'size-11'
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,transform] duration-150 disabled:opacity-50',
        variant === 'ghost' ? 'border-transparent text-ink-2 not-disabled:hover:bg-chip-hover not-disabled:hover:text-ink' : 'glass-strong text-ink not-disabled:hover:-translate-y-px not-disabled:hover:border-field-edge',
        dims,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
