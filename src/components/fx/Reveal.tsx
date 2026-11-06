import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useReveal } from './useReveal'

interface RevealProps {
  children: ReactNode
  className?: string
  delayMs?: number
}

/** Wraps content so it fades in when it scrolls into view. */
export function Reveal({ children, className, delayMs = 0 }: RevealProps) {
  const ref = useReveal<HTMLDivElement>()
  const style: CSSProperties = delayMs ? { transitionDelay: `${delayMs}ms` } : {}
  return (
    <div ref={ref} className={cn(className)} style={style}>
      {children}
    </div>
  )
}
