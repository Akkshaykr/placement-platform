import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createDb } from './harness'
import { MIN, administrator, approvedQuestion, publishedChallenge, seedTopic, student } from './phase2-helpers'

describe('challenge detail languages', () => {
  let db: PGlite
  let admin: string
  let challengeId: string
  let qv: string

  const detail = async () => {
    const user = await student(db)
    return as(db, asUser(user), async () =>
      (await db.query<{ r: any }>(`select public.student_challenge_detail('detail-language') as r`)).rows[0]!.r,
    )
  }

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    const topicId = await seedTopic(db)
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Detail language probe question?' })
    qv = q.questionVersionId
    const c = await publishedChallenge(
      db,
      admin,
      { topicId, slug: 'detail-language', startMs: -MIN, endMs: 600 * MIN },
      [{ questionVersionId: qv }],
    )
    challengeId = c.challengeId
  })

  it('offers English only, and Tamil is not ready, by default', async () => {
    const d = await detail()
    expect(d.languages).toEqual(['en'])
    expect(d.tamil_ready).toBe(false)
  })

  it('is not Tamil-ready while the translation is unapproved', async () => {
    await db.query(`update public.challenges set languages = array['en', 'ta'] where id = $1`, [challengeId])
    await db.query(
      `insert into public.question_translations (question_version_id, language, stem, explanation)
       values ($1, 'ta', 'Draft Tamil stem?', 'x')`,
      [qv],
    )
    const d = await detail()
    expect(d.languages).toEqual(['en', 'ta'])
    expect(d.tamil_ready).toBe(false)
  })

  it('is Tamil-ready once every question is approved', async () => {
    await db.query(
      `update public.question_translations set status = 'APPROVED', reviewed_by = $2, reviewed_at = now()
       where question_version_id = $1 and language = 'ta'`,
      [qv, admin],
    )
    expect((await detail()).tamil_ready).toBe(true)
  })
})