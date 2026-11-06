import { z } from 'zod'

export const checkSchema = z.object({
  check: z.string(),
  outcome: z.enum(['PASS', 'WARN', 'FAIL', 'SKIPPED']),
  message: z.string(),
})
export type Check = z.infer<typeof checkSchema>

export const adminChallengeRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.string(),
  state: z.string(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  topic_id: z.string().nullable(),
  topic_name: z.string().nullable(),
  category_name: z.string().nullable(),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  time_limit_minutes: z.number(),
  target_question_count: z.number(),
  participant_limit: z.number().nullable(),
  updated_at: z.string(),
  registrations: z.number(),
  completed_attempts: z.number(),
})
export type AdminChallengeRow = z.infer<typeof adminChallengeRowSchema>

export const adminChallengeDetailSchema = z.object({
  challenge: z.object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    instructions: z.string(),
    status: z.string(),
    state: z.string(),
    topic_id: z.string().nullable(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
    start_at: z.string().nullable(),
    end_at: z.string().nullable(),
    time_limit_minutes: z.number(),
    target_question_count: z.number(),
    max_attempts: z.number().nullable(),
    participant_limit: z.number().nullable(),
    points_per_correct: z.coerce.number(),
    negative_marking_enabled: z.boolean(),
    penalty_per_incorrect: z.coerce.number(),
    shuffle_questions: z.boolean(),
    shuffle_options: z.boolean(),
    result_release: z.enum(['IMMEDIATE', 'AFTER_CLOSE', 'NEVER']),
    languages: z.array(z.string()).default(['en']),
    registrations: z.number(),
    attempts: z.number(),
  }),
  working_version_frozen: z.boolean(),
  questions: z.array(
    z.object({
      position: z.number(),
      marks: z.coerce.number(),
      question_version_id: z.string(),
      question_id: z.string(),
      stem: z.string(),
      subtopic: z.string().nullable(),
      difficulty: z.string(),
      review_status: z.string(),
      topic_name: z.string().nullable(),
      tamil_ready: z.boolean().default(false),
    }),
  ),
})
export type AdminChallengeDetail = z.infer<typeof adminChallengeDetailSchema>

export const questionRowSchema = z.object({
  question_id: z.string(),
  question_version_id: z.string(),
  version_number: z.number(),
  stem: z.string(),
  subtopic: z.string().nullable(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  estimated_seconds: z.number(),
  review_status: z.string(),
  origin: z.string(),
  locked: z.boolean(),
  topic_id: z.string().nullable(),
  topic_name: z.string().nullable(),
  category_id: z.string().nullable(),
  category_name: z.string().nullable(),
  updated_at: z.string(),
})
export type QuestionRow = z.infer<typeof questionRowSchema>

export const questionDetailSchema = z.object({
  question_id: z.string(),
  origin: z.string(),
  question_version_id: z.string(),
  version_number: z.number(),
  version_count: z.number(),
  locked: z.boolean(),
  stem: z.string(),
  subtopic: z.string().nullable(),
  topic_id: z.string().nullable(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  estimated_seconds: z.number(),
  review_status: z.string(),
  approved_at: z.string().nullable(),
  options: z.array(z.object({ id: z.string(), position: z.number(), body: z.string() })),
  correct_option_id: z.string().nullable(),
  explanation: z.string().nullable(),
  checks: z.array(checkSchema),
  tamil: z
    .object({
      status: z.string(),
      source: z.string(),
      stem: z.string(),
      subtopic: z.string().nullable(),
      explanation: z.string(),
      reviewed_at: z.string().nullable(),
      options: z.array(z.string()),
    })
    .nullable()
    .default(null),
})
export type QuestionDetail = z.infer<typeof questionDetailSchema>

export const participantSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  registered_at: z.string(),
  attempts: z.number(),
  completed_attempts: z.number(),
  best_score: z.coerce.number().nullable(),
})
export type Participant = z.infer<typeof participantSchema>

export const analyticsSchema = z.object({
  registered: z.number(),
  started_attempts: z.number(),
  started_users: z.number(),
  completed_attempts: z.number(),
  completed_users: z.number(),
  participation_rate: z.number().nullable(),
  completion_rate: z.number().nullable(),
  average_score: z.coerce.number().nullable(),
  average_percentage: z.coerce.number().nullable(),
  max_score: z.coerce.number(),
  score_distribution: z.array(z.object({ band: z.string(), count: z.number() })),
  questions: z.array(
    z.object({
      position: z.number(),
      question_version_id: z.string(),
      stem: z.string(),
      seen: z.number(),
      answered: z.number(),
      correct: z.number(),
      correct_rate: z.number().nullable(),
      discrimination: z.number().nullable(),
      flag: z.enum(['TOO_EASY', 'TOO_DIFFICULT', 'POSSIBLY_AMBIGUOUS']).nullable(),
    }),
  ),
  topics: z.array(
    z.object({
      topic_name: z.string(),
      answers: z.number(),
      correct: z.number(),
      accuracy: z.number().nullable(),
    }),
  ),
})
export type Analytics = z.infer<typeof analyticsSchema>

export const aiStatusSchema = z.object({
  enabled: z.boolean(),
  max_questions_per_request: z.number(),
  daily_limit: z.number(),
  used_today: z.number(),
})
export type AiStatus = z.infer<typeof aiStatusSchema>
