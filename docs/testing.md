# Testing

## Layers

| Layer | Command | What it proves | What it does **not** prove |
|---|---|---|---|
| Database (82 tests) | `npm run test:db` | migrations apply from empty; grants, RLS, triggers and constraints behave as documented, using real PostgreSQL (PGlite) with a Supabase-style shim | behaviour of Supabase's own services (Auth, PostgREST, JWT verification); extensions not in PGlite |
| Unit/component (75 tests) | `npm run test:unit` | validation, redirects, guards, provider role handling (fail-closed), form flows, design-token contrast | real network behaviour (Supabase is replaced by fakes) |
| Browser (54 tests, 27 x 2 viewports) | `npm run test:e2e` | routing, guards, forms, keyboard use, mobile layout, error handling, with the backend **mocked** at the network layer | that a real Supabase project returns those responses |
| Build scan | `npm run verify-build` | no secret patterns in `dist/` (scanner proven against a planted secret) | secrets in other forms |
| CSP check | `npm run check:csp` | the built site loads under the production CSP, fonts included (proven to fail when a directive is broken) | CSP behaviour on Cloudflare itself |

## How the database shim works

`tests/db/supabase-shim.sql` creates the roles `anon`, `authenticated`, `service_role`, an `auth.users` table and `auth.uid()`, and **replicates Supabase's default privileges**, so the migrations' revokes are tested against the same starting point as production. `tests/db/harness.ts` runs each query as a role with JWT claims set, so RLS and grants apply for real.

## Not covered in Phase 1

Real Supabase Auth (email delivery, Google OAuth, token refresh), `supabase db reset` on the real CLI, concurrency under load, accessibility audit with a screen reader or axe, cross-browser runs (Chromium only), Safari/iOS, and the deployed Cloudflare site. See [phase1-report.md](phase1-report.md).

## Adding tests

- New table or function: update the expected lists in `tests/db/schema.test.ts`, add RLS tests alongside the feature.
- New colour: add its pairs to `tests/unit/tokens.test.ts`.
- Mocked E2E responses live in `tests/e2e/support.ts`; keep mocks honest and label such tests.

## Regenerating screenshots

`SCREENSHOTS=1 npx playwright test screenshots` writes `docs/screenshots/`. These images use **mocked data** (for example the admin counts), not a live database.

## Playwright version note

`@playwright/test` is pinned to 1.56.1 because the development sandbox had only the matching Chromium build. On your machine you may upgrade it; run `npx playwright install chromium` afterwards.
