-- Phase 2 / migration 11: the server-side engine and its browser API surface.
--
-- Every state change is a SECURITY DEFINER function with a pinned search_path that:
--   1. identifies the caller from auth.uid() (never from a client-supplied id or role),
--   2. checks the caller's role (administrator functions) or ownership (student functions),
--   3. checks the lifecycle state and raises a coded error (CODE: message) when a rule is broken,
--   4. writes an audit row for administrator actions.
-- Functions are granted to `authenticated` one by one at the end of this file. Internal helpers are not granted.
--
-- Error codes returned to the browser (the text before the first colon):
--   FORBIDDEN, NOT_FOUND, VALIDATION, INVALID_TRANSITION, NOT_OPEN, ENDED, CANCELLED, FULL,
--   ATTEMPT_LIMIT, ATTEMPT_CLOSED, ATTEMPT_EXPIRED, INVALID_ANSWER, AI_DISABLED, AI_QUOTA.

-- =============================================================================================
-- 1. Internal helpers (no grants to browser roles)
-- =============================================================================================

create function public.require_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: Administrator access is required.' using errcode = '42501';
  end if;
end;
$$;

create function public.audit_event(
  p_action text, p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (actor_id, actor_kind, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'ADMIN', p_action, p_entity_type, p_entity_id, p_before, p_after);
end;
$$;

-- Derives the student-facing state of a challenge from its status and the SERVER clock (now()).
-- NOT_PUBLISHED covers drafts and anything else students must never be told about.
create function public.derive_challenge_state(
  p_status public.challenge_status, p_start timestamptz, p_end timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status = 'CANCELLED' then 'CANCELLED'
    when p_status in ('CLOSED', 'ARCHIVED') then 'COMPLETED'
    when p_status <> 'PUBLISHED' then 'NOT_PUBLISHED'
    when p_end is not null and p_end <= now() then 'COMPLETED'
    when p_start is not null and p_start > now() then 'UPCOMING'
    else 'OPEN'
  end
$$;

-- Map of check outcomes to the review status stored on the question version.
create function public.review_status_from_checks(p_checks jsonb)
returns public.question_review_status
language sql
immutable
set search_path = ''
as $$
  select case
    when exists (select 1 from jsonb_array_elements(p_checks) c where c ->> 'outcome' = 'FAIL')
      then 'FAILED'::public.question_review_status
    when exists (select 1 from jsonb_array_elements(p_checks) c where c ->> 'outcome' = 'WARN')
      then 'WARNING'::public.question_review_status
    else 'AUTO_PASSED'::public.question_review_status
  end
$$;

-- Deterministic structural checks on one question version. Mathematical correctness cannot be
-- proven here; that is why approval always requires a human confirmation (see admin_approve_question).
create function public.question_checks(p_qv uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  qv              public.question_versions%rowtype;
  v_origin        public.question_origin;
  v_options       integer;
  v_distinct      integer;
  v_explanation   text;
  v_has_key       boolean;
  v_sol_outcome   text;
  v_sol_message   text;
  v_checks        jsonb := '[]'::jsonb;
begin
  select * into qv from public.question_versions where id = p_qv;
  if not found then
    return '[]'::jsonb;
  end if;

  select q.origin into v_origin from public.questions q where q.id = qv.question_id;

  select count(*)::integer, count(distinct lower(btrim(o.body)))::integer
    into v_options, v_distinct
  from public.question_options o
  where o.question_version_id = p_qv;

  select k.explanation into v_explanation
  from public.question_answer_keys k
  where k.question_version_id = p_qv;

  v_has_key := exists (select 1 from public.question_answer_keys k where k.question_version_id = p_qv);

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'check', 'ANSWER_KEY',
    'outcome', case when v_has_key then 'PASS' else 'FAIL' end,
    'message', case when v_has_key then 'A correct answer is set.' else 'No correct answer is set.' end));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'check', 'OPTION_COUNT',
    'outcome', case when v_options between 2 and 6 then 'PASS' else 'FAIL' end,
    'message', format('%s option(s). Between 2 and 6 are required.', v_options)));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'check', 'OPTIONS_DISTINCT',
    'outcome', case when v_distinct = v_options then 'PASS' else 'FAIL' end,
    'message', case when v_distinct = v_options
      then 'All options are different.'
      else 'Two or more options have the same text.' end));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'check', 'EXPLANATION',
    'outcome', case when btrim(coalesce(v_explanation, '')) <> '' then 'PASS' else 'WARN' end,
    'message', case when btrim(coalesce(v_explanation, '')) <> ''
      then 'An explanation is provided.'
      else 'No explanation yet. Add one so students can learn from the question.' end));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'check', 'HUMAN_REVIEW',
    'outcome', case when qv.review_status = 'ADMIN_APPROVED' then 'PASS'
                    when v_origin = 'AI' then 'WARN'
                    else 'PASS' end,
    'message', case when qv.review_status = 'ADMIN_APPROVED' then 'Approved by an administrator.'
                    when v_origin = 'AI' then 'AI-generated. An administrator must confirm the correct answer before approval.'
                    else 'Entered manually. An administrator must still approve it.' end));

  select r.outcome::text, r.message
    into v_sol_outcome, v_sol_message
  from public.question_validation_results r
  where r.question_version_id = p_qv and r.check_name = 'MODEL_SOLVER_AGREEMENT'
  order by r.created_at desc
  limit 1;

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'check', 'MODEL_SOLVER_AGREEMENT',
    'outcome', coalesce(v_sol_outcome, 'SKIPPED'),
    'message', coalesce(v_sol_message, 'No second-model check was run for this question.')));

  return v_checks;
end;
$$;

