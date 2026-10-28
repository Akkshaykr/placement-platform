-- Phase 1 / migration 4: categories, topics, challenges, questions, versions, answer keys.
--
-- Immutability model
--   * A challenge_version pins an ordered list of question_versions plus the time limit and
--     scoring rules in force. Attempts reference a challenge_version, so editing a challenge
--     later creates a NEW version and never changes past results.
--   * Once frozen (challenge_versions.frozen_at) / locked (question_versions.locked_at), rows are
--     immutable; triggers in migration 7 enforce this at the database level.
--
-- Answer-key model
--   * Correct option and explanation live in question_answer_keys, separate from the
--     student-visible question text and options. Students have no policy on that table.

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create table public.topics (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  slug        text not null
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (category_id, slug)
);

create index topics_category_idx on public.topics (category_id);

create trigger topics_set_updated_at
  before update on public.topics
  for each row execute function public.set_updated_at();

-- AI generation history (written by a server-side function in a later phase).
create table public.ai_generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  requested_by    uuid references auth.users (id) on delete set null,
  status          public.generation_status not null default 'QUEUED',
  request         jsonb not null,
  requested_count integer not null check (requested_count between 1 and 50),
  produced_count  integer not null default 0 check (produced_count >= 0),
  provider        text,
  model           text,
  input_tokens    integer check (input_tokens is null or input_tokens >= 0),
  output_tokens   integer check (output_tokens is null or output_tokens >= 0),
  error_code      text check (char_length(error_code) <= 60),
  -- Safe, user-presentable message only. Never store provider payloads or secrets here.
  error_message   text check (char_length(error_message) <= 500),
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  check (finished_at is null or started_at is null or finished_at >= started_at)
);

create index ai_generation_jobs_requester_idx
  on public.ai_generation_jobs (requested_by, created_at desc);

create table public.challenges (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  title                    text not null check (char_length(btrim(title)) between 3 and 120),
  description              text not null default '' check (char_length(description) <= 4000),
  instructions             text not null default '' check (char_length(instructions) <= 4000),
  topic_id                 uuid references public.topics (id) on delete restrict,
  difficulty               public.difficulty_level not null default 'MEDIUM',
  tags                     text[] not null default '{}' check (cardinality(tags) <= 15),
  learning_objectives      text[] not null default '{}' check (cardinality(learning_objectives) <= 10),
  status                   public.challenge_status not null default 'DRAFT',
  start_at                 timestamptz,
  end_at                   timestamptz,
  time_limit_minutes       integer not null default 30 check (time_limit_minutes between 1 and 300),
  target_question_count    integer not null default 10 check (target_question_count between 1 and 100),
  max_attempts             integer check (max_attempts is null or max_attempts between 1 and 100),
  points_per_correct       numeric(6, 2) not null default 1 check (points_per_correct > 0),
  negative_marking_enabled boolean not null default false,
  penalty_per_incorrect    numeric(6, 2) not null default 0 check (penalty_per_incorrect >= 0),
  live_version_id          uuid,
  created_by               uuid references auth.users (id) on delete set null,
  updated_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  constraint challenges_schedule_ck check (start_at is null or end_at is null or end_at > start_at),
  constraint challenges_penalty_ck check (
    (negative_marking_enabled and penalty_per_incorrect > 0)
    or (not negative_marking_enabled and penalty_per_incorrect = 0)
  ),
  -- A published challenge must have a topic and a live version to serve.
  constraint challenges_published_ck check (
    status <> 'PUBLISHED' or (topic_id is not null and live_version_id is not null)
  )
);

create index challenges_topic_idx on public.challenges (topic_id);
create index challenges_status_schedule_idx on public.challenges (status, start_at, end_at)
  where deleted_at is null;

create trigger challenges_set_updated_at
  before update on public.challenges
  for each row execute function public.set_updated_at();

