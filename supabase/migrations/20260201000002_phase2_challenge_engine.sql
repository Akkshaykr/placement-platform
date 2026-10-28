-- Phase 2 / migration 10: schema for the aptitude challenge engine.
--
-- Builds on Phase 1 instead of replacing it. Existing tables keep their meaning; this migration only
-- adds columns with safe defaults, new tables, indexes and integrity triggers.
--
-- Concepts
--   * The DRAFT version of a challenge is the single unfrozen challenge_versions row. Saving a draft
--     keeps that row in step with the challenge; publishing freezes it (immutable from then on).
--   * challenge_registrations: who has joined a challenge (enforces participant limits together
--     with a row lock taken by the server functions).
--   * attempt_questions: a per-attempt snapshot of the question order and option order, so shuffled
--     presentation is stable across refreshes and is recorded for audit.

-- ---------------------------------------------------------------------------------------------
-- 1. Challenge rules (current draft / live settings)
-- ---------------------------------------------------------------------------------------------
alter table public.challenges
  add column participant_limit  integer
    check (participant_limit is null or participant_limit between 1 and 100000),
  add column shuffle_questions  boolean not null default false,
  add column shuffle_options    boolean not null default false,
  add column result_release     text not null default 'IMMEDIATE'
    check (result_release in ('IMMEDIATE', 'AFTER_CLOSE', 'NEVER')),
  add column archived_at        timestamptz;

-- ---------------------------------------------------------------------------------------------
-- 2. Rules pinned by each challenge version (so attempts keep the rules they started under)
-- ---------------------------------------------------------------------------------------------
alter table public.challenge_versions
  add column max_attempts       integer
    check (max_attempts is null or max_attempts between 1 and 100),
  add column shuffle_questions  boolean not null default false,
  add column shuffle_options    boolean not null default false,
  add column result_release     text not null default 'IMMEDIATE'
    check (result_release in ('IMMEDIATE', 'AFTER_CLOSE', 'NEVER'));

-- At most one editable (unfrozen) draft version per challenge.
create unique index challenge_versions_one_draft_idx
  on public.challenge_versions (challenge_id) where frozen_at is null;

-- Optional per-question marks override. NULL means "use the version's points_per_correct".
alter table public.challenge_version_questions
  add column marks numeric(6, 2) check (marks is null or marks > 0);

-- ---------------------------------------------------------------------------------------------
-- 3. Question metadata
-- ---------------------------------------------------------------------------------------------
alter table public.question_versions
  add column subtopic      text check (subtopic is null or char_length(btrim(subtopic)) between 1 and 80),
  add column question_type text not null default 'SINGLE_CHOICE'
    check (question_type in ('SINGLE_CHOICE'));

-- ---------------------------------------------------------------------------------------------
-- 4. Registrations
-- ---------------------------------------------------------------------------------------------
create table public.challenge_registrations (
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index challenge_registrations_user_idx on public.challenge_registrations (user_id);

-- ---------------------------------------------------------------------------------------------
-- 5. Per-attempt question snapshot
-- ---------------------------------------------------------------------------------------------
create table public.attempt_questions (
  attempt_id           uuid not null,
  challenge_version_id uuid not null,
  question_version_id  uuid not null,
  display_position     integer not null check (display_position > 0),
  -- Option ids in the order the student saw them. Must list every option exactly once (trigger).
  option_order         uuid[] not null,
  primary key (attempt_id, question_version_id),
  unique (attempt_id, display_position),
  foreign key (attempt_id, challenge_version_id)
    references public.challenge_attempts (id, challenge_version_id) on delete cascade,
  foreign key (challenge_version_id, question_version_id)
    references public.challenge_version_questions (challenge_version_id, question_version_id)
    on delete restrict
);

create function public.check_attempt_question_options()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if cardinality(new.option_order) = 0
     or (select count(distinct x) from unnest(new.option_order) as x) <> cardinality(new.option_order)
     or (select count(*) from public.question_options o
          where o.question_version_id = new.question_version_id) <> cardinality(new.option_order)
     or exists (
       select 1 from unnest(new.option_order) as x
       where not exists (
         select 1 from public.question_options o
         where o.id = x and o.question_version_id = new.question_version_id))
  then
    raise exception 'option_order must list every option of the question exactly once.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger attempt_questions_check_options
  before insert or update on public.attempt_questions
  for each row execute function public.check_attempt_question_options();

-- Snapshot rows are frozen with their attempt: no insert, update or delete once it is submitted.
-- guard_attempt_answers() is generic (it only reads attempt_id), so it is reused here.
create trigger attempt_questions_guard_submitted
  before insert or update or delete on public.attempt_questions
  for each row execute function public.guard_attempt_answers();

-- ---------------------------------------------------------------------------------------------
-- 6. Indexes for listings, lookups, leaderboard and analytics
-- ---------------------------------------------------------------------------------------------
-- Expiry sweeps touch only running attempts.
create index challenge_attempts_running_deadline_idx
  on public.challenge_attempts (deadline_at) where status = 'IN_PROGRESS';

-- Leaderboard and analytics read finalized scores per challenge.
create index challenge_attempts_challenge_submitted_idx
  on public.challenge_attempts (challenge_id, user_id) where status = 'SUBMITTED';

create index challenges_listing_idx on public.challenges (status, deleted_at, updated_at desc);

create index question_versions_subtopic_idx on public.question_versions (topic_id, subtopic);

create index attempt_questions_qv_idx on public.attempt_questions (question_version_id);
