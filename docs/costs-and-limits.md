# Costs and limits

Aim: run at **no or minimal cost** on free tiers. Free tiers change; **verify current terms before launch** and never assume zero cost.

## What is used in Phase 1

| Service | Used for | Free-tier points to check (as reported when this was written) |
|---|---|---|
| Cloudflare Pages | static hosting | about 500 builds/month, 1 concurrent build, 20-minute build timeout, 25 MiB per file. Verify at developers.cloudflare.com/pages/platform/limits |
| Supabase | Auth, PostgreSQL, (later) Edge Functions | small database and monthly-active-user allowances, and **inactive free projects can be paused** (reported as after about a week of inactivity). Figures came from third-party summaries, not Supabase's own pricing page: confirm at supabase.com/pricing |
| Email delivery | confirmation and reset emails | Supabase's built-in sender is low-limit and meant for testing; plan for your own SMTP |
| Google OAuth | sign-in | no charge for basic sign-in; consent-screen verification rules apply |
| Gemini API (phase 4) | question generation | not used yet; free-tier terms and models change, so check at implementation time |

## Controls already in the schema

- `app_settings`: `ai.enabled` (**false** by default), `ai.max_questions_per_request` (10), `ai.max_generations_per_admin_per_day` (20), `feedback.max_reports_per_user_per_hour` (10).
- Feedback abuse limit is enforced by a database trigger (tested).
- Supabase Auth applies its own rate limits to sign-in, sign-up and email sending.

## Disabling AI generation if quota runs out (from phase 4)

Run in the SQL editor: `update public.app_settings set value = 'false'::jsonb where key = 'ai.enabled';`. The generator will refuse to call the provider while it is false, and manual question entry will keep working.

## Avoiding a paused project

If a free project can pause when idle, an occasional visit or a scheduled health check keeps it active; a paid plan removes the concern. Decide before inviting real users.
