-- Bilingual: students choose a language when starting an attempt; Tamil text is served for 'ta' attempts.

drop function public.student_start_attempt(uuid);

create function public.student_start_attempt(p_challenge_id uuid, p_language text default 'en')
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
  if p_language is null or p_language not in ('en', 'ta') then
    raise exception 'VALIDATION: Choose English or Tamil.' using errcode = '22023';
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

  if not (p_language = any (c.languages)) then
    raise exception 'VALIDATION: This challenge is not available in the chosen language.' using errcode = '22023';
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

  if exists (
    select 1 from public.challenge_version_questions cvq
    where cvq.challenge_version_id = v.id
      and not public.question_ready_in(cvq.question_version_id, p_language)
  ) then
    raise exception 'VALIDATION: Not every question is available in the chosen language yet.' using errcode = '22023';
  end if;

  select count(*)::integer into v_count
  from public.challenge_attempts where challenge_id = c.id and user_id = v_uid;
  if v.max_attempts is not null and v_count >= v.max_attempts then
    raise exception 'ATTEMPT_LIMIT: You have used all attempts for this challenge.' using errcode = '55000';
  end if;

  -- Effective deadline = the earlier of (start + time limit) and the challenge end.
  v_deadline := least(v_now + make_interval(mins => v.time_limit_minutes),
                      coalesce(c.end_at, v_now + make_interval(mins => v.time_limit_minutes)));

  insert into public.challenge_attempts (
    challenge_id, challenge_version_id, user_id, attempt_number, started_at, deadline_at, language
  )
  values (c.id, v.id, v_uid, v_count + 1, v_now, v_deadline, p_language)
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

revoke all on function public.student_start_attempt(uuid, text) from public, anon;
grant execute on function public.student_start_attempt(uuid, text) to authenticated;

create or replace function public.student_get_attempt(p_attempt_id uuid)
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

  -- Tamil text only when the attempt is Tamil AND the translation is approved; otherwise English.
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', q.display_position,
           'question_version_id', q.question_version_id,
           'stem', coalesce(t.stem, qv.stem),
           'subtopic', coalesce(t.subtopic, qv.subtopic),
           'options', (
             select coalesce(jsonb_agg(jsonb_build_object(
                                         'id', o.id,
                                         'body', case when t.question_version_id is not null
                                                      then coalesce(ot.body, o.body) else o.body end)
                                       order by array_position(q.option_order, o.id)), '[]'::jsonb)
             from public.question_options o
             left join public.question_option_translations ot
               on ot.option_id = o.id and ot.language = a.language
             where o.id = any (q.option_order)
           )
         ) order by q.display_position), '[]'::jsonb)
    into v_questions
  from public.attempt_questions q
  join public.question_versions qv on qv.id = q.question_version_id
  left join public.question_translations t
    on t.question_version_id = q.question_version_id
   and t.language = a.language
   and t.status = 'APPROVED'
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
    'language', a.language,
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