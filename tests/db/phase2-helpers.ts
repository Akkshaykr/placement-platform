import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { addAdmin, addUser, as, asUser, type Actor } from './harness'

export const MIN = 60_000
export const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

/** Runs one SQL statement as `actor` (RLS and grants apply) and returns the first column of the first row. */
export async function scalar<T = unknown>(db: PGlite, actor: Actor, sql: string, params: unknown[] = []): Promise<T> {
  return as(db, actor, async () => {
    const r = await db.query<Record<string, unknown>>(sql, params as never)
    const row = r.rows[0]
    return (row ? Object.values(row)[0] : undefined) as T
  })
}

/** Like scalar(), but reports the coded error prefix (e.g. "NOT_OPEN") instead of the full message. */
export async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toThrow(new RegExp(`${code}:`))
}

/** Creates the category and topic used by test content. Returns the topic id. */
export async function seedTopic(db: PGlite): Promise<string> {
  const cat = await db.query<{ id: string }>(
    `insert into public.categories (slug, name) values ($1, 'Test category') returning id`,
    [`cat-${randomUUID().slice(0, 8)}`],
  )
  const topic = await db.query<{ id: string }>(
    `insert into public.topics (category_id, slug, name) values ($1, $2, 'Test topic') returning id`,
    [cat.rows[0]!.id, `topic-${randomUUID().slice(0, 8)}`],
  )
  return topic.rows[0]!.id
}

export interface ApprovedQuestion {
  questionId: string
  questionVersionId: string
  optionIds: string[]
  correctOptionId: string
}

/**
 * Creates a question through the admin function and approves it through the admin function.
 * `correct` is the 1-based position of the correct option.
 */
export async function approvedQuestion(
  db: PGlite,
  admin: string,
  topicId: string,
  opts: { stem?: string; correct?: number; options?: string[]; origin?: 'MANUAL' | 'AI'; explanation?: string } = {},
): Promise<ApprovedQuestion> {
  const saved = await scalar<{ question_id: string; question_version_id: string }>(
    db,
    asUser(admin),
    'select public.admin_save_question(null, $1::jsonb)',
    [
      JSON.stringify({
        stem: opts.stem ?? `Question ${randomUUID().slice(0, 6)}: what is 2 + 2?`,
        topic_id: topicId,
        subtopic: 'Basics',
        difficulty: 'EASY',
        estimated_seconds: 60,
        options: opts.options ?? ['3', '4', '5', '6'],
        correct_position: opts.correct ?? 2,
        explanation: opts.explanation ?? 'Two plus two is four.',
        origin: opts.origin ?? 'MANUAL',
      }),
    ],
  )
  await scalar(db, asUser(admin), 'select public.admin_approve_question($1::uuid, true)', [saved.question_version_id])
  const detail = await scalar<{ options: { id: string }[]; correct_option_id: string }>(
    db,
    asUser(admin),
    'select public.admin_get_question($1::uuid)',
    [saved.question_id],
  )
  return {
    questionId: saved.question_id,
    questionVersionId: saved.question_version_id,
    optionIds: detail.options.map((o) => o.id),
    correctOptionId: detail.correct_option_id,
  }
}

export interface ChallengeInput {
  title?: string
  slug?: string
  topicId: string
  startMs?: number | null
  endMs?: number | null
  timeLimit?: number
  target?: number
  maxAttempts?: number | null
  participantLimit?: number | null
  negative?: boolean
  penalty?: number
  pointsPerCorrect?: number
  shuffleQuestions?: boolean
  shuffleOptions?: boolean
  resultRelease?: 'IMMEDIATE' | 'AFTER_CLOSE' | 'NEVER'
}

export function challengeData(input: ChallengeInput, override: Record<string, unknown> = {}) {
  return {
    slug: input.slug ?? `ch-${randomUUID().slice(0, 8)}`,
    title: input.title ?? 'Aptitude sprint',
    description: 'Practice set.',
    instructions: 'Answer every question.',
    topic_id: input.topicId,
    difficulty: 'MEDIUM',
    start_at: input.startMs === null ? null : iso(input.startMs ?? -MIN),
    end_at: input.endMs === null ? null : iso(input.endMs ?? 24 * 60 * MIN),
    time_limit_minutes: input.timeLimit ?? 30,
    target_question_count: input.target ?? 1,
    max_attempts: input.maxAttempts ?? null,
    participant_limit: input.participantLimit ?? null,
    points_per_correct: input.pointsPerCorrect ?? 1,
    negative_marking_enabled: input.negative ?? false,
    penalty_per_incorrect: input.penalty ?? 0,
    shuffle_questions: input.shuffleQuestions ?? false,
    shuffle_options: input.shuffleOptions ?? false,
    result_release: input.resultRelease ?? 'IMMEDIATE',
    ...override,
  }
}

/** Creates a draft challenge, sets its questions (optionally with marks) and publishes it. */
export async function publishedChallenge(
  db: PGlite,
  admin: string,
  input: ChallengeInput,
  questions: { questionVersionId: string; marks?: number }[],
): Promise<{ challengeId: string; slug: string }> {
  const data = challengeData(input, { target_question_count: questions.length })
  const challengeId = await scalar<string>(
    db,
    asUser(admin),
    'select public.admin_save_challenge(null, $1::jsonb)',
    [JSON.stringify(data)],
  )
  await scalar(
    db,
    asUser(admin),
    'select public.admin_set_challenge_questions($1::uuid, $2::jsonb)',
    [challengeId, JSON.stringify(questions.map((q) => ({ question_version_id: q.questionVersionId, marks: q.marks ?? null })))],
  )
  await scalar(db, asUser(admin), 'select public.admin_publish_challenge($1::uuid)', [challengeId])
  return { challengeId, slug: data.slug }
}

/** Gives a student their own account (role USER is granted by the signup trigger). */
export async function student(db: PGlite): Promise<string> {
  return addUser(db)
}

export async function administrator(db: PGlite): Promise<string> {
  return addAdmin(db)
}

/** Forces an attempt's deadline into the past, as if real time had passed (owner-side test setup only). */
export async function expireAttempt(db: PGlite, attemptId: string): Promise<void> {
  await db.query(
    `update public.challenge_attempts set deadline_at = now() - interval '1 second', started_at = now() - interval '2 hours' where id = $1`,
    [attemptId],
  )
}

export interface AttemptView {
  attempt_id: string
  status: string
  deadline_at: string
  questions: { position: number; question_version_id: string; options: { id: string; body: string }[] }[]
  answers: { question_version_id: string; selected_option_id: string | null }[]
}
