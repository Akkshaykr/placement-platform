-- Phase 1 / migration 7: database-level immutability guards.
--
-- These enforce "history never changes silently" regardless of which code path writes the data.
-- A superuser can still disable triggers deliberately; ordinary application roles cannot.

-- A locked question version is frozen: no edits, no deletes.
create function public.guard_locked_question_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.locked_at is not null then
    raise exception 'question_version % is locked and cannot be changed. Create a new version instead.', old.id
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger question_versions_guard_locked
  before update or delete on public.question_versions
  for each row execute function public.guard_locked_question_version();

-- Options and answer keys of a locked question version are frozen with it.
create function public.guard_locked_question_child()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op <> 'INSERT' then
    v_old := old.question_version_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new := new.question_version_id;
  end if;

  if exists (
    select 1 from public.question_versions qv
    where qv.id in (v_old, v_new) and qv.locked_at is not null
  ) then
    raise exception 'The question version is locked; its options and answer key cannot be changed.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger question_options_guard_locked
  before insert or update or delete on public.question_options
  for each row execute function public.guard_locked_question_child();

create trigger question_answer_keys_guard_locked
  before insert or update or delete on public.question_answer_keys
  for each row execute function public.guard_locked_question_child();

-- A frozen challenge version cannot change, and neither can its question list.
create function public.guard_frozen_challenge_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.frozen_at is not null then
    raise exception 'challenge_version % is frozen. Create a new version instead.', old.id
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger challenge_versions_guard_frozen
  before update or delete on public.challenge_versions
  for each row execute function public.guard_frozen_challenge_version();

create function public.guard_frozen_version_questions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op <> 'INSERT' then
    v_old := old.challenge_version_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new := new.challenge_version_id;
  end if;

  if exists (
    select 1 from public.challenge_versions cv
    where cv.id in (v_old, v_new) and cv.frozen_at is not null
  ) then
    raise exception 'The challenge version is frozen; its question list cannot be changed.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger challenge_version_questions_guard_frozen
  before insert or update or delete on public.challenge_version_questions
  for each row execute function public.guard_frozen_version_questions();

-- A submitted attempt is immutable. The single exception is account deletion, where the
-- foreign key's ON DELETE SET NULL anonymises user_id and nothing else changes.
create function public.guard_submitted_attempt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'SUBMITTED' then
    if tg_op = 'UPDATE'
       and new.user_id is null
       and old.user_id is not null
       and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
      return new;
    end if;
    raise exception 'A submitted attempt cannot be changed or deleted.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger challenge_attempts_guard_submitted
  before update or delete on public.challenge_attempts
  for each row execute function public.guard_submitted_attempt();

-- Answers cannot be added, changed or removed once their attempt is submitted.
create function public.guard_attempt_answers()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_attempt uuid;
  v_status  public.attempt_status;
begin
  v_attempt := case when tg_op = 'DELETE' then old.attempt_id else new.attempt_id end;

  select a.status into v_status
  from public.challenge_attempts a
  where a.id = v_attempt;

  -- No parent row means the parent is being deleted (cascade); nothing to protect.
  if v_status = 'SUBMITTED' then
    raise exception 'Answers of a submitted attempt cannot be changed.' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger attempt_answers_guard_submitted
  before insert or update or delete on public.attempt_answers
  for each row execute function public.guard_attempt_answers();

-- Scores are write-once and may only be written for a submitted attempt.
create function public.guard_attempt_scores()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.attempt_status;
begin
  if tg_op = 'INSERT' then
    select a.status into v_status from public.challenge_attempts a where a.id = new.attempt_id;
    if v_status is distinct from 'SUBMITTED' then
      raise exception 'A score can only be recorded for a submitted attempt.' using errcode = '55000';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE'
     and not exists (select 1 from public.challenge_attempts a where a.id = old.attempt_id) then
    return old;
  end if;

  raise exception 'Scores are write-once and cannot be changed or deleted.' using errcode = '55000';
end;
$$;

create trigger attempt_scores_guard
  before insert or update or delete on public.attempt_scores
  for each row execute function public.guard_attempt_scores();
