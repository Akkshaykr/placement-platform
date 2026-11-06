import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createDb } from './harness'
import { MIN, administrator, approvedQuestion, publishedChallenge, seedTopic, student } from './phase2-helpers'

// Tamil text written as unicode escapes so the file is safe in any terminal encoding.
const TA_STEM = '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD \u0BB5\u0BBF\u0BA9\u0BBE?'
const taOption = (i: number) => `\u0BB5\u0BBF\u0B9F\u0BC8 ${i + 1}`

type AttemptView = {
  language: string
  questions: { stem: string; options: { id: string; body: string }[] }[]
}

describe('student language choice', () => {
  let db: PGlite
  let admin: string
  let challengeId: string
  let qv: string
  let optionIds: string[]

  const start = (userId: string, language?: string) =>
    as(db, asUser(userId), async () => {
      const r =
        language === undefined
          ? await db.query<{ r: AttemptView }>(`select public.student_start_attempt($1) as r`, [challengeId])
          : await db.query<{ r: AttemptView }>(`select public.student_start_attempt($1, $2) as r`, [challengeId, language])
      return r.rows[0]!.r
    })

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    const topicId = await seedTopic(db)
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Student language probe question?' })
    qv = q.questionVersionId
    optionIds = q.optionIds
    const c = await publishedChallenge(
      db,
      admin,
      { topicId, slug: 'student-language', startMs: -MIN, endMs: 600 * MIN },
      [{ questionVersionId: qv }],
    )
    challengeId = c.challengeId
  })

  it('starts in English by default, with the one-argument call', async () => {
    const attempt = await start(await student(db))
    expect(attempt.language).toBe('en')
    expect(attempt.questions[0]!.stem).toBe('Student language probe question?')
  })

  it('refuses Tamil while the challenge offers English only', async () => {
    await expect(start(await student(db), 'ta')).rejects.toThrow(/VALIDATION/)
  })

  it('refuses unknown languages', async () => {
    await expect(start(await student(db), 'fr')).rejects.toThrow(/VALIDATION/)
  })

  it('refuses Tamil until every question has an approved translation', async () => {
    await db.query(`update public.challenges set languages = array['en', 'ta'] where id = $1`, [challengeId])
    await expect(start(await student(db), 'ta')).rejects.toThrow(/VALIDATION/)
  })

  it('serves Tamil text on the same option ids once approved', async () => {
    await db.query(
      `insert into public.question_translations (question_version_id, language, stem, explanation, status, reviewed_by, reviewed_at)
       values ($1, 'ta', $2, 'x', 'APPROVED', $3, now())`,
      [qv, TA_STEM, admin],
    )
    for (const [i, id] of optionIds.entries()) {
      await db.query(`insert into public.question_option_translations (option_id, language, body) values ($1, 'ta', $2)`, [id, taOption(i)])
    }
    const attempt = await start(await student(db), 'ta')
    expect(attempt.language).toBe('ta')
    const question = attempt.questions[0]!
    expect(question.stem).toBe(TA_STEM)
    expect([...question.options.map((o) => o.id)].sort()).toEqual([...optionIds].sort())
    for (const o of question.options) {
      expect(o.body).toMatch(/^\u0BB5\u0BBF\u0B9F\u0BC8 \d$/)
    }
  })

  it('keeps English for English attempts even after Tamil is available', async () => {
    const attempt = await start(await student(db), 'en')
    expect(attempt.language).toBe('en')
    expect(attempt.questions[0]!.stem).toBe('Student language probe question?')
  })
})