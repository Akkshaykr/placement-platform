import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'brand' | 'danger' | 'success' | 'warning'

const tones: Record<Tone, string> = {
  neutral: 'border-line-strong text-ink-muted',
  brand: 'border-brand/50 bg-brand/15 text-brand-soft',
  danger: 'border-danger/50 bg-danger/15 text-danger-soft',
  success: 'border-success/50 bg-success/15 text-success',
  warning: 'border-warning/50 bg-warning/15 text-warning',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  )
}
