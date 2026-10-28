# Phase 1 report: foundation

Date: 27 October 2026. Scope: scaffold, design system, Supabase configuration, email + Google auth, USER/ADMIN roles, core migrations, RLS, initial tests. **Phase 2 has not been started.**

## 1. What was run here, and the result

| Check | Command | Result |
|---|---|---|
| TypeScript (app + config) | `npm run typecheck` | **Passed** |
| Lint (incl. jsx-a11y) | `npm run lint` | **Passed**, 0 errors, 0 warnings |
| Database tests (real PostgreSQL via PGlite) | `npm run test:db` | **82 / 82 passed** in 8 files |
| Unit + component tests | `npm run test:unit` | **75 / 75 passed** in 10 files |
| Production build | `npm run build` | **Passed** (main chunk 361 kB, 113 kB gzip; Supabase client 337 kB, 91 kB gzip; admin and form pages lazy-loaded) |
| Secret scan of `dist/` | `npm run verify-build` | **Passed**; proven to fail when a secret is planted |
| CSP check (built site under production headers) | `npm run check:csp` | **Passed**; proven to fail when a directive is broken |
| Browser tests, Chromium, desktop + mobile (Pixel 7 emulation) | `npm run test:e2e` | **54 passed**, 2 skipped (the opt-in screenshot helper) |
| Dependency audit | `npm audit` | **2 advisories**, see section 5 |
| Fresh-extract reproduction | unzip the archive to an empty folder, `npm ci`, `npm run check` | **Passed** (157 tests, build, scan) on the same Linux sandbox; Windows not tried |

## 2. What could NOT be tested here

These need your credentials, a live project, or hardware I do not have. None is claimed as working.

| Not tested | Why | How you verify |
|---|---|---|
| Migrations on the real Supabase CLI / hosted Postgres (`supabase db reset`, `db push`) | no Docker, no Supabase access in the sandbox. Migrations were applied to PGlite (PostgreSQL 18 in WebAssembly) with a Supabase-style shim | follow [windows-setup.md](windows-setup.md); `db push --dry-run` first |
| Real email sign-up, confirmation emails, password-reset emails | needs a Supabase project and mail delivery | register with a real address |
| **Google sign-in** | needs your Google OAuth credentials | [oauth-setup.md](oauth-setup.md) |
| Token refresh, real JWT verification, PostgREST behaviour (column grants, `maybeSingle`, `Content-Range`) | tests use fakes/mocks for Supabase's own services | smoke-test the dashboard, profile edit and admin page on a dev project |
| Cloudflare Pages deployment, `_headers`, SPA fallback on refresh | no Cloudflare account | [deployment.md](deployment.md) post-deploy checklist |
| Safari/iOS, Firefox, real phones | only Chromium available | open the deployed site on your devices |
| Screen reader / axe audit | not available; only lint rules and contrast tests ran | planned for phase 7 |
| Independent reproduction by another developer | not possible yet | ask a colleague to follow the Windows guide |

**The browser tests mock the backend.** They prove how the UI reacts to responses, not that a real Supabase project sends them.

## 3. What was built

- 8 migrations, 20 tables, explicit grants, RLS on every table, immutability triggers, append-only audit log, seed (categories/topics only). Access model: [rls-policies.md](rls-policies.md).
- Auth: email register/sign-in/reset, Google button, callback handling, session persistence, protected routes, safe post-login redirect, friendly error mapping, non-revealing sign-up and reset messages.
- Roles: automatic USER; ADMIN only through `grant_admin_role()` (SQL editor/service role, requires confirmed email, audited, last-admin protected).
- Design system: tokens in one CSS file with WCAG contrast tests; Button, Field, Card, Badge, Alert, Skeleton, Toast; reduced-motion support.
- Pages: landing (labelled example, no invented statistics), auth screens, student dashboard and profile (real counts, empty states, error states), admin overview (real counts with printed definitions), 404, forbidden, setup-required.

Screenshots: `docs/screenshots/` (mocked data).

## 4. Problems the tests found and I fixed

These were real defects in my first drafts; they are listed so you can judge the test suite's value.

