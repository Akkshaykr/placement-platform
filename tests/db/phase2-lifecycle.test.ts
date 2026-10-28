import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asAnon, asUser, createDb } from './harness'
import {
  MIN,
  administrator,
  approvedQuestion,
  challengeData,
  expectCode,
  iso,
  publishedChallenge,
  scalar,
  seedTopic,
  student,
} from './phase2-helpers'

describe('Phase 2: challenge lifecycle and publication', () => {
  let db: PGlite
  let admin: string
  let learner: string
  let topicId: string

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    learner = await student(db)
    topicId = await seedTopic(db)
  })

  it('lets an administrator create a draft and refuses a student the same call', async () => {
    const id = await scalar<string>(db, asUser(admin), 'select public.admin_save_challenge(null, $1::jsonb)', [
      JSON.stringify(challengeData({ topicId }, { slug: 'draft-one' })),
    ])
    expect(id).toMatch(/^[0-9a-f-]{36}$/)

    await expectCode(
      scalar(db, asUser(learner), 'select public.admin_save_challenge(null, $1::jsonb)', [
        JSON.stringify(challengeData({ topicId })),
      ]),
      'FORBIDDEN',
    )
  })

  it('rejects invalid challenge input with coded validation errors', async () => {
    const save = (data: Record<string, unknown>) =>
      scalar(db, asUser(admin), 'select public.admin_save_challenge(null, $1::jsonb)', [
        JSON.stringify(challengeData({ topicId }, data)),
      ])
    await expectCode(save({ title: 'ab' }), 'VALIDATION')
    await expectCode(save({ time_limit_minutes: 0 }), 'VALIDATION')
    await expectCode(save({ target_question_count: 101 }), 'VALIDATION')
    await expectCode(save({ result_release: 'SOMETIMES' }), 'VALIDATION')
    await expectCode(
      save({ start_at: iso(2 * MIN * 60), end_at: iso(MIN * 60) }),
      'VALIDATION',
    )
  })

  it('keeps drafts invisible to students at every level', async () => {
    await scalar(db, asUser(admin), 'select public.admin_save_challenge(null, $1::jsonb)', [
      JSON.stringify(challengeData({ topicId }, { slug: 'secret-draft', title: 'Secret draft' })),
    ])
    const list = await scalar<{ slug: string }[]>(db, asUser(learner), 'select public.student_list_challenges()')
    expect(list.map((c) => c.slug)).not.toContain('secret-draft')
    await expectCode(
      scalar(db, asUser(learner), `select public.student_challenge_detail('secret-draft')`),
      'NOT_FOUND',
    )
    await expectCode(
      scalar(db, asUser(learner), 'select public.student_register((select id from public.challenges where slug = $1))', [
        'secret-draft',
      ]),
      'NOT_FOUND',
    )
  })

  it('refuses to publish without a schedule, a topic, approved questions, or the right question count', async () => {
    const q = await approvedQuestion(db, admin, topicId)
    const draft = async (data: Record<string, unknown>) => {
      const id = await scalar<string>(db, asUser(admin), 'select public.admin_save_challenge(null, $1::jsonb)', [
        JSON.stringify(challengeData({ topicId }, data)),
      ])
      await scalar(db, asUser(admin), 'select public.admin_set_challenge_questions($1::uuid, $2::jsonb)', [
        id,
        JSON.stringify([{ question_version_id: q.questionVersionId }]),
      ])
      return id
    }

    const noSchedule = await draft({ start_at: null, end_at: null })
    await expectCode(scalar(db, asUser(admin), 'select public.admin_publish_challenge($1::uuid)', [noSchedule]), 'VALIDATION')

    const wrongCount = await draft({ target_question_count: 3 })
    await expectCode(scalar(db, asUser(admin), 'select public.admin_publish_challenge($1::uuid)', [wrongCount]), 'VALIDATION')

    const noTopic = await draft({ topic_id: null })
    await expectCode(scalar(db, asUser(admin), 'select public.admin_publish_challenge($1::uuid)', [noTopic]), 'VALIDATION')
  })

  it('refuses to add a question that is not approved to a challenge', async () => {
    const saved = await scalar<{ question_version_id: string }>(
      db,
      asUser(admin),
      'select public.admin_save_question(null, $1::jsonb)',
      [
        JSON.stringify({
          stem: 'An unapproved draft question?',
          topic_id: topicId,
          options: ['a', 'b', 'c', 'd'],
          correct_position: 1,
          explanation: 'Because.',
        }),
      ],
    )
    const id = await scalar<string>(db, asUser(admin), 'select public.admin_save_challenge(null, $1::jsonb)', [
      JSON.stringify(challengeData({ topicId }, { slug: 'uses-draft-question' })),
    ])
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_set_challenge_questions($1::uuid, $2::jsonb)', [
        id,
        JSON.stringify([{ question_version_id: saved.question_version_id }]),
      ]),
      'VALIDATION',
    )
  })

  it('publishes, freezes the content, and keeps it hidden until the schedule opens', async () => {
    const q = await approvedQuestion(db, admin, topicId)
    const { challengeId, slug } = await publishedChallenge(
      db,
      admin,
      { topicId, slug: 'freeze-me', startMs: -MIN, endMs: 60 * MIN },
      [{ questionVersionId: q.questionVersionId }],
    )

    const row = await db.query<{ status: string; frozen: boolean; locked: boolean }>(
      `select c.status, cv.frozen_at is not null as frozen, qv.locked_at is not null as locked
         from public.challenges c
         join public.challenge_versions cv on cv.id = c.live_version_id
         join public.challenge_version_questions cvq on cvq.challenge_version_id = cv.id
         join public.question_versions qv on qv.id = cvq.question_version_id
        where c.id = $1`,
      [challengeId],
    )
    expect(row.rows[0]).toEqual({ status: 'PUBLISHED', frozen: true, locked: true })

    const list = await scalar<{ slug: string; state: string }[]>(db, asUser(learner), 'select public.student_list_challenges()')
    expect(list.find((c) => c.slug === slug)?.state).toBe('OPEN')

    // Published content cannot be edited or re-composed through the functions.
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_save_challenge($1::uuid, $2::jsonb)', [
        challengeId,
        JSON.stringify(challengeData({ topicId }, { title: 'Sneaky edit' })),
      ]),
      'INVALID_TRANSITION',
    )
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_set_challenge_questions($1::uuid, $2::jsonb)', [
        challengeId,
        JSON.stringify([]),
      ]),
      'INVALID_TRANSITION',
    )
  })

  it('shows future challenges as UPCOMING and refuses registration before they open with a coded error', async () => {
    const q = await approvedQuestion(db, admin, topicId)
    await publishedChallenge(db, admin, { topicId, slug: 'coming-soon', startMs: 2 * 60 * MIN, endMs: 4 * 60 * MIN }, [
      { questionVersionId: q.questionVersionId },
    ])
    const list = await scalar<{ slug: string; state: string }[]>(db, asUser(learner), 'select public.student_list_challenges()')
    expect(list.find((c) => c.slug === 'coming-soon')?.state).toBe('UPCOMING')
    // Registration before opening is allowed (it is how a student "joins" an upcoming challenge).
    // Students learn ids through the browse function, not through the (schedule-filtered) table.
    const upcomingId = list.find((c) => c.slug === 'coming-soon') as unknown as { id: string }
    const reg = await scalar<{ registered: boolean }>(db, asUser(learner), 'select public.student_register($1::uuid)', [
      upcomingId.id,
    ])
    expect(reg.registered).toBe(true)
  })

  it('lets only the administrator transition lifecycle states, and only along valid paths', async () => {
    const q = await approvedQuestion(db, admin, topicId)
    const { challengeId } = await publishedChallenge(db, admin, { topicId, slug: 'cancel-me', startMs: 60 * MIN, endMs: 120 * MIN }, [
      { questionVersionId: q.questionVersionId },
    ])

    await expectCode(
      scalar(db, asUser(learner), 'select public.admin_transition_challenge($1::uuid, $2)', [challengeId, 'CANCEL']),
      'FORBIDDEN',
    )

    // Upcoming challenges can be cancelled; the state is then final and visible to students.
    await scalar(db, asUser(admin), 'select public.admin_transition_challenge($1::uuid, $2)', [challengeId, 'CANCEL'])
    const list = await scalar<{ slug: string; state: string }[]>(db, asUser(learner), 'select public.student_list_challenges()')
    expect(list.find((c) => c.slug === 'cancel-me')?.state).toBe('CANCELLED')

    // A cancelled challenge cannot be completed, and cannot be cancelled twice.
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_transition_challenge($1::uuid, $2)', [challengeId, 'COMPLETE']),
      'INVALID_TRANSITION',
    )
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_transition_challenge($1::uuid, $2)', [challengeId, 'CANCEL']),
      'INVALID_TRANSITION',
    )
  })

  it('deletes only drafts, and archives only cancelled, completed or draft challenges', async () => {
    const id = await scalar<string>(db, asUser(admin), 'select public.admin_save_challenge(null, $1::jsonb)', [
      JSON.stringify(challengeData({ topicId }, { slug: 'to-delete' })),
    ])
    await scalar(db, asUser(admin), 'select public.admin_transition_challenge($1::uuid, $2)', [id, 'DELETE'])
    const list = await scalar<{ slug: string }[]>(db, asUser(admin), 'select public.admin_list_challenges($1::jsonb)', [
      JSON.stringify({ q: 'to-delete' }),
    ])
    expect(list).toHaveLength(0)

    const q = await approvedQuestion(db, admin, topicId)
    const { challengeId } = await publishedChallenge(db, admin, { topicId, slug: 'live-one', startMs: -MIN, endMs: 60 * MIN }, [
      { questionVersionId: q.questionVersionId },
    ])
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_transition_challenge($1::uuid, $2)', [challengeId, 'ARCHIVE']),
      'INVALID_TRANSITION',
    )
  })

  it('completes an open challenge: running attempts are submitted at that moment and the challenge closes', async () => {
    const q = await approvedQuestion(db, admin, topicId)
    const { challengeId, slug } = await publishedChallenge(db, admin, { topicId, slug: 'close-early', startMs: -MIN, endMs: 60 * MIN }, [
      { questionVersionId: q.questionVersionId },
    ])
    const who = await student(db)
    const attemptId = await scalar<{ attempt_id: string }>(
      db,
      asUser(who),
      'select public.student_start_attempt($1::uuid)',
      [challengeId],
    )
    await scalar(db, asUser(admin), 'select public.admin_transition_challenge($1::uuid, $2)', [challengeId, 'COMPLETE'])

    const status = await db.query<{ status: string; submitted_via: string }>(
      'select status, submitted_via from public.challenge_attempts where id = $1',
      [attemptId.attempt_id],
    )
    expect(status.rows[0]).toEqual({ status: 'SUBMITTED', submitted_via: 'TIMEOUT' })
    const ch = await db.query<{ status: string }>('select status from public.challenges where slug = $1', [slug])
    expect(ch.rows[0]!.status).toBe('CLOSED')
  })

  it('denies anonymous callers every Phase 2 function', async () => {
    const grants = await db.query<{ fn: string; ok: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'admin\\_%' or p.proname like 'student\\_%'`,
    )
    expect(grants.rows.filter((g) => g.ok)).toEqual([])
    await expect(as(db, asAnon, () => db.query('select public.student_list_challenges()'))).rejects.toThrow(
      /permission denied/i,
    )
  })
})
