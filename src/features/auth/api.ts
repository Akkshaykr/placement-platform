import { getSiteUrl, getSupabase } from '@/lib/supabase'
import { describeAuthError, type AuthFailure } from './errors'

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: AuthFailure }

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return { ok: false, error: describeAuthError(error) }
  }
}

export interface SignUpInput {
  email: string
  password: string
  displayName: string
}

/**
 * With email confirmation on, Supabase returns no session and (to prevent account enumeration)
 * the same shape whether or not the address is already registered. The UI therefore always says
 * "check your email" and never reveals whether the address was new.
 */
export function signUpWithEmail({ email, password, displayName }: SignUpInput): Promise<Result<{ signedIn: boolean }>> {
  return run(async () => {
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: { data: { full_name: displayName }, emailRedirectTo: `${getSiteUrl()}/auth/callback` },
    })
    if (error) throw error
    return { signedIn: data.session !== null }
  })
}

export function signInWithEmail(email: string, password: string): Promise<Result> {
  return run(async () => {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password })
    if (error) throw error
  })
}

export function resendConfirmation(email: string): Promise<Result> {
  return run(async () => {
    const { error } = await getSupabase().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${getSiteUrl()}/auth/callback` },
    })
    if (error) throw error
  })
}

export function requestPasswordReset(email: string): Promise<Result> {
  return run(async () => {
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${getSiteUrl()}/reset-password`,
    })
    if (error) throw error
  })
}

export function updatePassword(password: string): Promise<Result> {
  return run(async () => {
    const { error } = await getSupabase().auth.updateUser({ password })
    if (error) throw error
  })
}

export function signOutUser(): Promise<Result> {
  return run(async () => {
    const { error } = await getSupabase().auth.signOut()
    if (error) throw error
  })
}