-- Finalises one running attempt: writes the answer results, marks the attempt submitted and writes
-- the immutable score. Called only from server functions. Never trusts a client value for scoring.
create function public.finalize_attempt(p_attempt_id uuid, p_via text, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a            public.challenge_attempts%rowtype;
  v            public.challenge_versions%rowtype;
  r            record;
  v_score      numeric(8, 2) := 0;
  v_max        numeric(8, 2) := 0;
  v_correct    integer := 0;
  v_incorrect  integer := 0;
  v_unanswered integer := 0;
  v_points     numeric(6, 2);
  v_at         timestamptz;
begin
  select * into a from public.challenge_attempts where id = p_attempt_id for update;
  if not found or a.status <> 'IN_PROGRESS' then
    return;
  end if;

  select * into v from public.challenge_versions where id = a.challenge_version_id;

  -- Never record a time after the enforced deadline, whatever the caller passed.
  v_at := least(p_at, a.deadline_at);

  for r in
    select q.question_version_id,
           coalesce(cvq.marks, v.points_per_correct) as marks,
           ans.id                                   as answer_id,
           ans.selected_option_id,
           k.correct_option_id
    from public.attempt_questions q
    join public.challenge_version_questions cvq
      on cvq.challenge_version_id = a.challenge_version_id
     and cvq.question_version_id = q.question_version_id
    left join public.attempt_answers ans
      on ans.attempt_id = q.attempt_id
     and ans.question_version_id = q.question_version_id
    left join public.question_answer_keys k
      on k.question_version_id = q.question_version_id
    where q.attempt_id = a.id
  loop
    if r.correct_option_id is null then
      raise exception 'Answer key missing for a question in attempt %.', a.id using errcode = '55000';
    end if;

    v_max := v_max + r.marks;

    if r.selected_option_id is null then
      v_unanswered := v_unanswered + 1;
      v_points := 0;
    elsif r.selected_option_id = r.correct_option_id then
      v_correct := v_correct + 1;
      v_points := r.marks;
    else
      v_incorrect := v_incorrect + 1;
      v_points := case when v.negative_marking_enabled then -v.penalty_per_incorrect else 0 end;
    end if;

    v_score := v_score + v_points;

    if r.answer_id is not null then
      update public.attempt_answers
         set is_correct     = case when r.selected_option_id is null then null
                                   else r.selected_option_id = r.correct_option_id end,
             points_awarded = v_points
       where id = r.answer_id;
    end if;
  end loop;

  -- Answers are final; now close the attempt, then write its single score row.
  update public.challenge_attempts
     set status = 'SUBMITTED', submitted_at = v_at, submitted_via = p_via
   where id = a.id;

  insert into public.attempt_scores (
    attempt_id, score, max_score, correct_count, incorrect_count, unanswered_count,
    accuracy, time_taken_seconds
  )
  values (
    a.id, v_score, v_max, v_correct, v_incorrect, v_unanswered,
    case when (v_correct + v_incorrect + v_unanswered) = 0 then 0
         else round(v_correct::numeric / (v_correct + v_incorrect + v_unanswered), 4) end,
    greatest(0, floor(extract(epoch from (v_at - a.started_at)))::integer)
  );
end;
$$;

-- Sweeps every running attempt whose deadline has passed and finalises it at its deadline.
-- Runs lazily on every student call, and can be scheduled (pg_cron) so that closed browsers are
-- still submitted. Not granted to browser roles.
create function public.finalize_expired_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, deadline_at
    from public.challenge_attempts
    where status = 'IN_PROGRESS' and deadline_at <= now()
    order by deadline_at
  loop
    perform public.finalize_attempt(r.id, 'TIMEOUT', r.deadline_at);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Result summary of one submitted attempt (no answer key, no per-question correctness).
create function public.student_result_summary(p_attempt_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'attempt_id', a.id,
    'status', a.status,
    'submitted_via', a.submitted_via,
    'submitted_at', a.submitted_at,
    'score', s.score,
    'max_score', s.max_score,
    'percentage', case when s.max_score = 0 then 0 else round(s.score / s.max_score * 100, 2) end,
    'correct_count', s.correct_count,
    'incorrect_count', s.incorrect_count,
    'unanswered_count', s.unanswered_count,
    'time_taken_seconds', s.time_taken_seconds
  )
  from public.challenge_attempts a
  join public.attempt_scores s on s.attempt_id = a.id
  where a.id = p_attempt_id
$$;

-- Shared student view of a challenge, derived on the server.
create function public.challenge_student_view(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ch          public.challenges%rowtype;
  lv          public.challenge_versions%rowtype;
  v_topic     text;
  v_category  text;
  v_uid       uuid := auth.uid();
  v_registered integer;
  v_limit_reached boolean;
  v_running   uuid;
  v_my_attempts integer;
  v_is_registered boolean;
begin
  select * into ch from public.challenges where id = p_challenge_id;
  if not found then
    return null;
  end if;

  select t.name, cat.name into v_topic, v_category
  from public.topics t
  left join public.categories cat on cat.id = t.category_id
  where t.id = ch.topic_id;

  select * into lv from public.challenge_versions where id = ch.live_version_id;

  select count(*)::integer into v_registered
  from public.challenge_registrations r where r.challenge_id = ch.id;

  v_is_registered := exists (
    select 1 from public.challenge_registrations r
    where r.challenge_id = ch.id and r.user_id = v_uid);

  select a.id into v_running
  from public.challenge_attempts a
  where a.challenge_id = ch.id and a.user_id = v_uid and a.status = 'IN_PROGRESS'
  limit 1;

  select count(*)::integer into v_my_attempts
  from public.challenge_attempts a
  where a.challenge_id = ch.id and a.user_id = v_uid;

  v_limit_reached := ch.participant_limit is not null and v_registered >= ch.participant_limit;

  return jsonb_build_object(
    'id', ch.id,
    'slug', ch.slug,
    'title', ch.title,
    'description', ch.description,
    'instructions', ch.instructions,
    'learning_objectives', to_jsonb(ch.learning_objectives),
    'difficulty', ch.difficulty,
    'topic_name', v_topic,
    'category_name', v_category,
    'state', public.derive_challenge_state(ch.status, ch.start_at, ch.end_at),
    'start_at', ch.start_at,
    'end_at', ch.end_at,
    'time_limit_minutes', ch.time_limit_minutes,
    'question_count', ch.target_question_count,
    'participant_limit', ch.participant_limit,
    'registered_count', v_registered,
    'is_full', v_limit_reached,
    'is_registered', v_is_registered,
    'max_attempts', lv.max_attempts,
    'my_attempts', v_my_attempts,
    'running_attempt_id', v_running,
    'points_per_correct', lv.points_per_correct,
    'negative_marking_enabled', lv.negative_marking_enabled,
    'penalty_per_incorrect', lv.penalty_per_incorrect,
    'shuffle_questions', lv.shuffle_questions,
    'shuffle_options', lv.shuffle_options,
    'result_release', lv.result_release
  );
end;
$$;

-- =============================================================================================
-- 2. Administrator: challenge lifecycle
-- =============================================================================================

create function public.admin_save_challenge(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c                public.challenges%rowtype;
  v                public.challenge_versions%rowtype;
  v_id             uuid;
  v_slug           text := btrim(coalesce(p_data ->> 'slug', ''));
  v_title          text := btrim(coalesce(p_data ->> 'title', ''));
  v_description    text := coalesce(p_data ->> 'description', '');
  v_instructions   text := coalesce(p_data ->> 'instructions', '');
  v_topic          uuid := nullif(p_data ->> 'topic_id', '')::uuid;
  v_difficulty     public.difficulty_level := coalesce(nullif(p_data ->> 'difficulty', ''), 'MEDIUM')::public.difficulty_level;
  v_start          timestamptz := nullif(p_data ->> 'start_at', '')::timestamptz;
  v_end            timestamptz := nullif(p_data ->> 'end_at', '')::timestamptz;
  v_limit          integer := coalesce((p_data ->> 'time_limit_minutes')::integer, 30);
  v_target         integer := coalesce((p_data ->> 'target_question_count')::integer, 10);
  v_max_attempts   integer := nullif(p_data ->> 'max_attempts', '')::integer;
  v_participants   integer := nullif(p_data ->> 'participant_limit', '')::integer;
  v_points         numeric(6, 2) := coalesce((p_data ->> 'points_per_correct')::numeric, 1);
  v_neg            boolean := coalesce((p_data ->> 'negative_marking_enabled')::boolean, false);
  v_penalty        numeric(6, 2);
  v_shuffle_q      boolean := coalesce((p_data ->> 'shuffle_questions')::boolean, false);
  v_shuffle_o      boolean := coalesce((p_data ->> 'shuffle_options')::boolean, false);
  v_release        text := coalesce(nullif(p_data ->> 'result_release', ''), 'IMMEDIATE');
  v_next           integer;
begin
  perform public.require_admin();

  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    raise exception 'VALIDATION: The title must be 3 to 120 characters.' using errcode = '22023';
  end if;
  if char_length(v_description) > 4000 or char_length(v_instructions) > 4000 then
    raise exception 'VALIDATION: Description and instructions must be at most 4000 characters.' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 300 then
    raise exception 'VALIDATION: The time limit must be 1 to 300 minutes.' using errcode = '22023';
  end if;
  if v_target < 1 or v_target > 100 then
    raise exception 'VALIDATION: A challenge needs 1 to 100 questions.' using errcode = '22023';
  end if;
  if v_start is not null and v_end is not null and v_end <= v_start then
    raise exception 'VALIDATION: The end time must be after the start time.' using errcode = '22023';
  end if;
  if v_release not in ('IMMEDIATE', 'AFTER_CLOSE', 'NEVER') then
    raise exception 'VALIDATION: Choose a valid result-release policy.' using errcode = '22023';
  end if;
  if v_topic is not null and not exists (select 1 from public.topics t where t.id = v_topic and t.deleted_at is null) then
    raise exception 'VALIDATION: The selected topic does not exist.' using errcode = '22023';
  end if;
  if v_points <= 0 then
    raise exception 'VALIDATION: Marks per correct answer must be above zero.' using errcode = '22023';
  end if;
  v_penalty := case when v_neg then coalesce((p_data ->> 'penalty_per_incorrect')::numeric, 0) else 0 end;
  if v_neg and v_penalty <= 0 then
    raise exception 'VALIDATION: Negative marking needs a penalty above zero.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.challenges (
      slug, title, description, instructions, topic_id, difficulty, start_at, end_at,
      time_limit_minutes, target_question_count, max_attempts, participant_limit,
      points_per_correct, negative_marking_enabled, penalty_per_incorrect,
      shuffle_questions, shuffle_options, result_release, created_by, updated_by
    )
    values (
      v_slug, v_title, v_description, v_instructions, v_topic, v_difficulty, v_start, v_end,
      v_limit, v_target, v_max_attempts, v_participants,
      v_points, v_neg, v_penalty,
      v_shuffle_q, v_shuffle_o, v_release, auth.uid(), auth.uid()
    )
    returning id into v_id;
  else
    select * into c from public.challenges where id = p_id for update;
    if not found or c.deleted_at is not null then
      raise exception 'NOT_FOUND: The challenge does not exist.' using errcode = 'P0002';
    end if;
    if c.status <> 'DRAFT' then
      raise exception 'INVALID_TRANSITION: Published, cancelled or completed challenges cannot be edited. Create a new challenge instead.'
        using errcode = '55000';
    end if;

    update public.challenges
       set slug = v_slug, title = v_title, description = v_description, instructions = v_instructions,
           topic_id = v_topic, difficulty = v_difficulty, start_at = v_start, end_at = v_end,
           time_limit_minutes = v_limit, target_question_count = v_target, max_attempts = v_max_attempts,
           participant_limit = v_participants, points_per_correct = v_points,
           negative_marking_enabled = v_neg, penalty_per_incorrect = v_penalty,
           shuffle_questions = v_shuffle_q, shuffle_options = v_shuffle_o, result_release = v_release,
           updated_by = auth.uid()
     where id = p_id;
    v_id := p_id;
  end if;

  -- Keep the single draft version in step with the challenge's rules.
  select * into v from public.challenge_versions where challenge_id = v_id and frozen_at is null;
  if not found then
    select coalesce(max(version_number), 0) + 1 into v_next
    from public.challenge_versions where challenge_id = v_id;

    insert into public.challenge_versions (
      challenge_id, version_number, time_limit_minutes, points_per_correct, negative_marking_enabled,
      penalty_per_incorrect, max_attempts, shuffle_questions, shuffle_options, result_release, created_by
    )
    values (
      v_id, v_next, v_limit, v_points, v_neg, v_penalty, v_max_attempts,
      v_shuffle_q, v_shuffle_o, v_release, auth.uid()
    );
  else
    update public.challenge_versions
       set time_limit_minutes = v_limit, points_per_correct = v_points,
           negative_marking_enabled = v_neg, penalty_per_incorrect = v_penalty,
           max_attempts = v_max_attempts, shuffle_questions = v_shuffle_q,
           shuffle_options = v_shuffle_o, result_release = v_release
     where id = v.id;
  end if;

  perform public.audit_event(
    case when p_id is null then 'challenge.create' else 'challenge.update' end,
    'challenges', v_id::text, null, jsonb_build_object('title', v_title, 'status', 'DRAFT'));

  return v_id;
end;
$$;

-- Replaces the ordered question list of a DRAFT challenge. Only approved question versions are accepted.
create function public.admin_set_challenge_questions(p_challenge_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   public.challenges%rowtype;
  v   public.challenge_versions%rowtype;
  e   record;
  v_qv uuid;
  v_status public.question_review_status;
  v_deleted boolean;
  v_seen  uuid[] := '{}';
begin
  perform public.require_admin();

  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'NOT_FOUND: The challenge does not exist.' using errcode = 'P0002';
  end if;
  if c.status <> 'DRAFT' then
    raise exception 'INVALID_TRANSITION: Only draft challenges can change their questions.' using errcode = '55000';
  end if;

  select * into v from public.challenge_versions where challenge_id = c.id and frozen_at is null;
  if not found then
    raise exception 'VALIDATION: Save the challenge details before adding questions.' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'VALIDATION: The question list must be an array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'VALIDATION: A challenge can hold at most 100 questions.' using errcode = '22023';
  end if;

  for e in select value as item from jsonb_array_elements(p_items) loop
    v_qv := nullif(e.item ->> 'question_version_id', '')::uuid;
    if v_qv is null then
      raise exception 'VALIDATION: Every entry needs a question_version_id.' using errcode = '22023';
    end if;
    if v_qv = any(v_seen) then
      raise exception 'VALIDATION: The same question cannot appear twice.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_qv;

    select qv.review_status, q.deleted_at is not null
      into v_status, v_deleted
    from public.question_versions qv
    join public.questions q on q.id = qv.question_id
    where qv.id = v_qv;

    if v_status is null or v_deleted then
      raise exception 'VALIDATION: A selected question no longer exists.' using errcode = '22023';
    end if;
    if v_status <> 'ADMIN_APPROVED' then
      raise exception 'VALIDATION: Only approved questions can be added to a challenge.' using errcode = '22023';
    end if;
    if nullif(e.item ->> 'marks', '') is not null and (e.item ->> 'marks')::numeric <= 0 then
      raise exception 'VALIDATION: Marks must be above zero.' using errcode = '22023';
    end if;
  end loop;

  delete from public.challenge_version_questions where challenge_version_id = v.id;

  insert into public.challenge_version_questions (challenge_version_id, question_version_id, position, marks)
  select v.id,
         (x.item ->> 'question_version_id')::uuid,
         x.ord::integer,
         nullif(x.item ->> 'marks', '')::numeric(6, 2)
  from jsonb_array_elements(p_items) with ordinality as x (item, ord);

  perform public.audit_event('challenge.questions_set', 'challenges', c.id::text, null,
    jsonb_build_object('question_count', jsonb_array_length(p_items)));
end;
$$;

-- Publishes a DRAFT: validates everything, freezes the draft version, locks its questions, goes live.
create function public.admin_publish_challenge(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c     public.challenges%rowtype;
  v     public.challenge_versions%rowtype;
  r     record;
  v_count integer;
begin
  perform public.require_admin();

  select * into c from public.challenges where id = p_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'NOT_FOUND: The challenge does not exist.' using errcode = 'P0002';
  end if;
  if c.status <> 'DRAFT' then
    raise exception 'INVALID_TRANSITION: Only draft challenges can be published.' using errcode = '55000';
  end if;
  if c.topic_id is null then
    raise exception 'VALIDATION: Choose a topic before publishing.' using errcode = '22023';
  end if;
  if c.start_at is null or c.end_at is null then
    raise exception 'VALIDATION: Set a start and an end time before publishing.' using errcode = '22023';
  end if;
  if c.end_at <= now() then
    raise exception 'VALIDATION: The end time has already passed.' using errcode = '22023';
  end if;

  select * into v from public.challenge_versions where challenge_id = c.id and frozen_at is null;
  if not found then
    raise exception 'VALIDATION: Save the challenge details before publishing.' using errcode = '22023';
  end if;

  select count(*)::integer into v_count
  from public.challenge_version_questions where challenge_version_id = v.id;

  if v_count <> c.target_question_count then
    raise exception 'VALIDATION: The assessment has % question(s) but is set to % question(s).',
      v_count, c.target_question_count using errcode = '22023';
  end if;

  for r in
    select cvq.question_version_id, cvq.position
    from public.challenge_version_questions cvq
    where cvq.challenge_version_id = v.id
    order by cvq.position
  loop
    if (select qv.review_status from public.question_versions qv where qv.id = r.question_version_id)
       is distinct from 'ADMIN_APPROVED' then
      raise exception 'VALIDATION: Question % is not approved.', r.position using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(public.question_checks(r.question_version_id)) x
      where x ->> 'outcome' = 'FAIL'
    ) then
      raise exception 'VALIDATION: Question % has failed checks. Fix it before publishing.', r.position
        using errcode = '22023';
    end if;
  end loop;

  -- Freeze: the question versions and the challenge version can no longer change.
  update public.question_versions
     set locked_at = now()
   where id in (select cvq.question_version_id from public.challenge_version_questions cvq
                where cvq.challenge_version_id = v.id)
     and locked_at is null;

  update public.challenge_versions set frozen_at = now() where id = v.id;

  update public.challenges
     set status = 'PUBLISHED', live_version_id = v.id, updated_by = auth.uid()
   where id = c.id;

  perform public.audit_event('challenge.publish', 'challenges', c.id::text,
    jsonb_build_object('status', 'DRAFT'),
    jsonb_build_object('status', 'PUBLISHED', 'version_id', v.id, 'question_count', v_count));
end;
$$;

-- CANCEL, COMPLETE, ARCHIVE, DELETE: the only lifecycle transitions after creation.
create function public.admin_transition_challenge(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c     public.challenges%rowtype;
  r     record;
  v_state text;
  v_running integer;
begin
  perform public.require_admin();

  select * into c from public.challenges where id = p_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'NOT_FOUND: The challenge does not exist.' using errcode = 'P0002';
  end if;

  v_state := public.derive_challenge_state(c.status, c.start_at, c.end_at);

  if p_action = 'CANCEL' then
    if c.status <> 'PUBLISHED' or v_state not in ('UPCOMING', 'OPEN') then
      raise exception 'INVALID_TRANSITION: Only upcoming or open challenges can be cancelled.' using errcode = '55000';
    end if;
    select count(*)::integer into v_running
    from public.challenge_attempts where challenge_id = c.id and status = 'IN_PROGRESS';
    if v_running > 0 then
      raise exception 'INVALID_TRANSITION: % attempt(s) are in progress. Complete the challenge instead.', v_running
        using errcode = '55000';
    end if;
    update public.challenges set status = 'CANCELLED', updated_by = auth.uid() where id = c.id;

  elsif p_action = 'COMPLETE' then
    if c.status <> 'PUBLISHED' or v_state not in ('OPEN', 'COMPLETED') then
      raise exception 'INVALID_TRANSITION: Only open or ended challenges can be completed.' using errcode = '55000';
    end if;
    -- Running attempts are submitted now, at their own deadline or at this moment, whichever is earlier.
    for r in select id from public.challenge_attempts where challenge_id = c.id and status = 'IN_PROGRESS' loop
      perform public.finalize_attempt(r.id, 'TIMEOUT', now());
    end loop;
    update public.challenges set status = 'CLOSED', updated_by = auth.uid() where id = c.id;

  elsif p_action = 'ARCHIVE' then
    if c.status not in ('DRAFT', 'CANCELLED', 'CLOSED') then
      raise exception 'INVALID_TRANSITION: Only drafts, cancelled or completed challenges can be archived.' using errcode = '55000';
    end if;
    update public.challenges set status = 'ARCHIVED', archived_at = now(), updated_by = auth.uid() where id = c.id;

  elsif p_action = 'DELETE' then
    if c.status <> 'DRAFT' then
      raise exception 'INVALID_TRANSITION: Only drafts can be deleted. Archive other challenges instead.' using errcode = '55000';
    end if;
    update public.challenges set deleted_at = now(), updated_by = auth.uid() where id = c.id;

  else
    raise exception 'VALIDATION: Unknown lifecycle action.' using errcode = '22023';
  end if;

  perform public.audit_event('challenge.' || lower(p_action), 'challenges', c.id::text,
    jsonb_build_object('status', c.status), jsonb_build_object('action', p_action));
end;
$$;

-- =============================================================================================
-- 3. Administrator: question bank
-- =============================================================================================

create function public.admin_save_question(p_question_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id uuid := p_question_id;
  v_latest      public.question_versions%rowtype;
  v_target      uuid;
  v_version     integer;
  v_stem        text := btrim(coalesce(p_data ->> 'stem', ''));
  v_options     text[];
  v_correct_pos integer := nullif(p_data ->> 'correct_position', '')::integer;
  v_explanation text := btrim(coalesce(p_data ->> 'explanation', ''));
  v_origin      public.question_origin := coalesce(nullif(p_data ->> 'origin', ''), 'MANUAL')::public.question_origin;
  v_topic       uuid := nullif(p_data ->> 'topic_id', '')::uuid;
  v_subtopic    text := nullif(btrim(coalesce(p_data ->> 'subtopic', '')), '');
  v_difficulty  public.difficulty_level := coalesce(nullif(p_data ->> 'difficulty', ''), 'MEDIUM')::public.difficulty_level;
  v_est         integer := coalesce((p_data ->> 'estimated_seconds')::integer, 60);
  v_correct_id  uuid;
  v_tmp         uuid;
  v_checks      jsonb;
  v_status      public.question_review_status;
  i             integer;
begin
  perform public.require_admin();

  if char_length(v_stem) < 5 or char_length(v_stem) > 4000 then
    raise exception 'VALIDATION: The question text must be 5 to 4000 characters.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data -> 'options') is distinct from 'array' then
    raise exception 'VALIDATION: Options must be provided as a list.' using errcode = '22023';
  end if;

  v_options := array(select jsonb_array_elements_text(p_data -> 'options'));
  if cardinality(v_options) < 2 or cardinality(v_options) > 6 then
    raise exception 'VALIDATION: Provide 2 to 6 options.' using errcode = '22023';
  end if;
  for i in 1 .. cardinality(v_options) loop
    if char_length(btrim(v_options[i])) = 0 or char_length(v_options[i]) > 1000 then
      raise exception 'VALIDATION: Option % must be 1 to 1000 characters.', i using errcode = '22023';
    end if;
  end loop;

  if v_correct_pos is null or v_correct_pos < 1 or v_correct_pos > cardinality(v_options) then
    raise exception 'VALIDATION: Choose which option is correct.' using errcode = '22023';
  end if;
  if char_length(v_explanation) > 8000 then
    raise exception 'VALIDATION: The explanation must be at most 8000 characters.' using errcode = '22023';
  end if;
  if v_topic is not null and not exists (select 1 from public.topics t where t.id = v_topic and t.deleted_at is null) then
    raise exception 'VALIDATION: The selected topic does not exist.' using errcode = '22023';
  end if;

  if v_question_id is null then
    insert into public.questions (origin, generation_job_id, created_by)
    values (v_origin, nullif(p_data ->> 'generation_job_id', '')::uuid, auth.uid())
    returning id into v_question_id;
    v_version := 1;
  else
    if exists (select 1 from public.questions q where q.id = v_question_id and q.deleted_at is not null) then
      raise exception 'NOT_FOUND: The question does not exist.' using errcode = 'P0002';
    end if;
    select * into v_latest from public.question_versions
    where question_id = v_question_id order by version_number desc limit 1;
    if not found then
      raise exception 'NOT_FOUND: The question does not exist.' using errcode = 'P0002';
    end if;

    if v_latest.locked_at is null then
      v_target := v_latest.id;             -- editable: change it in place
    else
      v_version := v_latest.version_number + 1;  -- used by a published challenge: never change it
    end if;
  end if;

  if v_target is null then
    if v_version is null then
      select coalesce(max(version_number), 0) + 1 into v_version
      from public.question_versions where question_id = v_question_id;
    end if;
    insert into public.question_versions (
      question_id, version_number, stem, topic_id, subtopic, difficulty, estimated_seconds,
      review_status, generation_metadata, created_by
    )
    values (
      v_question_id, v_version, v_stem, v_topic, v_subtopic, v_difficulty, v_est,
      'DRAFT', coalesce(p_data -> 'generation_metadata', '{}'::jsonb), auth.uid()
    )
    returning id into v_target;
  else
    -- Editing an unlocked version resets its approval: the content changed, so it must be re-approved.
    delete from public.question_answer_keys where question_version_id = v_target;
    delete from public.question_options where question_version_id = v_target;
    update public.question_versions
       set stem = v_stem, topic_id = v_topic, subtopic = v_subtopic, difficulty = v_difficulty,
           estimated_seconds = v_est, review_status = 'DRAFT', approved_by = null, approved_at = null,
           generation_metadata = coalesce(p_data -> 'generation_metadata', generation_metadata)
     where id = v_target;
  end if;

  for i in 1 .. cardinality(v_options) loop
    insert into public.question_options (question_version_id, position, body)
    values (v_target, i, btrim(v_options[i]))
    returning id into v_tmp;
    if i = v_correct_pos then
      v_correct_id := v_tmp;
    end if;
  end loop;

  insert into public.question_answer_keys (question_version_id, correct_option_id, explanation)
  values (v_target, v_correct_id, v_explanation);

  v_checks := public.question_checks(v_target);
  v_status := public.review_status_from_checks(v_checks);
  update public.question_versions set review_status = v_status where id = v_target;

  perform public.audit_event('question.save', 'question_versions', v_target::text, null,
    jsonb_build_object('question_id', v_question_id, 'review_status', v_status));

  return jsonb_build_object(
    'question_id', v_question_id,
    'question_version_id', v_target,
    'review_status', v_status,
    'checks', v_checks
  );
end;
$$;

-- Approval is a human decision. It refuses any version with a FAILED check and requires an explicit
-- confirmation that the correct answer has been checked. It never happens automatically.
create function public.admin_approve_question(p_question_version_id uuid, p_confirm boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  qv public.question_versions%rowtype;
begin
  perform public.require_admin();

  select * into qv from public.question_versions where id = p_question_version_id for update;
  if not found then
    raise exception 'NOT_FOUND: The question version does not exist.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.questions q where q.id = qv.question_id and q.deleted_at is not null) then
    raise exception 'NOT_FOUND: The question does not exist.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.question_versions x
             where x.question_id = qv.question_id and x.version_number > qv.version_number) then
    raise exception 'VALIDATION: A newer version of this question exists. Review that version instead.' using errcode = '22023';
  end if;
  if qv.review_status = 'ADMIN_APPROVED' then
    return;
  end if;
  if p_confirm is not true then
    raise exception 'VALIDATION: Confirm that you have checked the correct answer before approving.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(public.question_checks(qv.id)) x where x ->> 'outcome' = 'FAIL'
  ) then
    raise exception 'VALIDATION: Fix the failed checks before approving.' using errcode = '22023';
  end if;

  update public.question_versions
     set review_status = 'ADMIN_APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = qv.id;

  perform public.audit_event('question.approve', 'question_versions', qv.id::text, null,
    jsonb_build_object('review_status', 'ADMIN_APPROVED'));
end;
$$;

-- Soft delete. Refused when any challenge version uses the question, so history stays intact.
create function public.admin_delete_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();

  if not exists (select 1 from public.questions where id = p_question_id and deleted_at is null) then
    raise exception 'NOT_FOUND: The question does not exist.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.challenge_version_questions cvq
    join public.question_versions qv on qv.id = cvq.question_version_id
    where qv.question_id = p_question_id
  ) then
    raise exception 'INVALID_TRANSITION: This question is used by a challenge and cannot be deleted.' using errcode = '55000';
  end if;

  update public.questions set deleted_at = now() where id = p_question_id;
  perform public.audit_event('question.delete', 'questions', p_question_id::text, null, null);
end;
$$;

create function public.admin_list_questions(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := lower(nullif(btrim(coalesce(p_filters ->> 'q', '')), ''));
  v_result jsonb;
begin
  perform public.require_admin();

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
    into v_result
  from (
    select q.id as question_id,
           lv.id as question_version_id,
           lv.version_number,
           lv.stem,
           lv.subtopic,
           lv.difficulty,
           lv.estimated_seconds,
           lv.review_status,
           q.origin,
           lv.locked_at is not null as locked,
           lv.topic_id,
           t.name as topic_name,
           cat.id as category_id,
           cat.name as category_name,
           lv.updated_at
    from public.questions q
    join lateral (
      select v.* from public.question_versions v
      where v.question_id = q.id
      order by v.version_number desc
      limit 1
    ) lv on true
    left join public.topics t on t.id = lv.topic_id
    left join public.categories cat on cat.id = t.category_id
    where q.deleted_at is null
      and (nullif(p_filters ->> 'topic_id', '') is null or lv.topic_id = (p_filters ->> 'topic_id')::uuid)
      and (nullif(p_filters ->> 'category_id', '') is null or cat.id = (p_filters ->> 'category_id')::uuid)
      and (nullif(p_filters ->> 'difficulty', '') is null or lv.difficulty = (p_filters ->> 'difficulty')::public.difficulty_level)
      and (nullif(p_filters ->> 'review_status', '') is null or lv.review_status = (p_filters ->> 'review_status')::public.question_review_status)
      and (nullif(p_filters ->> 'origin', '') is null or q.origin = (p_filters ->> 'origin')::public.question_origin)
      and (v_q is null or strpos(lower(lv.stem), v_q) > 0 or strpos(lower(coalesce(lv.subtopic, '')), v_q) > 0)
    order by lv.updated_at desc
    limit 500
  ) x;

  return v_result;
end;
$$;

create function public.admin_get_question(p_question_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q  public.questions%rowtype;
  lv public.question_versions%rowtype;
  v_options jsonb;
  v_key     public.question_answer_keys%rowtype;
begin
  perform public.require_admin();

  select * into q from public.questions where id = p_question_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND: The question does not exist.' using errcode = 'P0002';
  end if;

  select * into lv from public.question_versions
  where question_id = q.id order by version_number desc limit 1;

  select * into v_key from public.question_answer_keys where question_version_id = lv.id;

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'position', o.position, 'body', o.body)
                  order by o.position), '[]'::jsonb)
    into v_options
  from public.question_options o where o.question_version_id = lv.id;

  return jsonb_build_object(
    'question_id', q.id,
    'origin', q.origin,
    'question_version_id', lv.id,
    'version_number', lv.version_number,
    'version_count', (select count(*) from public.question_versions v where v.question_id = q.id),
    'locked', lv.locked_at is not null,
    'stem', lv.stem,
    'subtopic', lv.subtopic,
    'topic_id', lv.topic_id,
    'difficulty', lv.difficulty,
    'estimated_seconds', lv.estimated_seconds,
    'review_status', lv.review_status,
    'approved_at', lv.approved_at,
    'options', v_options,
    'correct_option_id', v_key.correct_option_id,
    'explanation', v_key.explanation,
    'generation_metadata', lv.generation_metadata,
    'checks', public.question_checks(lv.id)
  );
end;
$$;

-- =============================================================================================
-- 4. Administrator: challenge reads
-- =============================================================================================

create function public.admin_list_challenges(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := lower(nullif(btrim(coalesce(p_filters ->> 'q', '')), ''));
  v_result jsonb;
begin
  perform public.require_admin();

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
    into v_result
  from (
    select c.id, c.slug, c.title, c.status,
           public.derive_challenge_state(c.status, c.start_at, c.end_at) as state,
           c.difficulty, c.topic_id, t.name as topic_name, cat.name as category_name,
           c.start_at, c.end_at, c.time_limit_minutes, c.target_question_count,
           c.participant_limit, c.updated_at,
           (select count(*)::integer from public.challenge_registrations r where r.challenge_id = c.id) as registrations,
           (select count(*)::integer from public.challenge_attempts a
             where a.challenge_id = c.id and a.status = 'SUBMITTED') as completed_attempts
    from public.challenges c
    left join public.topics t on t.id = c.topic_id
    left join public.categories cat on cat.id = t.category_id
    where c.deleted_at is null
      and (nullif(p_filters ->> 'status', '') is null or c.status = (p_filters ->> 'status')::public.challenge_status)
      and (nullif(p_filters ->> 'topic_id', '') is null or c.topic_id = (p_filters ->> 'topic_id')::uuid)
      and (nullif(p_filters ->> 'difficulty', '') is null or c.difficulty = (p_filters ->> 'difficulty')::public.difficulty_level)
      and (nullif(p_filters ->> 'from', '') is null or c.start_at >= (p_filters ->> 'from')::timestamptz)
      and (nullif(p_filters ->> 'to', '') is null or c.start_at <= (p_filters ->> 'to')::timestamptz)
      and (v_q is null or strpos(lower(c.title), v_q) > 0 or strpos(lower(c.slug), v_q) > 0)
    order by c.updated_at desc
    limit 300
  ) x;

  return v_result;
end;
$$;

create function public.admin_get_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.challenges%rowtype;
  v public.challenge_versions%rowtype;
  v_questions jsonb;
begin
  perform public.require_admin();

  select * into c from public.challenges where id = p_challenge_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND: The challenge does not exist.' using errcode = 'P0002';
  end if;

  -- The working version: the draft while editing, otherwise the live (frozen) version.
  select * into v from public.challenge_versions
  where challenge_id = c.id and (id = c.live_version_id or frozen_at is null)
  order by version_number desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'position', cvq.position,
           'marks', coalesce(cvq.marks, v.points_per_correct),
           'question_version_id', qv.id,
           'question_id', qv.question_id,
           'stem', qv.stem,
           'subtopic', qv.subtopic,
           'difficulty', qv.difficulty,
           'review_status', qv.review_status,
           'topic_name', t.name
         ) order by cvq.position), '[]'::jsonb)
    into v_questions
  from public.challenge_version_questions cvq
  join public.question_versions qv on qv.id = cvq.question_version_id
  left join public.topics t on t.id = qv.topic_id
  where cvq.challenge_version_id = v.id;

  return jsonb_build_object(
    'challenge', jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'title', c.title, 'description', c.description,
      'instructions', c.instructions, 'status', c.status,
      'state', public.derive_challenge_state(c.status, c.start_at, c.end_at),
      'topic_id', c.topic_id, 'difficulty', c.difficulty,
      'start_at', c.start_at, 'end_at', c.end_at,
      'time_limit_minutes', c.time_limit_minutes, 'target_question_count', c.target_question_count,
      'max_attempts', c.max_attempts, 'participant_limit', c.participant_limit,
      'points_per_correct', c.points_per_correct, 'negative_marking_enabled', c.negative_marking_enabled,
      'penalty_per_incorrect', c.penalty_per_incorrect, 'shuffle_questions', c.shuffle_questions,
      'shuffle_options', c.shuffle_options, 'result_release', c.result_release,
      'live_version_id', c.live_version_id, 'updated_at', c.updated_at,
      'registrations', (select count(*)::integer from public.challenge_registrations r where r.challenge_id = c.id),
      'attempts', (select count(*)::integer from public.challenge_attempts a where a.challenge_id = c.id)
    ),
    'working_version_id', v.id,
    'working_version_frozen', v.frozen_at is not null,
    'questions', v_questions
  );
