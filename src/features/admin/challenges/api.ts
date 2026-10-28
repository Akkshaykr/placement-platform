import { z } from 'zod'
import { getSupabase } from '@/lib/supabase'
import { toAppError } from '@/features/assessment/errors'
import {
  adminChallengeDetailSchema,
  adminChallengeRowSchema,
  analyticsSchema,
  participantSchema,
  type Analytics,
  type AdminChallengeDetail,
  type AdminChallengeRow,
} from '@/features/admin/adminSchemas'

async function call<T extends z.ZodType>(name: string, args: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
  const { data, error } = await getSupabase().rpc(name, args)
  if (error) throw toAppError(error)
  return schema.parse(data)
}

export interface ChallengeFilters {
  status?: string
  topic_id?: string
  difficulty?: string
  from?: string
  to?: string
  q?: string
}

export const listAdminChallenges = (filters: ChallengeFilters) =>
  call('admin_list_challenges', { p_filters: cleanFilters(filters) }, z.array(adminChallengeRowSchema))

export const getAdminChallenge = (id: string) =>
  call('admin_get_challenge', { p_challenge_id: id }, adminChallengeDetailSchema)

export const saveChallenge = (id: string | null, data: Record<string, unknown>) =>
  call('admin_save_challenge', { p_id: id, p_data: data }, z.string())

export const setChallengeQuestions = (id: string, items: { question_version_id: string; marks: number | null }[]) =>
  call('admin_set_challenge_questions', { p_challenge_id: id, p_items: items }, z.unknown())

export const publishChallenge = (id: string) => call('admin_publish_challenge', { p_id: id }, z.unknown())

export const transitionChallenge = (id: string, action: 'CANCEL' | 'COMPLETE' | 'ARCHIVE' | 'DELETE') =>
  call('admin_transition_challenge', { p_id: id, p_action: action }, z.unknown())

export const challengeParticipants = (id: string) =>
  call('admin_challenge_participants', { p_challenge_id: id }, z.array(participantSchema))

export const challengeAnalytics = (id: string): Promise<Analytics> =>
  call('admin_challenge_analytics', { p_challenge_id: id }, analyticsSchema)

export type { AdminChallengeDetail, AdminChallengeRow }

/** Drops empty filter values so they are not sent as empty strings. */
export function cleanFilters(filters: object): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => typeof v === 'string' && v !== '')) as Record<string, string>
}
