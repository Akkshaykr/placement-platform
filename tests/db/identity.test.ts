import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { addAdmin, addUser, as, asAnon, asService, asUser, createDb } from './harness'
import { expectPermissionDenied } from './helpers'

describe('identity, roles and admin bootstrap', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb()
  })

  const rolesOf = async (id: string) =>
    (await db.query<{ role: string }>('select role::text as role from public.user_roles where user_id = $1 order by 1', [id])).rows.map(
      (r) => r.role,
    )

  describe('signup trigger', () => {
    it('creates a profile and the USER role for every new account', async () => {
      const id = await addUser(db, { email: 'ada@example.test', metadata: { full_name: 'Ada Lovelace' } })
      const p = await db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [id])
      expect(p.rows[0]?.display_name).toBe('Ada Lovelace')
      expect(await rolesOf(id)).toEqual(['USER'])
    })

    it('falls back to the email name, then to a default', async () => {
      const a = await addUser(db, { email: 'grace.hopper@example.test' })
      const b = await db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [a])
      expect(b.rows[0]?.display_name).toBe('grace.hopper')

      const id = await addUser(db, { email: '@example.test' })
      const c = await db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [id])
      expect(c.rows[0]?.display_name).toBe('Student')
    })

    it('truncates long names and strips control characters', async () => {
      const id = await addUser(db, { metadata: { full_name: `Line1\nLine2\t${'x'.repeat(100)}` } })
      const r = await db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [id])
      const name = r.rows[0]!.display_name
      expect(name.length).toBeLessThanOrEqual(60)
      expect(name).not.toMatch(/[\r\n\t]/)
    })

    it('can never be made an administrator through user-controlled metadata', async () => {
      const id = await addUser(db, {
        metadata: { role: 'ADMIN', roles: ['ADMIN'], is_admin: true, app_role: 'ADMIN' },
      })
      await db.query(`update auth.users set raw_app_meta_data = '{"role":"ADMIN"}' where id = $1`, [id])
      expect(await rolesOf(id)).toEqual(['USER'])
      expect(await as(db, asUser(id), async () => (await db.query<{ ok: boolean }>('select public.is_admin() as ok')).rows[0]?.ok)).toBe(false)
    })

    it('accepts Google-hosted avatars only', async () => {
      const ok = await addUser(db, { metadata: { avatar_url: 'https://lh3.googleusercontent.com/a/abc123' } })
      const bad = await addUser(db, { metadata: { avatar_url: 'https://evil.example.test/track.png' } })
      const http = await addUser(db, { metadata: { avatar_url: 'http://lh3.googleusercontent.com/a/abc' } })
      const get = async (id: string) =>
        (await db.query<{ avatar_url: string | null }>('select avatar_url from public.profiles where id = $1', [id])).rows[0]?.avatar_url
      expect(await get(ok)).toBe('https://lh3.googleusercontent.com/a/abc123')
      expect(await get(bad)).toBeNull()
      expect(await get(http)).toBeNull()
    })
  })

  describe('privilege escalation attempts by a signed-in user', () => {
    it('cannot insert, update or delete role assignments', async () => {
      const id = await addUser(db)
      await as(db, asUser(id), async () => {
        await expectPermissionDenied(db.query(`insert into public.user_roles (user_id, role) values ($1, 'ADMIN')`, [id]))
        await expectPermissionDenied(db.query(`update public.user_roles set role = 'ADMIN' where user_id = $1`, [id]))
        await expectPermissionDenied(db.query('delete from public.user_roles where user_id = $1', [id]))
      })
      expect(await rolesOf(id)).toEqual(['USER'])
    })

    it('cannot call the trusted admin functions', async () => {
      const id = await addUser(db, { email: 'mallory@example.test' })
      await as(db, asUser(id), async () => {
        await expectPermissionDenied(db.query(`select public.grant_admin_role('mallory@example.test')`))
        await expectPermissionDenied(db.query(`select public.revoke_admin_role('mallory@example.test')`))
      })
      await as(db, asAnon, async () => {
        await expectPermissionDenied(db.query(`select public.grant_admin_role('mallory@example.test')`))
      })
      expect(await rolesOf(id)).toEqual(['USER'])
    })

    it('cannot write the audit log', async () => {
      const id = await addUser(db)
      await as(db, asUser(id), async () => {
        await expectPermissionDenied(
          db.query(`insert into public.audit_logs (actor_kind, action, entity_type) values ('ADMIN', 'x', 'y')`),
        )
      })
    })
  })

  describe('grant_admin_role / revoke_admin_role (trusted operations)', () => {
    it('grants ADMIN to a confirmed account and records it in the audit log', async () => {
      const id = await addUser(db, { email: 'owner@example.test' })
      await as(db, asService, async () => {
        await db.query(`select public.grant_admin_role('OWNER@example.test')`)
      })
      expect(await rolesOf(id)).toEqual(['ADMIN', 'USER'])
      const log = await db.query<{ action: string; actor_kind: string }>(
        `select action, actor_kind from public.audit_logs where entity_id = $1 and action = 'role.grant'`,
        [id],
      )
      expect(log.rows).toEqual([{ action: 'role.grant', actor_kind: 'SYSTEM' }])
      expect(await as(db, asUser(id), async () => (await db.query<{ ok: boolean }>('select public.is_admin() as ok')).rows[0]?.ok)).toBe(true)
    })

    it('is idempotent and does not duplicate audit entries', async () => {
      await addUser(db, { email: 'idem@example.test' })
      await db.query(`select public.grant_admin_role('idem@example.test')`)
      await db.query(`select public.grant_admin_role('idem@example.test')`)
      const r = await db.query<{ n: number }>(
        `select count(*)::int as n from public.audit_logs l join auth.users u on u.id::text = l.entity_id
         where u.email = 'idem@example.test' and l.action = 'role.grant'`,
      )
      expect(r.rows[0]?.n).toBe(1)
    })

    it('refuses unknown emails', async () => {
      await expect(db.query(`select public.grant_admin_role('nobody@example.test')`)).rejects.toThrow(/No account exists/)
    })

    it('refuses an email that has not been confirmed (blocks pre-registration hijacking)', async () => {
      const id = await addUser(db, { email: 'unconfirmed@example.test', confirmed: false })
      await expect(db.query(`select public.grant_admin_role('unconfirmed@example.test')`)).rejects.toThrow(/not confirmed/)
      expect(await rolesOf(id)).toEqual(['USER'])
    })

    it('refuses to remove the last administrator, but removes one of several', async () => {
      const fresh = await createDb()
      const a = await addUser(fresh, { email: 'a@example.test' })
      const b = await addUser(fresh, { email: 'b@example.test' })
      await fresh.query(`select public.grant_admin_role('a@example.test')`)
      await expect(fresh.query(`select public.revoke_admin_role('a@example.test')`)).rejects.toThrow(/last administrator/)
      await fresh.query(`select public.grant_admin_role('b@example.test')`)
      await fresh.query(`select public.revoke_admin_role('a@example.test')`)
      const roles = async (id: string) =>
        (await fresh.query<{ role: string }>('select role::text as role from public.user_roles where user_id = $1 order by 1', [id])).rows.map((r) => r.role)
      expect(await roles(a)).toEqual(['USER'])
      expect(await roles(b)).toEqual(['ADMIN', 'USER'])
    })
  })

  describe('reading roles', () => {
    it('shows a user only their own roles and an admin everyone’s', async () => {
      const admin = await addAdmin(db)
      const u1 = await addUser(db)
      const u2 = await addUser(db)

      const seenByU1 = await as(db, asUser(u1), async () =>
        (await db.query<{ user_id: string }>('select user_id from public.user_roles')).rows.map((r) => r.user_id),
      )
      expect(new Set(seenByU1)).toEqual(new Set([u1]))

      const seenByAdmin = await as(db, asUser(admin), async () =>
        (await db.query<{ user_id: string }>('select distinct user_id from public.user_roles')).rows.map((r) => r.user_id),
      )
      expect(seenByAdmin).toEqual(expect.arrayContaining([admin, u1, u2]))
    })

    it('denies anonymous callers entirely', async () => {
      await as(db, asAnon, async () => {
        await expectPermissionDenied(db.query('select * from public.user_roles'))
        await expectPermissionDenied(db.query('select public.is_admin()'))
      })
    })
  })

  describe('account deletion and audit retention', () => {
    it('removes profile and roles with the account but keeps the audit trail', async () => {
      const id = await addUser(db, { email: 'leaver@example.test' })
      await db.query(`select public.grant_admin_role('leaver@example.test')`)
      await db.query(`select public.grant_admin_role('owner@example.test')`)
      await db.query('delete from auth.users where id = $1', [id])
      expect((await db.query('select 1 from public.profiles where id = $1', [id])).rows).toHaveLength(0)
      expect(await rolesOf(id)).toEqual([])
      const log = await db.query(`select 1 from public.audit_logs where entity_id = $1`, [id])
      expect(log.rows.length).toBeGreaterThan(0)
    })

    it('makes the audit log append-only, even for the table owner', async () => {
      await expect(db.query(`update public.audit_logs set action = 'tampered'`)).rejects.toThrow(/append-only/)
      await expect(db.query('delete from public.audit_logs')).rejects.toThrow(/append-only/)
      await expect(db.query('truncate public.audit_logs')).rejects.toThrow(/append-only/)
    })
  })
})
