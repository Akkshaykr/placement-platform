import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { requestPasswordReset } from './api'
import { forgotPasswordSchema, type ForgotPasswordValues } from './schemas'

export function ForgotPasswordPage() {
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } })

  const onSubmit = async ({ email }: ForgotPasswordValues) => {
    setFormError(null)
    const result = await requestPasswordReset(email)
    if (result.ok) setSent(true)
    else setFormError(result.error.message)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      {sent ? (
        <Alert tone="success" className="mt-6" title="Check your email">
          If an account exists for that address, we’ve sent a link to choose a new password.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-4">
          <p className="text-sm text-ink-muted">Enter the email you registered with and we’ll send you a reset link.</p>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field label="Email" type="email" autoComplete="email" inputMode="email" error={errors.email?.message} {...register('email')} />
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-sm">
        <Link to="/login" className="text-brand-soft underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
