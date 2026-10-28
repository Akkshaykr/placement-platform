-- Phase 1 / migration 5: attempts, answers, scores (schema only).
--
-- All writes to these tables will go through server-side functions in the quiz-engine phase.
-- The browser gets read access to its own rows and nothing else (see the API-surface migration).
-- Deadlines and scores are decided by the server clock and server logic, never by the client.

create table public.challenge_attempts (
  id                   uuid primary key default gen_random_uuid(),
  challenge_id         uuid not null,
  challenge_version_id uuid not null,
  -- SET NULL: deleting an account anonymises attempts instead of destroying aggregate history.
  user_id              uuid references auth.users (id) on delete set null,
  attempt_number       integer not null check (attempt_number > 0),
  status               public.attempt_status not null default 'IN_PROGRESS',
  started_at           timestamptz not null default now(),
  deadline_at          timestamptz not null,
  submitted_at         timestamptz,
  submitted_via        text check (submitted_via in ('USER', 'TIMEOUT')),
  created_at           timestamptz not null default now(),
  constraint attempts_version_fk
    foreign key (challenge_id, challenge_version_id)
    references public.challenge_versions (challenge_id, id) on delete restrict,
  constraint attempts_deadline_ck check (deadline_at > started_at),
  constraint attempts_state_ck check (
    (status = 'IN_PROGRESS' and submitted_at is null and submitted_via is null)
    or (status = 'SUBMITTED' and submitted_at is not null and submitted_via is not null)
  ),
  unique (id, challenge_version_id),
  unique (challenge_id, user_id, attempt_number)
);

-- At most one running attempt per user per challenge.
create unique index challenge_attempts_one_running_idx
  on public.challenge_attempts (user_id, challenge_id)
  where status = 'IN_PROGRESS';

create index challenge_attempts_user_idx on public.challenge_attempts (user_id, started_at desc);
create index challenge_attempts_challenge_idx on public.challenge_attempts (challenge_id, status);
create index challenge_attempts_submitted_idx on public.challenge_attempts (submitted_at)
  where status = 'SUBMITTED';

create table public.attempt_answers (
  id                   uuid primary key default gen_random_uuid(),
  attempt_id           uuid not null,
  challenge_version_id uuid not null,
  question_version_id  uuid not null,
  selected_option_id   uuid,
  marked_for_review    boolean not null default false,
  -- Set once, by the server, when the attempt is scored. NULL while the attempt is running.
  is_correct           boolean,
  points_awarded       numeric(6, 2),
  answered_at          timestamptz,
  updated_at           timestamptz not null default now(),
  -- The answer must belong to this attempt AND to a question in the attempt's pinned version.
  foreign key (attempt_id, challenge_version_id)
    references public.challenge_attempts (id, challenge_version_id) on delete cascade,
  foreign key (challenge_version_id, question_version_id)
    references public.challenge_version_questions (challenge_version_id, question_version_id)
    on delete restrict,
  -- The chosen option must belong to that same question version.
  foreign key (selected_option_id, question_version_id)
    references public.question_options (id, question_version_id) on delete restrict,
  unique (attempt_id, question_version_id)
);

create index attempt_answers_question_idx on public.attempt_answers (question_version_id);

create trigger attempt_answers_set_updated_at
  before update on public.attempt_answers
  for each row execute function public.set_updated_at();

-- One immutable score row per attempt. Writing it twice is impossible (primary key) and
-- changing it is blocked by a trigger, which is what makes scoring idempotent.
create table public.attempt_scores (
  attempt_id         uuid primary key references public.challenge_attempts (id) on delete cascade,
  score              numeric(8, 2) not null,
  max_score          numeric(8, 2) not null check (max_score >= 0),
  correct_count      integer not null check (correct_count >= 0),
  incorrect_count    integer not null check (incorrect_count >= 0),
  unanswered_count   integer not null check (unanswered_count >= 0),
  accuracy           numeric(5, 4) not null check (accuracy between 0 and 1),
  time_taken_seconds integer not null check (time_taken_seconds >= 0),
  computed_at        timestamptz not null default now(),
  check (score <= max_score)
);
