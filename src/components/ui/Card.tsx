import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Translucent, blurred surface. Use on a few key panels, not on every card. */
  glass?: boolean
  /** Lifts and highlights on hover. Use for cards that link somewhere or open something. */
  interactive?: boolean
}

export function Card({ className, glass = false, interactive = false, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-panel border',
        glass ? 'fx-glass' : 'border-line bg-surface',
        interactive &&
          'transition duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-soft/60 hover:shadow-lg hover:shadow-black/25 motion-reduce:transform-none motion-reduce:transition-none',
        className,
      )}
      {...rest}
    />
  )
}
