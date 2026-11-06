import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createDb } from './harness'
import { administrator } from './phase2-helpers'

type ChallengeView = { challenge: { languages: string[] }; questions: { tamil_ready: boolean }[] }

describe('admin challenge languages', () => {
  let db: PGlite
  let admin: string
  let challengeId: string

  const save = (id: string | null, data: Record<string, unknown>) =>
    as(db, asUser(admin), async () =>
      (
        await db.query<{ r: string }>(`select public.admin_save_challenge($1, $2::jsonb) as r`, [
          id,
          JSON.stringify({ slug: 'lang-save-test', title: 'Language save test', ...data }),
        ])
      ).rows[0]!.r,
    )

  const get = () =>
    as(db, asUser(admin), async () =>
      (await db.query<{ r: ChallengeView }>(`select public.admin_get_challenge($1) as r`, [challengeId])).rows[0]!.r,
    )

  beforeAll(async () => {
    db = await createDb()
    admin = await administrator(db)
  })

  it('defaults a new challenge to English only', async () => {
    challengeId = await save(null, {})
    expect((await get()).challenge.languages).toEqual(['en'])
  })

  it('adds Tamil, and always keeps English', async () => {
    await save(challengeId, { languages: ['ta'] })
    expect((await get()).challenge.languages).toEqual(['en', 'ta'])
  })

  it('keeps the languages when a save does not mention them', async () => {
    await save(challengeId, {})
    expect((await get()).challenge.languages).toEqual(['en', 'ta'])
  })

  it('can go back to English only', async () => {
    await save(challengeId, { languages: ['en'] })
    expect((await get()).challenge.languages).toEqual(['en'])
  })

  it('refuses other languages with a clear message', async () => {
    await expect(save(challengeId, { languages: ['en', 'fr'] })).rejects.toThrow(/VALIDATION/)
  })
})