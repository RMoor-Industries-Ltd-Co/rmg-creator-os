# Incident record — `STEP_UP_COOKIE_SECRET` boot crash (#65–#71)

Blameless. The purpose of this record is to prevent recurrence, not to assign fault.

## Window

- **Start:** first production deploy carrying B1.2 step 3 (step-up authentication, PR #65) with
  `AUTH_ENABLED=true` and no `STEP_UP_COOKIE_SECRET` configured in the production Doppler
  environment.
- **End:** hotfix PR #71 (`8dc430c`) merged and deployed; production verified healthy.
- **Duration:** approximately 1.5 hours, spanning five deploys that each reported success.

## Impact

Every request to the gateway failed. `assertStepUpCookieSecret()` ran at module scope in
`server.ts` and threw when `STEP_UP_COOKIE_SECRET` was unset — since that code runs before
Fastify starts listening, the thrown error prevented the process from ever reaching a state
where it could serve *any* route, not just the step-up route the missing secret actually
protects. This included `/health` itself, which is why the automated deploy pipeline of the
time had no way to notice.

## Detection

Not automated. Found during a manual production validation pass conducted as part of closing
out B1.2 (the "CC DIRECTIVE — CLOSE B1.2 AFTER PR #70" review), not by any deploy-time signal.

## Root cause

`STEP_UP_COOKIE_SECRET` was classified, in effect, as required for the *entire gateway* to
start, when what it actually gates is one route (`POST /auth/google/step-up`) with no live
write-path caller at the time (B1.2 §13 step 6, the step that would call it, was and remains
blocked on the A-Roll pin). The credential's blast radius (the whole process) exceeded what it
protects (one not-yet-live route). This is a category this repo already had a name and a fix
pattern for — `WORKER_SECRET` (`workerAuth.ts`) and `postizConfigured()` (`postiz.ts`) both
already fail closed *without* crashing — but the step-up implementation did not follow that
pattern at the time it shipped.

## Why deployment automation did not detect it

`infra/control-server/deploy.sh` ran `docker compose up -d`, slept 15 seconds, printed
container logs and state for a human to read, and then unconditionally printed
`"deployed ... @ ..."` and exited 0. None of the gathered diagnostic evidence — container
status, restart count — was ever checked programmatically. A crash-looping container and a
healthy one produced an identical exit code and an identical "deployed" message from the CI/CD
pipeline's point of view. This is the same underlying gap across five separate deploys: the
pipeline had the evidence on-screen and never looked at it.

## Remediation (already applied, prior to this directive)

PR #71: `assertStepUpCookieSecret()` is no longer called at module scope. `server.ts` now wraps
it in `try/catch`; on failure it sets `STEP_UP_CONFIGURED = false`, logs the condition via
`app.log.error`, and the step-up route itself returns `503` when `!STEP_UP_CONFIGURED` — the
gateway boots and serves every other route normally.

## Permanent controls introduced by B1.3

1. **A written, tested classification** (`apps/gateway/src/config.ts`) making the
   required-to-start / feature-required / optional distinction explicit and auditable per
   variable, so a future credential's blast radius is a deliberate classification decision, not
   an accident of where the assertion happens to run.
2. **A deployment health gate** (`infra/control-server/deploy.sh`) that actually checks the
   evidence it already gathers — container status, restart-count stability, a live HTTP 200
   against the public health endpoint — and fails the CI/CD pipeline (`exit 1`) rather than
   unconditionally reporting success. This is the control that would have caught this exact
   incident on the very first of the five deploys, rather than requiring a human to notice
   later.
3. **A secret-free startup configuration report** (`apps/gateway/src/configReport.ts`), logged
   once at boot and served via `/health`'s `readiness` field, so "is step-up actually usable
   right now" is answerable by reading a log line or hitting an endpoint, not by inferring it
   from whether the process is up at all.

## Follow-up items

- `STEP_UP_COOKIE_SECRET` and `FOUNDER_PRINCIPALS` still need to be added to Doppler
  (`master-atelier`, `prd`) by an operator with write access — see
  `docs/atelier/b1-3-operational-activation.md` §5. Neither was fabricated or worked around in
  this session.
- No automated boot-integration test exists that would catch a *new* instance of this same
  class of defect (a fresh required-secret assertion reintroduced at module scope) short of code
  review against `config.ts`'s classification table. Named as an open gap in
  `docs/atelier/b1-3-operational-activation.md` §8 rather than left unstated.
