import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asAnon, asUser, createDb } from './harness'
import {
  MIN,
  administrator,
  approvedQuestion,
  expectCode,
  publishedChallenge,
  scalar,
  seedTopic,
  student,
} from './phase2-helpers'

type Checks = { check: string; outcome: string; message: string }[]

const saveInput = (topicId: string, over: Record<string, unknown> = {}) => ({
  stem: 'If a train travels 60 km in 1 hour, what is its speed?',
  topic_id: topicId,
  subtopic: 'Speed',
  difficulty: 'EASY',
  estimated_seconds: 45,
  options: ['30 km/h', '60 km/h', '90 km/h', '120 km/h'],
  correct_position: 2,
  explanation: 'Speed = distance / time = 60 / 1.',
  ...over,
})

describe('Phase 2: question bank, answer keys and approval', () => {
  let db: PGlite
  let admin: string
  let topicId: string

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    topicId = await seedTopic(db)
  })

  const save = (qid: string | null, data: Record<string, unknown>) =>
    scalar<{ question_id: string; question_version_id: string; review_status: string; checks: Checks }>(
      db,
      asUser(admin),
      'select public.admin_save_question($1::uuid, $2::jsonb)',
      [qid, JSON.stringify(data)],
    )

  it('creates a DRAFT question with its key, and never accepts an invalid option list', async () => {
    const r = await save(null, saveInput(topicId))
    expect(r.review_status).toBe('AUTO_PASSED')

    await expectCode(save(null, saveInput(topicId, { options: ['only one'] })), 'VALIDATION')
    await expectCode(save(null, saveInput(topicId, { options: ['a', '  ', 'c', 'd'] })), 'VALIDATION')
    await expectCode(save(null, saveInput(topicId, { correct_position: 5 })), 'VALIDATION')
    await expectCode(save(null, saveInput(topicId, { correct_position: null })), 'VALIDATION')
    await expectCode(save(null, saveInput(topicId, { stem: 'hi' })), 'VALIDATION')
  })

  it('flags duplicate options as FAILED and refuses approval', async () => {
    const r = await save(null, saveInput(topicId, { options: ['Same', 'same ', 'Other', 'More'], correct_position: 1 }))
    expect(r.review_status).toBe('FAILED')
    const dup = r.checks.find((c) => c.check === 'OPTIONS_DISTINCT')
    expect(dup?.outcome).toBe('FAIL')
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_approve_question($1::uuid, true)', [r.question_version_id]),
      'VALIDATION',
    )
  })

  it('requires an explicit confirmation before approving, and approves only on confirmation', async () => {
    const r = await save(null, saveInput(topicId, { stem: 'Confirm before approving this question please?' }))
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_approve_question($1::uuid, false)', [r.question_version_id]),
      'VALIDATION',
    )
    await scalar(db, asUser(admin), 'select public.admin_approve_question($1::uuid, true)', [r.question_version_id])
    const row = await db.query<{ review_status: string; approved_by: string | null }>(
      'select review_status, approved_by from public.question_versions where id = $1',
      [r.question_version_id],
    )
    expect(row.rows[0]).toEqual({ review_status: 'ADMIN_APPROVED', approved_by: admin })
  })

  it('reports a missing answer key as a FAILED check and blocks approval', async () => {
    const r = await save(null, saveInput(topicId, { stem: 'A question whose key will be removed?' }))
    // Simulate corruption of a DRAFT (owner-side). Unlocked versions allow it; the check must catch it.
    await db.query('delete from public.question_answer_keys where question_version_id = $1', [r.question_version_id])
    const detail = await scalar<{ checks: Checks }>(db, asUser(admin), 'select public.admin_get_question($1::uuid)', [r.question_id])
    expect(detail.checks.find((c) => c.check === 'ANSWER_KEY')?.outcome).toBe('FAIL')
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_approve_question($1::uuid, true)', [r.question_version_id]),
      'VALIDATION',
    )
  })

  it('resets approval when an approved question is edited, so the change must be reviewed again', async () => {
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Approved then edited question?' })
    await save(q.questionId, saveInput(topicId, { stem: 'Approved then edited, new wording?' }))
    const row = await db.query<{ review_status: string; approved_at: string | null }>(
      'select review_status, approved_at from public.question_versions where id = $1',
      [q.questionVersionId],
    )
    expect(row.rows[0]!.review_status).not.toBe('ADMIN_APPROVED')
    expect(row.rows[0]!.approved_at).toBeNull()
  })

  it('keeps a published question version stable: later edits create a new version', async () => {
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Question that will be published?' })
    const { challengeId } = await publishedChallenge(db, admin, { topicId, slug: 'stable-versions', startMs: -MIN, endMs: 600 * MIN }, [
      { questionVersionId: q.questionVersionId },
    ])
    expect(challengeId).toBeTruthy()

    const edited = await save(q.questionId, saveInput(topicId, { stem: 'Edited after publication, should be v2?' }))
    expect(edited.question_version_id).not.toBe(q.questionVersionId)

    const original = await db.query<{ stem: string; version_number: number }>(
      'select stem, version_number from public.question_versions where id = $1',
      [q.questionVersionId],
    )
    expect(original.rows[0]).toEqual({ stem: 'Question that will be published?', version_number: 1 })

    // The new version is a draft; the published challenge still points at version 1.
    const used = await db.query<{ question_version_id: string }>(
      `select cvq.question_version_id from public.challenge_version_questions cvq
         join public.challenges c on c.live_version_id = cvq.challenge_version_id
        where c.id = $1`,
      [challengeId],
    )
    expect(used.rows.map((r) => r.question_version_id)).toEqual([q.questionVersionId])
  })

  it('never lets an unapproved draft into a published assessment, even when it is the newest version', async () => {
    // Publishing locks version 1. Editing it afterwards creates version 2, which is an unapproved draft.
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Original approved for a draft test?' })
    await publishedChallenge(db, admin, { topicId, slug: 'locks-v1', startMs: -MIN, endMs: 600 * MIN }, [
      { questionVersionId: q.questionVersionId },
    ])
    const v2 = await save(q.questionId, saveInput(topicId, { stem: 'Newer unapproved draft version here?' }))
    expect(v2.review_status).not.toBe('ADMIN_APPROVED')

    const id = await scalar<string>(db, asUser(admin), 'select public.admin_save_challenge(null, $1::jsonb)', [
      JSON.stringify({
        slug: 'draft-version-try',
        title: 'Draft version try',
        topic_id: topicId,
        start_at: new Date(Date.now() - MIN).toISOString(),
        end_at: new Date(Date.now() + 60 * MIN).toISOString(),
        target_question_count: 1,
      }),
    ])
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_set_challenge_questions($1::uuid, $2::jsonb)', [
        id,
        JSON.stringify([{ question_version_id: v2.question_version_id }]),
      ]),
      'VALIDATION',
    )
  })

  it('treats AI-generated questions as untrusted: a human check is required, and a solver disagreement only warns', async () => {
    // AI generation is off by default: starting a job must be refused until an administrator enables it.
    await expectCode(
      scalar(db, asUser(admin), 'select public.admin_ai_begin($1::jsonb)', [JSON.stringify({ count: 1, prompt: 'speed' })]),
      'AI_DISABLED',
    )
    // Enable it for this test only, then restore the default.
    await db.query(`update public.app_settings set value = 'true'::jsonb where key = 'ai.enabled'`)
    try {
      const jobId = await scalar<string>(db, asUser(admin), 'select public.admin_ai_begin($1::jsonb)', [
        JSON.stringify({ count: 1, topic_id: topicId, prompt: 'speed' }),
      ])
      const r = await scalar<{ question_id: string; question_version_id: string; review_status: string; checks: Checks }>(
        db,
        asUser(admin),
        'select public.admin_save_question(null, $1::jsonb)',
        [JSON.stringify(saveInput(topicId, { stem: 'AI generated speed question here?', origin: 'AI', generation_job_id: jobId }))],
      )
      expect(r.review_status).toBe('WARNING')
      expect(r.checks.find((c) => c.check === 'HUMAN_REVIEW')?.outcome).toBe('WARN')

      await scalar(db, asUser(admin), 'select public.admin_record_solver_check($1::uuid, $2, $3)', [
        r.question_version_id,
        'WARN',
        'Second pass answered option 3.',
      ])
      const after = await db.query<{ key: string; review: string }>(
        `select k.correct_option_id::text as key, qv.review_status::text as review
           from public.question_versions qv join public.question_answer_keys k on k.question_version_id = qv.id
          where qv.id = $1`,
        [r.question_version_id],
      )
      // The solver disagreement did not approve the question; it only moved it to WARNING.
      expect(after.rows[0]!.review).toBe('WARNING')
      const solver = await scalar<{ checks: Checks }>(db, asUser(admin), 'select public.admin_get_question($1::uuid)', [r.question_id])
      expect(solver.checks.find((c) => c.check === 'MODEL_SOLVER_AGREEMENT')?.outcome).toBe('WARN')
    } finally {
      await db.query(`update public.app_settings set value = 'false'::jsonb where key = 'ai.enabled'`)
    }
  })

  it('refuses to delete a question that a challenge uses, and allows deleting an unused one', async () => {
    const used = await approvedQuestion(db, admin, topicId, { stem: 'Used by a published challenge?' })
    await publishedChallenge(db, admin, { topicId, slug: 'uses-question', startMs: -MIN, endMs: 600 * MIN }, [
      { questionVersionId: used.questionVersionId },
    ])
    await expectCode(scalar(db, asUser(admin), 'select public.admin_delete_question($1::uuid)', [used.questionId]), 'INVALID_TRANSITION')

    const spare = await save(null, saveInput(topicId, { stem: 'Spare question to delete now?' }))
    await scalar(db, asUser(admin), 'select public.admin_delete_question($1::uuid)', [spare.question_id])
    const listed = await scalar<{ question_id: string }[]>(db, asUser(admin), 'select public.admin_list_questions($1::jsonb)', [
      JSON.stringify({ q: 'spare question to delete' }),
    ])
    expect(listed.find((x) => x.question_id === spare.question_id)).toBeUndefined()
  })

  it('filters the bank by topic, status and text, for administrators only', async () => {
    await save(null, saveInput(topicId, { stem: 'Filterable quantitative question about ratios?' }))
    const byText = await scalar<{ stem: string }[]>(db, asUser(admin), 'select public.admin_list_questions($1::jsonb)', [
      JSON.stringify({ q: 'filterable' }),
    ])
    expect(byText.length).toBeGreaterThan(0)
    expect(byText.every((x) => x.stem.toLowerCase().includes('filterable'))).toBe(true)

    const byStatus = await scalar<{ review_status: string }[]>(db, asUser(admin), 'select public.admin_list_questions($1::jsonb)', [
      JSON.stringify({ review_status: 'FAILED' }),
    ])
    expect(byStatus.every((x) => x.review_status === 'FAILED')).toBe(true)

    const learner = await student(db)
    await expectCode(
      scalar(db, asUser(learner), 'select public.admin_list_questions($1::jsonb)', ['{}']),
      'FORBIDDEN',
    )
    await expectCode(scalar(db, asUser(learner), 'select public.admin_save_question(null, $1::jsonb)', [JSON.stringify(saveInput(topicId))]), 'FORBIDDEN')
    await expect(as(db, asAnon, () => db.query('select public.admin_list_questions($1::jsonb)', ['{}']))).rejects.toThrow(
      /permission denied/i,
    )
  })
})
