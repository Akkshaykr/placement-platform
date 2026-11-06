create table public.question_translations (
  question_version_id uuid not null references public.question_versions (id) on delete cascade,
  language            text not null,
  stem                text not null,
  subtopic            text,
  explanation         text not null default '',
  status              text not null default 'DRAFT',
  source              text not null default 'HUMAN',
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  primary key (question_version_id, language),
  constraint question_translations_language_ck check (language = 'ta'),
  constraint question_translations_stem_ck check (char_length(btrim(stem)) between 5 and 4000),
  constraint question_translations_explanation_ck check (char_length(explanation) <= 8000),
  constraint question_translations_status_ck check (status in ('DRAFT', 'NEEDS_REVIEW', 'APPROVED')),
  constraint question_translations_source_ck check (source in ('HUMAN', 'AI_DRAFT')),
  constraint question_translations_review_ck
    check (status <> 'APPROVED' or (reviewed_by is not null and reviewed_at is not null))
);

create table public.question_option_translations (
  option_id uuid not null references public.question_options (id) on delete cascade,
  language  text not null,
  body      text not null,
  primary key (option_id, language),
  constraint question_option_translations_language_ck check (language = 'ta'),
  constraint question_option_translations_body_ck check (char_length(btrim(body)) between 1 and 1000)
);