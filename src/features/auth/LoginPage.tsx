import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { safeNextPath } from '@/lib/safeRedirect'
import { resendConfirmation, signInWithEmail } from './api'
import { GoogleButton } from './GoogleButton'
import { loginSchema, type LoginValues } from './schemas'

export function LoginPage() {
  const [params] = useSearchParams()
  const next = params.get('next')
  const toast = useToast()
  const [formError, setFormError] = useState<{ code: string; message: string } | null>(null)
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  const onSubmit = async (values: LoginValues) => {
    setFormError(null)
    const result = await signInWithEmail(values.email, values.password)
    // On success the auth listener updates the session and <RedirectIfAuthenticated> navigates.
    if (!result.ok) setFormError(result.error)
  }

  const onResend = async () => {
    const result = await resendConfirmation(getValues('email'))
    if (result.ok) toast.success('If that address needs confirming, a new email is on its way.')
    else toast.error(result.error.message)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-ink-muted">Welcome back. Pick up where you left off.</p>

      <div className="mt-8 space-y-4">
        <GoogleButton next={safeNextPath(next)} onError={(m) => setFormError({ code: 'oauth', message: m })} />
        <div className="flex items-center gap-3 text-xs text-ink-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {formError ? (
            <Alert tone="danger">
              {formError.message}
              {formError.code === 'email_not_confirmed' ? (
                <button type="button" onClick={onResend} className="mt-2 block font-medium text-brand-soft underline underline-offset-2">
                  Resend confirmation email
                </button>
              ) : null}
            </Alert>
          ) : null}
          <Field label="Email" type="email" autoComplete="email" inputMode="email" error={errors.email?.message} {...register('email')} />
          <Field label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
          <div className="text-right">
            <Link to="/forgot-password" className="text-sm text-brand-soft underline-offset-2 hover:underline">
              Forgot your password?
            </Link>
          </div>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>
      </div>

      <p className="mt-6 text-sm text-ink-muted">
        New here?{' '}
        <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="text-brand-soft underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  )
}
