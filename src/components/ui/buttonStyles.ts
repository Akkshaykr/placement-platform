import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'lg'

export const buttonStyles = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-55',
    size === 'md' ? 'h-10 px-4 text-sm' : 'h-12 px-6 text-base',
    variant === 'primary' && 'bg-brand text-ink hover:bg-brand-hover',
    variant === 'secondary' && 'border border-line-strong bg-raised text-ink hover:border-brand-soft',
    variant === 'ghost' && 'text-ink-muted hover:bg-raised hover:text-ink',
    variant === 'danger' && 'bg-danger text-canvas hover:bg-danger-soft',
  )

