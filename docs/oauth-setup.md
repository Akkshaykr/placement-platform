# Google sign-in setup

Google sign-in cannot work until **you** create OAuth credentials; it needs your Google account and cannot be tested without them. Until then the "Continue with Google" button will return an error from Supabase.

## 1. Google Cloud Console

1. Create or choose a project at https://console.cloud.google.com.
2. **APIs & Services > OAuth consent screen**: configure the app name and support email. Keep the requested scopes to the defaults (`email`, `profile`, `openid`).
3. **Credentials > Create credentials > OAuth client ID > Web application.**
4. **Authorized redirect URIs:** add the Supabase callback shown in your dashboard under **Authentication > Sign In / Providers > Google** (hosted projects: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`; local stack: `http://127.0.0.1:54321/auth/v1/callback`).
5. Copy the **Client ID** and **Client secret**. Treat the secret like a password.

## 2. Supabase

**Hosted:** Dashboard > Authentication > Sign In / Providers > Google > enable, paste Client ID and secret, save.

**Local stack:** set `enabled = true` under `[auth.external.google]` in `supabase/config.toml`, then in PowerShell before `npx supabase start`:
```powershell
$env:SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID = "your-client-id"
$env:SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET = "your-client-secret"
```
Do not commit the secret and do not put it in `.env.local` (that file feeds the browser bundle only for `VITE_` names, but keeping secrets out of it avoids mistakes).

## 3. Redirect URLs (this app's side)

In **Authentication > URL Configuration** allow-list every address the app is served from:

| Environment | Site URL | Redirect URLs to add |
|---|---|---|
| Local dev | `http://localhost:5173` | `http://localhost:5173/auth/callback`, `http://localhost:5173/reset-password` |
| Production | `https://your-domain` | `https://your-domain/auth/callback`, `https://your-domain/reset-password` |

The app stores the page you were heading to in `sessionStorage`, not in the URL, so the allow-list entries above are exact and need no wildcards.

## 4. Verify

1. Open `/login`, click **Continue with Google**, choose an account.
2. You should land on `/dashboard`, and a row for you should exist in `public.profiles` with role `USER` in `public.user_roles`.
3. Google accounts arrive with a verified email, so `grant_admin_role` works for them immediately.

Google's consent-screen verification rules and quotas change; check Google's current documentation if you leave "testing" mode.