end;
$$;

create function public.admin_challenge_participants(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.require_admin();

  if not exists (select 1 from public.challenges where id = p_challenge_id) then
    raise exception 'NOT_FOUND: The challenge does not exist.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', r.user_id,
           'display_name', coalesce(p.display_name, 'Deleted account'),
           'registered_at', r.registered_at,
           'attempts', coalesce(a.attempts, 0),
           'completed_attempts', coalesce(a.completed, 0),
           'best_score', a.best_score
         ) order by r.registered_at), '[]'::jsonb)
    into v_result
  from public.challenge_registrations r
  left join public.profiles p on p.id = r.user_id
  left join lateral (
    select count(*)::integer as attempts,
           count(*) filter (where ca.status = 'SUBMITTED')::integer as completed,
           max(s.score) as best_score
    from public.challenge_attempts ca
    left join public.attempt_scores s on s.attempt_id = ca.id
    where ca.challenge_id = p_challenge_id and ca.user_id = r.user_id
  ) a on true
  where r.challenge_id = p_challenge_id;

  return v_result;
end;
$$;

-- Analytics. Every figure is computed from persisted attempts. Definitions: docs/analytics-definitions.md.
create function public.admin_challenge_analytics(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c            public.challenges%rowtype;
  v_ver_id     uuid;
  v_registered integer;
  v_started    integer;
  v_started_u  integer;
  v_completed  integer;
  v_completers integer;
  v_avg_score  numeric;
  v_avg_pct    numeric;
  v_max        numeric := 0;
  v_dist       jsonb;
  v_questions  jsonb;
  v_topics     jsonb;
begin
  perform public.require_admin();

  select * into c from public.challenges where id = p_challenge_id;
  if not found then
    raise exception 'NOT_FOUND: The challenge does not exist.' using errcode = 'P0002';
  end if;
  v_ver_id := c.live_version_id;

  select count(*)::integer into v_registered
  from public.challenge_registrations where challenge_id = c.id;

  select count(*)::integer, count(distinct user_id)::integer
    into v_started, v_started_u
  from public.challenge_attempts
  where challenge_id = c.id;

  select count(*)::integer,
         count(distinct a.user_id)::integer,
         avg(s.score),
         avg(case when s.max_score = 0 then 0 else s.score / s.max_score * 100 end)
    into v_completed, v_completers, v_avg_score, v_avg_pct
  from public.challenge_attempts a
  join public.attempt_scores s on s.attempt_id = a.id
  where a.challenge_id = c.id and a.status = 'SUBMITTED';

  if v_ver_id is not null then
    select coalesce(sum(coalesce(cvq.marks, cv.points_per_correct)), 0) into v_max
    from public.challenge_version_questions cvq
    join public.challenge_versions cv on cv.id = cvq.challenge_version_id
    where cvq.challenge_version_id = v_ver_id;
  end if;

  select jsonb_agg(jsonb_build_object('band', b.band, 'count', coalesce(x.n, 0)) order by b.ord)
    into v_dist
  from (values (1, '0-19'), (2, '20-39'), (3, '40-59'), (4, '60-79'), (5, '80-100')) as b (ord, band)
  left join (
    select (least(greatest(floor(pct / 20)::integer, 0), 4) + 1) as ord, count(*)::integer as n
    from (
      select case when s.max_score = 0 then 0 else s.score / s.max_score * 100 end as pct
      from public.challenge_attempts a
      join public.attempt_scores s on s.attempt_id = a.id
      where a.challenge_id = c.id and a.status = 'SUBMITTED'
    ) p
    group by 1
  ) x on x.ord = b.ord;

  with submitted as (
    select a.id from public.challenge_attempts a
    where a.challenge_id = c.id and a.status = 'SUBMITTED'
  ),
  ranked as (
    select sub.id,
           ntile(2) over (order by s.score desc, a.submitted_at asc, a.id asc) as half
    from submitted sub
    join public.challenge_attempts a on a.id = sub.id
    join public.attempt_scores s on s.attempt_id = sub.id
  ),
  seen as (
    select cvq.position, cvq.question_version_id,
           count(distinct sub.id)::integer                                     as seen,
           count(ans.id) filter (where ans.selected_option_id is not null)::integer as answered,
           count(ans.id) filter (where ans.is_correct)::integer                as correct
    from public.challenge_version_questions cvq
    cross join submitted sub
    left join public.attempt_answers ans
      on ans.attempt_id = sub.id and ans.question_version_id = cvq.question_version_id
    where cvq.challenge_version_id = v_ver_id
    group by cvq.position, cvq.question_version_id
  ),
  disc as (
    select cvq.question_version_id,
           (count(*) filter (where r.half = 1 and ans.is_correct))::numeric
             / nullif(count(*) filter (where r.half = 1), 0)
           - (count(*) filter (where r.half = 2 and ans.is_correct))::numeric
             / nullif(count(*) filter (where r.half = 2), 0) as discrimination
    from public.challenge_version_questions cvq
    cross join ranked r
    left join public.attempt_answers ans
      on ans.attempt_id = r.id and ans.question_version_id = cvq.question_version_id
    where cvq.challenge_version_id = v_ver_id
    group by cvq.question_version_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', s.position,
           'question_version_id', s.question_version_id,
           'stem', qv.stem,
           'seen', s.seen,
           'answered', s.answered,
           'correct', s.correct,
           'correct_rate', case when s.seen = 0 then null else round(s.correct::numeric / s.seen, 4) end,
           'discrimination', round(d.discrimination, 4),
           'flag', case
             when s.seen < 10 then null
             when s.correct::numeric / s.seen >= 0.9 then 'TOO_EASY'
             when s.correct::numeric / s.seen <= 0.2 then 'TOO_DIFFICULT'
             when s.seen >= 20 and d.discrimination is not null and d.discrimination <= 0 then 'POSSIBLY_AMBIGUOUS'
             else null end
         ) order by s.position), '[]'::jsonb)
    into v_questions
  from seen s
  join public.question_versions qv on qv.id = s.question_version_id
  left join disc d on d.question_version_id = s.question_version_id;

  with submitted as (
    select a.id from public.challenge_attempts a
    where a.challenge_id = c.id and a.status = 'SUBMITTED'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'topic_name', x.topic_name,
           'answers', x.total,
           'correct', x.correct,
           'accuracy', case when x.total = 0 then null else round(x.correct::numeric / x.total, 4) end
         ) order by x.topic_name), '[]'::jsonb)
    into v_topics
  from (
    select coalesce(t.name, 'Uncategorised') as topic_name,
           count(*)::integer as total,
           count(ans.id) filter (where ans.is_correct)::integer as correct
    from public.challenge_version_questions cvq
    join public.question_versions qv on qv.id = cvq.question_version_id
    left join public.topics t on t.id = qv.topic_id
    cross join submitted sub
    left join public.attempt_answers ans
      on ans.attempt_id = sub.id and ans.question_version_id = cvq.question_version_id
    where cvq.challenge_version_id = v_ver_id
    group by coalesce(t.name, 'Uncategorised')
  ) x;

  return jsonb_build_object(
    'registered', v_registered,
    'started_attempts', v_started,
    'started_users', v_started_u,
    'completed_attempts', v_completed,
    'completed_users', v_completers,
    'participation_rate', case when v_registered = 0 then null
                               else round(v_started_u::numeric / v_registered, 4) end,
    'completion_rate', case when v_started = 0 then null
                            else round(v_completed::numeric / v_started, 4) end,
    'average_score', round(v_avg_score, 2),
    'average_percentage', round(v_avg_pct, 2),
    'max_score', v_max,
    'score_distribution', coalesce(v_dist, '[]'::jsonb),
    'questions', v_questions,
    'topics', v_topics
  );
