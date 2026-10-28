# Deployment: Cloudflare Pages + Supabase

Not yet performed. This was written from the project's configuration and has **not been exercised against a live Cloudflare or Supabase account**. Follow it once and note any difference.

## 1. Production Supabase project

1. Create a separate project for production (do not reuse your development project).
2. Apply the schema: `npx supabase link --project-ref PROD_REF` then `npx supabase db push` (add `--include-seed` for the categories/topics).
3. **Authentication > URL Configuration:** Site URL `https://your-domain`; Redirect URLs `https://your-domain/auth/callback` and `https://your-domain/reset-password`.
4. **Providers:** Email with **Confirm email** on and minimum password length 10. Google per [oauth-setup.md](oauth-setup.md).
5. **Email delivery:** the built-in sender is intended for testing and is rate-limited. Configure your own SMTP provider before real users sign up.
6. Create the administrator with `select public.grant_admin_role('you@example.com');` after you have registered and confirmed.
7. Enable backups appropriate to your plan, and read the plan's backup/pausing policy ([costs-and-limits.md](costs-and-limits.md)).

## 2. Cloudflare Pages (Git integration)

Push the repository to GitHub/GitLab, then **Workers & Pages > Create > Pages > Connect to Git** and use:

| Setting | Value |
|---|---|
| Framework preset | None / Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `.node-version` (22) is in the repo; or set `NODE_VERSION=22` |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (and optionally `VITE_APP_URL=https://your-domain`) |

These variables are **public by design** (compiled into the bundle). Never add a `service_role` or `sb_secret_` key. The app and `npm run verify-build` both refuse such a key.

What ships from `public/`:
- `_headers`: security headers and a strict Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`, `connect-src` limited to `*.supabase.co`). **If you use a Supabase custom domain, add it to `connect-src`.** Verified locally with `npm run check:csp`.
- No `_redirects` file: Cloudflare Pages treats a project without a top-level `404.html` as a single-page app and serves `index.html` for unknown paths, so deep links such as `/dashboard` work on refresh. After the first deploy, open a deep link and refresh to confirm.

Manual deploy alternative: `npm run build` then `npx wrangler pages deploy dist` (requires a Cloudflare login).

## 3. Post-deploy checks (manual)

- [ ] `/` loads; refresh on `/login` works.
- [ ] Register with email, confirm, sign in, reach `/dashboard`.
- [ ] Google sign-in lands on `/dashboard`.
- [ ] A normal account visiting `/admin` sees "You don't have access".
- [ ] Browser dev tools > Network: no request carries a key other than the publishable one; no CSP violations in the console.
- [ ] In the Supabase SQL editor, `select * from public.audit_logs;` shows the admin grant.

## Rollback

Cloudflare Pages keeps previous deployments; promote an earlier one from the dashboard. Database migrations are forward-only: write a new migration to undo a change, and take a backup/export before applying risky ones.
