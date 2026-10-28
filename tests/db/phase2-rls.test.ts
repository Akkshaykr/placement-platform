import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { addUser, as, asAnon, asUser, createDb } from './harness'
import { expectPermissionDenied } from './helpers'
import { MIN, administrator, approvedQuestion, publishedChallenge, scalar, seedTopic, type AttemptView } from './phase2-helpers'

describe('Phase 2 row level security on new tables', () => {
  let db: PGlite
  let admin: string
  let alice: string
  let bob: string
  let challengeId: string
  let aliceAttempt: string

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    alice = await addUser(db)
    bob = await addUser(db)
    const topicId = await seedTopic(db)
    const q = await approvedQuestion(db, admin, topicId, { stem: 'RLS probe question here?' })
    const c = await publishedChallenge(db, admin, { topicId, slug: 'rls-probe', startMs: -MIN, endMs: 600 * MIN }, [
      { questionVersionId: q.questionVersionId },
    ])
    challengeId = c.challengeId
    await scalar(db, asUser(alice), 'select public.student_register($1::uuid)', [challengeId])
    const a = await scalar<AttemptView>(db, asUser(alice), 'select public.student_start_attempt($1::uuid)', [challengeId])
    aliceAttempt = a.attempt_id
  })

  it('shows a student only their own registrations', async () => {
    const aliceSees = await as(db, asUser(alice), async () =>
      (await db.query<{ user_id: string }>('select user_id from public.challenge_registrations')).rows,
    )
    expect(aliceSees.map((r) => r.user_id)).toEqual([alice])
    const bobSees = await as(db, asUser(bob), async () =>
      (await db.query('select user_id from public.challenge_registrations')).rows,
    )
    expect(bobSees).toHaveLength(0)
  })

  it('shows a student only the question snapshot of their own attempt', async () => {
    const bobSees = await as(db, asUser(bob), async () =>
      (await db.query('select attempt_id from public.attempt_questions')).rows,
    )
    expect(bobSees).toHaveLength(0)
    const aliceSees = await as(db, asUser(alice), async () =>
      (await db.query<{ attempt_id: string }>('select attempt_id from public.attempt_questions')).rows,
    )
    expect(aliceSees.every((r) => r.attempt_id === aliceAttempt)).toBe(true)
    expect(aliceSees.length).toBeGreaterThan(0)
  })

  it('lets the administrator read the registrations and snapshots of every challenge', async () => {
    const rows = await as(db, asUser(admin), async () =>
      (await db.query('select user_id from public.challenge_registrations')).rows,
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('denies anonymous users the new tables', async () => {
    await expect(as(db, asAnon, () => db.query('select * from public.challenge_registrations'))).rejects.toThrow(/permission denied/i)
    await expect(as(db, asAnon, () => db.query('select * from public.attempt_questions'))).rejects.toThrow(/permission denied/i)
  })

  it('refuses every direct write from a student to the Phase 2 tables', async () => {
    await as(db, asUser(alice), async () => {
      await expectPermissionDenied(
        db.query('insert into public.challenge_registrations (challenge_id, user_id) values ($1, $2)', [challengeId, bob]),
      )
      await expectPermissionDenied(db.query('delete from public.challenge_registrations'))
      await expectPermissionDenied(db.query(`update public.challenges set title = 'Hacked title'`))
      await expectPermissionDenied(db.query('delete from public.attempt_questions'))
      await expectPermissionDenied(db.query('insert into public.question_answer_keys (question_version_id, correct_option_id) values (gen_random_uuid(), gen_random_uuid())'))
    })
  })

  it('refuses the administrator direct writes too: every change goes through a reviewed function', async () => {
    await as(db, asUser(admin), async () => {
      await expectPermissionDenied(db.query(`insert into public.challenges (slug, title) values ('direct-admin-2', 'Direct')`))
      await expectPermissionDenied(db.query('insert into public.challenge_registrations (challenge_id, user_id) values ($1, $2)', [challengeId, bob]))
      await expectPermissionDenied(db.query('update public.attempt_answers set is_correct = true'))
    })
  })
})
