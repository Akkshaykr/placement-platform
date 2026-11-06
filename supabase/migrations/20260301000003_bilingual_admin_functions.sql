-- Bilingual: admin functions to save and approve Tamil translations.

create function public.admin_save_translation(p_question_version_id uuid, p_language text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stem        text := btrim(coalesce(p_data ->> 'stem', ''));
  v_subtopic    text := nullif(btrim(coalesce(p_data ->> 'subtopic', '')), '');
  v_explanation text := btrim(coalesce(p_data ->> 'explanation', ''));
  v_source      text := coalesce(nullif(p_data ->> 'source', ''), 'HUMAN');
  v_bodies      text[];
  v_option_ids  uuid[];
  i             integer;
begin
  perform public.require_admin();

  if p_language is distinct from 'ta' then
    raise exception 'VALIDATION: Only Tamil (ta) translations are supported.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.question_versions qv where qv.id = p_question_version_id) then
    raise exception 'VALIDATION: The question version does not exist.' using errcode = '22023';
  end if;
  if char_length(v_stem) < 5 or char_length(v_stem) > 4000 then
    raise exception 'VALIDATION: The translated question text must be 5 to 4000 characters.' using errcode = '22023';
  end if;
  if char_length(v_explanation) > 8000 then
    raise exception 'VALIDATION: The translated explanation must be at most 8000 characters.' using errcode = '22023';
  end if;
  if v_source not in ('HUMAN', 'AI_DRAFT') then
    raise exception 'VALIDATION: Unknown translation source.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data -> 'options') is distinct from 'array' then
    raise exception 'VALIDATION: Options must be provided as a list.' using errcode = '22023';
  end if;

  v_bodies := array(select jsonb_array_elements_text(p_data -> 'options'));
  v_option_ids := array(
    select o.id from public.question_options o
    where o.question_version_id = p_question_version_id
    order by o.position
  );
  if cardinality(v_bodies) <> cardinality(v_option_ids) then
    raise exception 'VALIDATION: Provide exactly one translated option for each English option (%).', cardinality(v_option_ids)
      using errcode = '22023';
  end if;
  for i in 1 .. cardinality(v_bodies) loop
    if char_length(btrim(v_bodies[i])) = 0 or char_length(v_bodies[i]) > 1000 then
      raise exception 'VALIDATION: Translated option % must be 1 to 1000 characters.', i using errcode = '22023';
    end if;
  end loop;

  insert into public.question_translations
    (question_version_id, language, stem, subtopic, explanation, status, source, reviewed_by, reviewed_at)
  values
    (p_question_version_id, p_language, v_stem, v_subtopic, v_explanation, 'NEEDS_REVIEW', v_source, null, null)
  on conflict (question_version_id, language) do update
    set stem        = excluded.stem,
        subtopic    = excluded.subtopic,
        explanation = excluded.explanation,
        status      = 'NEEDS_REVIEW',
        source      = excluded.source,
        reviewed_by = null,
        reviewed_at = null;

  for i in 1 .. cardinality(v_option_ids) loop
    insert into public.question_option_translations (option_id, language, body)
    values (v_option_ids[i], p_language, btrim(v_bodies[i]))
    on conflict (option_id, language) do update set body = excluded.body;
  end loop;

  return jsonb_build_object(
    'question_version_id', p_question_version_id,
    'language', p_language,
    'status', 'NEEDS_REVIEW'
  );
end;
$$;

create function public.admin_approve_translation(p_question_version_id uuid, p_language text, p_approve boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total      integer;
  v_translated integer;
  v_status     text;
begin
  perform public.require_admin();

  if not exists (
    select 1 from public.question_translations t
    where t.question_version_id = p_question_version_id and t.language = p_language
  ) then
    raise exception 'VALIDATION: There is no translation to review for this question.' using errcode = '22023';
  end if;

  if p_approve then
    select count(*) into v_total
    from public.question_options o where o.question_version_id = p_question_version_id;
    select count(*) into v_translated
    from public.question_options o
    join public.question_option_translations ot on ot.option_id = o.id and ot.language = p_language
    where o.question_version_id = p_question_version_id;
    if v_translated <> v_total then
      raise exception 'VALIDATION: Every option must be translated before approval.' using errcode = '22023';
    end if;

    update public.question_translations
       set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
     where question_version_id = p_question_version_id and language = p_language;
    v_status := 'APPROVED';
  else
    update public.question_translations
       set status = 'NEEDS_REVIEW', reviewed_by = null, reviewed_at = null
     where question_version_id = p_question_version_id and language = p_language;
    v_status := 'NEEDS_REVIEW';
  end if;

  return jsonb_build_object(
    'question_version_id', p_question_version_id,
    'language', p_language,
    'status', v_status
  );
end;
$$;

revoke all on function public.admin_save_translation(uuid, text, jsonb) from public, anon;
revoke all on function public.admin_approve_translation(uuid, text, boolean) from public, anon;
grant execute on function public.admin_save_translation(uuid, text, jsonb) to authenticated;
grant execute on function public.admin_approve_translation(uuid, text, boolean) to authenticated;