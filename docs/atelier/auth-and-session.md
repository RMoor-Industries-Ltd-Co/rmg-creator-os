# Auth & Session — Master Atelier

Master Atelier is an internal production operating system, not a public app. Access is gated
by a gateway-level signed session over Google sign-in, restricted to an env-configured
allowlist. This document is the reference for that boundary. Introduced/hardened in Sprint 1
PR 2 ("Auth/Session UX Hardening").

## Model

- **Gateway guard** (`apps/gateway/src/server.ts`, when `AUTH_ENABLED=true`): a global
  `onRequest` hook rejects every non-public route with `401 { error: 'unauthorized', code:
  'session_required' }` unless the request carries a valid signed `rmg_sess` cookie whose email
  is on the allowlist.
- **Public routes** (`isPublicRoute`, `apps/gateway/src/auth.ts`): `/health`, `/auth/*`, and the
  UUID media proxies (`/(assets|videos)/:id/raw`, `/assets/drive-thumb/*`). Nothing else.
- **Sign-in**: `POST /auth/google` verifies a Google ID token, checks the allowlist, and sets a
  signed, `httpOnly`, `secure`, `sameSite=lax`, 30-day `rmg_sess` cookie. A non-allowlisted
  identity gets `403 { error: 'not authorized', code: 'not_allowlisted' }`.
- **Session check / sign-out**: `GET /auth/me`, `POST /auth/logout`.
- **Frontend** (`apps/dashboard`): the app gates on `/auth/me` at load, and any mid-session
  `session_required` 401 from an API call routes the whole app to the sign-in screen with
  "Your session expired. Please sign in again." — never a raw `unauthorized` string
  (`authClient.ts` + `App.tsx` + `Login.tsx`).

## Allowlist

Emails come from the environment — **never hardcoded in source**.

- `AUTH_ALLOWED_EMAILS` — comma-separated allowlist (preferred), e.g.
  `rahm@rmasters.group,rmoorindustries@gmail.com`.
- `AUTH_ALLOWED_EMAIL` — legacy single value, still honored and merged in as a fallback.

Both are normalized (trimmed, lowercased) into one Set (`parseAllowedEmails`). Comparison is
case- and whitespace-insensitive (`isEmailAllowed`).

## Environment variables

| Var | Purpose | Notes |
|---|---|---|
| `AUTH_ENABLED` | `true` turns the guard on | Off in local dev by default. |
| `GOOGLE_CLIENT_ID` | Google Identity Services client id | Required for sign-in. |
| `AUTH_ALLOWED_EMAILS` | comma-separated allowlist | Preferred; source of truth for who may sign in. |
| `AUTH_ALLOWED_EMAIL` | single-email fallback | Back-compat; merged with the list. |
| `COOKIE_SECRET` | signs the `rmg_sess` cookie | **Required, strong, and stable across deploys in production.** |

### `COOKIE_SECRET` is required in production
`assertCookieSecret` fails gateway startup when `AUTH_ENABLED=true` **and** `NODE_ENV=production`
**and** `COOKIE_SECRET` is unset or equals the dev default (`rmg-dev-secret-change-me`). This is
deliberate fail-closed behavior: a missing/default secret makes sessions trivially forgeable and
unstable across deploys (a rotated/absent secret invalidates every issued cookie — the cause of
the briefing "unauthorized" incident). It **must be stable** — changing it signs everyone out.

## Session lifetime

The `rmg_sess` cookie has a 30-day `maxAge`. When it expires or is cleared, the next guarded
request returns `session_required` and the UI prompts re-sign-in.

## Before deploying PR 2 to production

Set in Doppler (`master-atelier/prd`) **before** deploy — the startup guard fails closed otherwise:

```
AUTH_ALLOWED_EMAILS=rahm@rmasters.group,rmoorindustries@gmail.com
COOKIE_SECRET=<strong, stable, non-default value>   # keep stable across deploys
AUTH_ENABLED=true
```

## Out of scope (deliberately)

No roles, permissions, broad IAM, user management, or public-route expansion. The allowlist is
two accounts by env config. Adding accounts = edit `AUTH_ALLOWED_EMAILS`, no code change.