1. **Open redirect.** `?next=/x/../..//evil.example` normalised to `//evil.example`, a protocol-relative URL. Fixed in `safeNextPath`; regression tests added.
2. **Sign-out landed on `/login?next=%2Fdashboard`.** The route guard unmounted the header before my redirect ran. Now navigates home first.
3. **Blank screen while lazy routes load.** Added a router-level loading fallback.
4. **Brand name wrapped to two lines on narrow phones.** Fixed; secondary header button hidden below the `sm` breakpoint.
5. Several of my own test expectations were wrong (enum ordering, a miscounted fixture, a locator matching two links). The product code was correct in those cases.

## 5. Known issues and limitations

- **npm audit:** `undici` (high; only via `jsdom`, test tooling) and `fast-uri` (moderate; via a validator package that is not part of the shipped bundle: confirmed absent from `dist/`). The fixed releases were published 8 to 12 days ago, inside the 14-day waiting period I applied to all dependencies, so I did not adopt them. Re-run `npm audit fix` after about 2 November 2026.
- **Dependencies are new majors** (React Router 8, Vite 8, Vitest 5, TypeScript 6, Zod 4). They work in every check above, but expect ecosystem rough edges. ESLint is held at 9 because `eslint-plugin-jsx-a11y` does not yet support 10. Playwright is pinned to 1.56.1 to match the sandbox browser.
- **No generated database types.** Responses are validated with Zod; run `supabase gen types` once you have a database if you want compile-time types.
- **Bundle size** is acceptable but not optimised; revisit in phase 7.
- **No admin write path yet** (create/edit challenges arrives in phase 2). Admin can only read, and manage categories/topics through the API.
- **Account deletion UI** is not built; the database already anonymises attempts when an account is deleted.
- **Profiles are private** (owner and admin only). Leaderboards will need a controlled view that exposes display names.
- **Product name** "Placement Challenge" is a placeholder in `src/lib/brand.ts`.
- **Free-tier figures** in [costs-and-limits.md](costs-and-limits.md) came partly from third-party summaries; confirm on the official pages.

## 6. Deviations from the approved plan

| Change | Reason |
|---|---|
| Added `question_versions`, `challenge_version_questions`, `app_settings` | required for immutable history (approved in the plan as additions) |
| Added `/forgot-password` and `/reset-password` | a password-reset flow needs both |
| Password minimum 10 characters, max 72 | stronger than Supabase's default; keeps within bcrypt's limit |
| `lucide-react` not installed | no icons used yet |
| Bookmarks: no client INSERT | will go through a function that checks the person has seen the question |
| Feedback rate limit implemented in the database | testable, configurable, needs no extra service |

## 7. Phase 1 against the acceptance list

| # | Criterion | Status |
|---|---|---|
| 1 | Register with email | UI, validation and trigger tested; **real email flow untested** |
| 2 | Google sign-in | **untested** (needs your credentials) |
| 3 | Student cannot reach admin operations | **tested** at database level and in the UI (mocked) |
| 15 | Database permissions block unauthorised access | **tested** (82 tests) |
| 16 | Works on mobile and desktop | **tested** in Chromium at both sizes; real devices untested |
| 17 | Migrations run from a clean database | **tested on PGlite**; real CLI untested |
| 18 | Automated tests pass | **passed** |
| 19 | Production build succeeds | **passed** |
| 20 | Setup reproducible by another developer | ZIP reproduces from a clean folder with `npm ci` (same machine); Windows guide **not yet followed by anyone** |
| 4-14 | Challenges, AI, quiz, scoring, leaderboards | Phases 2 to 5, **not started** |

## 8. Decisions I need from you before Phase 2

1. Do you approve the **private-profile** choice, and a **10-character** minimum password?
2. Do you want a different **product name** or tagline?
3. Phase 2 plan: admin writes go through audited database functions (`admin_create_challenge`, `admin_transition_challenge`, ...) with the lifecycle enforced in SQL, and the question editor uses the version/lock model already in place. Approve, or prefer direct table writes with policies?
4. Can you run the setup on a free Supabase project and report anything that differs from my PGlite-based tests? That single step closes the biggest gap in this phase.
