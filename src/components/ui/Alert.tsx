import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'info' | 'success' | 'warning' | 'danger'

const tones: Record<Tone, string> = {
  info: 'border-brand/50 bg-brand/10',
  success: 'border-success/50 bg-success/10',
  warning: 'border-warning/50 bg-warning/10',
  danger: 'border-danger/50 bg-danger/10',
}

export function Alert({ tone = 'info', title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-control border px-4 py-3 text-sm', tones[tone], className)}>
      {title ? <p className="font-medium text-ink">{title}</p> : null}
      {children ? <div className={cn('text-ink-muted', title && 'mt-1')}>{children}</div> : null}
    </div>
  )
}
