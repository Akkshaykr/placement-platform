import { z } from 'zod'
import { getSupabase } from '@/lib/supabase'

const statsSchema = z.object({
  registered_users: z.number(),
  published_challenges: z.number(),
  challenges_in_preparation: z.number(),
  completed_attempts: z.number(),
  unique_participants: z.number(),
  open_reports: z.number(),
})
export type AdminStats = z.infer<typeof statsSchema>

/** Calls the admin-only database function. It refuses anyone who is not an administrator. */
export async function fetchAdminStats(): Promise<AdminStats> {
  const { data, error } = await getSupabase().rpc('admin_overview_stats')
  if (error) throw error
  return statsSchema.parse(data)
}
