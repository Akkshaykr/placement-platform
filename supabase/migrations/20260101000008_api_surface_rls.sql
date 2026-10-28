-- Phase 1 / migration 8: the complete browser-facing API surface (grants + row level security).
--
-- Read this file to know exactly what the browser can do. Everything not granted here is denied.
--
-- Roles used by Supabase's Data API:
--   anon          not signed in. Granted NOTHING in this schema (the app requires sign-in).
--   authenticated signed in. Students and the admin both use this role; policies tell them apart
--                 with is_admin(), which reads user_roles on the server.
--   service_role  server-side only (Edge Functions). Bypasses RLS. Never shipped to the browser.
--
-- Rules followed for every table:
--   1. Row level security is enabled.
--   2. Grants are listed explicitly, column-scoped where a table is partly writable.
--   3. Writes that carry business rules (attempts, scoring, publishing) have NO client grant;
--      they are performed by server-side functions added in later phases.

-- ---------------------------------------------------------------------------------------------
-- 1. Clean slate: remove anything granted implicitly (e.g. by platform default privileges).
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Row level security on every table.
-- ---------------------------------------------------------------------------------------------
alter table public.audit_logs                  enable row level security;
alter table public.app_settings                enable row level security;
alter table public.profiles                    enable row level security;
alter table public.user_roles                  enable row level security;
alter table public.categories                  enable row level security;
alter table public.topics                      enable row level security;
alter table public.ai_generation_jobs          enable row level security;
alter table public.challenges                  enable row level security;
alter table public.challenge_versions          enable row level security;
alter table public.questions                   enable row level security;
alter table public.question_versions           enable row level security;
alter table public.question_options            enable row level security;
alter table public.question_answer_keys        enable row level security;
alter table public.challenge_version_questions enable row level security;
alter table public.question_validation_results enable row level security;
alter table public.challenge_attempts          enable row level security;
alter table public.attempt_answers             enable row level security;
alter table public.attempt_scores              enable row level security;
alter table public.bookmarks                   enable row level security;
alter table public.feedback_reports            enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3. Identity
-- ---------------------------------------------------------------------------------------------
-- profiles: a person sees and edits only their own display name. Other people's profiles are
-- deliberately not readable; leaderboards will expose display names through a controlled view.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: admins read all"
  on public.profiles for select to authenticated
  using ((select public.is_admin()));

create policy "profiles: update own display name"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- user_roles: read-only for the browser. There is no insert/update/delete grant, so a user cannot
-- grant themselves anything. Roles change only through grant_admin_role()/revoke_admin_role().
grant select on public.user_roles to authenticated;

create policy "user_roles: read own"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_roles: admins read all"
  on public.user_roles for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- 4. Admin-only reads (operational data)
-- ---------------------------------------------------------------------------------------------
grant select on public.audit_logs                  to authenticated;
grant select on public.app_settings                to authenticated;
grant select on public.ai_generation_jobs          to authenticated;
grant select on public.challenge_versions          to authenticated;
grant select on public.challenge_version_questions to authenticated;
grant select on public.questions                   to authenticated;
grant select on public.question_versions           to authenticated;
grant select on public.question_options            to authenticated;
grant select on public.question_answer_keys        to authenticated;
grant select on public.question_validation_results to authenticated;

create policy "audit_logs: admins read"
  on public.audit_logs for select to authenticated
  using ((select public.is_admin()));

create policy "app_settings: admins read"
  on public.app_settings for select to authenticated
  using ((select public.is_admin()));

create policy "ai_generation_jobs: admins read"
  on public.ai_generation_jobs for select to authenticated
  using ((select public.is_admin()));

-- Question content and answer keys: admins only. Students receive questions during an attempt
-- through a server function that never includes the key, and review data only after submission.
create policy "challenge_versions: admins read"
  on public.challenge_versions for select to authenticated
  using ((select public.is_admin()));

create policy "challenge_version_questions: admins read"
  on public.challenge_version_questions for select to authenticated
  using ((select public.is_admin()));

create policy "questions: admins read"
  on public.questions for select to authenticated
  using ((select public.is_admin()));

create policy "question_versions: admins read"
  on public.question_versions for select to authenticated
  using ((select public.is_admin()));

create policy "question_options: admins read"
  on public.question_options for select to authenticated
  using ((select public.is_admin()));

create policy "question_answer_keys: admins read"
  on public.question_answer_keys for select to authenticated
  using ((select public.is_admin()));

create policy "question_validation_results: admins read"
  on public.question_validation_results for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- 5. Catalog
-- ---------------------------------------------------------------------------------------------
-- No DELETE grant: categories and topics are soft-deleted (deleted_at).
grant select, insert, update on public.categories to authenticated;
grant select, insert, update on public.topics     to authenticated;

