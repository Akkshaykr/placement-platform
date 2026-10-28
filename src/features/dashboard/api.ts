import { getSupabase } from '@/lib/supabase'

/** Challenges the signed-in person can currently see. Row level security applies the visibility rules. */
export async function countOpenChallenges(): Promise<number> {
  const { count, error } = await getSupabase().from('challenges').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

/** The person's own submitted attempts (row level security restricts the rows to their own). */
export async function countCompletedAttempts(): Promise<number> {
  const { count, error } = await getSupabase()
    .from('challenge_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'SUBMITTED')
  if (error) throw error
  return count ?? 0
}
