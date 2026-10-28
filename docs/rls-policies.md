# Access model: grants and row level security

Source of truth: `supabase/migrations/20260101000008_api_surface_rls.sql`. Test coverage: `tests/db/*.test.ts` (82 tests against real PostgreSQL).

Roles: **anon** (not signed in) has **no grants at all**. **authenticated** covers students and the administrator; policies tell them apart with `is_admin()`, which reads `user_roles` on the server. **service_role** is server-side only and bypasses RLS.

## Table matrix (authenticated users)

| Table | Student | Administrator | Notes |
|---|---|---|---|
| `profiles` | read/update **own** `display_name` only | read all | other columns are not updatable; no insert/delete |
| `user_roles` | read own | read all | **no writes from the browser**; changed only via `grant_admin_role` / `revoke_admin_role` |
| `categories`, `topics` | read non-deleted | read all, insert, update | no DELETE grant (soft delete) |
| `challenges` | read **only** `PUBLISHED`, not deleted, inside start/end | read all | no writes yet (phase 2 adds functions) |
| `challenge_versions`, `challenge_version_questions` | none | read | |
| `questions`, `question_versions`, `question_options` | none | read | students receive questions later through a function |
| `question_answer_keys` | **none** | read | the protected answer key + explanation |
| `question_validation_results`, `ai_generation_jobs` | none | read | |
| `challenge_attempts`, `attempt_answers`, `attempt_scores` | read own | read all | **no writes from the browser**; server functions in phase 3 |
| `bookmarks` | read/delete own | (own) | adding will go through a function |
| `feedback_reports` | insert (limited columns), read own | read all, update `status` and `admin_response` | `reporter_id` defaults to caller; resolution stamped by trigger; rate-limited |
| `app_settings`, `audit_logs` | none | read | `audit_logs` is append-only |

## Function matrix

| Function | Who can execute | Purpose |
|---|---|---|
| `is_admin()` | authenticated | policy helper (`SECURITY DEFINER`, pinned `search_path`) |
| `admin_overview_stats()` | authenticated, but raises `42501` unless admin | dashboard counts |
| `grant_admin_role(email)`, `revoke_admin_role(email)` | **service_role / SQL editor only** | the only way to change admin membership |
| everything else | nobody | trigger functions and internals |

A test enumerates every function in `public` and fails if anyone but the two above is executable by `anon` or `authenticated`.

## Threats considered

| Threat | Defence | Test |
|---|---|---|
| User grants themselves ADMIN via insert/update | no write grant on `user_roles` | `identity.test.ts` |
| Role injected through sign-up metadata | trigger ignores metadata for roles | `identity.test.ts` |
| Pre-registering an admin's email to inherit the role | `grant_admin_role` requires a confirmed email | `identity.test.ts` |
| Reading answer keys with direct/joined queries | no student policy on key table; keys not in question tables | `content-rls.test.ts`, `schema.test.ts` |
| Seeing drafts, closed, scheduled or deleted challenges | policy predicate on status, schedule, `deleted_at` | `content-rls.test.ts` |
| Forging scores, deadlines or answers | no write grants; write-once and submitted-immutability triggers | `integrity.test.ts` |
| Editing history under past results | version locks/freezes enforced by triggers | `integrity.test.ts` |
| Forging report author or resolver | column-scoped grants; DB-stamped resolution | `feedback.test.ts` |
| Spamming reports | per-user hourly limit from `app_settings` | `feedback.test.ts` |
| Tampering with the audit trail | trigger blocks update/delete/truncate | `identity.test.ts` |
| New tables/functions silently exposed | default privileges revoked; schema tests fail on drift | `schema.test.ts` |
| Secret key shipped to browsers | startup validation + post-build scanner | `env.test.ts`, `verify-build.mjs` |

## Rules for future migrations

1. Enable RLS on every new table.
2. Grant explicitly, column-scoped where partly writable; never rely on defaults.
3. New functions: `SECURITY DEFINER` only with `set search_path = ''`; grant `execute` explicitly.
4. Update the expected lists in `tests/db/schema.test.ts` in the same change. A failing schema test means exposure changed and needs a reviewer.
