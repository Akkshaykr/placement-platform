import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createDb } from './harness'
import { administrator, approvedQuestion, seedTopic, student } from './phase2-helpers'

const payload = (n: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    stem: 'Translated stem placeholder?',
    explanation: 'Translated explanation',
    options: Array.from({ length: n }, (_, i) => `Translated option ${i + 1}`),
    ...extra,
  })

describe('admin translation functions', () => {
  let db: PGlite
  let admin: string
  let learner: string
  let topicId: string
  let qv: string
  let optionCount: number

  const save = (id: string, data: string, lang = 'ta') =>
    as(db, asUser(admin), () => db.query(`select public.admin_save_translation($1, $2, $3::jsonb) as r`, [id, lang, data]))
  const approve = (id: string, flag = true) =>
    as(db, asUser(admin), () => db.query(`select public.admin_approve_translation($1, 'ta', $2) as r`, [id, flag]))
  const ready = async (id: string) =>
    (await db.query<{ r: boolean }>(`select public.question_ready_in($1, 'ta') as r`, [id])).rows[0]!.r

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    learner = await student(db)
    topicId = await seedTopic(db)
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Admin translation probe question?' })
    qv = q.questionVersionId
    optionCount = q.optionIds.length
  })

  it('lets an administrator save a draft translation with all options', async () => {
    await save(qv, payload(optionCount))
    const t = await db.query<{ status: string }>(
      `select status from public.question_translations where question_version_id = $1 and language = 'ta'`, [qv])
    expect(t.rows[0]!.status).toBe('NEEDS_REVIEW')
    const o = await db.query<{ n: number }>(
      `select count(*)::int as n from public.question_option_translations ot join public.question_options q on q.id = ot.option_id where q.question_version_id = $1`, [qv])
    expect(o.rows[0]!.n).toBe(optionCount)
    expect(await ready(qv)).toBe(false)
  })

  it('refuses students', async () => {
    await expect(
      as(db, asUser(learner), () => db.query(`select public.admin_save_translation($1, 'ta', $2::jsonb)`, [qv, payload(optionCount)])),
    ).rejects.toThrow(/FORBIDDEN/)
    await expect(
      as(db, asUser(learner), () => db.query(`select public.admin_approve_translation($1, 'ta', true)`, [qv])),
    ).rejects.toThrow(/FORBIDDEN/)
  })

  it('rejects English, and a wrong number of options', async () => {
    await expect(save(qv, payload(optionCount), 'en')).rejects.toThrow(/VALIDATION/)
    await expect(save(qv, payload(optionCount - 1))).rejects.toThrow(/VALIDATION/)
  })

  it('approves a complete translation and records the reviewer', async () => {
    await approve(qv)
    const t = await db.query<{ status: string; reviewed_by: string }>(
      `select status, reviewed_by from public.question_translations where question_version_id = $1 and language = 'ta'`, [qv])
    expect(t.rows[0]).toMatchObject({ status: 'APPROVED', reviewed_by: admin })
    expect(await ready(qv)).toBe(true)
  })

  it('sends an edited translation back to review', async () => {
    await save(qv, payload(optionCount, { stem: 'Edited translated stem?' }))
    const t = await db.query<{ status: string; reviewed_by: string | null }>(
      `select status, reviewed_by from public.question_translations where question_version_id = $1 and language = 'ta'`, [qv])
    expect(t.rows[0]).toMatchObject({ status: 'NEEDS_REVIEW', reviewed_by: null })
    expect(await ready(qv)).toBe(false)
  })

  it('cannot approve a question that has no translation', async () => {
    const other = await approvedQuestion(db, admin, topicId, { stem: 'Untranslated probe question?' })
    await expect(approve(other.questionVersionId)).rejects.toThrow(/VALIDATION/)
  })
})