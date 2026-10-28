import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { addPublishedChallenge, addUser, as, asUser, createDb, type SeededContent } from './harness'
import { expectPermissionDenied } from './helpers'

describe('database integrity guards', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb()
  })

  describe('challenge constraints', () => {
    it('rejects an end time that is not after the start time', async () => {
      await expect(
        db.query(`insert into public.challenges (slug, title, start_at, end_at) values ('bad-window', 'Bad window', now(), now())`),
      ).rejects.toThrow(/challenges_schedule_ck/)
    })

    it('keeps negative marking and the penalty consistent', async () => {
      await expect(
        db.query(`insert into public.challenges (slug, title, negative_marking_enabled, penalty_per_incorrect) values ('neg-a', 'Neg A', true, 0)`),
      ).rejects.toThrow(/challenges_penalty_ck/)
      await expect(
        db.query(`insert into public.challenges (slug, title, negative_marking_enabled, penalty_per_incorrect) values ('neg-b', 'Neg B', false, 0.25)`),
      ).rejects.toThrow(/challenges_penalty_ck/)
      await db.query(`insert into public.challenges (slug, title, negative_marking_enabled, penalty_per_incorrect) values ('neg-ok', 'Neg OK', true, 0.25)`)
    })

    it('refuses a PUBLISHED challenge that has no live version or topic', async () => {
      await expect(
        db.query(`insert into public.challenges (slug, title, status) values ('empty-pub', 'Empty published', 'PUBLISHED')`),
      ).rejects.toThrow(/challenges_published_ck/)
    })

    it('requires the live version to belong to the same challenge', async () => {
      const a = await addPublishedChallenge(db)
      const b = await addPublishedChallenge(db)
      await expect(
        db.query('update public.challenges set live_version_id = $2 where id = $1', [a.challengeId, b.versionId]),
      ).rejects.toThrow(/challenges_live_version_fk/)
    })

    it('enforces unique slugs', async () => {
      await db.query(`insert into public.challenges (slug, title) values ('unique-slug', 'First')`)
      await expect(db.query(`insert into public.challenges (slug, title) values ('unique-slug', 'Second')`)).rejects.toThrow(/duplicate key/)
    })
  })

  describe('question and answer-key structure', () => {
    it('only accepts a correct option that belongs to the same question version', async () => {
      const a = await addPublishedChallenge(db)
      const b = await addPublishedChallenge(db)
      const qv = await db.query<{ id: string }>(
        `insert into public.question_versions (question_id, version_number, stem) values ($1, 2, 'Second version stem') returning id`,
        [a.questionId],
      )
      await expect(
        db.query('insert into public.question_answer_keys (question_version_id, correct_option_id) values ($1, $2)', [qv.rows[0]!.id, b.optionIds[0]]),
      ).rejects.toThrow(/foreign key/)
    })

    it('allows exactly one answer key per question version', async () => {
      const c = await addPublishedChallenge(db)
      await expect(
        db.query('insert into public.question_answer_keys (question_version_id, correct_option_id) values ($1, $2)', [c.questionVersionId, c.optionIds[0]]),
      ).rejects.toThrow(/duplicate key/)
    })

    it('refuses to delete the option that is the correct answer', async () => {
      const c = await addPublishedChallenge(db)
      await expect(db.query('delete from public.question_options where id = $1', [c.correctOptionId])).rejects.toThrow(/foreign key/)
    })

    it('enforces unique option positions', async () => {
      const c = await addPublishedChallenge(db)
      await expect(
        db.query(`insert into public.question_options (question_version_id, position, body) values ($1, 1, 'dup')`, [c.questionVersionId]),
      ).rejects.toThrow(/duplicate key/)
    })

    it('requires approval metadata to match the review status', async () => {
      const c = await addPublishedChallenge(db)
      await expect(
        db.query(`update public.question_versions set review_status = 'ADMIN_APPROVED' where id = $1`, [c.questionVersionId]),
      ).rejects.toThrow(/question_versions_approval_ck/)
      await db.query(`update public.question_versions set review_status = 'ADMIN_APPROVED', approved_at = now() where id = $1`, [c.questionVersionId])
    })
  })

  describe('locked and frozen history', () => {
    it('freezes a locked question version, its options and its answer key', async () => {
      const c = await addPublishedChallenge(db)
      await db.query('update public.question_versions set locked_at = now() where id = $1', [c.questionVersionId])

      await expect(db.query(`update public.question_versions set stem = 'Changed stem text' where id = $1`, [c.questionVersionId])).rejects.toThrow(/locked/)
      await expect(db.query('delete from public.question_versions where id = $1', [c.questionVersionId])).rejects.toThrow(/locked/)
      await expect(db.query(`update public.question_options set body = 'tampered' where id = $1`, [c.optionIds[0]])).rejects.toThrow(/locked/)
      await expect(db.query(`insert into public.question_options (question_version_id, position, body) values ($1, 5, 'extra')`, [c.questionVersionId])).rejects.toThrow(/locked/)
      await expect(db.query('delete from public.question_options where id = $1', [c.optionIds[0]])).rejects.toThrow(/locked/)
      await expect(db.query(`update public.question_answer_keys set correct_option_id = $2 where question_version_id = $1`, [c.questionVersionId, c.optionIds[0]])).rejects.toThrow(/locked/)
      await expect(db.query(`update public.question_answer_keys set explanation = 'rewritten' where question_version_id = $1`, [c.questionVersionId])).rejects.toThrow(/locked/)
    })

    it('still lets an unlocked draft be edited and deleted with its children', async () => {
      const c = await addPublishedChallenge(db)
      await db.query(`update public.question_versions set stem = 'Edited stem text' where id = $1`, [c.questionVersionId])
      await db.query(`update public.question_answer_keys set explanation = 'Updated' where question_version_id = $1`, [c.questionVersionId])
      await db.query('delete from public.challenge_version_questions where question_version_id = $1', [c.questionVersionId])
      await db.query('delete from public.question_versions where id = $1', [c.questionVersionId])
      const left = await db.query('select 1 from public.question_options where question_version_id = $1', [c.questionVersionId])
      expect(left.rows).toHaveLength(0)
    })

    it('freezes a challenge version and its question list', async () => {
      const c = await addPublishedChallenge(db)
      await db.query('update public.challenge_versions set frozen_at = now() where id = $1', [c.versionId])
      await expect(db.query('update public.challenge_versions set time_limit_minutes = 5 where id = $1', [c.versionId])).rejects.toThrow(/frozen/)
      await expect(db.query('delete from public.challenge_versions where id = $1', [c.versionId])).rejects.toThrow(/frozen/)
      await expect(db.query('delete from public.challenge_version_questions where challenge_version_id = $1', [c.versionId])).rejects.toThrow(/frozen/)
      await expect(
        db.query(`update public.challenge_version_questions set position = 9 where challenge_version_id = $1`, [c.versionId]),
      ).rejects.toThrow(/frozen/)
    })

    it('blocks adding questions to a frozen version', async () => {
      const c = await addPublishedChallenge(db)
      const other = await addPublishedChallenge(db)
      await db.query('update public.challenge_versions set frozen_at = now() where id = $1', [c.versionId])
      await expect(
        db.query('insert into public.challenge_version_questions (challenge_version_id, question_version_id, position) values ($1, $2, 2)', [c.versionId, other.questionVersionId]),
      ).rejects.toThrow(/frozen/)
    })
  })

  describe('attempts, answers and scores', () => {
    let c: SeededContent
    let other: SeededContent
    let alice: string
    let bob: string

    const newAttempt = async (userId: string, content: SeededContent, n = 1) => {
      const r = await db.query<{ id: string }>(
        `insert into public.challenge_attempts (challenge_id, challenge_version_id, user_id, attempt_number, deadline_at)
         values ($1, $2, $3, $4, now() + interval '30 minutes') returning id`,
        [content.challengeId, content.versionId, userId, n],
      )
      return r.rows[0]!.id
    }
    const submit = (attemptId: string) =>
      db.query(`update public.challenge_attempts set status = 'SUBMITTED', submitted_at = now(), submitted_via = 'USER' where id = $1`, [attemptId])

    beforeAll(async () => {
      c = await addPublishedChallenge(db)
      other = await addPublishedChallenge(db)
      alice = await addUser(db)
      bob = await addUser(db)
    })

    it('allows only one running attempt per user and challenge', async () => {
      const first = await newAttempt(alice, c)
      await expect(newAttempt(alice, c, 2)).rejects.toThrow(/challenge_attempts_one_running_idx|duplicate key/)
      await submit(first)
      await newAttempt(alice, c, 2)
    })

    it('rejects duplicate attempt numbers and inconsistent state', async () => {
      await expect(newAttempt(alice, c, 1)).rejects.toThrow(/duplicate key/)
      await expect(
        db.query(
          `insert into public.challenge_attempts (challenge_id, challenge_version_id, user_id, attempt_number, deadline_at, status)
           values ($1, $2, $3, 7, now() + interval '1 hour', 'SUBMITTED')`,
          [c.challengeId, c.versionId, bob],
        ),
      ).rejects.toThrow(/attempts_state_ck/)
      await expect(
        db.query(
          `insert into public.challenge_attempts (challenge_id, challenge_version_id, user_id, attempt_number, started_at, deadline_at)
           values ($1, $2, $3, 8, now(), now() - interval '1 minute')`,
          [c.challengeId, c.versionId, bob],
        ),
      ).rejects.toThrow(/attempts_deadline_ck/)
    })

    it('rejects a version that does not belong to the challenge', async () => {
      await expect(
        db.query(
          `insert into public.challenge_attempts (challenge_id, challenge_version_id, user_id, attempt_number, deadline_at)
           values ($1, $2, $3, 1, now() + interval '1 hour')`,
          [c.challengeId, other.versionId, bob],
        ),
      ).rejects.toThrow(/attempts_version_fk/)
    })

    it('only accepts answers for questions and options that belong to the attempt’s version', async () => {
      const attempt = await newAttempt(bob, c)
      const insert = (qv: string, option: string | null) =>
        db.query(
          `insert into public.attempt_answers (attempt_id, challenge_version_id, question_version_id, selected_option_id)
           values ($1, $2, $3, $4)`,
          [attempt, c.versionId, qv, option],
        )
      await expect(insert(other.questionVersionId, null)).rejects.toThrow(/foreign key/)
      await expect(insert(c.questionVersionId, other.optionIds[0]!)).rejects.toThrow(/foreign key/)
      await insert(c.questionVersionId, c.optionIds[0]!)
      await expect(insert(c.questionVersionId, c.optionIds[1]!)).rejects.toThrow(/duplicate key/)
    })

    it('makes a submitted attempt, its answers and its score immutable', async () => {
      const carol = await addUser(db)
      const attempt = await newAttempt(carol, c)
      await db.query(
        `insert into public.attempt_answers (attempt_id, challenge_version_id, question_version_id, selected_option_id)
         values ($1, $2, $3, $4)`,
        [attempt, c.versionId, c.questionVersionId, c.correctOptionId],
      )

      // A score cannot exist for an attempt that is still running.
      const insertScore = () =>
        db.query(
          `insert into public.attempt_scores (attempt_id, score, max_score, correct_count, incorrect_count, unanswered_count, accuracy, time_taken_seconds)
           values ($1, 1, 1, 1, 0, 0, 1, 42)`,
          [attempt],
        )
      await expect(insertScore()).rejects.toThrow(/submitted attempt/)

      await submit(attempt)
      await insertScore()

      // Idempotency: a second score, any edit, any delete is refused.
      await expect(insertScore()).rejects.toThrow(/duplicate key/)
      await expect(db.query('update public.attempt_scores set score = 0 where attempt_id = $1', [attempt])).rejects.toThrow(/write-once/)
      await expect(db.query('delete from public.attempt_scores where attempt_id = $1', [attempt])).rejects.toThrow(/write-once/)
      await expect(db.query(`update public.challenge_attempts set submitted_at = now() where id = $1`, [attempt])).rejects.toThrow(/cannot be changed/)
      await expect(db.query(`update public.challenge_attempts set status = 'IN_PROGRESS', submitted_at = null, submitted_via = null where id = $1`, [attempt])).rejects.toThrow(/cannot be changed/)
      await expect(db.query('delete from public.challenge_attempts where id = $1', [attempt])).rejects.toThrow(/cannot be changed/)
      await expect(db.query(`update public.attempt_answers set selected_option_id = $2 where attempt_id = $1`, [attempt, c.optionIds[0]])).rejects.toThrow(/submitted attempt/)
      await expect(db.query('delete from public.attempt_answers where attempt_id = $1', [attempt])).rejects.toThrow(/submitted attempt/)
    })

    it('anonymises attempts when an account is deleted, keeping the history', async () => {
      const dave = await addUser(db)
      const attempt = await newAttempt(dave, c)
      await db.query(
        `insert into public.attempt_answers (attempt_id, challenge_version_id, question_version_id, selected_option_id)
         values ($1, $2, $3, $4)`,
        [attempt, c.versionId, c.questionVersionId, c.optionIds[0]],
      )
      await submit(attempt)
      await db.query('delete from auth.users where id = $1', [dave])
      const row = await db.query<{ user_id: string | null; status: string }>('select user_id, status from public.challenge_attempts where id = $1', [attempt])
      expect(row.rows).toEqual([{ user_id: null, status: 'SUBMITTED' }])
      expect((await db.query('select 1 from public.attempt_answers where attempt_id = $1', [attempt])).rows).toHaveLength(1)
    })

    it('lets a user read only their own attempt data and never write it', async () => {
      const eve = await addUser(db)
      const frank = await addUser(db)
      const eveAttempt = await newAttempt(eve, c)
      await db.query(
        `insert into public.attempt_answers (attempt_id, challenge_version_id, question_version_id, selected_option_id)
         values ($1, $2, $3, $4)`,
        [eveAttempt, c.versionId, c.questionVersionId, c.optionIds[2]],
      )

      const eveSees = await as(db, asUser(eve), async () => ({
        attempts: (await db.query('select id from public.challenge_attempts')).rows.length,
        answers: (await db.query('select id from public.attempt_answers')).rows.length,
      }))
      expect(eveSees).toEqual({ attempts: 1, answers: 1 })

      await as(db, asUser(frank), async () => {
        expect((await db.query('select id from public.challenge_attempts')).rows).toHaveLength(0)
        expect((await db.query('select id from public.attempt_answers')).rows).toHaveLength(0)
        expect((await db.query('select attempt_id from public.attempt_scores')).rows).toHaveLength(0)
      })

      await as(db, asUser(eve), async () => {
        await expectPermissionDenied(
          db.query(`insert into public.challenge_attempts (challenge_id, challenge_version_id, user_id, attempt_number, deadline_at) values ($1, $2, $3, 99, now() + interval '1 hour')`, [c.challengeId, c.versionId, eve]),
        )
        await expectPermissionDenied(db.query(`update public.challenge_attempts set deadline_at = now() + interval '1 year'`))
        await expectPermissionDenied(db.query(`update public.attempt_answers set is_correct = true`))
        await expectPermissionDenied(db.query(`insert into public.attempt_scores (attempt_id, score, max_score, correct_count, incorrect_count, unanswered_count, accuracy, time_taken_seconds) values ($1, 1, 1, 1, 0, 0, 1, 1)`, [eveAttempt]))
      })
    })
  })

  it('refuses hard deletion of a challenge that has versions', async () => {
    const c = await addPublishedChallenge(db)
    await db.query(`update public.challenges set status = 'DRAFT', live_version_id = null where id = $1`, [c.challengeId])
    await expect(db.query('delete from public.challenges where id = $1', [c.challengeId])).rejects.toThrow(/foreign key/)
  })
})
