import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb } from './harness'
import {
  MIN,
  administrator,
  approvedQuestion,
  expectCode,
  expireAttempt,
  publishedChallenge,
  scalar,
  seedTopic,
  student,
  type ApprovedQuestion,
  type AttemptView,
} from './phase2-helpers'

interface Analytics {
  registered: number
  started_attempts: number
  started_users: number
  completed_attempts: number
  participation_rate: number | null
  completion_rate: number | null
  average_percentage: number | null
  max_score: number
  score_distribution: { band: string; count: number }[]
  questions: { position: number; seen: number; correct: number; correct_rate: number | null; flag: string | null }[]
  topics: { topic_name: string; answers: number; correct: number; accuracy: number | null }[]
}

describe('Phase 2: analytics are computed from persisted attempts', () => {
  let db: PGlite
  let admin: string
  let q1: ApprovedQuestion
  let q2: ApprovedQuestion
  let challengeId: string

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    const topicId = await seedTopic(db)
    q1 = await approvedQuestion(db, admin, topicId, { stem: 'Analytics question one?', correct: 2 })
    q2 = await approvedQuestion(db, admin, topicId, { stem: 'Analytics question two?', correct: 3 })

    const c = await publishedChallenge(db, admin, { topicId, slug: 'analytics', startMs: -MIN, endMs: 600 * MIN }, [
      { questionVersionId: q1.questionVersionId },
      { questionVersionId: q2.questionVersionId },
    ])
    challengeId = c.challengeId

    const s1 = await student(db)
    const s2 = await student(db)
    const s3 = await student(db)
    const s4 = await student(db) // registers but never starts

    for (const s of [s1, s2, s3, s4]) {
      await scalar(db, asUser(s), 'select public.student_register($1::uuid)', [challengeId])
    }

    // s1: both correct.
    const a1 = await scalar<AttemptView>(db, asUser(s1), 'select public.student_start_attempt($1::uuid)', [challengeId])
    await scalar(db, asUser(s1), 'select public.student_save_answer($1::uuid, $2::uuid, $3::uuid, false)', [a1.attempt_id, q1.questionVersionId, q1.optionIds[1]])
    await scalar(db, asUser(s1), 'select public.student_save_answer($1::uuid, $2::uuid, $3::uuid, false)', [a1.attempt_id, q2.questionVersionId, q2.optionIds[2]])
    await scalar(db, asUser(s1), 'select public.student_submit_attempt($1::uuid)', [a1.attempt_id])

    // s2: first correct, second wrong.
    const a2 = await scalar<AttemptView>(db, asUser(s2), 'select public.student_start_attempt($1::uuid)', [challengeId])
    await scalar(db, asUser(s2), 'select public.student_save_answer($1::uuid, $2::uuid, $3::uuid, false)', [a2.attempt_id, q1.questionVersionId, q1.optionIds[1]])
    await scalar(db, asUser(s2), 'select public.student_save_answer($1::uuid, $2::uuid, $3::uuid, false)', [a2.attempt_id, q2.questionVersionId, q2.optionIds[0]])
    await scalar(db, asUser(s2), 'select public.student_submit_attempt($1::uuid)', [a2.attempt_id])

    // s3: starts, answers nothing, and the browser closes: the deadline passes and the server submits.
    const a3 = await scalar<AttemptView>(db, asUser(s3), 'select public.student_start_attempt($1::uuid)', [challengeId])
    await expireAttempt(db, a3.attempt_id)
    await scalar(db, asUser(s3), 'select public.student_list_challenges()')
  })

  const analytics = (who: string) =>
    scalar<Analytics>(db, asUser(who), 'select public.admin_challenge_analytics($1::uuid)', [challengeId])

  it('counts registrations, starts, completions and rates exactly', async () => {
    const a = await analytics(admin)
    expect(a.registered).toBe(4)
    expect(a.started_attempts).toBe(3)
    expect(a.started_users).toBe(3)
    expect(a.completed_attempts).toBe(3)
    expect(a.participation_rate).toBe(0.75) // 3 of 4 registered people started
    expect(a.completion_rate).toBe(1) // every started attempt was finalised
  })

  it('computes average and distribution from the stored scores', async () => {
    const a = await analytics(admin)
    // s1 = 2/2 = 100%, s2 = 1/2 = 50%, s3 = 0/2 = 0%. Average = 50%.
    expect(a.max_score).toBe(2)
    expect(a.average_percentage).toBe(50)
    const total = a.score_distribution.reduce((sum, band) => sum + band.count, 0)
    expect(total).toBe(3)
    expect(a.score_distribution.find((b) => b.band === '0-19')?.count).toBe(1)
    expect(a.score_distribution.find((b) => b.band === '40-59')?.count).toBe(1)
    expect(a.score_distribution.find((b) => b.band === '80-100')?.count).toBe(1)
  })

  it('reports per-question correct rates and withholds flags for small samples', async () => {
    const a = await analytics(admin)
    const byPos = Object.fromEntries(a.questions.map((q) => [q.position, q]))
    expect(byPos[1]).toMatchObject({ seen: 3, correct: 2 })
    expect(byPos[1]!.correct_rate).toBeCloseTo(2 / 3, 4)
    expect(byPos[2]).toMatchObject({ seen: 3, correct: 1 })
    // Fewer than 10 people saw each question, so no "too easy" or "too hard" conclusion is drawn.
    expect(a.questions.every((q) => q.flag === null)).toBe(true)
  })

  it('reports topic-level accuracy from the same data', async () => {
    const a = await analytics(admin)
    expect(a.topics).toHaveLength(1)
    // 3 people x 2 questions = 6 answers, of which 3 were correct.
    expect(a.topics[0]).toMatchObject({ answers: 6, correct: 3, accuracy: 0.5 })
  })

  it('shows analytics only to administrators', async () => {
    const learner = await student(db)
    await expectCode(
      scalar(db, asUser(learner), 'select public.admin_challenge_analytics($1::uuid)', [challengeId]),
      'FORBIDDEN',
    )
    await expectCode(
      scalar(db, asUser(learner), 'select public.admin_challenge_participants($1::uuid)', [challengeId]),
      'FORBIDDEN',
    )
  })

  it('lists participants without email addresses and with best score only', async () => {
    const rows = await scalar<{ display_name: string; best_score: number | null; attempts: number }[]>(
      db,
      asUser(admin),
      'select public.admin_challenge_participants($1::uuid)',
      [challengeId],
    )
    expect(rows).toHaveLength(4)
    expect(JSON.stringify(rows)).not.toContain('@example.test')
    const unstarted = rows.find((r) => r.attempts === 0)
    expect(unstarted?.best_score).toBeNull()
  })
})
