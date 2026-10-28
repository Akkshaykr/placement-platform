import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { ButtonVariant } from '@/components/ui/buttonStyles'

interface ConfirmActionProps {
  label: string
  /** The question the person must answer before the action runs. */
  question: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  variant?: ButtonVariant
  disabled?: boolean
  loading?: boolean
}

/**
 * Destructive actions take two deliberate steps: the first button asks, the second confirms.
 * Nothing irreversible happens on a single click.
 */
export function ConfirmAction({ label, question, confirmLabel, onConfirm, variant = 'secondary', disabled, loading }: ConfirmActionProps) {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <Button variant={variant} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    )
  }

  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">{question}</span>
      <Button
        variant="danger"
        loading={loading}
        onClick={async () => {
          await onConfirm()
          setAsking(false)
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setAsking(false)} disabled={loading}>
        Cancel
      </Button>
    </div>
  )
}
