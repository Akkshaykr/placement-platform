import { z } from 'zod'

/** Response shapes of the Phase 2 student functions. Unknown keys are dropped; wrong types fail loudly. */

const uuid = z.string()
const iso = z.string()
const nullableIso = z.string().nullable()

export const challengeStateSchema = z.enum(['OPEN', 'UPCOMING', 'COMPLETED', 'CANCELLED', 'NOT_PUBLISHED'])
export type ChallengeState = z.infer<typeof challengeStateSchema>

export const releasePolicySchema = z.enum(['IMMEDIATE', 'AFTER_CLOSE', 'NEVER'])

export const attemptSummarySchema = z.object({
  attempt_id: uuid,
  status: z.string(),
  submitted_via: z.string().nullable().optional(),
  submitted_at: nullableIso.optional(),
  score: z.coerce.number(),
  max_score: z.coerce.number(),
  percentage: z.coerce.number(),
  correct_count: z.number(),
  incorrect_count: z.number(),
  unanswered_count: z.number(),
  time_taken_seconds: z.number(),
  attempt_number: z.number().optional(),
  started_at: iso.optional(),
})
export type AttemptSummary = z.infer<typeof attemptSummarySchema>

export const challengeSchema = z.object({
  id: uuid,
  slug: z.string(),
  title: z.string(),
  description: z.string().default(''),
  instructions: z.string().default(''),
  learning_objectives: z.array(z.string()).default([]),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  topic_name: z.string().nullable(),
  category_name: z.string().nullable(),
  state: challengeStateSchema,
  start_at: nullableIso,
  end_at: nullableIso,
  time_limit_minutes: z.number(),
  question_count: z.number(),
  participant_limit: z.number().nullable(),
  registered_count: z.number(),
  is_full: z.boolean(),
  is_registered: z.boolean(),
  max_attempts: z.number().nullable(),
  my_attempts: z.number(),
  running_attempt_id: uuid.nullable(),
  points_per_correct: z.coerce.number(),
  negative_marking_enabled: z.boolean(),
  penalty_per_incorrect: z.coerce.number(),
  shuffle_questions: z.boolean(),
  shuffle_options: z.boolean(),
  result_release: releasePolicySchema,
  attempts: z.array(attemptSummarySchema).optional(),
})
export type Challenge = z.infer<typeof challengeSchema>

export const challengeListSchema = z.array(challengeSchema)

export const attemptStateSchema = z.object({
  attempt_id: uuid,
  challenge_id: uuid,
  challenge_title: z.string(),
  status: z.enum(['IN_PROGRESS', 'SUBMITTED']),
  started_at: iso,
  deadline_at: iso,
  submitted_at: nullableIso,
  submitted_via: z.string().nullable(),
  server_now: iso,
  questions: z.array(
    z.object({
      position: z.number(),
      question_version_id: uuid,
      stem: z.string(),
      subtopic: z.string().nullable(),
      options: z.array(z.object({ id: uuid, body: z.string() })),
    }),
  ),
  answers: z.array(
    z.object({
      question_version_id: uuid,
      selected_option_id: uuid.nullable(),
      marked_for_review: z.boolean(),
    }),
  ),
})
export type AttemptState = z.infer<typeof attemptStateSchema>

export const saveResultSchema = z.object({
  saved: z.boolean(),
  code: z.string().optional(),
  status: z.string().optional(),
  saved_at: z.string().optional(),
  deadline_at: z.string().optional(),
})

export const resultSchema = z.object({
  attempt_id: uuid,
  status: z.string(),
  released: z.boolean().optional(),
  release_policy: releasePolicySchema.optional(),
  challenge: z
    .object({ id: uuid, slug: z.string(), title: z.string(), state: challengeStateSchema })
    .optional(),
  summary: attemptSummarySchema.optional(),
  questions: z
    .array(
      z.object({
        position: z.number(),
        question_version_id: uuid,
        stem: z.string(),
        subtopic: z.string().nullable(),
        topic_name: z.string().nullable(),
        selected_option_id: uuid.nullable(),
        marked_for_review: z.boolean(),
        answered: z.boolean(),
        is_correct: z.boolean().nullable(),
        points_awarded: z.coerce.number().nullable(),
        correct_option_id: uuid.nullable(),
        explanation: z.string().nullable(),
        options: z.array(z.object({ id: uuid, body: z.string(), is_correct: z.boolean().nullable() })),
      }),
    )
    .optional(),
  topics: z
    .array(
      z.object({
        topic_name: z.string(),
        total: z.number(),
        correct: z.number(),
        incorrect: z.number(),
        unanswered: z.number(),
        accuracy: z.coerce.number().nullable(),
      }),
    )
    .optional(),
})
export type Result = z.infer<typeof resultSchema>

export const leaderboardSchema = z.object({
  challenge: z.object({ id: uuid, title: z.string(), state: challengeStateSchema }),
  final: z.boolean(),
  total_ranked: z.number(),
  my_rank: z.number().nullable(),
  server_now: iso,
  entries: z.array(
    z.object({
      rank: z.number(),
      display_name: z.string(),
      score: z.coerce.number(),
      max_score: z.coerce.number(),
      correct_count: z.number(),
      submitted_at: nullableIso,
      is_me: z.boolean(),
    }),
  ),
})
export type Leaderboard = z.infer<typeof leaderboardSchema>

export const myAttemptsSchema = z.array(
  z.object({
    attempt_id: uuid,
    challenge_id: uuid,
    challenge_slug: z.string(),
    challenge_title: z.string(),
    attempt_number: z.number(),
    status: z.string(),
    started_at: iso,
    submitted_at: nullableIso,
    submitted_via: z.string().nullable(),
    score: z.coerce.number().nullable(),
    max_score: z.coerce.number().nullable(),
    percentage: z.coerce.number().nullable(),
    correct_count: z.number().nullable(),
    time_taken_seconds: z.number().nullable(),
  }),
)
export type MyAttempt = z.infer<typeof myAttemptsSchema>[number]