end;
$$;

-- =============================================================================================
-- 5. AI generation bookkeeping (the model call itself runs in the generate-questions Edge Function)
-- =============================================================================================

create function public.admin_ai_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();

  return jsonb_build_object(
    'enabled', coalesce((select (s.value #>> '{}')::boolean from public.app_settings s where s.key = 'ai.enabled'), false),
    'max_questions_per_request', coalesce((select (s.value #>> '{}')::integer
                                             from public.app_settings s where s.key = 'ai.max_questions_per_request'), 10),
    'daily_limit', coalesce((select (s.value #>> '{}')::integer
                               from public.app_settings s where s.key = 'ai.max_generations_per_admin_per_day'), 20),
    'used_today', (select count(*)::integer from public.ai_generation_jobs j
                    where j.requested_by = auth.uid() and j.created_at > now() - interval '1 day')
  );
end;
$$;

create function public.admin_ai_begin(p_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_count  integer := nullif(p_request ->> 'count', '')::integer;
  v_job    uuid;
begin
  perform public.require_admin();
  v_status := public.admin_ai_status();

  if not (v_status ->> 'enabled')::boolean then
    raise exception 'AI_DISABLED: AI question generation is turned off. An administrator can enable it in app settings.'
      using errcode = '55000';
  end if;
  if v_count is null or v_count < 1 or v_count > (v_status ->> 'max_questions_per_request')::integer then
    raise exception 'VALIDATION: Request between 1 and % questions.', v_status ->> 'max_questions_per_request'
      using errcode = '22023';
  end if;
  if (v_status ->> 'used_today')::integer >= (v_status ->> 'daily_limit')::integer then
    raise exception 'AI_QUOTA: You have reached today''s generation limit.' using errcode = '54000';
  end if;

  insert into public.ai_generation_jobs (requested_by, status, request, requested_count, started_at)
  values (auth.uid(), 'RUNNING', p_request, v_count, now())
  returning id into v_job;

  return v_job;
end;
$$;

create function public.admin_ai_finish(
  p_job uuid, p_status text, p_produced integer, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_error_code text, p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_status not in ('SUCCEEDED', 'FAILED') then
    raise exception 'VALIDATION: Invalid job status.' using errcode = '22023';
  end if;

  update public.ai_generation_jobs
     set status = p_status::public.generation_status,
         produced_count = greatest(coalesce(p_produced, 0), 0),
         provider = left(p_provider, 60),
         model = left(p_model, 100),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         error_code = left(p_error_code, 60),
         error_message = left(p_error_message, 500),
         finished_at = now()
   where id = p_job and requested_by = auth.uid() and status = 'RUNNING';

  if not found then
    raise exception 'NOT_FOUND: That generation job is not running.' using errcode = 'P0002';
  end if;
end;
$$;

-- Records the result of the second-model "solver" pass. A solver disagreement only WARNS: it never
-- changes the answer key and never approves anything. It only moves an unapproved version to WARNING.
create function public.admin_record_solver_check(p_question_version_id uuid, p_outcome text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  qv public.question_versions%rowtype;
begin
  perform public.require_admin();
  if p_outcome not in ('PASS', 'WARN', 'SKIPPED') then
    raise exception 'VALIDATION: Invalid outcome.' using errcode = '22023';
  end if;

  select * into qv from public.question_versions where id = p_question_version_id;
  if not found then
    raise exception 'NOT_FOUND: The question version does not exist.' using errcode = 'P0002';
  end if;

  delete from public.question_validation_results
   where question_version_id = qv.id and check_name = 'MODEL_SOLVER_AGREEMENT' and source = 'AUTOMATED';

  insert into public.question_validation_results (question_version_id, source, check_name, outcome, message)
  values (qv.id, 'AUTOMATED', 'MODEL_SOLVER_AGREEMENT', p_outcome::public.validation_outcome,
          left(coalesce(p_message, ''), 1000));

  if qv.locked_at is null and qv.review_status <> 'ADMIN_APPROVED' then
    update public.question_versions
       set review_status = public.review_status_from_checks(public.question_checks(qv.id))
     where id = qv.id;
  end if;
end;
$$;

-- =============================================================================================
-- 6. Student: discovery, registration and attempts
-- =============================================================================================

create function public.student_list_challenges()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select coalesce(jsonb_agg(public.challenge_student_view(c.id) order by
           case public.derive_challenge_state(c.status, c.start_at, c.end_at)
             when 'OPEN' then 1 when 'UPCOMING' then 2 when 'COMPLETED' then 3 else 4 end,
           c.start_at nulls last, c.title), '[]'::jsonb)
    into v_result
  from public.challenges c
  where c.status in ('PUBLISHED', 'CLOSED', 'CANCELLED') and c.deleted_at is null;

  return v_result;
end;
$$;

create function public.student_challenge_detail(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
  v_view jsonb;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select c.id into v_id from public.challenges c
  where c.slug = p_slug and c.deleted_at is null
    and c.status in ('PUBLISHED', 'CLOSED', 'CANCELLED');
  if v_id is null then
    raise exception 'NOT_FOUND: That challenge does not exist.' using errcode = 'P0002';
  end if;

  v_view := public.challenge_student_view(v_id);
  return v_view || jsonb_build_object(
    'attempts', coalesce((
      select jsonb_agg(public.student_result_summary(a.id) || jsonb_build_object(
               'attempt_number', a.attempt_number, 'started_at', a.started_at) order by a.attempt_number)
      from public.challenge_attempts a
      left join public.attempt_scores s on s.attempt_id = a.id
      where a.challenge_id = v_id and a.user_id = v_uid and a.status = 'SUBMITTED'
    ), '[]'::jsonb)
  );
end;
$$;

create function public.student_register(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c     public.challenges%rowtype;
  v_state text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select * into c from public.challenges where id = p_challenge_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: That challenge does not exist.' using errcode = 'P0002';
  end if;

  v_state := public.derive_challenge_state(c.status, c.start_at, c.end_at);
  if v_state = 'NOT_PUBLISHED' then
    raise exception 'NOT_FOUND: That challenge does not exist.' using errcode = 'P0002';
  elsif v_state = 'CANCELLED' then
    raise exception 'CANCELLED: This challenge was cancelled.' using errcode = '55000';
  elsif v_state = 'COMPLETED' then
    raise exception 'ENDED: This challenge has ended.' using errcode = '55000';
  end if;

  if exists (select 1 from public.challenge_registrations
             where challenge_id = c.id and user_id = v_uid) then
    return jsonb_build_object('registered', true, 'already_registered', true);
  end if;

  select count(*)::integer into v_count
  from public.challenge_registrations where challenge_id = c.id;
  if c.participant_limit is not null and v_count >= c.participant_limit then
    raise exception 'FULL: This challenge has reached its participant limit.' using errcode = '55000';
  end if;

  insert into public.challenge_registrations (challenge_id, user_id) values (c.id, v_uid);

  return jsonb_build_object('registered', true, 'already_registered', false);
end;
$$;

create function public.student_start_attempt(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  c        public.challenges%rowtype;
  v        public.challenge_versions%rowtype;
  v_state  text;
  v_attempt uuid;
  v_count  integer;
  v_now    timestamptz := now();
  v_deadline timestamptz;
  v_order  uuid[];
  v_opts   uuid[];
  i        integer;
  v_qv     uuid;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  -- The challenge row lock serialises starts and registrations, so limits hold under concurrency.
  select * into c from public.challenges where id = p_challenge_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: That challenge does not exist.' using errcode = 'P0002';
  end if;

  v_state := public.derive_challenge_state(c.status, c.start_at, c.end_at);
  if v_state = 'NOT_PUBLISHED' then
    raise exception 'NOT_FOUND: That challenge does not exist.' using errcode = 'P0002';
  elsif v_state = 'CANCELLED' then
    raise exception 'CANCELLED: This challenge was cancelled.' using errcode = '55000';
  elsif v_state = 'COMPLETED' then
    raise exception 'ENDED: This challenge has ended.' using errcode = '55000';
  elsif v_state = 'UPCOMING' then
    raise exception 'NOT_OPEN: This challenge has not started yet.' using errcode = '55000';
  end if;

  -- Resume a running attempt instead of creating a second one (refresh, reconnect, second tab).
  select a.id into v_attempt from public.challenge_attempts a
  where a.challenge_id = c.id and a.user_id = v_uid and a.status = 'IN_PROGRESS'
  limit 1;
  if v_attempt is not null then
    return public.student_get_attempt(v_attempt);
  end if;

  if not exists (select 1 from public.challenge_registrations
                 where challenge_id = c.id and user_id = v_uid) then
    select count(*)::integer into v_count from public.challenge_registrations where challenge_id = c.id;
    if c.participant_limit is not null and v_count >= c.participant_limit then
      raise exception 'FULL: This challenge has reached its participant limit.' using errcode = '55000';
    end if;
    insert into public.challenge_registrations (challenge_id, user_id) values (c.id, v_uid);
  end if;

  select * into v from public.challenge_versions where id = c.live_version_id;

  select count(*)::integer into v_count
  from public.challenge_attempts where challenge_id = c.id and user_id = v_uid;
  if v.max_attempts is not null and v_count >= v.max_attempts then
    raise exception 'ATTEMPT_LIMIT: You have used all attempts for this challenge.' using errcode = '55000';
  end if;

  -- Effective deadline = the earlier of (start + time limit) and the challenge end.
  v_deadline := least(v_now + make_interval(mins => v.time_limit_minutes),
                      coalesce(c.end_at, v_now + make_interval(mins => v.time_limit_minutes)));

  insert into public.challenge_attempts (
    challenge_id, challenge_version_id, user_id, attempt_number, started_at, deadline_at
  )
  values (c.id, v.id, v_uid, v_count + 1, v_now, v_deadline)
  returning id into v_attempt;

  -- Question order (shuffled on the server, stored for the attempt, never recomputed).
  v_order := array(
    select cvq.question_version_id
    from public.challenge_version_questions cvq
    where cvq.challenge_version_id = v.id
    order by case when v.shuffle_questions then 0 else cvq.position end, random()
  );

  for i in 1 .. cardinality(v_order) loop
    v_qv := v_order[i];
    v_opts := array(
      select o.id from public.question_options o
      where o.question_version_id = v_qv
      order by case when v.shuffle_options then 0 else o.position end, random()
    );
    insert into public.attempt_questions (
      attempt_id, challenge_version_id, question_version_id, display_position, option_order
    )
    values (v_attempt, v.id, v_qv, i, v_opts);
  end loop;

  return public.student_get_attempt(v_attempt);
end;
$$;

create function public.student_get_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a     public.challenge_attempts%rowtype;
  v_title text;
  v_questions jsonb;
  v_answers jsonb;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select a2.* into a from public.challenge_attempts a2 where a2.id = p_attempt_id and a2.user_id = v_uid;
  if not found then
    raise exception 'NOT_FOUND: That attempt does not exist.' using errcode = 'P0002';
  end if;

  select c.title into v_title from public.challenges c where c.id = a.challenge_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'position', q.display_position,
           'question_version_id', q.question_version_id,
           'stem', qv.stem,
           'subtopic', qv.subtopic,
           'options', (
             select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'body', o.body)
                                       order by array_position(q.option_order, o.id)), '[]'::jsonb)
             from public.question_options o
             where o.id = any (q.option_order)
           )
         ) order by q.display_position), '[]'::jsonb)
    into v_questions
  from public.attempt_questions q
  join public.question_versions qv on qv.id = q.question_version_id
  where q.attempt_id = a.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'question_version_id', ans.question_version_id,
           'selected_option_id', ans.selected_option_id,
           'marked_for_review', ans.marked_for_review
         )), '[]'::jsonb)
    into v_answers
  from public.attempt_answers ans
  where ans.attempt_id = a.id;

  return jsonb_build_object(
    'attempt_id', a.id,
    'challenge_id', a.challenge_id,
    'challenge_title', v_title,
    'status', a.status,
    'started_at', a.started_at,
    'deadline_at', a.deadline_at,
    'submitted_at', a.submitted_at,
    'submitted_via', a.submitted_via,
    'server_now', now(),
    'questions', v_questions,
    'answers', v_answers
  );
end;
$$;

create function public.student_save_answer(
  p_attempt_id uuid, p_question_version_id uuid, p_option_id uuid, p_marked_for_review boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a     public.challenge_attempts%rowtype;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  -- Row lock: a save and a submit cannot interleave.
  select * into a from public.challenge_attempts where id = p_attempt_id and user_id = v_uid for update;
  if not found then
    raise exception 'NOT_FOUND: That attempt does not exist.' using errcode = 'P0002';
  end if;
  -- A closed or expired attempt is not an error the caller caused, so return it as a result.
  -- Returning (rather than raising) keeps the expiry sweep above committed.
  if a.status <> 'IN_PROGRESS' then
    return jsonb_build_object('saved', false, 'code', 'ATTEMPT_CLOSED', 'status', a.status);
  end if;

  if not exists (select 1 from public.attempt_questions q
                 where q.attempt_id = a.id and q.question_version_id = p_question_version_id) then
    raise exception 'INVALID_ANSWER: That question is not part of this attempt.' using errcode = '22023';
  end if;

  if p_option_id is not null and not exists (
    select 1 from public.attempt_questions q
    where q.attempt_id = a.id and q.question_version_id = p_question_version_id
      and p_option_id = any (q.option_order)
  ) then
    raise exception 'INVALID_ANSWER: That option does not belong to this question.' using errcode = '22023';
  end if;

  insert into public.attempt_answers (
    attempt_id, challenge_version_id, question_version_id, selected_option_id, marked_for_review, answered_at
  )
  values (
    a.id, a.challenge_version_id, p_question_version_id, p_option_id,
    coalesce(p_marked_for_review, false),
    case when p_option_id is null then null else now() end
  )
  on conflict (attempt_id, question_version_id) do update
    set selected_option_id = excluded.selected_option_id,
        marked_for_review  = excluded.marked_for_review,
        answered_at        = excluded.answered_at;

  return jsonb_build_object('saved', true, 'saved_at', now(), 'deadline_at', a.deadline_at);
end;
$$;

-- Idempotent: a second call returns the same result instead of scoring again.
create function public.student_submit_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a     public.challenge_attempts%rowtype;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select * into a from public.challenge_attempts where id = p_attempt_id and user_id = v_uid for update;
  if not found then
    raise exception 'NOT_FOUND: That attempt does not exist.' using errcode = 'P0002';
  end if;

  if a.status = 'SUBMITTED' then
    return public.student_result_summary(a.id);
  end if;

  -- Still running and inside the deadline: this is a genuine student submission.
  perform public.finalize_attempt(a.id, 'USER', now());

  return public.student_result_summary(a.id);
end;
$$;

create function public.student_get_result(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  a       public.challenge_attempts%rowtype;
  c       public.challenges%rowtype;
  v       public.challenge_versions%rowtype;
  v_state text;
  v_released boolean;
  v_summary jsonb;
  v_questions jsonb;
  v_topics jsonb;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select * into a from public.challenge_attempts where id = p_attempt_id and user_id = v_uid;
  if not found then
    raise exception 'NOT_FOUND: That attempt does not exist.' using errcode = 'P0002';
  end if;
  if a.status <> 'SUBMITTED' then
    return jsonb_build_object('attempt_id', a.id, 'status', a.status);
  end if;

  select * into c from public.challenges where id = a.challenge_id;
  select * into v from public.challenge_versions where id = a.challenge_version_id;
  v_state := public.derive_challenge_state(c.status, c.start_at, c.end_at);

  -- Release policy decides whether correct answers and explanations may be shown.
  v_released := case v.result_release
                  when 'IMMEDIATE' then true
                  when 'AFTER_CLOSE' then v_state = 'COMPLETED'
                  else false end;

  v_summary := public.student_result_summary(a.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'position', q.display_position,
           'question_version_id', q.question_version_id,
           'stem', qv.stem,
           'subtopic', qv.subtopic,
           'topic_name', t.name,
           'selected_option_id', ans.selected_option_id,
           'marked_for_review', coalesce(ans.marked_for_review, false),
           'answered', ans.selected_option_id is not null,
           'is_correct', case when v_released then ans.is_correct else null end,
           'points_awarded', case when v_released then ans.points_awarded else null end,
           'correct_option_id', case when v_released then k.correct_option_id else null end,
           'explanation', case when v_released then k.explanation else null end,
           'options', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', o.id,
                      'body', o.body,
                      'is_correct', case when v_released then o.id = k.correct_option_id else null end)
                    order by array_position(q.option_order, o.id)), '[]'::jsonb)
             from public.question_options o
             where o.id = any (q.option_order)
           )
         ) order by q.display_position), '[]'::jsonb)
    into v_questions
  from public.attempt_questions q
  join public.question_versions qv on qv.id = q.question_version_id
  left join public.topics t on t.id = qv.topic_id
  left join public.attempt_answers ans
    on ans.attempt_id = q.attempt_id and ans.question_version_id = q.question_version_id
  left join public.question_answer_keys k on k.question_version_id = q.question_version_id
  where q.attempt_id = a.id;

  -- Topic-wise performance is aggregate data about the student's own attempt. It reveals no key.
  select coalesce(jsonb_agg(jsonb_build_object(
           'topic_name', x.topic_name,
           'total', x.total,
           'correct', x.correct,
           'incorrect', x.incorrect,
           'unanswered', x.unanswered,
           'accuracy', case when x.total = 0 then null else round(x.correct::numeric / x.total * 100, 2) end
         ) order by x.topic_name), '[]'::jsonb)
    into v_topics
  from (
    select coalesce(t.name, 'Uncategorised') as topic_name,
           count(*)::integer as total,
           count(*) filter (where ans.is_correct)::integer as correct,
           count(*) filter (where ans.selected_option_id is not null and ans.is_correct is not true)::integer as incorrect,
           count(*) filter (where ans.selected_option_id is null)::integer as unanswered
    from public.attempt_questions q
    join public.question_versions qv on qv.id = q.question_version_id
    left join public.topics t on t.id = qv.topic_id
    left join public.attempt_answers ans
      on ans.attempt_id = q.attempt_id and ans.question_version_id = q.question_version_id
    where q.attempt_id = a.id
    group by coalesce(t.name, 'Uncategorised')
  ) x;

  return jsonb_build_object(
    'attempt_id', a.id,
    'status', a.status,
    'released', v_released,
    'release_policy', v.result_release,
    'challenge', jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'state', v_state),
    'summary', v_summary,
    'questions', v_questions,
    'topics', v_topics
  );
