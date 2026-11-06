import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createDb } from './harness'
import { administrator, approvedQuestion, seedTopic } from './phase2-helpers'

type QuestionView = {
  tamil: null | { status: string; stem: string; options: string[] }
}

describe('admin_get_question translations', () => {
  let db: PGlite
  let admin: string
  let questionId: string
  let qv: string
  let optionCount: number

  const get = () =>
    as(db, asUser(admin), async () =>
      (await db.query<{ r: QuestionView }>(`select public.admin_get_question($1) as r`, [questionId])).rows[0]!.r,
    )

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    const topicId = await seedTopic(db)
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Admin get question probe?' })
    qv = q.questionVersionId
    optionCount = q.optionIds.length
    const row = await db.query<{ question_id: string }>(
      `select question_id from public.question_versions where id = $1`,
      [qv],
    )
    questionId = row.rows[0]!.question_id
  })

  it('has no Tamil translation until one is saved', async () => {
    expect((await get()).tamil).toBeNull()
  })

  it('returns the saved Tamil draft with one body per option', async () => {
    await as(db, asUser(admin), () =>
      db.query(`select public.admin_save_translation($1, 'ta', $2::jsonb)`, [
        qv,
        JSON.stringify({
          stem: 'Translated stem placeholder?',
          explanation: 'Translated explanation',
          options: Array.from({ length: optionCount }, (_, i) => `Translated option ${i + 1}`),
        }),
      ]),
    )
    const view = await get()
    expect(view.tamil?.status).toBe('NEEDS_REVIEW')
    expect(view.tamil?.stem).toBe('Translated stem placeholder?')
    expect(view.tamil?.options).toHaveLength(optionCount)
  })
})