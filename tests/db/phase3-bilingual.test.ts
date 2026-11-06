import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createDb } from './harness'
import {
  MIN,
  administrator,
  approvedQuestion,
  publishedChallenge,
  seedTopic,
  student,
} from './phase2-helpers'

const TAMIL_STEM = 'இந்த வினா சோதனைக்கானது?'

describe('bilingual content schema (English and Tamil)', () => {
  let db: PGlite
  let admin: string
  let learner: string
  let topicId: string
  let qv: string
  let optionIds: string[]

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    learner = await student(db)
    topicId = await seedTopic(db)
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Bilingual schema probe question?' })
    qv = q.questionVersionId
    optionIds = q.optionIds
  })

  it('stores a Tamil translation that students cannot read directly', async () => {
    await db.query(
      `insert into public.question_translations (question_version_id, language, stem, explanation) values ($1, 'ta', $2, $3)`,
      [qv, TAMIL_STEM, 'விளக்கம்'],
    )
    const studentRows = await as(db, asUser(learner), async () =>
      (await db.query('select question_version_id from public.question_translations')).rows,
    )
    expect(studentRows).toHaveLength(0)
    const adminRows = await as(db, asUser(admin), async () =>
      (await db.query('select question_version_id from public.question_translations')).rows,
    )
    expect(adminRows).toHaveLength(1)
  })

  it('rejects English as a translation, because English is the canonical version', async () => {
    await expect(
      db.query(`insert into public.question_translations (question_version_id, language, stem) values ($1, 'en', 'English copy?')`, [qv]),
    ).rejects.toThrow(/violates check constraint/)
  })

  it('refuses an approved translation that has no named reviewer', async () => {
    const other = await approvedQuestion(db, admin, topicId, { stem: 'Second probe question for the reviewer rule?' })
    await expect(
      db.query(
        `insert into public.question_translations (question_version_id, language, stem, status) values ($1, 'ta', $2, 'APPROVED')`,
        [other.questionVersionId, TAMIL_STEM],
      ),
    ).rejects.toThrow(/question_translations_review_ck/)
  })

  it('stores one Tamil body for each English option, on the same option ids', async () => {
    for (const id of optionIds) {
      await db.query(`insert into public.question_option_translations (option_id, language, body) values ($1, 'ta', $2)`, [id, 'விடை'])
    }
    const count = await db.query<{ n: number }>(
      'select count(*)::int as n from public.question_option_translations where option_id = any($1::uuid[])',
      [optionIds],
    )
    expect(count.rows[0]!.n).toBe(optionIds.length)
  })

  it('reports a question as Tamil-ready only once its translation is approved', async () => {
    const before = await db.query<{ ready: boolean }>(`select public.question_ready_in($1, 'ta') as ready`, [qv])
    expect(before.rows[0]!.ready).toBe(false)

    await db.query(
      `update public.question_translations set status = 'APPROVED', reviewed_by = $2, reviewed_at = now() where question_version_id = $1 and language = 'ta'`,
      [qv, admin],
    )
    const after = await db.query<{ ready: boolean }>(`select public.question_ready_in($1, 'ta') as ready`, [qv])
    expect(after.rows[0]!.ready).toBe(true)

    const english = await db.query<{ ready: boolean }>(`select public.question_ready_in($1, 'en') as ready`, [qv])
    expect(english.rows[0]!.ready).toBe(true)
  })

  it('defaults every challenge to English only, and rejects unknown languages', async () => {
    const c = await publishedChallenge(
      db,
      admin,
      { topicId, slug: 'language-default', startMs: -MIN, endMs: 600 * MIN },
      [{ questionVersionId: qv }],
    )
    const row = await db.query<{ languages: string[] }>('select languages from public.challenges where id = $1', [c.challengeId])
    expect(row.rows[0]!.languages).toEqual(['en'])
    await expect(
      db.query(`update public.challenges set languages = array['en', 'fr'] where id = $1`, [c.challengeId]),
    ).rejects.toThrow(/violates check constraint/)
  })

  it('starts every attempt in English unless a Tamil attempt is chosen', async () => {
    const row = await db.query<{ column_default: string }>(
      `select column_default from information_schema.columns where table_schema = 'public' and table_name = 'challenge_attempts' and column_name = 'language'`,
    )
    expect(row.rows[0]!.column_default).toContain("'en'")
  })
})
