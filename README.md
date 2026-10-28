# Placement Challenge Platform

A web platform for placement aptitude practice: an administrator creates and reviews timed challenges, students attempt them, and scoring is done on the server.

> **Status: Phase 1 of 7 (foundation) is complete and awaiting review.**
> Challenge creation, the quiz engine, AI generation, leaderboards and the Learning Hub are **not built yet**. See [docs/phase1-report.md](docs/phase1-report.md) for exactly what exists, what was tested, and what could not be tested.

## What Phase 1 contains

- React + TypeScript + Vite + Tailwind CSS v4 app with a dark, red-to-blue design system.
- Email and Google sign-in through Supabase Auth, sign-out, password reset, protected routes.
- `USER` / `ADMIN` roles enforced **in the database** (the frontend only hides things for convenience).
- 8 SQL migrations: 20 tables, grants, row level security, immutability guards, audit log.
- Student dashboard, profile page, and a read-only admin overview that shows real database counts.
- 157 unit and database tests, 54 browser tests, secret-leak and CSP checks.

## Quick start (Windows)

Full instructions: **[docs/windows-setup.md](docs/windows-setup.md)**. In short, from PowerShell:

```powershell
npm install
copy .env.example .env.local      # then edit .env.local with your Supabase values
npm run dev                       # http://localhost:5173
```

You need a Supabase project first (free tier is fine). The guide walks through creating it, applying the migrations, and making your first administrator.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server on port 5173 |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build on port 4173 |
| `npm run typecheck` | TypeScript checks only |
| `npm run lint` | ESLint (including accessibility rules) |
| `npm test` | All Vitest tests (unit + database) |
| `npm run test:unit` / `npm run test:db` | One project at a time |
| `npm run test:e2e` | Playwright browser tests (needs `npx playwright install chromium` once) |
| `npm run verify-build` | Scan `dist/` for leaked secrets (run after `build`) |
| `npm run check:csp` | Load the built site under the production Content-Security-Policy |
| `npm run check` | typecheck + lint + tests + build + verify-build |
| `npm run db:start` / `db:reset` / `db:push` | Supabase CLI helpers (`start` and `reset` need Docker Desktop) |

## Project layout

```
src/
  components/ui/      Button, Field, Card, Badge, Alert, Skeleton, Toast
  features/
    auth/             sign-in, register, reset, provider, route guards
    admin/            admin overview (lazy-loaded)
    dashboard/        student dashboard
    profile/          profile page
  layouts/            public, auth, student, admin shells
  lib/                env validation, Supabase client, safe redirects
  pages/              landing, 404, forbidden, setup-required
supabase/
  config.toml         local stack + auth settings
  migrations/         the database, in order (read 0008 for the full access model)
  seed.sql            reference data only (categories and topics)
tests/
  db/                 PostgreSQL tests (migrations, RLS, triggers) via PGlite
  unit/               design-token contrast tests and helpers
  e2e/                Playwright specs (+ mocked-network helpers)
docs/                 architecture, RLS matrix, API, setup, deployment, report
scripts/              verify-build.mjs, csp-check.mjs
```

## Security model in one paragraph

The browser holds only the Supabase **publishable** key. What a person may read or write is decided by PostgreSQL: every table has row level security, grants are explicit (anonymous users have none), roles can only be changed by a trusted SQL/service-role operation, and answer keys live in a table that students cannot query. The app refuses to start if a secret or `service_role` key is placed in a `VITE_` variable. Details: [docs/rls-policies.md](docs/rls-policies.md).

## Documentation

- [Windows setup](docs/windows-setup.md) · [Google sign-in](docs/oauth-setup.md) · [Deployment](docs/deployment.md)
- [Architecture & ER diagram](docs/architecture.md) · [RLS policy matrix](docs/rls-policies.md) · [API contract](docs/api.md)
- [Testing](docs/testing.md) · [Costs and limits](docs/costs-and-limits.md) · [Metric definitions](docs/analytics-definitions.md)
- [Phase 1 report](docs/phase1-report.md)
