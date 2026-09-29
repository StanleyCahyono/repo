/** Form primitives: every control has a visible, associated label. */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/ui/cn'

const control =
  'w-full rounded-md border border-divider-strong bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 ' +
  'transition-colors duration-150 hover:border-ink-3 focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 ' +
  'disabled:bg-surface-3 disabled:text-ink-3 aria-[invalid=true]:border-critical'

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
    <select ref={ref} className={cn(control, 'h-11 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9 md:h-10', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5l5-5' fill='none' stroke='%2352616b' stroke-width='1.6'/%3E%3C/svg%3E\")" }} {...rest}>
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
      <input id={rest.id ?? id} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--teal)]" {...rest} />
      <label htmlFor={rest.id ?? id} className="text-[14.5px] text-ink">
        {label}
        {hint ? <span className="block text-[12.5px] text-ink-3">{hint}</span> : null}
      </label>
    </div>
  )
}
