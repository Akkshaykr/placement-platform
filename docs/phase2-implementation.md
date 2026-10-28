# Phase 2: aptitude challenge platform

Phase 2 turns the Phase 1 foundation into a working aptitude platform: administrators build and publish timed
challenges, generate or write questions, approve them, and watch results. Students join, sit timed attempts,
see server-scored results, and follow a live leaderboard. Coding challenges are out of scope.

## What is included

| Area | Where |
| --- | --- |
| Challenge lifecycle (draft, publish, complete, cancel, archive, delete) | `admin_*` functions, migration `20260201000003` |
| Question bank with versions, approval and checks | `admin_save_question`, `admin_approve_question`, `question_checks` |
| AI drafting (server-side) | `supabase/functions/generate-questions` and `supabase/functions/_shared/questionSchema.ts` |
| Student discovery, registration, attempts, autosave, submit | `student_*` functions; `src/features/challenges/*`, `src/features/assessment/*` |
| Server-authoritative scoring, expiry, release policy | `finalize_attempt`, `finalize_expired_attempts`, `student_get_result` |
| Live leaderboard (polling) | `student_leaderboard`; `LeaderboardPage.tsx` |
| Analytics | `admin_challenge_analytics`, `admin_challenge_participants`; `AdminChallengeInsightsPage.tsx` |

## Routes

Students (inside the student layout): `/challenges`, `/challenges/:slug`, `/attempt/:attemptId`,
`/results/:attemptId`, `/leaderboard/:challengeId`, `/history`.

Administrators (inside the admin layout, guarded as before): `/admin/challenges`, `/admin/challenges/new`,
`/admin/challenges/:id`, `/admin/challenges/:id/insights`, `/admin/questions`, `/admin/questions/new`,
`/admin/questions/:id`, `/admin/ai-generator`.

## Merge into the Phase 1 project

1. **Back up** the Phase 1 project (copy the folder or commit it).
2. **Extract** the Phase 2 ZIP into the project root. Files keep their relative paths. Where a file already exists
   (the list is in `PHASE2-MANIFEST.md`), the ZIP version is the complete updated file: replace the Phase 1 file with it.
   Do not restore your Phase 1 copies of the listed modified files afterwards.
3. **Dependencies:** no new runtime packages are added. Run `npm ci` to be sure the lockfile matches.
4. **Migrations.** Apply the three new files in order. They are new files, so applied Phase 1 migrations are not changed:
   - `20260201000001_phase2_enums.sql`
   - `20260201000002_phase2_challenge_engine.sql`
   - `20260201000003_phase2_functions_and_rls.sql`

   Locally: `npx supabase db reset`. Against your Supabase project: `npx supabase db push`, or run each file in the
   SQL editor in order. The first file must be applied on its own before the second, because PostgreSQL requires
   a new enum value to be committed before use. `db push` already does this.
5. **Deploy the Edge Function** (server-side AI). Set the secrets first; the key never goes in a `VITE_` variable:
   ```bash
   npx supabase secrets set GEMINI_API_KEY=<your key>
   npx supabase secrets set APP_ORIGIN=https://<your-production-site>
   npx supabase secrets set GEMINI_MODEL=<model name you have access to>   # optional, defaults to gemini-2.5-flash
   npx supabase functions deploy generate-questions
   ```
   Keep the function's JWT check on (the default). The function still checks administrator status in the database.
6. **Turn AI on** when you are ready. It is off by default (Phase 1 seeded `ai.enabled = false`). In the SQL editor:
   ```sql
   update public.app_settings set value = 'true'::jsonb where key = 'ai.enabled';
   ```
   Daily quota and batch size are `ai.max_generations_per_admin_per_day` (20) and `ai.max_questions_per_request` (10).
7. **Optional: scheduled expiry sweep.** Attempts are also finalised lazily on every student call. To submit
   attempts even when nobody calls the API, enable `pg_cron` in your Supabase project and run:
   ```sql
   select cron.schedule('finalize-expired-attempts', '* * * * *', $$select public.finalize_expired_attempts()$$);
   ```
8. **Run the checks**, in this order:
   ```bash
   npm run typecheck && npm run lint
   npx vitest run --project unit      # unit and component tests
   npx vitest run --project db        # database tests, PGlite, real migrations and RLS
   npm run build && npm run verify-build && npm run check:csp
   ```
   The Playwright end-to-end suite needs a running Supabase stack and browsers (`npm run test:e2e`). It was not run
   for this release (see limitations).
9. **Start locally:** `npm run dev`, then sign in as an administrator and a student.
10. **Verify the workflows** (below).

## Verifying the workflows by hand

As an administrator: create a draft challenge; write or generate two questions; approve them (approval needs the
confirmation tick); add both to the challenge and save the list; preview; publish; open the insights page.

As a student: open the challenge from `/challenges`; join and start; answer, mark for review, and resume after a
refresh; submit; open the result and the leaderboard.

## Behaviour that must not change

- Answer keys reach students only through `student_get_result`, and only when the release policy allows it.
- Published questions and challenges are frozen. Edits create new question versions, and the published challenge
  keeps the old one.
- Scores come from the server only. A repeated submit returns the same result.
- Scheduling is decided by the server clock. The countdown on screen is a display of the server deadline, corrected
  for device clock skew.

## Known limitations

- **Live leaderboard uses polling** (every 10 seconds while a challenge runs), not Supabase Realtime. It is simpler
  and compatible with the current architecture, but it is less immediate.
- **Automatic submission depends on a sweep.** Expired attempts are finalised on the next call from any student, or by the
  optional `pg_cron` schedule above. Without the schedule, an attempt whose browser closed is scored when anyone next
  uses the platform. The score is always the server's, at the deadline.
- **Concurrency guarantees are designed, not stress-tested.** Starts and registrations take a row lock on the
  challenge, so participant limits hold under concurrent requests. The test suite runs on PGlite, which is a single
  connection, so it does not prove this under real parallel load. Test it against your Supabase project before a large event.
- **Question types:** only single-answer multiple choice is supported. Multi-answer questions are not implemented.
- **Regenerating one question** creates a new draft from the same request; it does not replace the old draft in place.
  Delete the old draft in the bank if it is unused.
- **Editing schedules after publication** is not supported. Cancel and recreate, or complete early.
- **Preview** shows the latest version of each question. For drafts this is the version in the assessment; for published
  challenges the page shows the pinned version.
- **AI correctness is not proven.** A generated answer can be wrong. The second model pass can only add a warning.
  An administrator must confirm each answer before approval, and approval is never automatic.
- **Model name and quotas.** The default model name must be one your Gemini account can use. Free-tier quotas are
  limited and can change; the function returns a clear "busy or quota used up" message when the provider refuses.
- **Not verified in this release:** a live Supabase project, the Playwright end-to-end suite, a real Gemini call,
  and the Edge Function running against a real database. The function was type-checked with Deno and smoke-tested
  over HTTP for its error paths only.
- Phase 1 documents (`docs/api.md`, `docs/rls-policies.md`, the README) were not revised. Analytics definitions are
  in `docs/analytics-definitions.md`.

## Security summary

Browser roles can call only the reviewed functions listed in `tests/db/schema.test.ts`. Internal helpers (scoring,
expiry, checks) are not callable by any browser role. Students cannot read `is_correct` or `points_awarded`
directly. Every administrator action writes an audit row. The AI key exists only in the function's secrets.