create table public.challenge_versions (
  id                       uuid primary key default gen_random_uuid(),
  challenge_id             uuid not null references public.challenges (id) on delete restrict,
  version_number           integer not null check (version_number > 0),
  -- Rules in force for attempts against this version (copied from the challenge when created).
  time_limit_minutes       integer not null check (time_limit_minutes between 1 and 300),
  points_per_correct       numeric(6, 2) not null check (points_per_correct > 0),
  negative_marking_enabled boolean not null default false,
  penalty_per_incorrect    numeric(6, 2) not null default 0 check (penalty_per_incorrect >= 0),
  created_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  frozen_at                timestamptz,
  unique (challenge_id, version_number),
  unique (challenge_id, id),
  constraint challenge_versions_penalty_ck check (
    (negative_marking_enabled and penalty_per_incorrect > 0)
    or (not negative_marking_enabled and penalty_per_incorrect = 0)
  )
);

-- The live version must belong to the same challenge (composite key, MATCH SIMPLE:
-- not enforced while live_version_id is null).
alter table public.challenges
  add constraint challenges_live_version_fk
  foreign key (id, live_version_id)
  references public.challenge_versions (challenge_id, id);

create table public.questions (
  id                uuid primary key default gen_random_uuid(),
  origin            public.question_origin not null default 'MANUAL',
  generation_job_id uuid references public.ai_generation_jobs (id) on delete set null,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table public.question_versions (
  id                  uuid primary key default gen_random_uuid(),
  question_id         uuid not null references public.questions (id) on delete restrict,
  version_number      integer not null check (version_number > 0),
  stem                text not null check (char_length(btrim(stem)) between 5 and 4000),
  topic_id            uuid references public.topics (id) on delete restrict,
  difficulty          public.difficulty_level not null default 'MEDIUM',
  estimated_seconds   integer not null default 60 check (estimated_seconds between 10 and 1800),
  review_status       public.question_review_status not null default 'DRAFT',
  approved_by         uuid references auth.users (id) on delete set null,
  approved_at         timestamptz,
  generation_metadata jsonb not null default '{}'::jsonb,
  locked_at           timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (question_id, version_number),
  constraint question_versions_approval_ck check (
    (review_status = 'ADMIN_APPROVED') = (approved_at is not null)
  )
);

create index question_versions_topic_idx on public.question_versions (topic_id);
create index question_versions_review_idx on public.question_versions (review_status);

create trigger question_versions_set_updated_at
  before update on public.question_versions
  for each row execute function public.set_updated_at();

create table public.question_options (
  id                  uuid primary key default gen_random_uuid(),
  question_version_id uuid not null references public.question_versions (id) on delete cascade,
  position            smallint not null check (position between 1 and 6),
  body                text not null check (char_length(btrim(body)) between 1 and 1000),
  unique (question_version_id, position),
  unique (id, question_version_id)
);

create table public.question_answer_keys (
  question_version_id uuid primary key references public.question_versions (id) on delete cascade,
  correct_option_id   uuid not null,
  -- May be empty while drafting; validation flags empty explanations before approval.
  explanation         text not null default '' check (char_length(explanation) <= 8000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- The correct option must belong to this same question version.
  -- NO ACTION (not CASCADE): deleting the correct option on its own is refused.
  foreign key (correct_option_id, question_version_id)
    references public.question_options (id, question_version_id)
);

create trigger question_answer_keys_set_updated_at
  before update on public.question_answer_keys
  for each row execute function public.set_updated_at();

create table public.challenge_version_questions (
  challenge_version_id uuid not null references public.challenge_versions (id) on delete cascade,
  question_version_id  uuid not null references public.question_versions (id) on delete restrict,
  position             integer not null check (position > 0),
  primary key (challenge_version_id, question_version_id),
  unique (challenge_version_id, position)
);

create index challenge_version_questions_qv_idx
  on public.challenge_version_questions (question_version_id);

create table public.question_validation_results (
  id                  uuid primary key default gen_random_uuid(),
  question_version_id uuid not null references public.question_versions (id) on delete cascade,
  source              text not null default 'AUTOMATED' check (source in ('AUTOMATED', 'ADMIN')),
  check_name          text not null check (char_length(check_name) between 1 and 80),
  outcome             public.validation_outcome not null,
  message             text not null default '' check (char_length(message) <= 1000),
  details             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index question_validation_results_qv_idx
  on public.question_validation_results (question_version_id, created_at desc);
