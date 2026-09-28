import { forwardRef, type ButtonHTMLAttributes, type AnchorHTMLAttributes } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/ui/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 font-medium select-none whitespace-nowrap rounded-md border ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out-soft)] ' +
  'active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0'

const variants: Record<Variant, string> = {
  primary: 'bg-teal text-on-teal border-teal hover:bg-teal-strong hover:border-teal-strong shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)]',
  secondary: 'bg-surface text-ink border-divider-strong hover:border-teal hover:text-teal',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-surface-3',
  quiet: 'bg-glacier/60 text-teal border-transparent hover:bg-glacier',
  danger: 'bg-surface text-critical border-divider-strong hover:border-critical',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13.5px]',
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
        'inline-flex items-center justify-center rounded-md border transition-colors duration-150',
        variant === 'ghost' ? 'border-transparent text-ink-2 hover:bg-surface-3 hover:text-ink' : 'border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal',
        dims,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
