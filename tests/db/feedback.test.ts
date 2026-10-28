import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { addAdmin, addPublishedChallenge, addUser, as, asUser, createDb, type SeededContent } from './harness'
import { expectPermissionDenied } from './helpers'

describe('feedback and error reports', () => {
  let db: PGlite
  let content: SeededContent
  let admin: string

  beforeAll(async () => {
    db = await createDb()
    content = await addPublishedChallenge(db)
    admin = await addAdmin(db)
  })

  const report = (message = 'Option B looks wrong') =>
    db.query<{ id: string; reporter_id: string; status: string }>(
      `insert into public.feedback_reports (kind, question_version_id, message)
       values ('QUESTION_ERROR', $1, $2) returning id, reporter_id, status`,
      [content.questionVersionId, message],
    )

  it('lets a signed-in user file a report that is attributed to them and starts OPEN', async () => {
    const u = await addUser(db)
    const r = await as(db, asUser(u), async () => (await report()).rows[0])
    expect(r).toMatchObject({ reporter_id: u, status: 'OPEN' })
  })

  it('does not let the client choose the reporter, status or admin fields', async () => {
    const u = await addUser(db)
    const other = await addUser(db)
    await as(db, asUser(u), async () => {
      await expectPermissionDenied(
        db.query(`insert into public.feedback_reports (kind, question_version_id, message, reporter_id) values ('QUESTION_ERROR', $1, 'x', $2)`, [content.questionVersionId, other]),
      )
      await expectPermissionDenied(
        db.query(`insert into public.feedback_reports (kind, question_version_id, message, status) values ('QUESTION_ERROR', $1, 'x', 'RESOLVED')`, [content.questionVersionId]),
      )
      await expectPermissionDenied(
        db.query(`insert into public.feedback_reports (kind, question_version_id, message, admin_response) values ('QUESTION_ERROR', $1, 'x', 'official')`, [content.questionVersionId]),
      )
    })
  })

  it('requires a target for question-error reports and a challenge for ratings', async () => {
    const u = await addUser(db)
    await as(db, asUser(u), async () => {
      await expect(db.query(`insert into public.feedback_reports (kind, message) values ('QUESTION_ERROR', 'no target')`)).rejects.toThrow(/feedback_question_error_target_ck/)
      await expect(db.query(`insert into public.feedback_reports (kind, rating, message) values ('CONTENT_FEEDBACK', 5, 'great')`)).rejects.toThrow(/feedback_rating_target_ck/)
      await db.query(`insert into public.feedback_reports (kind, challenge_id, rating, message) values ('CONTENT_FEEDBACK', $1, 5, 'great')`, [content.challengeId])
      await expect(db.query(`insert into public.feedback_reports (kind, challenge_id, rating, message) values ('CONTENT_FEEDBACK', $1, 6, 'too high')`, [content.challengeId])).rejects.toThrow(/check constraint/i)
      await expect(db.query(`insert into public.feedback_reports (kind, challenge_id, message) values ('CONTENT_FEEDBACK', $1, '   ')`, [content.challengeId])).rejects.toThrow(/check constraint/i)
    })
  })

  it('shows users only their own reports and the admin all of them', async () => {
    const a = await addUser(db)
    const b = await addUser(db)
    await as(db, asUser(a), async () => { await report('from a') })
    await as(db, asUser(b), async () => { await report('from b') })

    const aSees = await as(db, asUser(a), async () => (await db.query<{ message: string }>('select message from public.feedback_reports')).rows.map((r) => r.message))
    expect(aSees).toEqual(['from a'])
    const adminSees = await as(db, asUser(admin), async () => (await db.query<{ message: string }>('select message from public.feedback_reports')).rows.map((r) => r.message))
    expect(adminSees).toEqual(expect.arrayContaining(['from a', 'from b']))
  })

  it('does not let a user change the status of a report (their own included)', async () => {
    const u = await addUser(db)
    await as(db, asUser(u), async () => { await report('mine') })
    await as(db, asUser(u), async () => {
      const r = await db.query(`update public.feedback_reports set status = 'RESOLVED', admin_response = 'fine' where reporter_id = $1`, [u])
      expect(r.affectedRows).toBe(0)
    })
    const row = await db.query<{ status: string }>('select status from public.feedback_reports where reporter_id = $1', [u])
    expect(row.rows[0]?.status).toBe('OPEN')
  })

  it('lets the admin resolve and reopen, with resolution stamped by the database', async () => {
    const u = await addUser(db)
    const id = await as(db, asUser(u), async () => (await report('please check')).rows[0]!.id)

    await as(db, asUser(admin), async () => {
      await db.query(`update public.feedback_reports set status = 'RESOLVED', admin_response = 'Corrected the key.' where id = $1`, [id])
    })
    let row = (await db.query<{ status: string; resolved_by: string | null; resolved_at: string | null; admin_response: string }>(
      'select status, resolved_by, resolved_at, admin_response from public.feedback_reports where id = $1', [id])).rows[0]!
    expect(row.status).toBe('RESOLVED')
    expect(row.resolved_by).toBe(admin)
    expect(row.resolved_at).not.toBeNull()

    await as(db, asUser(admin), async () => {
      await db.query(`update public.feedback_reports set status = 'OPEN' where id = $1`, [id])
    })
    row = (await db.query('select status, resolved_by, resolved_at, admin_response from public.feedback_reports where id = $1', [id])).rows[0] as typeof row
    expect(row.status).toBe('OPEN')
    expect(row.resolved_by).toBeNull()
    expect(row.resolved_at).toBeNull()
  })

  it('does not let even the admin forge who resolved a report', async () => {
    await as(db, asUser(admin), async () => {
      await expectPermissionDenied(db.query(`update public.feedback_reports set resolved_by = gen_random_uuid()`))
    })
  })

  it('rate-limits reports per user, using the configurable setting', async () => {
    const spammer = await addUser(db)
    const bystander = await addUser(db)
    await as(db, asUser(spammer), async () => {
      for (let i = 0; i < 10; i += 1) await report(`spam ${i}`)
      await expect(report('one too many')).rejects.toThrow(/RATE_LIMITED/)
    })
    await as(db, asUser(bystander), async () => { await report('unaffected') })

    await db.query(`update public.app_settings set value = '2'::jsonb where key = 'feedback.max_reports_per_user_per_hour'`)
    const tight = await addUser(db)
    await as(db, asUser(tight), async () => {
      await report('1')
      await report('2')
      await expect(report('3')).rejects.toThrow(/RATE_LIMITED/)
    })
  })
})
