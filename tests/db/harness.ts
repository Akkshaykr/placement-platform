import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const ROOT = resolve(import.meta.dirname, '..', '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export function readMigration(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
}

export interface CreateDbOptions {
  /** Apply supabase/seed.sql after the migrations. */
  seed?: boolean
}

/** Fresh in-memory PostgreSQL with the Supabase shim, every migration, and optionally the seed. */
export async function createDb(options: CreateDbOptions = {}): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(join(import.meta.dirname, 'supabase-shim.sql'), 'utf8'))
  for (const file of migrationFiles()) {
    try {
      await db.exec(readMigration(file))
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
    }
  }
  if (options.seed) {
    await db.exec(readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8'))
  }
  return db
}

export interface NewUser {
  email?: string
  confirmed?: boolean
  metadata?: Record<string, unknown>
}

/** Inserts into auth.users as the table owner (what Supabase Auth does) and returns the id. */
export async function addUser(db: PGlite, user: NewUser = {}): Promise<string> {
  const id = randomUUID()
  const email = user.email ?? `user-${id.slice(0, 8)}@example.test`
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, $3, $4::jsonb)`,
    [id, email, user.confirmed === false ? null : new Date().toISOString(), JSON.stringify(user.metadata ?? {})],
  )
  return id
}

export type Actor = { kind: 'anon' } | { kind: 'user'; id: string } | { kind: 'service' }

export const asAnon: Actor = { kind: 'anon' }
export const asService: Actor = { kind: 'service' }
export const asUser = (id: string): Actor => ({ kind: 'user', id })

/**
 * Runs `fn` with the session switched to the database role (and JWT claims) a request from
 * `actor` would have in Supabase, then always switches back. RLS and grants apply for real.
 */
export async function as<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  const role = actor.kind === 'anon' ? 'anon' : actor.kind === 'service' ? 'service_role' : 'authenticated'
  const claims =
    actor.kind === 'user'
      ? JSON.stringify({ sub: actor.id, role: 'authenticated' })
      : JSON.stringify({ role })
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}

export interface SeededContent {
  topicId: string
  challengeId: string
  versionId: string
  questionId: string
  questionVersionId: string
  optionIds: string[]
  correctOptionId: string
}

/**
 * Creates a complete published challenge (1 question, 4 options, answer key) as the table owner.
 * Used by RLS and integrity tests. `overrides` tweak the challenge row.
 */
export async function addPublishedChallenge(
  db: PGlite,
  overrides: { slug?: string; status?: string; startAt?: string | null; endAt?: string | null; deletedAt?: string | null } = {},
): Promise<SeededContent> {
  const topic = await db.query<{ id: string }>(
    `insert into public.categories (slug, name) values ($1, 'Test category') returning id`,
    [`cat-${randomUUID().slice(0, 8)}`],
  )
  const topicRow = await db.query<{ id: string }>(
    `insert into public.topics (category_id, slug, name) values ($1, $2, 'Test topic') returning id`,
    [topic.rows[0]!.id, `topic-${randomUUID().slice(0, 8)}`],
  )
  const topicId = topicRow.rows[0]!.id
  const slug = overrides.slug ?? `challenge-${randomUUID().slice(0, 8)}`

  const challenge = await db.query<{ id: string }>(
    `insert into public.challenges (slug, title, topic_id) values ($1, 'Sample challenge', $2) returning id`,
    [slug, topicId],
  )
  const challengeId = challenge.rows[0]!.id

  const version = await db.query<{ id: string }>(
    `insert into public.challenge_versions (challenge_id, version_number, time_limit_minutes, points_per_correct)
     values ($1, 1, 30, 1) returning id`,
    [challengeId],
  )
  const versionId = version.rows[0]!.id

  const question = await db.query<{ id: string }>(`insert into public.questions default values returning id`)
  const questionId = question.rows[0]!.id
  const qv = await db.query<{ id: string }>(
    `insert into public.question_versions (question_id, version_number, stem, topic_id)
     values ($1, 1, 'What is 2 + 2?', $2) returning id`,
    [questionId, topicId],
  )
  const questionVersionId = qv.rows[0]!.id

  const optionIds: string[] = []
  for (const [i, body] of ['3', '4', '5', '6'].entries()) {
    const o = await db.query<{ id: string }>(
      `insert into public.question_options (question_version_id, position, body) values ($1, $2, $3) returning id`,
      [questionVersionId, i + 1, body],
    )
    optionIds.push(o.rows[0]!.id)
  }
  const correctOptionId = optionIds[1]!
  await db.query(
    `insert into public.question_answer_keys (question_version_id, correct_option_id, explanation)
     values ($1, $2, 'Two plus two equals four.')`,
    [questionVersionId, correctOptionId],
  )
  await db.query(
    `insert into public.challenge_version_questions (challenge_version_id, question_version_id, position)
     values ($1, $2, 1)`,
    [versionId, questionVersionId],
  )

  await db.query(
    `update public.challenges
        set live_version_id = $2, status = $3, start_at = $4, end_at = $5, deleted_at = $6
      where id = $1`,
    [
      challengeId,
      versionId,
      overrides.status ?? 'PUBLISHED',
      overrides.startAt ?? null,
      overrides.endAt ?? null,
      overrides.deletedAt ?? null,
    ],
  )

  return { topicId, challengeId, versionId, questionId, questionVersionId, optionIds, correctOptionId }
}

export async function addAdmin(db: PGlite): Promise<string> {
  const id = await addUser(db, { email: `admin-${randomUUID().slice(0, 8)}@example.test` })
  const email = (await db.query<{ email: string }>('select email from auth.users where id = $1', [id])).rows[0]!.email
  await db.query('select public.grant_admin_role($1)', [email])
  return id
}
