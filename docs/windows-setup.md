# Windows setup

Tested commands are PowerShell. Everything except the optional local Supabase stack works without Docker.

## 1. Install the tools

| Tool | Version | Notes |
|---|---|---|
| Node.js | **22.12 or newer** (LTS) | https://nodejs.org. Check with `node -v`. Vitest 5 requires 22.12+. |
| Git | any recent | https://git-scm.com |
| Docker Desktop | optional | Only for the **local** Supabase stack (Path B). |

## 2. Install dependencies

```powershell
cd path\to\placement-platform
npm install
```

`npm install` also downloads the Supabase CLI (used as `npx supabase ...`; you do not install it globally).

## 3. Pick a database path

### Path A: hosted Supabase project (recommended, no Docker)

1. Create a free account and a **new project** at https://supabase.com/dashboard. Save the database password in a password manager (the CLI asks for it once).
2. Copy your values from **Project Settings > API**: the **Project URL** and the **publishable key** (`sb_publishable_...`). The legacy `anon` key also works. **Never use the `service_role` or `sb_secret_...` key here.**
3. Create your local config:
   ```powershell
   copy .env.example .env.local
   notepad .env.local
   ```
   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Leave `VITE_APP_URL` empty for local work.
4. Link and apply the database:
   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --include-seed
   ```
   The project ref is the subdomain in your project URL. `--include-seed` loads the categories and topics from `supabase/seed.sql`. You can preview first with `npx supabase db push --dry-run`.
5. Configure Auth in the dashboard (**Authentication**):
   - **URL Configuration > Site URL:** `http://localhost:5173`
   - **Redirect URLs:** add `http://localhost:5173/auth/callback` and `http://localhost:5173/reset-password`
   - **Sign In / Providers > Email:** keep **Confirm email** on. Set the minimum password length to **10**.
   - Google sign-in: see [oauth-setup.md](oauth-setup.md).

### Path B: local Supabase stack (needs Docker Desktop running)

```powershell
npx supabase start
```
When it finishes it prints a local API URL (normally `http://127.0.0.1:54321`) and keys. Put the URL and the publishable/anon key into `.env.local`. Then:
```powershell
npx supabase db reset
```
Confirmation emails in the local stack are caught by Mailpit; the URL is printed by `supabase start`. Stop with `npx supabase stop`.

## 4. Run the app

```powershell
npm run dev
```
Open http://localhost:5173. If the page says **"isn't configured yet"**, `.env.local` is missing, still contains placeholders, or the dev server was not restarted after editing it.

## 5. Create the first administrator

An account becomes an administrator only through a trusted database operation. There is no admin password in the repo and no sign-up path to admin.

1. Register through the app with the email you want to use, and **confirm the email** (the function refuses unconfirmed addresses, which blocks someone pre-registering your address).
2. In the Supabase dashboard open **SQL Editor** and run:
   ```sql
   select public.grant_admin_role('you@example.com');
   ```
3. Sign out and back in. An **Admin** link appears in the header.

To remove an administrator: `select public.revoke_admin_role('someone@example.com');`. The function refuses to remove the last administrator. Every grant and revoke is written to the `audit_logs` table.

## 6. Run the checks

```powershell
npm run check            # typecheck, lint, unit + database tests, build, secret scan
npx playwright install chromium   # once, for browser tests
npm run test:e2e
```
The database tests use an in-memory PostgreSQL (PGlite) and need no Docker or Supabase account.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| "isn't configured yet" | `.env.local` missing/placeholder. Edit it and **restart** `npm run dev`. |
| "contains a secret/service_role key" | You pasted the wrong key. Use the publishable/anon key and rotate the exposed one. |
| Sign-up says "check your email" but nothing arrives | Check spam. Hosted projects use a shared mail sender with a low hourly limit; configure custom SMTP for real use. Locally, open Mailpit. |
| After Google sign-in you land on an error | The redirect URL is not in the allow-list. See [oauth-setup.md](oauth-setup.md). |
| `supabase start` fails | Docker Desktop is not running, or WSL 2 is not enabled. |
| `npm run dev` says port 5173 in use | Another dev server is running. Close it (the port is fixed so OAuth redirects stay valid). |
| Admin link missing after `grant_admin_role` | Sign out and in again, or reload; roles are read at sign-in. |
| `Playwright browser not found` | Run `npx playwright install chromium`. |
| `npm run build` fails on Node < 22 | Upgrade Node (`node -v` must be 22.12+). |
