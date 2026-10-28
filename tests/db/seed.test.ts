import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDb } from './harness'

describe('seed.sql', () => {
  it('is idempotent and contains reference data only', async () => {
    const db = await createDb({ seed: true })
    const counts = async () =>
      (await db.query<{ c: number; t: number; u: number; ch: number; l: number }>(
        `select (select count(*) from public.categories)::int as c,
                (select count(*) from public.topics)::int as t,
                (select count(*) from auth.users)::int as u,
                (select count(*) from public.challenges)::int as ch,
                (select count(*) from public.challenge_attempts)::int as l`,
      )).rows[0]!
    const first = await counts()
    await db.exec(readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'seed.sql'), 'utf8'))
    const second = await counts()
    expect(second).toEqual(first)
    expect(first.c).toBeGreaterThan(0)
    expect(first.t).toBeGreaterThan(0)
    expect(first).toMatchObject({ u: 0, ch: 0, l: 0 })
  })
})
