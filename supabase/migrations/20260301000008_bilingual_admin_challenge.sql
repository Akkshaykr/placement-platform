-- Bilingual: challenges choose which languages they offer; the admin read-out shows Tamil readiness.

create or replace function public.admin_save_challenge(p_id uuid, p_data jsonb)
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
  v_langs          text[];
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

  -- Languages: optional. English is always offered; only English and Tamil exist.
  if jsonb_typeof(p_data -> 'languages') = 'array' then
    if exists (
      select 1 from jsonb_array_elements_text(p_data -> 'languages') as t(x) where x not in ('en', 'ta')
    ) then
      raise exception 'VALIDATION: Languages can only be English and Tamil.' using errcode = '22023';
    end if;
    v_langs := array(
      select s.x from (
        select x from jsonb_array_elements_text(p_data -> 'languages') as t(x)
        union
        select 'en'
      ) s order by s.x
    );
  end if;

  if p_id is null then
    insert into public.challenges (
      slug, title, description, instructions, topic_id, difficulty, start_at, end_at,
      time_limit_minutes, target_question_count, max_attempts, participant_limit,
      points_per_correct, negative_marking_enabled, penalty_per_incorrect,
      shuffle_questions, shuffle_options, result_release, languages, created_by, updated_by
    )
    values (
      v_slug, v_title, v_description, v_instructions, v_topic, v_difficulty, v_start, v_end,
      v_limit, v_target, v_max_attempts, v_participants,
      v_points, v_neg, v_penalty,
      v_shuffle_q, v_shuffle_o, v_release, coalesce(v_langs, array['en']), auth.uid(), auth.uid()
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
           languages = coalesce(v_langs, c.languages),
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

create or replace function public.admin_get_challenge(p_challenge_id uuid)
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
           'topic_name', t.name,
           'tamil_ready', public.question_ready_in(qv.id, 'ta')
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
      'languages', to_jsonb(c.languages),
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