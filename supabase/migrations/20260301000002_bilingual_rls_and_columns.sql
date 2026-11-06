-- Bilingual (English + Tamil): RLS, grants, language columns and readiness helper.

-- 1. Translation tables: RLS on, admins read only. Writes stay with trusted/service code.
alter table public.question_translations        enable row level security;
alter table public.question_option_translations enable row level security;

grant select on public.question_translations        to authenticated;
grant select on public.question_option_translations to authenticated;

create policy "question_translations: admins read"
  on public.question_translations for select to authenticated
  using ((select public.is_admin()));

create policy "question_option_translations: admins read"
  on public.question_option_translations for select to authenticated
  using ((select public.is_admin()));

-- 2. Challenges: which languages are offered. English is always included.
alter table public.challenges
  add column languages text[] not null default '{en}',
  add constraint challenges_languages_ck
    check (languages <@ array['en', 'ta']::text[] and 'en' = any (languages));

-- 3. Attempts: the language the student chose. Defaults to English.
alter table public.challenge_attempts
  add column language text not null default 'en',
  add constraint attempts_language_ck check (language in ('en', 'ta'));

-- 4. A question is ready in English always, and in Tamil only once an approved translation exists.
create function public.question_ready_in(p_question_version_id uuid, p_language text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_language = 'en' then true
    else exists (
      select 1
      from public.question_translations t
      where t.question_version_id = p_question_version_id
        and t.language = p_language
        and t.status = 'APPROVED'
    )
  end;
$$;

-- Internal helper: not exposed to browser roles.
revoke all on function public.question_ready_in(uuid, text) from public, anon, authenticated;