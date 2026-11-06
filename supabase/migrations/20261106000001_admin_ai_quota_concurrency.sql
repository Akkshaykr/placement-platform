-- Serialize AI quota reservations per administrator.
-- Recheck usage after acquiring the lock so concurrent requests
-- cannot both reserve the final available quota slot.

create or replace function public.admin_ai_begin(p_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := nullif(p_request ->> 'count', '')::integer;
  v_enabled boolean;
  v_max_questions integer;
  v_daily_limit integer;
  v_used_today integer;
  v_job uuid;
begin
  perform public.require_admin();

  -- Serialize quota checks for this administrator.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('admin_ai_quota'),
    pg_catalog.hashtext(auth.uid()::text)
  );

  -- Read settings after acquiring the lock.
  select
    coalesce((
      select (s.value #>> '{}')::boolean
      from public.app_settings s
      where s.key = 'ai.enabled'
    ), false),
    coalesce((
      select (s.value #>> '{}')::integer
      from public.app_settings s
      where s.key = 'ai.max_questions_per_request'
    ), 10),
    coalesce((
      select (s.value #>> '{}')::integer
      from public.app_settings s
      where s.key = 'ai.max_generations_per_admin_per_day'
    ), 20)
  into v_enabled, v_max_questions, v_daily_limit;

  -- Count jobs after acquiring the lock.
  select count(*)::integer
    into v_used_today
    from public.ai_generation_jobs j
   where j.requested_by = auth.uid()
     and j.created_at > now() - interval '1 day';

  if not v_enabled then
    raise exception 'AI_DISABLED: AI question generation is turned off. An administrator can enable it in app settings.'
      using errcode = '55000';
  end if;

  if v_count is null or v_count < 1 or v_count > v_max_questions then
    raise exception 'VALIDATION: Request between 1 and % questions.', v_max_questions
      using errcode = '22023';
  end if;

  if v_used_today >= v_daily_limit then
    raise exception 'AI_QUOTA: You have reached today''s generation limit.'
      using errcode = '54000';
  end if;

  insert into public.ai_generation_jobs (
    requested_by,
    status,
    request,
    requested_count,
    started_at
  )
  values (
    auth.uid(),
    'RUNNING',
    p_request,
    v_count,
    now()
  )
  returning id into v_job;

  return v_job;
end;
$$;

-- CREATE OR REPLACE preserves the existing function's permissions.