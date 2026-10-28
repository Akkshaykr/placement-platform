-- Phase 1 / migration 3: profiles, roles, signup trigger, admin bootstrap.
--
-- Role model
--   * Every account gets USER automatically (trigger below).
--   * ADMIN can only be granted by a trusted operation: the SQL editor / `postgres` role or the
--     service role calling grant_admin_role(). There is NO client-writable path to user_roles.
--   * Roles are never derived from user-editable data (raw_user_meta_data).

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 60 and display_name !~ '[\r\n\t]'),
  -- Only Google-hosted avatars are accepted for now. Other hosts would let a user make
  -- other users' browsers fetch an arbitrary URL. Relax this when avatar uploads exist.
  avatar_url   text
    check (avatar_url is null or (char_length(avatar_url) <= 500
           and avatar_url ~ '^https://[a-z0-9-]+\.googleusercontent\.com/')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index user_roles_role_idx on public.user_roles (role);

-- SECURITY DEFINER so that policies on other tables can call it without recursing into the
-- RLS policies of user_roles. search_path is pinned so it cannot be hijacked.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = 'ADMIN'
  );
$$;

-- Creates the profile and the default USER role for every new auth user.
-- Reads display name / avatar from provider metadata, which is user-controlled,
-- so everything is sanitised and nothing here can influence roles.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text;
  v_avatar text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'Student'
  );
  v_name := regexp_replace(v_name, '[\r\n\t]+', ' ', 'g');
  v_name := coalesce(nullif(btrim(left(v_name, 60)), ''), 'Student');

  v_avatar := new.raw_user_meta_data ->> 'avatar_url';
  if v_avatar is null
     or char_length(v_avatar) > 500
     or v_avatar !~ '^https://[a-z0-9-]+\.googleusercontent\.com/' then
    v_avatar := null;
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_name, v_avatar);

  insert into public.user_roles (user_id, role)
  values (new.id, 'USER');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trusted operation: grant ADMIN. Run from the Supabase SQL editor (postgres role) or the
-- service role only. Requires a CONFIRMED email so that nobody can pre-register an
-- administrator's address and inherit the role once the real owner is added.
create function public.grant_admin_role(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid;
  v_confirmed timestamptz;
begin
  select u.id, u.email_confirmed_at
    into v_user, v_confirmed
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;

  if v_user is null then
    raise exception 'No account exists for that email. Register it first, then run this again.'
      using errcode = 'P0002';
  end if;

  if v_confirmed is null then
    raise exception 'That account has not confirmed its email address yet.'
      using errcode = '55000';
  end if;

  insert into public.user_roles (user_id, role, granted_by)
  values (v_user, 'ADMIN', null)
  on conflict (user_id, role) do nothing;

  if found then
    insert into public.audit_logs (actor_id, actor_kind, action, entity_type, entity_id, after_data)
    values (null, 'SYSTEM', 'role.grant', 'user_roles', v_user::text,
            jsonb_build_object('role', 'ADMIN'));
  end if;

  return v_user;
end;
$$;

-- Trusted operation: remove ADMIN. Refuses to remove the last administrator.
create function public.revoke_admin_role(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_admins integer;
begin
  select u.id into v_user
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;

  if v_user is null then
    raise exception 'No account exists for that email.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.user_roles where user_id = v_user and role = 'ADMIN') then
    return v_user;
  end if;

  select count(*) into v_admins from public.user_roles where role = 'ADMIN';
  if v_admins <= 1 then
    raise exception 'Refusing to remove the last administrator.' using errcode = '55000';
  end if;

  delete from public.user_roles where user_id = v_user and role = 'ADMIN';

  insert into public.audit_logs (actor_id, actor_kind, action, entity_type, entity_id, before_data)
  values (null, 'SYSTEM', 'role.revoke', 'user_roles', v_user::text,
          jsonb_build_object('role', 'ADMIN'));

  return v_user;
end;
$$;

revoke all on function public.grant_admin_role(text) from public, anon, authenticated;
revoke all on function public.revoke_admin_role(text) from public, anon, authenticated;
grant execute on function public.grant_admin_role(text) to service_role;
grant execute on function public.revoke_admin_role(text) to service_role;
