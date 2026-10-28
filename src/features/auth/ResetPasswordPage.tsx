import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Field } from '@/components/ui/Field'
import { PageLoading } from '@/components/PageLoading'
import { useToast } from '@/components/ui/Toast'
import { updatePassword } from './api'
import { PASSWORD_MIN, resetPasswordSchema, type ResetPasswordValues } from './schemas'
import { useAuth } from './useAuth'

export function ResetPasswordPage() {
  const { status } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: '', confirmPassword: '' } })

  if (status === 'loading') return <PageLoading />

  // The recovery link signs the person in; without a session the link was invalid or has expired.
  if (status === 'unauthenticated') {
    return (
      <div>
        <h1 className="text-2xl font-semibold">This link has expired</h1>
        <p className="mt-3 text-ink-muted">Password reset links work once and expire quickly. Request a new one to continue.</p>
        <Link to="/forgot-password" className={`${buttonStyles('primary')} mt-6`}>
          Request a new link
        </Link>
      </div>
    )
  }

  const onSubmit = async ({ password }: ResetPasswordValues) => {
    setFormError(null)
    const result = await updatePassword(password)
    if (!result.ok) return setFormError(result.error.message)
    toast.success('Your password has been updated.')
    navigate('/dashboard', { replace: true })
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <Field label="New password" type="password" autoComplete="new-password" hint={`At least ${PASSWORD_MIN} characters.`} error={errors.password?.message} {...register('password')} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </div>
  )
}
