-- Phase 1 / migration 6: bookmarks and feedback / error reports.

create table public.bookmarks (
  user_id     uuid not null references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index bookmarks_question_idx on public.bookmarks (question_id);

create table public.feedback_reports (
  id                  uuid primary key default gen_random_uuid(),
  -- Defaults to the caller. The browser is not granted the right to set it.
  reporter_id         uuid default auth.uid() references auth.users (id) on delete set null,
  kind                public.report_kind not null,
  challenge_id        uuid references public.challenges (id) on delete restrict,
  question_version_id uuid references public.question_versions (id) on delete restrict,
  rating              smallint check (rating between 1 and 5),
  message             text not null check (char_length(btrim(message)) between 1 and 2000),
  status              public.report_status not null default 'OPEN',
  admin_response      text check (char_length(admin_response) <= 2000),
  resolved_by         uuid references auth.users (id) on delete set null,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint feedback_question_error_target_ck
    check (kind <> 'QUESTION_ERROR' or question_version_id is not null),
  constraint feedback_rating_target_ck
    check (rating is null or challenge_id is not null),
  constraint feedback_resolution_ck
    check ((status = 'OPEN') = (resolved_at is null))
);

create index feedback_reports_status_idx on public.feedback_reports (status, created_at desc);
create index feedback_reports_reporter_idx on public.feedback_reports (reporter_id, created_at desc);

create trigger feedback_reports_set_updated_at
  before update on public.feedback_reports
  for each row execute function public.set_updated_at();

-- Abuse limit, configurable through app_settings (feedback.max_reports_per_user_per_hour).
create function public.enforce_feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  select coalesce((s.value #>> '{}')::integer, 10)
    into v_limit
  from public.app_settings s
  where s.key = 'feedback.max_reports_per_user_per_hour';

  v_limit := coalesce(v_limit, 10);

  if new.reporter_id is not null then
    select count(*) into v_count
    from public.feedback_reports f
    where f.reporter_id = new.reporter_id
      and f.created_at > now() - interval '1 hour';

    if v_count >= v_limit then
      raise exception 'RATE_LIMITED: too many reports submitted. Try again later.'
        using errcode = '54000';
    end if;
  end if;

  return new;
end;
$$;

create trigger feedback_reports_rate_limit
  before insert on public.feedback_reports
  for each row execute function public.enforce_feedback_rate_limit();

-- Resolution bookkeeping is set by the database so an admin cannot forge it from the client.
create function public.stamp_feedback_resolution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'OPEN' then
      new.resolved_at := null;
      new.resolved_by := null;
    else
      new.resolved_at := now();
      new.resolved_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create trigger feedback_reports_stamp_resolution
  before update on public.feedback_reports
  for each row execute function public.stamp_feedback_resolution();
