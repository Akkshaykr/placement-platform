import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { resendConfirmation, signUpWithEmail } from './api'
import { rememberNextPath } from './nextPath'
import { PASSWORD_MIN, registerSchema, type RegisterValues } from './schemas'

export function RegisterPage() {
  const [params] = useSearchParams()
  const next = params.get('next')
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
  })

  const onSubmit = async (values: RegisterValues) => {
    setFormError(null)
    rememberNextPath(next)
    const result = await signUpWithEmail(values)
    if (!result.ok) return setFormError(result.error.message)
    // If confirmation is disabled the session already exists and the route guard redirects.
    if (!result.value.signedIn) setSentTo(values.email)
  }

  if (sentTo) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="mt-3 text-ink-muted">
          If <span className="font-medium text-ink">{sentTo}</span> can be used for a new account, we’ve sent a confirmation link to it. Open the link to finish signing up.
        </p>
        <Button
          variant="secondary"
          className="mt-6"
          onClick={async () => {
            const r = await resendConfirmation(sentTo)
            if (r.ok) toast.success('Another email is on its way.')
            else toast.error(r.error.message)
          }}
        >
          Resend email
        </Button>
        <p className="mt-6 text-sm text-ink-muted">
          Already confirmed?{' '}
          <Link to="/login" className="text-brand-soft underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mt-2 text-sm text-ink-muted">Enter your details to get started.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <Field label="Full name" autoComplete="name" error={errors.displayName?.message} {...register('displayName')} />
        <Field label="Email" type="email" autoComplete="email" inputMode="email" error={errors.email?.message} {...register('email')} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          error={errors.password?.message}
          {...register('password')}
        />
        <Field label="Confirm password" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        Already registered?{' '}
        <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="text-brand-soft underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}