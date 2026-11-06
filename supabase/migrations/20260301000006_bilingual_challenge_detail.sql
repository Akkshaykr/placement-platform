-- Bilingual: the student challenge detail says which languages are offered and whether Tamil is ready.

create or replace function public.student_challenge_detail(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
  v_view jsonb;
  v_langs text[];
  v_live uuid;
  v_ta_ready boolean;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Sign in required.' using errcode = '42501';
  end if;
  perform public.finalize_expired_attempts();

  select c.id, c.languages, c.live_version_id into v_id, v_langs, v_live
  from public.challenges c
  where c.slug = p_slug and c.deleted_at is null
    and c.status in ('PUBLISHED', 'CLOSED', 'CANCELLED');
  if v_id is null then
    raise exception 'NOT_FOUND: That challenge does not exist.' using errcode = 'P0002';
  end if;

  -- Tamil is offered only if the challenge allows it and every question has an approved translation.
  v_ta_ready :=
    'ta' = any (v_langs)
    and v_live is not null
    and exists (select 1 from public.challenge_version_questions cvq where cvq.challenge_version_id = v_live)
    and not exists (
      select 1 from public.challenge_version_questions cvq
      where cvq.challenge_version_id = v_live
        and not public.question_ready_in(cvq.question_version_id, 'ta')
    );

  v_view := public.challenge_student_view(v_id);
  return v_view || jsonb_build_object(
    'languages', to_jsonb(v_langs),
    'tamil_ready', v_ta_ready,
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