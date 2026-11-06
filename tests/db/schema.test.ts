import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, migrationFiles } from './harness'
import { TABLES } from './helpers'

/** Every function a signed-in browser may call. Adding one is a deliberate, reviewed change. */
const BROWSER_FUNCTIONS = [
  // Phase 1
  'is_admin', 'admin_overview_stats',
  // Phase 2: administrator (challenge lifecycle, question bank, analytics, AI bookkeeping)
  'admin_list_challenges', 'admin_get_challenge', 'admin_save_challenge', 'admin_set_challenge_questions',
  'admin_publish_challenge', 'admin_transition_challenge', 'admin_challenge_participants', 'admin_challenge_analytics',
  'admin_list_questions', 'admin_get_question', 'admin_save_question', 'admin_approve_question', 'admin_delete_question',
  'admin_ai_status', 'admin_ai_begin', 'admin_ai_finish', 'admin_record_solver_check',
  // Phase 2: student
  'student_list_challenges', 'student_challenge_detail', 'student_register', 'student_start_attempt',
  'student_get_attempt', 'student_save_answer', 'student_submit_attempt', 'student_get_result',
  'student_my_attempts', 'student_leaderboard',
  // Phase 3: bilingual
  'admin_save_translation', 'admin_approve_translation',
]

describe('schema and API exposure', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb()
  })

  it('applies every migration from an empty database', () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(8)
  })

  it('creates exactly the expected public tables', async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
    )
    expect(r.rows.map((x) => x.relname)).toEqual([...TABLES].sort())
  })

  it('enables row level security on every public table', async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    )
    expect(r.rows).toEqual([])
  })

  it('grants the anon role no privilege on any public table or sequence', async () => {
    const tables = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'S')
         and has_any_column_privilege('anon', c.oid, 'select,insert,update,references')`,
    )
    expect(tables.rows).toEqual([])
    const seqs = await db.query<{ relname: string }>(
      `with s as materialized (
         select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'S'
       )
       select relname from s where has_sequence_privilege('anon', oid, 'usage,select,update')`,
    )
    expect(seqs.rows).toEqual([])
  })

  it('never grants authenticated TRUNCATE, TRIGGER or REFERENCES', async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
         and (has_table_privilege('authenticated', c.oid, 'truncate')
           or has_table_privilege('authenticated', c.oid, 'trigger')
           or has_table_privilege('authenticated', c.oid, 'references'))`,
    )
    expect(r.rows).toEqual([])
  })

  it('lets authenticated write only the tables that are meant to be client-writable', async () => {
    const writable = async (priv: 'insert' | 'update' | 'delete') => {
      const check =
        priv === 'delete'
          ? `has_table_privilege('authenticated', c.oid, 'delete')`
          : `has_any_column_privilege('authenticated', c.oid, '${priv}')`
      const r = await db.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and ${check} order by 1`,
      )
      return r.rows.map((x) => x.relname)
    }
    expect(await writable('insert')).toEqual(['categories', 'feedback_reports', 'topics'])
    expect(await writable('update')).toEqual(['categories', 'feedback_reports', 'profiles', 'topics'])
    expect(await writable('delete')).toEqual(['bookmarks'])
  })

  it('exposes only the reviewed browser functions to signed-in users, and nothing to anonymous users', async () => {
    const r = await db.query<{ proname: string; anon: boolean; authed: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    )
    expect(r.rows.length).toBeGreaterThan(5)
    expect(r.rows.filter((f) => f.anon)).toEqual([])
    expect(r.rows.filter((f) => f.authed).map((f) => f.proname).sort()).toEqual([...BROWSER_FUNCTIONS].sort())
  })

  it('keeps internal engine helpers (scoring, expiry, checks) away from browser roles', async () => {
    const internal = [
      'require_admin', 'audit_event', 'derive_challenge_state', 'review_status_from_checks',
      'question_checks', 'finalize_attempt', 'finalize_expired_attempts', 'student_result_summary',
      'challenge_student_view', 'check_attempt_question_options',
    ]
    const r = await db.query<{ proname: string; authed: boolean; anon: boolean }>(
      `select p.proname,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              has_function_privilege('anon', p.oid, 'execute') as anon
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1::text[])`,
      [internal],
    )
    expect(r.rows).toHaveLength(internal.length)
    for (const f of r.rows) expect(f, f.proname).toMatchObject({ authed: false, anon: false })
  })

  it('pins search_path on every SECURITY DEFINER function', async () => {
    const r = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not coalesce(p.proconfig::text, '') like '%search_path=%'`,
    )
    expect(r.rows).toEqual([])
  })

  it('keeps the service-only admin functions away from browser roles', async () => {
    const r = await db.query<{ proname: string; svc: boolean; anon: boolean; authed: boolean }>(
      `select p.proname,
              has_function_privilege('service_role', p.oid, 'execute') as svc,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('grant_admin_role', 'revoke_admin_role')`,
    )
    expect(r.rows).toHaveLength(2)
    for (const f of r.rows) {
      expect(f).toMatchObject({ svc: true, anon: false, authed: false })
    }
  })

  it('stores correct answers outside the student-visible question tables', async () => {
    const cols = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('question_versions', 'question_options')`,
    )
    const names = cols.rows.map((c) => c.column_name)
    expect(names).not.toContain('correct_option_id')
    expect(names).not.toContain('explanation')
    expect(names).not.toContain('is_correct')
  })
})
