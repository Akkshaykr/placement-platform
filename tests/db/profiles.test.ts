import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { addAdmin, addUser, as, asAnon, asUser, createDb } from './harness'
import { expectPermissionDenied } from './helpers'

describe('profiles', () => {
  let db: PGlite
  let alice: string
  let bob: string
  beforeAll(async () => {
    db = await createDb()
    alice = await addUser(db, { metadata: { full_name: 'Alice' } })
    bob = await addUser(db, { metadata: { full_name: 'Bob' } })
  })

  it('lets a user read only their own profile', async () => {
    const rows = await as(db, asUser(alice), async () => (await db.query<{ id: string }>('select id from public.profiles')).rows)
    expect(rows.map((r) => r.id)).toEqual([alice])
  })

  it('lets an admin read every profile', async () => {
    const admin = await addAdmin(db)
    const rows = await as(db, asUser(admin), async () => (await db.query<{ id: string }>('select id from public.profiles')).rows)
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([alice, bob, admin]))
  })

  it('denies anonymous reads', async () => {
    await as(db, asAnon, async () => {
      await expectPermissionDenied(db.query('select * from public.profiles'))
    })
  })

  it('lets a user change their own display name', async () => {
    await as(db, asUser(alice), async () => {
      await db.query(`update public.profiles set display_name = 'Alice L.' where id = $1`, [alice])
    })
    const r = await db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [alice])
    expect(r.rows[0]?.display_name).toBe('Alice L.')
  })

  it('silently affects no rows when updating someone else’s profile', async () => {
    await as(db, asUser(alice), async () => {
      const r = await db.query(`update public.profiles set display_name = 'Hacked' where id = $1`, [bob])
      expect(r.affectedRows).toBe(0)
    })
    const r = await db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [bob])
    expect(r.rows[0]?.display_name).toBe('Bob')
  })

  it('refuses to update any column other than display_name', async () => {
    await as(db, asUser(alice), async () => {
      await expectPermissionDenied(db.query(`update public.profiles set id = gen_random_uuid() where id = $1`, [alice]))
      await expectPermissionDenied(db.query(`update public.profiles set created_at = now() where id = $1`, [alice]))
      await expectPermissionDenied(
        db.query(`update public.profiles set avatar_url = 'https://x.googleusercontent.com/a' where id = $1`, [alice]),
      )
    })
  })

  it('refuses to create or delete profiles from the client', async () => {
    await as(db, asUser(alice), async () => {
      await expectPermissionDenied(db.query(`insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x')`))
      await expectPermissionDenied(db.query('delete from public.profiles where id = $1', [alice]))
    })
  })

  it('rejects blank, overlong and multi-line display names', async () => {
    await as(db, asUser(alice), async () => {
      await expect(db.query(`update public.profiles set display_name = '   ' where id = $1`, [alice])).rejects.toThrow(/check constraint/i)
      await expect(
        db.query(`update public.profiles set display_name = $2 where id = $1`, [alice, 'x'.repeat(61)]),
      ).rejects.toThrow(/check constraint/i)
      await expect(
        db.query(`update public.profiles set display_name = E'a\\nb' where id = $1`, [alice]),
      ).rejects.toThrow(/check constraint/i)
    })
  })
})