end;
$$;

create function public.student_my_attempts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select coalesce(jsonb_agg(jsonb_build_object(
           'attempt_id', a.id,
           'challenge_id', c.id,
           'challenge_slug', c.slug,
           'challenge_title', c.title,
           'attempt_number', a.attempt_number,
           'status', a.status,
           'started_at', a.started_at,
           'submitted_at', a.submitted_at,
           'submitted_via', a.submitted_via,
           'score', s.score,
           'max_score', s.max_score,
           'percentage', case when s.max_score is null or s.max_score = 0 then null
                              else round(s.score / s.max_score * 100, 2) end,
           'correct_count', s.correct_count,
           'time_taken_seconds', s.time_taken_seconds
         ) order by a.started_at desc), '[]'::jsonb)
    into v_result
  from public.challenge_attempts a
  join public.challenges c on c.id = a.challenge_id
  left join public.attempt_scores s on s.attempt_id = a.id
  where a.user_id = v_uid
  limit 200;

  return v_result;
end;
$$;

-- Live leaderboard: the best FINALIZED attempt of each participant. Ties break on the earlier submission,
-- then on attempt id, so the order is fully deterministic. Only participants (or administrators) may view it.
create function public.student_leaderboard(p_challenge_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  c       public.challenges%rowtype;
  v_state text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_total integer;
  v_entries jsonb;
  v_me    integer;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select * into c from public.challenges where id = p_challenge_id and deleted_at is null;
  if not found or c.status not in ('PUBLISHED', 'CLOSED', 'CANCELLED') then
    raise exception 'NOT_FOUND: That challenge does not exist.' using errcode = 'P0002';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.challenge_registrations r where r.challenge_id = c.id and r.user_id = v_uid
  ) then
    raise exception 'FORBIDDEN: Only participants can view this leaderboard.' using errcode = '42501';
  end if;

  v_state := public.derive_challenge_state(c.status, c.start_at, c.end_at);

  with best as (
    select distinct on (a.user_id)
           a.user_id, a.id as attempt_id, s.score, s.max_score, s.correct_count, a.submitted_at
    from public.challenge_attempts a
    join public.attempt_scores s on s.attempt_id = a.id
    where a.challenge_id = c.id and a.status = 'SUBMITTED' and a.user_id is not null
    order by a.user_id, s.score desc, a.submitted_at asc, a.id asc
  ),
  ranked as (
    select b.*,
           row_number() over (order by b.score desc, b.submitted_at asc, b.attempt_id asc) as rnk
    from best b
  )
  select count(*)::integer,
         max(case when r.user_id = v_uid then r.rnk end),
         coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rnk,
           'display_name', coalesce(p.display_name, 'Student'),
           'score', r.score,
           'max_score', r.max_score,
           'correct_count', r.correct_count,
           'submitted_at', r.submitted_at,
           'is_me', r.user_id = v_uid
         ) order by r.rnk) filter (where r.rnk <= v_limit), '[]'::jsonb)
    into v_total, v_me, v_entries
  from ranked r
  left join public.profiles p on p.id = r.user_id;

  return jsonb_build_object(
    'challenge', jsonb_build_object('id', c.id, 'title', c.title, 'state', v_state),
    'final', v_state = 'COMPLETED',
    'total_ranked', v_total,
    'my_rank', v_me,
    'server_now', now(),
    'entries', v_entries
  );
