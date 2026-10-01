/**
 * Form primitives: every control has a visible, associated label. Glass HUD fields: an opaque field fill (text never
 * sits on bare glass), a 3:1 boundary (WCAG 1.4.11), 12px radius, and a teal edge + soft halo on focus on top of the
 * global focus outline.
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/ui/cn'

const control =
  'w-full min-w-0 rounded-[12px] border border-field-edge bg-field px-3 text-[15px] text-ink placeholder:text-ink-3 ' +
  'transition-[border-color,box-shadow] duration-150 hover:border-field-edge-hover ' +
  'focus:border-teal focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--focus)_18%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 ' +
  'disabled:border-glass-line disabled:bg-chip-track disabled:text-ink-3 aria-[invalid=true]:border-critical'

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  optional,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
  htmlFor?: string
  optional?: boolean
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13.5px] font-medium text-ink">
        {label}
        {/* A real space, so the accessible name reads "Grooming (optional)", not "Grooming(optional)". */}
        {optional ? <span className="font-normal text-ink-3"> (optional)</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-[12.5px] text-ink-3">{hint}</p> : null}
      {error ? (
        <p className="text-[12.5px] font-medium text-critical" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, 'h-11 md:h-10', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(control, 'h-11 appearance-none truncate bg-(image:--chevron) bg-[length:12px] bg-[right_14px_center] bg-no-repeat pr-10 md:h-10', className)}
      {...rest}
    >
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-24 py-2 leading-relaxed', className)} {...rest} />
})

export function Checkbox({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input id={rest.id ?? id} type="checkbox" className="mt-0.5 size-5 shrink-0 rounded-[6px] accent-[var(--teal)]" {...rest} />
      <label htmlFor={rest.id ?? id} className="min-w-0 text-[14.5px] text-ink">
        {label}
        {hint ? <span className="block text-[12.5px] text-ink-3">{hint}</span> : null}
      </label>
    </div>
  )
}
