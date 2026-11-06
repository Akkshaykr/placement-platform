import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createDb } from './harness'
import { MIN, administrator, approvedQuestion, publishedChallenge, seedTopic, student } from './phase2-helpers'

// Tamil text written as unicode escapes so the file is safe in any terminal encoding.
const TA_STEM = '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD \u0BB5\u0BBF\u0BA9\u0BBE?'
const TA_EXPL = '\u0BB5\u0BBF\u0BB3\u0B95\u0BCD\u0B95\u0BAE\u0BCD'
const taOption = (i: number) => `\u0BB5\u0BBF\u0B9F\u0BC8 ${i + 1}`

describe('Tamil results', () => {
  let db: PGlite
  let admin: string
  let challengeId: string
  let qv: string
  let optionIds: string[]

  const run = <T>(userId: string, sql: string, params: unknown[]) =>
    as(db, asUser(userId), async () => (await db.query<{ r: T }>(sql, params)).rows[0]!.r)

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
    const topicId = await seedTopic(db)
    const q = await approvedQuestion(db, admin, topicId, { stem: 'Result language probe question?' })
    qv = q.questionVersionId
    optionIds = q.optionIds
    const c = await publishedChallenge(
      db,
      admin,
      { topicId, slug: 'result-language', startMs: -MIN, endMs: 600 * MIN },
      [{ questionVersionId: qv }],
    )
    challengeId = c.challengeId
    await db.query(`update public.challenges set languages = array['en', 'ta'] where id = $1`, [challengeId])
    await db.query(
      `insert into public.question_translations (question_version_id, language, stem, explanation, status, reviewed_by, reviewed_at)
       values ($1, 'ta', $2, $3, 'APPROVED', $4, now())`,
      [qv, TA_STEM, TA_EXPL, admin],
    )
    for (const [i, id] of optionIds.entries()) {
      await db.query(`insert into public.question_option_translations (option_id, language, body) values ($1, 'ta', $2)`, [id, taOption(i)])
    }
  })

  const submitted = async (language: string) => {
    const user = await student(db)
    const attempt: any = await run(user, `select public.student_start_attempt($1, $2) as r`, [challengeId, language])
    await run(user, `select public.student_submit_attempt($1) as r`, [attempt.attempt_id])
    return run<any>(user, `select public.student_get_result($1) as r`, [attempt.attempt_id])
  }

  it('shows Tamil text in the result of a Tamil attempt', async () => {
    const result = await submitted('ta')
    expect(result.language).toBe('ta')
    const question = result.questions[0]
    expect(question.stem).toBe(TA_STEM)
    expect([...question.options.map((o: any) => o.id)].sort()).toEqual([...optionIds].sort())
    for (const o of question.options) expect(o.body).toMatch(/^\u0BB5\u0BBF\u0B9F\u0BC8 \d$/)
    if (result.released) expect(question.explanation).toBe(TA_EXPL)
    else expect(question.explanation).toBeNull()
  })

  it('keeps English in the result of an English attempt', async () => {
    const result = await submitted('en')
    expect(result.language).toBe('en')
    expect(result.questions[0].stem).toBe('Result language probe question?')
    if (result.released) expect(result.questions[0].explanation).not.toBe(TA_EXPL)
  })
})