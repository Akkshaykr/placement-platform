import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/cn'

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: string
  ref?: Ref<HTMLInputElement>
}

/** Label + input + hint + error, wired together with the right ARIA attributes. */
export function Field({ label, hint, error, className, id, ref, ...rest }: FieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-11 w-full rounded-control border bg-canvas px-3 text-base text-ink placeholder:text-ink-muted/70',
          'transition-colors focus:border-brand-soft disabled:opacity-60 sm:text-sm',
          error ? 'border-danger' : 'border-line-strong',
          className,
        )}
        {...rest}
      />
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-danger-soft">
          {error}
        </p>
      ) : null}
    </div>
  )
}
