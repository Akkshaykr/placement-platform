import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabase } from '@/lib/supabase'
import { AuthContext, type AuthContextValue, type RolesStatus } from './authContext'
import { signOutUser } from './api'
import { meQueryKey } from './queryKeys'
import { profileSchema, roleRowsSchema } from './types'

async function fetchMe(userId: string) {
  const supabase = getSupabase()
  const [rolesRes, profileRes] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', userId),
    supabase.from('profiles').select('id, display_name, avatar_url').eq('id', userId).maybeSingle(),
  ])
  if (rolesRes.error) throw rolesRes.error
  if (profileRes.error) throw profileRes.error
  return {
    roles: roleRowsSchema.parse(rolesRes.data).map((r) => r.role),
    profile: profileRes.data ? profileSchema.parse(profileRes.data) : null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [initialised, setInitialised] = useState(false)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    const supabase = getSupabase()
    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setInitialised(true)
    })

    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the client.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setInitialised(true)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') {
        setRecovering(false)
        queryClient.clear()
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [queryClient])

  const userId = session?.user.id
  const me = useQuery({
    queryKey: meQueryKey(userId),
    queryFn: () => fetchMe(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const refetch = me.refetch
  const retryRoles = useCallback(() => void refetch(), [refetch])
  const signOut = useCallback(async () => {
    await signOutUser()
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const status = !initialised ? 'loading' : session ? 'authenticated' : 'unauthenticated'
    const rolesStatus: RolesStatus = !userId
      ? 'idle'
      : me.isError
        ? 'error'
        : me.data
          ? 'ready'
          : 'loading'
    const roles = me.data?.roles ?? []
    return {
      status,
      session,
      user: session?.user ?? null,
      roles,
      rolesStatus,
      isAdmin: roles.includes('ADMIN'),
      profile: me.data?.profile ?? null,
      recovering,
      retryRoles,
      signOut,
    }
  }, [initialised, session, userId, me.isError, me.data, recovering, retryRoles, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