create policy "categories: signed-in users read active"
  on public.categories for select to authenticated
  using (deleted_at is null);

create policy "categories: admins read all"
  on public.categories for select to authenticated
  using ((select public.is_admin()));

create policy "categories: admins insert"
  on public.categories for insert to authenticated
  with check ((select public.is_admin()));

create policy "categories: admins update"
  on public.categories for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "topics: signed-in users read active"
  on public.topics for select to authenticated
  using (deleted_at is null);

create policy "topics: admins read all"
  on public.topics for select to authenticated
  using ((select public.is_admin()));

create policy "topics: admins insert"
  on public.topics for insert to authenticated
  with check ((select public.is_admin()));

create policy "topics: admins update"
  on public.topics for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- 6. Challenges
-- ---------------------------------------------------------------------------------------------
-- Students see a challenge only while it is PUBLISHED, not deleted, and inside its schedule.
-- Admin write access (create, edit, transitions) arrives with server-side functions in phase 2.
grant select on public.challenges to authenticated;

create policy "challenges: signed-in users read open challenges"
  on public.challenges for select to authenticated
  using (
    status = 'PUBLISHED'
    and deleted_at is null
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at > now())
  );

create policy "challenges: admins read all"
  on public.challenges for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- 7. Attempts (read own; all writes are server-side)
-- ---------------------------------------------------------------------------------------------
grant select on public.challenge_attempts to authenticated;
grant select on public.attempt_answers    to authenticated;
grant select on public.attempt_scores     to authenticated;

create policy "challenge_attempts: read own"
  on public.challenge_attempts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "challenge_attempts: admins read all"
  on public.challenge_attempts for select to authenticated
  using ((select public.is_admin()));

create policy "attempt_answers: read own"
  on public.attempt_answers for select to authenticated
  using (exists (
    select 1 from public.challenge_attempts a
    where a.id = attempt_answers.attempt_id
      and a.user_id = (select auth.uid())
  ));

create policy "attempt_answers: admins read all"
  on public.attempt_answers for select to authenticated
  using ((select public.is_admin()));

create policy "attempt_scores: read own"
  on public.attempt_scores for select to authenticated
  using (exists (
    select 1 from public.challenge_attempts a
    where a.id = attempt_scores.attempt_id
      and a.user_id = (select auth.uid())
  ));

create policy "attempt_scores: admins read all"
  on public.attempt_scores for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- 8. Engagement
-- ---------------------------------------------------------------------------------------------
-- bookmarks: read and remove your own. Adding will go through a function that checks the person
-- has actually seen the question.
grant select, delete on public.bookmarks to authenticated;

create policy "bookmarks: read own"
  on public.bookmarks for select to authenticated
  using (user_id = (select auth.uid()));

create policy "bookmarks: delete own"
  on public.bookmarks for delete to authenticated
  using (user_id = (select auth.uid()));

-- feedback_reports: reporters may create reports with a limited set of columns. reporter_id,
-- status and resolution fields are set by the database, never by the client.
grant select on public.feedback_reports to authenticated;
grant insert (kind, challenge_id, question_version_id, rating, message)
  on public.feedback_reports to authenticated;
grant update (status, admin_response) on public.feedback_reports to authenticated;

create policy "feedback_reports: read own"
  on public.feedback_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

create policy "feedback_reports: admins read all"
  on public.feedback_reports for select to authenticated
  using ((select public.is_admin()));

create policy "feedback_reports: create as self"
  on public.feedback_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));

create policy "feedback_reports: admins update"
  on public.feedback_reports for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- 9. Callable functions (everything else in `public` is not executable by the browser)
-- ---------------------------------------------------------------------------------------------
grant execute on function public.is_admin() to authenticated;

-- Admin dashboard counts. Metric definitions are documented in docs/analytics-definitions.md.
create function public.admin_overview_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'registered_users',
      (select count(*) from public.profiles),
    'published_challenges',
      (select count(*) from public.challenges
        where status = 'PUBLISHED' and deleted_at is null),
    'challenges_in_preparation',
      (select count(*) from public.challenges
        where status in ('DRAFT', 'GENERATING', 'GENERATION_FAILED', 'REVIEW_REQUIRED', 'VALIDATED', 'REJECTED')
          and deleted_at is null),
    'completed_attempts',
      (select count(*) from public.challenge_attempts where status = 'SUBMITTED'),
    'unique_participants',
      (select count(distinct user_id) from public.challenge_attempts
        where status = 'SUBMITTED' and user_id is not null),
    'open_reports',
      (select count(*) from public.feedback_reports where status = 'OPEN')
  );
end;
$$;

revoke all on function public.admin_overview_stats() from public, anon, authenticated;
grant execute on function public.admin_overview_stats() to authenticated;
