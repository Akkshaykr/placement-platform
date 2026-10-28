import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { meQueryKey } from '@/features/auth/queryKeys'
import { useAuth } from '@/features/auth/useAuth'
import { getSupabase } from '@/lib/supabase'

const profileFormSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a display name.').max(60, 'Use at most 60 characters.'),
})
type ProfileFormValues = z.infer<typeof profileFormSchema>

export function ProfilePage() {
  const { profile, user, roles, rolesStatus } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    values: { displayName: profile?.display_name ?? '' },
  })

  if (!user || rolesStatus === 'loading' || rolesStatus === 'idle') {
    return <Skeleton className="h-64 max-w-lg" />
  }

  const onSubmit = async ({ displayName }: ProfileFormValues) => {
    // The database only lets a person update their own display_name; nothing else is writable.
    const { error } = await getSupabase().from('profiles').update({ display_name: displayName }).eq('id', user.id)
    if (error) {
      toast.error('We couldn’t save your changes. Try again.')
      return
    }
    await queryClient.invalidateQueries({ queryKey: meQueryKey(user.id) })
    toast.success('Profile updated.')
  }

  return (
    <div className="max-w-lg space-y-8">
      <h1 className="text-2xl font-semibold sm:text-3xl">Profile</h1>
      <Card className="p-6">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <Field label="Display name" autoComplete="name" error={errors.displayName?.message} {...register('displayName')} />
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </form>
      </Card>
      <Card className="space-y-4 p-6">
        <div>
          <p className="text-sm text-ink-muted">Email</p>
          <p className="mt-1 break-all">{user.email}</p>
        </div>
        <div>
          <p className="text-sm text-ink-muted">Access</p>
          <div className="mt-1 flex gap-2">
            {roles.map((r) => (
              <Badge key={r} tone={r === 'ADMIN' ? 'danger' : 'brand'}>
                {r === 'ADMIN' ? 'Administrator' : 'Student'}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