end;
$$;

-- =============================================================================================
-- 7. Row level security and grants for the new tables
-- =============================================================================================

alter table public.challenge_registrations enable row level security;
alter table public.attempt_questions       enable row level security;

grant select on public.challenge_registrations to authenticated;

create policy "challenge_registrations: read own"
  on public.challenge_registrations for select to authenticated
  using (user_id = (select auth.uid()));

create policy "challenge_registrations: admins read all"
  on public.challenge_registrations for select to authenticated
  using ((select public.is_admin()));

grant select on public.attempt_questions to authenticated;

create policy "attempt_questions: read own"
  on public.attempt_questions for select to authenticated
  using (exists (
    select 1 from public.challenge_attempts a
    where a.id = attempt_questions.attempt_id and a.user_id = (select auth.uid())
  ));

create policy "attempt_questions: admins read all"
  on public.attempt_questions for select to authenticated
  using ((select public.is_admin()));

-- Answers: students may read their own selections and metadata, but NOT is_correct or points_awarded.
-- Those columns reveal the answer key (correct/incorrect for each option chosen) before release.
-- Results are released only through student_get_result(), which applies the release policy.
revoke select on public.attempt_answers from authenticated;
grant select (id, attempt_id, challenge_version_id, question_version_id, selected_option_id,
              marked_for_review, answered_at, updated_at)
  on public.attempt_answers to authenticated;

