-- Bilingual: admin_get_question returns the saved Tamil translation of the latest version.

create or replace function public.admin_get_question(p_question_id uuid)
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
  v_ta      jsonb;
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

  select jsonb_build_object(
           'status', t.status,
           'source', t.source,
           'stem', t.stem,
           'subtopic', t.subtopic,
           'explanation', t.explanation,
           'reviewed_at', t.reviewed_at,
           'options', coalesce((
             select jsonb_agg(coalesce(ot.body, '') order by o.position)
             from public.question_options o
             left join public.question_option_translations ot
               on ot.option_id = o.id and ot.language = 'ta'
             where o.question_version_id = lv.id
           ), '[]'::jsonb)
         )
    into v_ta
  from public.question_translations t
  where t.question_version_id = lv.id and t.language = 'ta';

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
    'checks', public.question_checks(lv.id),
    'tamil', v_ta
  );
end;
$$;