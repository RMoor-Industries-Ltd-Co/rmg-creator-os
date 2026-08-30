# ADR 0004 — Internal-app auth model: env allowlist + fail-closed session

- **Status:** Accepted (Sprint 1, PR 2 — Auth/Session UX Hardening)
- **Date:** 2026-08-29
- **Deciders:** Rahm Moore
- **Related:** [`../atelier/auth-and-session.md`](../atelier/auth-and-session.md),
  [`../atelier/sprint-00-readiness-audit.md`](../atelier/sprint-00-readiness-audit.md),
  ADR 0003 (Trust the Boundary).

## Context

The gateway already had a real session guard (`rmg_sess`, `COOKIE_SECRET`, Google sign-in) but
the product experience was incomplete: it allowed a **single** email, defaulted `COOKIE_SECRET`
silently, and surfaced raw `unauthorized` in the UI when a session lapsed (the briefing-card
incident). Master Atelier is an internal production OS gaining more power; the boundary should be
completed and made understandable **before** creative expansion — but without overbuilding IAM.

## Decision

1. **Env-configured allowlist, not identity management.** Access is a small list of emails from
   `AUTH_ALLOWED_EMAILS` (comma-separated), with the legacy `AUTH_ALLOWED_EMAIL` kept as a
   fallback. Initial members: `rahm@rmasters.group`, `rmoorindustries@gmail.com`. Emails live in
   the environment, never in source. Adding a user is an env edit, not a deploy of new code.
2. **Fail closed on the cookie secret in production.** With `AUTH_ENABLED=true` and
   `NODE_ENV=production`, the gateway refuses to start on an unset or default `COOKIE_SECRET`.
   The secret must be strong and **stable across deploys** (rotating it signs everyone out).
3. **A machine-readable 401 discriminator (`code: 'session_required'`).** Lets the frontend tell
   an expired/absent session apart from other errors and route to sign-in with a friendly
   message, instead of rendering `unauthorized`.
4. **No IAM, roles, permissions, user management, or public-route expansion.** The guard is
   unchanged in strength; `/health` and the UUID media proxies remain the only public routes.

## Alternatives considered

- **Full IAM / roles now** — rejected: disproportionate for a two-person internal tool; premature.
- **Hardcoding the two emails** — rejected: couples membership to a code deploy and leaks
  personal addresses into source/history.
- **Leaving `COOKIE_SECRET` optional** — rejected: it is the exact failure mode that produced the
  incident; silent insecurity is worse than a loud boot failure.

## Consequences

- One new env var (`AUTH_ALLOWED_EMAILS`) must be set in production before deploy, alongside a
  stable `COOKIE_SECRET`, or the gateway fails to boot (intended).
- Auth logic moves to a pure, unit-tested module (`apps/gateway/src/auth.ts`); the frontend gains
  a small session-handling module (`apps/dashboard/src/authClient.ts`). Both are covered by the
  vitest harness from PR 1.
- Guard behavior is otherwise preserved: every non-public route still requires a valid signed
  session on an allowlisted identity.