-- =============================================================================================
-- 8. Browser-callable functions (the complete Phase 2 allow-list)
-- =============================================================================================

revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_overview_stats() to authenticated;

grant execute on function public.admin_list_challenges(jsonb) to authenticated;
grant execute on function public.admin_get_challenge(uuid) to authenticated;
grant execute on function public.admin_save_challenge(uuid, jsonb) to authenticated;
grant execute on function public.admin_set_challenge_questions(uuid, jsonb) to authenticated;
grant execute on function public.admin_publish_challenge(uuid) to authenticated;
grant execute on function public.admin_transition_challenge(uuid, text) to authenticated;
grant execute on function public.admin_challenge_participants(uuid) to authenticated;
grant execute on function public.admin_challenge_analytics(uuid) to authenticated;

grant execute on function public.admin_list_questions(jsonb) to authenticated;
grant execute on function public.admin_get_question(uuid) to authenticated;
grant execute on function public.admin_save_question(uuid, jsonb) to authenticated;
grant execute on function public.admin_approve_question(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_question(uuid) to authenticated;

grant execute on function public.admin_ai_status() to authenticated;
grant execute on function public.admin_ai_begin(jsonb) to authenticated;
grant execute on function public.admin_ai_finish(uuid, text, integer, text, text, integer, integer, text, text) to authenticated;
grant execute on function public.admin_record_solver_check(uuid, text, text) to authenticated;

grant execute on function public.student_list_challenges() to authenticated;
grant execute on function public.student_challenge_detail(text) to authenticated;
grant execute on function public.student_register(uuid) to authenticated;
grant execute on function public.student_start_attempt(uuid) to authenticated;
grant execute on function public.student_get_attempt(uuid) to authenticated;
grant execute on function public.student_save_answer(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.student_submit_attempt(uuid) to authenticated;
grant execute on function public.student_get_result(uuid) to authenticated;
grant execute on function public.student_my_attempts() to authenticated;
grant execute on function public.student_leaderboard(uuid, integer) to authenticated;
