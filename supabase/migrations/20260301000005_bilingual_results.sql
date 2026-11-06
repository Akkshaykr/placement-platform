-- Bilingual: results show approved Tamil text for Tamil attempts, with English as the fallback.

create or replace function public.student_get_result(p_attempt_id uuid)
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
           'stem', coalesce(tr.stem, qv.stem),
           'subtopic', coalesce(tr.subtopic, qv.subtopic),
           'topic_name', t.name,
           'selected_option_id', ans.selected_option_id,
           'marked_for_review', coalesce(ans.marked_for_review, false),
           'answered', ans.selected_option_id is not null,
           'is_correct', case when v_released then ans.is_correct else null end,
           'points_awarded', case when v_released then ans.points_awarded else null end,
           'correct_option_id', case when v_released then k.correct_option_id else null end,
           'explanation', case when v_released
                               then coalesce(nullif(tr.explanation, ''), k.explanation)
                               else null end,
           'options', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', o.id,
                      'body', case when tr.question_version_id is not null
                                   then coalesce(ot.body, o.body) else o.body end,
                      'is_correct', case when v_released then o.id = k.correct_option_id else null end)
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
  left join public.question_translations tr
    on tr.question_version_id = q.question_version_id
   and tr.language = a.language
   and tr.status = 'APPROVED'
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
    'language', a.language,
    'released', v_released,
    'release_policy', v.result_release,
    'challenge', jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'state', v_state),
    'summary', v_summary,
    'questions', v_questions,
    'topics', v_topics
  );
end;
$$;