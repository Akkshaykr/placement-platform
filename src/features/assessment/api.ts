import { z } from 'zod'
import { getSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import {
  attemptStateSchema,
  challengeListSchema,
  challengeSchema,
  leaderboardSchema,
  myAttemptsSchema,
  resultSchema,
  saveResultSchema,
  type AttemptState,
  type Challenge,
  type Leaderboard,
  type MyAttempt,
  type Result,
} from './schemas'
import type { AnswerDraft, SaveOutcome } from './answerSync'

/** Calls a Phase 2 function and validates the answer. Errors are converted to stable codes. */
async function call<T extends z.ZodType>(name: string, args: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
  const { data, error } = await getSupabase().rpc(name, args)
  if (error) throw toAppError(error)
  return schema.parse(data)
}

export const listChallenges = () => call('student_list_challenges', {}, challengeListSchema)

export const challengeDetail = (slug: string) => call('student_challenge_detail', { p_slug: slug }, challengeSchema)

export const registerForChallenge = (challengeId: string) =>
  call('student_register', { p_challenge_id: challengeId }, z.object({ registered: z.boolean() }))

export const startAttempt = (challengeId: string) =>
  call('student_start_attempt', { p_challenge_id: challengeId }, attemptStateSchema)

export const getAttempt = (attemptId: string) => call('student_get_attempt', { p_attempt_id: attemptId }, attemptStateSchema)

export const saveAnswer = async (draft: AnswerDraft): Promise<SaveOutcome> => {
  const result = await call(
    'student_save_answer',
    {
      p_attempt_id: draft.attemptId,
      p_question_version_id: draft.questionVersionId,
      p_option_id: draft.optionId,
      p_marked_for_review: draft.marked,
    },
    saveResultSchema,
  )
  return { saved: result.saved, code: result.code }
}

export const submitAttempt = (attemptId: string) =>
  call('student_submit_attempt', { p_attempt_id: attemptId }, z.object({ attempt_id: z.string() }).passthrough())

export const getResult = (attemptId: string) => call('student_get_result', { p_attempt_id: attemptId }, resultSchema)

export const leaderboard = (challengeId: string, limit = 50) =>
  call('student_leaderboard', { p_challenge_id: challengeId, p_limit: limit }, leaderboardSchema)

export const myAttempts = () => call('student_my_attempts', {}, myAttemptsSchema)

export type { AttemptState, Challenge, Leaderboard, MyAttempt, Result }
