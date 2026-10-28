import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { addAdmin, addPublishedChallenge, addUser, as, asAnon, asUser, createDb } from './harness'
import { expectPermissionDenied } from './helpers'

interface Stats {
  registered_users: number
  published_challenges: number
  challenges_in_preparation: number
  completed_attempts: number
  unique_participants: number
  open_reports: number
}

describe('admin_overview_stats', () => {
  let db: PGlite
  let admin: string
  let student: string

  const stats = (actor: string) =>
    as(db, asUser(actor), async () => (await db.query<{ s: Stats }>('select public.admin_overview_stats() as s')).rows[0]!.s)

  beforeAll(async () => {
    db = await createDb()
    admin = await addAdmin(db)
    student = await addUser(db)
  })

  it('refuses students and anonymous callers', async () => {
    await as(db, asUser(student), async () => {
      await expect(db.query('select public.admin_overview_stats()')).rejects.toThrow(/Administrator access required/)
    })
    await as(db, asAnon, async () => {
      await expectPermissionDenied(db.query('select public.admin_overview_stats()'))
    })
  })

  it('reports real zeros on an empty platform', async () => {
    expect(await stats(admin)).toEqual({
      registered_users: 2,
      published_challenges: 0,
      challenges_in_preparation: 0,
      completed_attempts: 0,
      unique_participants: 0,
      open_reports: 0,
    })
  })

  it('counts from actual records and keeps attempts and unique participants separate', async () => {
    const live = await addPublishedChallenge(db)
    await addPublishedChallenge(db, { status: 'DRAFT' })
    await addPublishedChallenge(db, { status: 'REVIEW_REQUIRED' })
    await addPublishedChallenge(db, { status: 'CLOSED' })
    await addPublishedChallenge(db, { deletedAt: new Date().toISOString() })

    const other = await addUser(db)
    const submit = async (user: string, n: number) => {
      await db.query(
        `insert into public.challenge_attempts (challenge_id, challenge_version_id, user_id, attempt_number, deadline_at, status, submitted_at, submitted_via)
         values ($1, $2, $3, $4, now() + interval '1 hour', 'SUBMITTED', now(), 'USER')`,
        [live.challengeId, live.versionId, user, n],
      )
    }
    await submit(student, 1)
    await submit(student, 2)
    await submit(other, 1)
    // A running attempt must not count as completed.
    const third = await addUser(db)
    await db.query(
      `insert into public.challenge_attempts (challenge_id, challenge_version_id, user_id, attempt_number, deadline_at)
       values ($1, $2, $3, 1, now() + interval '1 hour')`,
      [live.challengeId, live.versionId, third],
    )
    await as(db, asUser(student), async () => {
      await db.query(
        `insert into public.feedback_reports (kind, question_version_id, message) values ('QUESTION_ERROR', $1, 'x')`,
        [live.questionVersionId],
      )
    })

    const s = await stats(admin)
    expect(s.registered_users).toBe(4)
    expect(s.published_challenges).toBe(1) // only `live`; the soft-deleted PUBLISHED one is excluded
    expect(s.challenges_in_preparation).toBe(2) // DRAFT + REVIEW_REQUIRED; CLOSED and deleted excluded
    expect(s.completed_attempts).toBe(3)
    expect(s.unique_participants).toBe(2)
    expect(s.open_reports).toBe(1)
  })
})
