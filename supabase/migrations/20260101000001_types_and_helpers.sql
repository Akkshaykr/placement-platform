-- Phase 1 / migration 1: enum types and shared helpers.
--
-- Security baseline for every later migration:
--   * New functions in `public` are NOT executable by PUBLIC, anon or authenticated by default.
--     Each function that the browser may call must be granted explicitly in the API-surface migration.
--   * New tables in `public` get NO default privileges for anon/authenticated.
--     Every table must be granted explicitly, and must have row level security enabled.
-- This makes access an explicit, reviewable decision instead of a side effect of Supabase defaults.

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create type public.app_role as enum ('USER', 'ADMIN');

create type public.difficulty_level as enum ('EASY', 'MEDIUM', 'HARD');

-- Lifecycle: DRAFT -> GENERATING -> REVIEW_REQUIRED -> VALIDATED -> PUBLISHED -> CLOSED -> ARCHIVED
-- plus GENERATION_FAILED and REJECTED for failed generation / rejected content.
create type public.challenge_status as enum (
  'DRAFT', 'GENERATING', 'GENERATION_FAILED', 'REVIEW_REQUIRED', 'VALIDATED',
  'REJECTED', 'PUBLISHED', 'CLOSED', 'ARCHIVED'
);

-- Per-question review state shown to the admin.
-- AUTO_PASSED means "passed automated checks". It is not proof of correctness.
create type public.question_review_status as enum (
  'DRAFT', 'AUTO_PASSED', 'WARNING', 'FAILED', 'ADMIN_APPROVED', 'REJECTED'
);

create type public.question_origin as enum ('MANUAL', 'AI');
create type public.attempt_status as enum ('IN_PROGRESS', 'SUBMITTED');
create type public.generation_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
create type public.validation_outcome as enum ('PASS', 'WARN', 'FAIL', 'SKIPPED');
create type public.report_kind as enum ('QUESTION_ERROR', 'CONTENT_FEEDBACK', 'BUG');
create type public.report_status as enum ('OPEN', 'RESOLVED', 'DISMISSED');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
