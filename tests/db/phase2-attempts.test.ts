import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb } from './harness'
import { expectPermissionDenied } from './helpers'
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

interface StartResult extends AttemptView {
  attempt_id: string
}

describe('Phase 2: attempt engine (schedule, autosave, scoring, release, leaderboard)', () => {
  let db: PGlite
  let admin: string
  let topicId: string
  let q1: ApprovedQuestion
  let q2: ApprovedQuestion
  let q3: ApprovedQuestion

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    topicId = await seedTopic(db)
    q1 = await approvedQuestion(db, admin, topicId, { stem: 'Question one, 2 plus 2?', correct: 2 })
    q2 = await approvedQuestion(db, admin, topicId, { stem: 'Question two, 5 times 5?', correct: 3, options: ['10', '20', '25', '30'] })
    q3 = await approvedQuestion(db, admin, topicId, { stem: 'Question three, 9 minus 4?', correct: 1, options: ['5', '6', '7', '8'] })
  })

  const start = (who: string, challengeId: string) =>
    scalar<StartResult>(db, asUser(who), 'select public.student_start_attempt($1::uuid)', [challengeId])
  const save = (who: string, attemptId: string, qv: string, opt: string | null, marked = false) =>
    scalar<{ saved: boolean; code?: string }>(db, asUser(who), 'select public.student_save_answer($1::uuid, $2::uuid, $3::uuid, $4)', [
      attemptId,
      qv,
      opt,
      marked,
    ])
  const submit = (who: string, attemptId: string) =>
    scalar<{ score: number; max_score: number; correct_count: number; incorrect_count: number; unanswered_count: number; submitted_via: string; percentage: number; time_taken_seconds: number }>(
      db,
      asUser(who),
      'select public.student_submit_attempt($1::uuid)',
      [attemptId],
    )
  const optionOf = (qv: ApprovedQuestion, position: number) => qv.optionIds[position - 1]!

  describe('scheduling boundaries', () => {
    it('refuses to start before the window opens and after it closes, with coded errors', async () => {
      const future = await publishedChallenge(db, admin, { topicId, slug: 'boundary-future', startMs: 3 * 60 * MIN, endMs: 5 * 60 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      await expectCode(start(await student(db), future.challengeId), 'NOT_OPEN')

      // Ended: the schedule was set so the end is already in the past. We use an owner-side update on
      // an OPEN challenge to simulate time passing, which is exactly what the database compares with now().
      const past = await publishedChallenge(db, admin, { topicId, slug: 'boundary-past', startMs: -MIN, endMs: 30 * 60_000 }, [
        { questionVersionId: q1.questionVersionId },
      ])
      await db.query(`update public.challenges set end_at = now() - interval '1 second', start_at = now() - interval '1 hour' where id = $1`, [
        past.challengeId,
      ])
      await expectCode(start(await student(db), past.challengeId), 'ENDED')
    })

    it('caps the attempt deadline at the challenge end when the time limit would run past it', async () => {
      const short = await publishedChallenge(db, admin, { topicId, slug: 'capped-end', startMs: -MIN, endMs: 5 * MIN, timeLimit: 30 }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, short.challengeId)
      const endAt = await db.query<{ end_at: Date }>('select end_at from public.challenges where id = $1', [short.challengeId])
      const deadline = new Date(a.deadline_at).getTime()
      expect(deadline).toBeLessThanOrEqual(new Date(endAt.rows[0]!.end_at).getTime() + 1000)
      expect(deadline).toBeLessThan(Date.now() + 10 * MIN)
    })

    it('uses the full time limit when the challenge runs long enough', async () => {
      const long = await publishedChallenge(db, admin, { topicId, slug: 'full-limit', startMs: -MIN, endMs: 600 * MIN, timeLimit: 20 }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const a = await start(await student(db), long.challengeId)
      const remainingMs = new Date(a.deadline_at).getTime() - Date.now()
      expect(remainingMs).toBeGreaterThan(19 * MIN)
      expect(remainingMs).toBeLessThanOrEqual(20 * MIN + 2000)
    })
  })

  describe('starting, resuming and attempt limits', () => {
    it('returns questions without the correct answers or explanations', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'no-keys', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
        { questionVersionId: q2.questionVersionId },
      ])
      const a = await start(await student(db), c.challengeId)
      // Option ids must be present (students submit them), but nothing that reveals correctness may be.
      const text = JSON.stringify(a)
      expect(text).not.toMatch(/is_correct|correct_option|explanation/)
      expect(a.questions).toHaveLength(2)
      expect(a.questions[0]!.options.map((o) => o.id)).toContain(q1.optionIds[1])
    })

    it('resumes the running attempt after a refresh instead of creating another one', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'resume', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const first = await start(who, c.challengeId)
      const second = await start(who, c.challengeId)
      expect(second.attempt_id).toBe(first.attempt_id)
      expect(second.questions.map((x) => x.question_version_id)).toEqual(first.questions.map((x) => x.question_version_id))
      const count = await db.query<{ n: number }>('select count(*)::int n from public.challenge_attempts where challenge_id = $1', [c.challengeId])
      expect(count.rows[0]!.n).toBe(1)
    })

    it('enforces the attempt limit on the server', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'one-attempt', startMs: -MIN, endMs: 600 * MIN, maxAttempts: 1 }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await submit(who, a.attempt_id)
      await expectCode(start(who, c.challengeId), 'ATTEMPT_LIMIT')
    })

    it('allows a second attempt when the limit is two, numbering it correctly', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'two-attempts', startMs: -MIN, endMs: 600 * MIN, maxAttempts: 2 }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a1 = await start(who, c.challengeId)
      await submit(who, a1.attempt_id)
      const a2 = await start(who, c.challengeId)
      expect(a2.attempt_id).not.toBe(a1.attempt_id)
      const n = await db.query<{ attempt_number: number }>(
        'select attempt_number from public.challenge_attempts where id = $1',
        [a2.attempt_id],
      )
      expect(n.rows[0]!.attempt_number).toBe(2)
    })

    it('enforces the participant limit, counting each person once', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'capped-seats', startMs: -MIN, endMs: 600 * MIN, participantLimit: 2 }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const a = await student(db)
      const b = await student(db)
      const d = await student(db)
      await start(a, c.challengeId)
      await start(b, c.challengeId)
      await expectCode(start(d, c.challengeId), 'FULL')
      // A registered participant can still resume even though the limit is reached.
      await expect(start(a, c.challengeId)).resolves.toBeTruthy()
    })

    it('shuffles options per attempt as a stable permutation that survives a resume', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'shuffle-opts', startMs: -MIN, endMs: 600 * MIN, shuffleOptions: true }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      const shown = a.questions[0]!.options.map((o) => o.id).sort()
      expect(shown).toEqual([...q1.optionIds].sort())
      const again = await start(who, c.challengeId)
      expect(again.questions[0]!.options.map((o) => o.id)).toEqual(a.questions[0]!.options.map((o) => o.id))
    })
  })

  describe('autosave and answer integrity', () => {
    it('saves, overwrites and clears answers, and restores them on resume', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'autosave', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
        { questionVersionId: q2.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      expect((await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 1), true)).saved).toBe(true)
      expect((await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 2))).saved).toBe(true)
      await save(who, a.attempt_id, q2.questionVersionId, optionOf(q2, 3))
      await save(who, a.attempt_id, q2.questionVersionId, null)

      const restored = await start(who, c.challengeId)
      const byQ = Object.fromEntries(restored.answers.map((x) => [x.question_version_id, x.selected_option_id]))
      expect(byQ[q1.questionVersionId]).toBe(optionOf(q1, 2))
      expect(byQ[q2.questionVersionId]).toBeNull()
    })

    it('rejects an option from another question and a question outside the attempt', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'foreign-option', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await expectCode(save(who, a.attempt_id, q1.questionVersionId, optionOf(q2, 1)), 'INVALID_ANSWER')
      await expectCode(save(who, a.attempt_id, q3.questionVersionId, optionOf(q3, 1)), 'INVALID_ANSWER')
    })

    it('never lets a student read is_correct or points_awarded directly', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'col-grants', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      await submit(who, a.attempt_id)
      await expectPermissionDenied(scalar(db, asUser(who), 'select is_correct from public.attempt_answers'))
      await expectPermissionDenied(scalar(db, asUser(who), 'select points_awarded from public.attempt_answers'))
    })

    it('refuses a student direct writes to attempts, answers and scores', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'no-direct', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await expectPermissionDenied(scalar(db, asUser(who), `update public.challenge_attempts set status = 'SUBMITTED', submitted_at = now(), submitted_via = 'USER' where id = $1`, [a.attempt_id]))
      await expectPermissionDenied(scalar(db, asUser(who), `update public.challenge_attempts set deadline_at = now() + interval '1 year' where id = $1`, [a.attempt_id]))
      await expectPermissionDenied(scalar(db, asUser(who), `insert into public.attempt_answers (attempt_id, challenge_version_id, question_version_id, selected_option_id) values ($1, $1, $1, $1)`, [a.attempt_id]))
    })
  })

  describe('scoring', () => {
    it('scores from the answer key with per-question marks and negative marking, and counts unanswered', async () => {
      const c = await publishedChallenge(
        db,
        admin,
        { topicId, slug: 'scored', startMs: -MIN, endMs: 600 * MIN, negative: true, penalty: 0.5 },
        [
          { questionVersionId: q1.questionVersionId, marks: 2 },
          { questionVersionId: q2.questionVersionId, marks: 3 },
          { questionVersionId: q3.questionVersionId, marks: 1 },
        ],
      )
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 2)) // correct, +2
      await save(who, a.attempt_id, q2.questionVersionId, optionOf(q2, 1)) // wrong, -0.5
      // q3 left unanswered: 0
      const r = await submit(who, a.attempt_id)
      expect(r.score).toBe(1.5)
      expect(r.max_score).toBe(6)
      expect(r.correct_count).toBe(1)
      expect(r.incorrect_count).toBe(1)
      expect(r.unanswered_count).toBe(1)
      expect(r.percentage).toBe(25)
      expect(r.submitted_via).toBe('USER')
    })

    it('makes submission idempotent: a repeat returns the same score and never rescores', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'idempotent', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      const first = await submit(who, a.attempt_id)
      const second = await submit(who, a.attempt_id)
      expect(second).toEqual(first)
      const rows = await db.query<{ n: number }>('select count(*)::int n from public.attempt_scores where attempt_id = $1', [a.attempt_id])
      expect(rows.rows[0]!.n).toBe(1)
    })

    it('refuses to change answers after submission', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'post-submit', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      const before = await submit(who, a.attempt_id)
      const after = await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 1))
      expect(after).toMatchObject({ saved: false, code: 'ATTEMPT_CLOSED' })
      const stored = await db.query<{ selected_option_id: string }>(
        'select selected_option_id from public.attempt_answers where attempt_id = $1',
        [a.attempt_id],
      )
      expect(stored.rows[0]!.selected_option_id).toBe(optionOf(q1, 2))
      expect((await submit(who, a.attempt_id)).score).toBe(before.score)
    })
  })

  describe('deadlines and automatic submission', () => {
    it('submits an expired attempt at its deadline, even when the student never pressed submit', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'auto-submit', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      await expireAttempt(db, a.attempt_id)

      // Any student call sweeps expired attempts. Listing is enough: the browser may be closed.
      await scalar(db, asUser(who), 'select public.student_list_challenges()')
      const row = await db.query<{ status: string; submitted_via: string; submitted_at: Date; deadline_at: Date }>(
        'select status, submitted_via, submitted_at, deadline_at from public.challenge_attempts where id = $1',
        [a.attempt_id],
      )
      expect(row.rows[0]!.status).toBe('SUBMITTED')
      expect(row.rows[0]!.submitted_via).toBe('TIMEOUT')
      expect(new Date(row.rows[0]!.submitted_at).getTime()).toBeLessThanOrEqual(new Date(row.rows[0]!.deadline_at).getTime())
      const score = await db.query<{ correct_count: number }>('select correct_count from public.attempt_scores where attempt_id = $1', [a.attempt_id])
      expect(score.rows[0]!.correct_count).toBe(1)
    })

    it('rejects an answer that arrives after the deadline, and keeps the score the server recorded', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'late-answer', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await expireAttempt(db, a.attempt_id)
      const late = await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      expect(late).toMatchObject({ saved: false, code: 'ATTEMPT_CLOSED' })
      const score = await db.query<{ correct_count: number; unanswered_count: number }>(
        'select correct_count, unanswered_count from public.attempt_scores where attempt_id = $1',
        [a.attempt_id],
      )
      expect(score.rows[0]).toEqual({ correct_count: 0, unanswered_count: 1 })
    })

    it('does not let a student submit a timed-out attempt for a higher score', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'no-late-submit', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await expireAttempt(db, a.attempt_id)
      const r = await submit(who, a.attempt_id)
      expect(r.submitted_via).toBe('TIMEOUT')
      expect(r.score).toBe(0)
    })
  })

  describe('result release policy', () => {
    const takeQuiz = async (slug: string, release: 'IMMEDIATE' | 'AFTER_CLOSE' | 'NEVER') => {
      const c = await publishedChallenge(db, admin, { topicId, slug, startMs: -MIN, endMs: 600 * MIN, resultRelease: release }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const a = await start(who, c.challengeId)
      await save(who, a.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      await submit(who, a.attempt_id)
      return { challengeId: c.challengeId, who, attemptId: a.attempt_id }
    }
    type ResultQuestion = {
      correct_option_id?: string | null
      explanation?: string | null
      is_correct?: boolean | null
      options: { id: string; is_correct: boolean | null }[]
    }
    const result = (who: string, attemptId: string) =>
      scalar<{ released: boolean; questions: ResultQuestion[] }>(db, asUser(who), 'select public.student_get_result($1::uuid)', [
        attemptId,
      ])
    // The key is withheld when every key field is null and no option is marked correct.
    const keyWithheld = (q: ResultQuestion) =>
      q.correct_option_id === null && q.explanation === null && q.is_correct === null && q.options.every((o) => o.is_correct === null)

    it('IMMEDIATE: shows the correct answer and explanation straight after submission', async () => {
      const { who, attemptId } = await takeQuiz('release-now', 'IMMEDIATE')
      const r = await result(who, attemptId)
      expect(r.released).toBe(true)
      expect(r.questions[0]).toMatchObject({ correct_option_id: q1.correctOptionId, is_correct: true })
      expect(r.questions[0]!.explanation).toBeTruthy()
    })

    it('AFTER_CLOSE: hides the answer key while the challenge is open, and releases it once it is completed', async () => {
      const { who, attemptId, challengeId } = await takeQuiz('release-later', 'AFTER_CLOSE')
      const hidden = await result(who, attemptId)
      expect(hidden.released).toBe(false)
      expect(keyWithheld(hidden.questions[0]!)).toBe(true)

      await scalar(db, asUser(admin), 'select public.admin_transition_challenge($1::uuid, $2)', [challengeId, 'COMPLETE'])
      const shown = await result(who, attemptId)
      expect(shown.released).toBe(true)
      expect(shown.questions[0]!.correct_option_id).toBe(q1.correctOptionId)
    })

    it('NEVER: keeps the key hidden from students permanently', async () => {
      const { who, attemptId, challengeId } = await takeQuiz('release-never', 'NEVER')
      await scalar(db, asUser(admin), 'select public.admin_transition_challenge($1::uuid, $2)', [challengeId, 'COMPLETE'])
      const r = await result(who, attemptId)
      expect(r.released).toBe(false)
      expect(keyWithheld(r.questions[0]!)).toBe(true)
    })

    it('never shows another student their own results', async () => {
      const { attemptId } = await takeQuiz('others-results', 'IMMEDIATE')
      const stranger = await student(db)
      await expectCode(
        scalar(db, asUser(stranger), 'select public.student_get_result($1::uuid)', [attemptId]),
        'NOT_FOUND',
      )
    })
  })

  describe('live leaderboard', () => {
    it('ranks by score, then earlier submission, then attempt id, and exposes no email address', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'board', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
        { questionVersionId: q2.questionVersionId },
      ])
      const alice = await student(db)
      const bob = await student(db)
      const carol = await student(db)

      const aliceA = await start(alice, c.challengeId)
      await save(alice, aliceA.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      await save(alice, aliceA.attempt_id, q2.questionVersionId, optionOf(q2, 3))
      await submit(alice, aliceA.attempt_id) // 2, first to finish

      const bobA = await start(bob, c.challengeId)
      await save(bob, bobA.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      await save(bob, bobA.attempt_id, q2.questionVersionId, optionOf(q2, 3))
      await submit(bob, bobA.attempt_id) // 2, second to finish

      const carolA = await start(carol, c.challengeId)
      await save(carol, carolA.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      await submit(carol, carolA.attempt_id) // 1

      const board = await scalar<{
        entries: { rank: number; score: number; display_name: string; is_me: boolean }[]
        total_ranked: number
        my_rank: number | null
      }>(db, asUser(bob), 'select public.student_leaderboard($1::uuid, 50)', [c.challengeId])

      expect(board.entries.map((e) => e.score)).toEqual([2, 2, 1])
      expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3])
      expect(board.total_ranked).toBe(3)
      expect(board.my_rank).toBe(2)
      expect(board.entries.find((e) => e.is_me)?.rank).toBe(2)

      const text = JSON.stringify(board)
      expect(text).not.toContain('@example.test')
      expect(text).not.toContain(alice)
      expect(text).not.toContain(bob)
    })

    it('uses only each participant\u2019s best finalized attempt', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'best-only', startMs: -MIN, endMs: 600 * MIN, maxAttempts: 2 }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const first = await start(who, c.challengeId)
      await submit(who, first.attempt_id) // 0
      const second = await start(who, c.challengeId)
      await save(who, second.attempt_id, q1.questionVersionId, optionOf(q1, 2))
      await submit(who, second.attempt_id) // 1
      const board = await scalar<{ entries: { score: number }[]; total_ranked: number }>(
        db,
        asUser(who),
        'select public.student_leaderboard($1::uuid, 50)',
        [c.challengeId],
      )
      expect(board.total_ranked).toBe(1)
      expect(board.entries[0]!.score).toBe(1)
    })

    it('refuses the leaderboard to people who did not join the challenge', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'members-only', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const outsider = await student(db)
      await expectCode(
        scalar(db, asUser(outsider), 'select public.student_leaderboard($1::uuid, 50)', [c.challengeId]),
        'FORBIDDEN',
      )
    })
  })

  describe('history', () => {
    it('lists only the caller\u2019s own attempts', async () => {
      const c = await publishedChallenge(db, admin, { topicId, slug: 'history', startMs: -MIN, endMs: 600 * MIN }, [
        { questionVersionId: q1.questionVersionId },
      ])
      const who = await student(db)
      const other = await student(db)
      const a = await start(who, c.challengeId)
      await submit(who, a.attempt_id)
      const mine = await scalar<{ attempt_id: string }[]>(db, asUser(who), 'select public.student_my_attempts()')
      const theirs = await scalar<{ attempt_id: string }[]>(db, asUser(other), 'select public.student_my_attempts()')
      expect(mine.map((x) => x.attempt_id)).toEqual([a.attempt_id])
      expect(theirs).toEqual([])
    })
  })
})
