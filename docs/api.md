# API contract (Phase 1)

There is no custom REST layer yet. The browser talks to Supabase: Auth, PostgREST (tables) and RPC. Later phases add RPC functions and Edge Functions; their contracts will be added here.

Errors from PostgREST look like `{ "code": "...", "message": "...", "details": null, "hint": null }`. Permission failures are `42501`; check/unique violations are `23xxx`; `54000` with message `RATE_LIMITED: ...` is the report limit.

## Auth (Supabase Auth)

| Action | Call | Notes |
|---|---|---|
| Register | `auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo } })` | password 10 to 72 chars (client) and configured minimum 10 (server); with confirmation on, the response is the same whether or not the address exists |
| Sign in | `auth.signInWithPassword` | unconfirmed email returns `email_not_confirmed` |
| Google | `auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <site>/auth/callback } })` | PKCE |
| Resend confirmation | `auth.resend({ type: 'signup', email })` | |
| Reset | `auth.resetPasswordForEmail(email, { redirectTo: <site>/reset-password })` then `auth.updateUser({ password })` | |
| Sign out | `auth.signOut()` | |

## Tables (PostgREST, subject to RLS)

| Request | Returns | Used by |
|---|---|---|
| `GET user_roles?select=role&user_id=eq.<me>` | `[{ role: 'USER' \| 'ADMIN' }]` | role hint for the UI |
| `GET profiles?select=id,display_name,avatar_url&id=eq.<me>` | one row | header, profile |
| `PATCH profiles?id=eq.<me>` body `{ display_name }` | 204 | profile page; no other column is updatable |
| `HEAD challenges` with `Prefer: count=exact` | count in `Content-Range` | dashboard; RLS limits to open challenges |
| `HEAD challenge_attempts?status=eq.SUBMITTED` with count | count | dashboard; RLS limits to own rows |

## RPC

### `POST /rpc/is_admin`
Returns `boolean` for the caller. Authenticated only.

### `POST /rpc/admin_overview_stats`
Administrator only; others receive `403` with code `42501`.
```json
{
  "registered_users": 0,
  "published_challenges": 0,
  "challenges_in_preparation": 0,
  "completed_attempts": 0,
  "unique_participants": 0,
  "open_reports": 0
}
```
Definitions: [analytics-definitions.md](analytics-definitions.md). The client validates this shape with Zod before use.

## Trusted operations (SQL editor or service role only)

```sql
select public.grant_admin_role('person@example.com');   -- requires a confirmed email; audited
select public.revoke_admin_role('person@example.com');  -- refuses to remove the last admin; audited
```

## Planned (not implemented)

Phase 2 admin challenge/question functions and state transitions; phase 3 `start_attempt`, `save_answer`, `submit_attempt`, `get_result`; phase 4 `generate-questions` and `validate-question` Edge Functions; phase 5 leaderboard views. Each will be added with its tests and RLS changes.
