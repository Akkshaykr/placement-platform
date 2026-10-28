import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { addAdmin, addPublishedChallenge, addUser, as, asAnon, asUser, createDb } from './harness'
import { TABLES, expectPermissionDenied, expectRlsViolation } from './helpers'

const HOUR = 3_600_000
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

describe('content visibility and answer-key protection', () => {
  let db: PGlite
  let student: string
  let admin: string
  let live: Awaited<ReturnType<typeof addPublishedChallenge>>

  beforeAll(async () => {
    db = await createDb()
    student = await addUser(db)
    admin = await addAdmin(db)
    live = await addPublishedChallenge(db, { slug: 'visible-open' })
    await addPublishedChallenge(db, { slug: 'hidden-draft', status: 'DRAFT' })
    await addPublishedChallenge(db, { slug: 'hidden-review', status: 'REVIEW_REQUIRED' })
    await addPublishedChallenge(db, { slug: 'hidden-closed', status: 'CLOSED' })
    await addPublishedChallenge(db, { slug: 'hidden-archived', status: 'ARCHIVED' })
    await addPublishedChallenge(db, { slug: 'hidden-future', startAt: iso(HOUR), endAt: iso(2 * HOUR) })
    await addPublishedChallenge(db, { slug: 'hidden-ended', startAt: iso(-2 * HOUR), endAt: iso(-HOUR) })
    await addPublishedChallenge(db, { slug: 'hidden-deleted', deletedAt: iso(-HOUR) })
    await addPublishedChallenge(db, { slug: 'visible-in-window', startAt: iso(-HOUR), endAt: iso(HOUR) })
    await addPublishedChallenge(db, { slug: 'visible-no-end', startAt: iso(-HOUR), endAt: null })
  })

  it('denies anonymous users every table', async () => {
    await as(db, asAnon, async () => {
      for (const table of TABLES) {
        await expectPermissionDenied(db.query(`select * from public.${table} limit 1`))
      }
    })
  })

  it('shows students only published, undeleted challenges inside their schedule', async () => {
    const slugs = await as(db, asUser(student), async () =>
      (await db.query<{ slug: string }>('select slug from public.challenges order by slug')).rows.map((r) => r.slug),
    )
    expect(slugs).toEqual(['visible-in-window', 'visible-no-end', 'visible-open'])
  })

  it('shows the admin every challenge, including drafts, closed and deleted ones', async () => {
    const slugs = await as(db, asUser(admin), async () =>
      (await db.query<{ slug: string }>('select slug from public.challenges')).rows.map((r) => r.slug),
    )
    expect(slugs).toEqual(
      expect.arrayContaining(['hidden-draft', 'hidden-review', 'hidden-closed', 'hidden-archived', 'hidden-future', 'hidden-ended', 'hidden-deleted']),
    )
    expect(slugs).toHaveLength(10)
  })

  it('reacts to schedule changes immediately (no caching in the database layer)', async () => {
    const c = await addPublishedChallenge(db, { slug: 'schedule-flip' })
    const visible = () =>
      as(db, asUser(student), async () =>
        (await db.query('select 1 from public.challenges where slug = $1', ['schedule-flip'])).rows.length,
      )
    expect(await visible()).toBe(1)
    await db.query(`update public.challenges set end_at = now() - interval '1 second', start_at = now() - interval '1 hour' where id = $1`, [c.challengeId])
    expect(await visible()).toBe(0)
  })

  it('never lets a student read question content, versions, options or answer keys', async () => {
    await as(db, asUser(student), async () => {
      for (const table of [
        'questions', 'question_versions', 'question_options', 'question_answer_keys',
        'challenge_versions', 'challenge_version_questions', 'question_validation_results',
      ]) {
        const r = await db.query(`select * from public.${table}`)
        expect(r.rows, `student must see no rows in ${table}`).toHaveLength(0)
      }
    })
  })

  it('does not leak the key through joins, filters or direct lookups by id', async () => {
    await as(db, asUser(student), async () => {
      const byId = await db.query('select * from public.question_answer_keys where question_version_id = $1', [live.questionVersionId])
      expect(byId.rows).toHaveLength(0)
      const join = await db.query(
        `select k.correct_option_id from public.question_options o
           join public.question_answer_keys k on k.question_version_id = o.question_version_id
          where o.id = $1`,
        [live.correctOptionId],
      )
      expect(join.rows).toHaveLength(0)
      const probe = await db.query('select count(*)::int as n from public.question_answer_keys')
      expect((probe.rows[0] as { n: number }).n).toBe(0)
    })
  })

  it('lets the admin read answer keys and explanations', async () => {
    const rows = await as(db, asUser(admin), async () =>
      (await db.query<{ correct_option_id: string; explanation: string }>(
        'select correct_option_id, explanation from public.question_answer_keys where question_version_id = $1',
        [live.questionVersionId],
      )).rows,
    )
    expect(rows).toEqual([{ correct_option_id: live.correctOptionId, explanation: 'Two plus two equals four.' }])
  })

  it('refuses every client write to challenge and question content', async () => {
    await as(db, asUser(student), async () => {
      await expectPermissionDenied(db.query(`insert into public.challenges (slug, title) values ('sneaky', 'Sneaky')`))
      await expectPermissionDenied(db.query(`update public.challenges set title = 'x'`))
      await expectPermissionDenied(db.query('delete from public.challenges'))
      await expectPermissionDenied(db.query(`insert into public.question_answer_keys (question_version_id, correct_option_id) values (gen_random_uuid(), gen_random_uuid())`))
      await expectPermissionDenied(db.query(`update public.question_answer_keys set explanation = 'x'`))
    })
    await as(db, asUser(admin), async () => {
      // Admin content writes arrive via server-side functions in phase 2; nothing is granted yet.
      await expectPermissionDenied(db.query(`insert into public.challenges (slug, title) values ('direct-admin', 'Direct')`))
      await expectPermissionDenied(db.query(`update public.question_answer_keys set explanation = 'x'`))
    })
  })

  describe('categories and topics', () => {
    it('hides soft-deleted rows from students but not from the admin', async () => {
      await db.query(`insert into public.categories (slug, name, deleted_at) values ('retired', 'Retired', now())`)
      const studentSees = await as(db, asUser(student), async () =>
        (await db.query<{ slug: string }>(`select slug from public.categories where slug = 'retired'`)).rows,
      )
      const adminSees = await as(db, asUser(admin), async () =>
        (await db.query<{ slug: string }>(`select slug from public.categories where slug = 'retired'`)).rows,
      )
      expect(studentSees).toHaveLength(0)
      expect(adminSees).toHaveLength(1)
    })

    it('lets only the admin create and edit them, and nobody hard-delete them', async () => {
      await as(db, asUser(student), async () => {
        await expectRlsViolation(db.query(`insert into public.categories (slug, name) values ('student-made', 'Nope')`))
        const r = await db.query(`update public.categories set name = 'Renamed'`)
        expect(r.affectedRows).toBe(0)
      })
      await as(db, asUser(admin), async () => {
        await db.query(`insert into public.categories (slug, name) values ('admin-made', 'Admin made')`)
        await db.query(`update public.categories set name = 'Admin renamed' where slug = 'admin-made'`)
        await expectPermissionDenied(db.query(`delete from public.categories where slug = 'admin-made'`))
      })
    })

    it('validates slugs', async () => {
      await expect(db.query(`insert into public.categories (slug, name) values ('Bad Slug!', 'x')`)).rejects.toThrow(/check constraint/i)
    })
  })

  describe('operational tables', () => {
    it('keeps settings, audit log and AI job history away from students', async () => {
      await as(db, asUser(student), async () => {
        for (const table of ['app_settings', 'audit_logs', 'ai_generation_jobs']) {
          expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0)
        }
      })
      const settings = await as(db, asUser(admin), async () => (await db.query<{ key: string }>('select key from public.app_settings')).rows)
      expect(settings.map((s) => s.key)).toContain('ai.enabled')
    })

    it('ships with AI generation disabled by default', async () => {
      const r = await db.query<{ value: boolean }>(`select value from public.app_settings where key = 'ai.enabled'`)
      expect(r.rows[0]?.value).toBe(false)
    })
  })
})
