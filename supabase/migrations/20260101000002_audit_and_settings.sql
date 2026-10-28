-- Phase 1 / migration 2: append-only audit log and platform settings.

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- Deliberately no foreign key: the log must outlive the account it describes.
  actor_id    uuid,
  actor_kind  text not null check (actor_kind in ('ADMIN', 'USER', 'SYSTEM')),
  action      text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 60),
  entity_id   text,
  before_data jsonb,
  after_data  jsonb,
  metadata    jsonb not null default '{}'::jsonb
);

create index audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id) where actor_id is not null;

create function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '55000';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.prevent_audit_mutation();

create table public.app_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]+$'),
  value       jsonb not null,
  description text,
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- Conservative defaults. AI generation stays off until an admin enables it
-- (cost control: see docs/costs-and-limits.md).
insert into public.app_settings (key, value, description) values
  ('ai.enabled', 'false'::jsonb, 'Master switch for AI question generation.'),
  ('ai.max_questions_per_request', '10'::jsonb, 'Upper bound on questions requested in one generation.'),
  ('ai.max_generations_per_admin_per_day', '20'::jsonb, 'Daily generation quota per admin.'),
  ('feedback.max_reports_per_user_per_hour', '10'::jsonb, 'Abuse limit on feedback and error reports.');
