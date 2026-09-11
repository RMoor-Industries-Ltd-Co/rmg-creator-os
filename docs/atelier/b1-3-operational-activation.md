# B1.3 — Operational Activation & Deployment Health Guard

Scope: configuration preflight, a secret-free startup configuration report, a three-tier
`/health` model (process / dependency / capability readiness), a real post-deploy health gate,
and the outstanding operator actions to bring B1.2's governance primitives fully live in
production. **This directive did not begin A-Roll candidate/canonical implementation or B2.**

## 1–3. Configuration classification, startup report, health model

Implemented in code, not just documented, so the classification cannot drift from behavior:

- `apps/gateway/src/config.ts` — `CONFIG_VARS`: every production-required variable classified
  `required_to_start` / `feature_required` / `optional`, each with a note explaining why.
  `COOKIE_SECRET` deliberately stays `required_to_start` (session auth gates nearly the whole
  API once `AUTH_ENABLED=true` — "do not weaken authentication to achieve availability").
  `STEP_UP_COOKIE_SECRET` is `feature_required` — the #65–#71 incident's actual lesson was that
  its blast radius (the whole process) exceeded what it protects (one not-yet-live route), not
  that fail-closed-by-crashing is always wrong. ALLEN is deliberately excluded — it's a sibling
  container reached by fixed internal hostname, not a gateway config var; it's dependency
  health (§3), not capability readiness (§1).
- `apps/gateway/src/configReport.ts` — `buildConfigReport()`: a pure function from
  already-computed booleans/counts (never a raw env value) to a fixed vocabulary of status
  words (`enabled` / `configured` / `unconfigured` / `disabled_by_flag` /
  `disabled_missing_secret` / `disabled_no_principals`). Logged once at boot via
  `app.log.info({ config: CONFIG_REPORT }, ...)` and served by `/health` as `readiness` —
  never a secret value, only ever one of those six words per capability.
- `/health` (`apps/gateway/src/server.ts`) now separates PROCESS HEALTH (the handler running
  at all, on a DB it just proved reachable) from DEPENDENCY HEALTH (`checks`: postgres, redis,
  heygen, higgsfield, drive, allen — each `ok` / `fail` / `unconfigured`) from CAPABILITY
  READINESS (`readiness`: the config report, computed once at boot). Fixed a real pre-existing
  bug in the same pass: `heygen`/`higgsfield`/`drive` previously reported `'fail'` for a simply
  unconfigured-and-optional integration, indistinguishable from a broken one — they now report
  `'unconfigured'`, matching the `allen` check's existing (correct) behavior. `status` is now
  `'ok'` when every *configured* dependency is `'ok'` — an `'unconfigured'` one no longer
  degrades status, since "not set up" and "broken" are different facts. **No health check makes
  a paid or live external-provider call** — heygen/higgsfield/drive report configuration
  presence only; a configured client object is not proof the provider works.

`HealthResponse` (`packages/types/src/index.ts`) gained an additive, optional `readiness` field
— existing consumers of `checks`/`status` are unaffected.

## 4. Deployment health gate

`infra/control-server/deploy.sh` no longer treats `docker compose up -d` succeeding as evidence
of a working deploy. After bringing the stack up it now runs a bounded stabilization loop
(`STABILIZE_SECONDS=30` / `POLL_INTERVAL_SECONDS=5`, both overridable) that, on each poll,
checks: the gateway container's `State.Status` is `running`; its `RestartCount` has not
increased since a baseline sampled immediately after `up -d` (catches a crash-loop, not just a
single-instant snapshot); `curl`-ing the **public** `HEALTH_URL`
(`https://rmg-creator-os.rmasters.group/api/health` by default) returns HTTP 200 — from the
deploy host, not inside the container (the gateway image has no curl/wget, and going out
through the public domain also proves Caddy is routing to the new container); and, when `jq` is
available, that `checks.postgres == 'ok'` and no `checks.*` entry is `'fail'`.

On failure at the end of the window: prints extended logs/state, **`exit 1`** (which fails the
`appleboy/ssh-action` step and therefore the whole `Deploy` workflow job — no change to
`deploy.yml` was needed, since it already propagates the remote script's exit code), and
explicitly does **not** attempt any automatic rollback — it names the manual recovery command
and states that an automated rollback is a separate architectural decision, per the directive's
explicit instruction not to add one here.

## 5. B1.2 production activation — exact remaining operator actions

Neither of these was fabricated or worked around. **This session's `DOPPLER_TOKEN` has access
only to the `axis-tekhen` Doppler project, not `master-atelier`** — confirmed directly via
`curl -u "$DOPPLER_TOKEN:" https://api.doppler.com/v3/projects`, not assumed. There is no write
path to production secrets from here.

1. **`STEP_UP_COOKIE_SECRET`** — generate a production-grade random secret (e.g.
   `openssl rand -hex 32`), distinct from `COOKIE_SECRET`, and add it to Doppler project
   `master-atelier`, config `prd`. Also requires the one-time GCP console step already on
   record in this repo's `CLAUDE.md`: add `https://<dashboard host>/stepup-callback.html` as an
   authorized redirect URI on the existing `GOOGLE_CLIENT_ID` OAuth client.
2. **`FOUNDER_PRINCIPALS`** — add the initial authorized business-domain Founder principal
   (Contract 36) as `email=principalId` pairs, e.g. `rahm@rmasters.group=rahm@business`, to the
   same Doppler config. Absence means no Founder approvals are possible — server-side only,
   never a client-visible value.

Both variables are already in `infra/docker-compose.prod.yml`'s `allen`-adjacent `gateway`
environment block from B1.2 — only the Doppler values are missing, not the wiring.

## 6. Live step-up validation plan (not executed)

Not run — the operator config in §5 is not yet present, and this directive does not authorize
creating a fake Founder approval or publishing anything. The smallest non-destructive proof,
once §5 is done:

1. Sign in normally (`POST /auth/google`) with the account that will be `rahm@business` in
   `FOUNDER_PRINCIPALS`. Confirm an ordinary session cookie is set and no approval-adjacent
   state changes.
2. Confirm the signed-in principal resolves to Founder via whatever read-only endpoint exposes
   `FOUNDER_PRINCIPALS` resolution (or, absent one, a one-off `node -e` using `founder.ts`'s
   exported resolver against the live env — read-only, no request sent).
3. Trigger the step-up flow (`prompt=login`, `max_age=900`) and confirm Google forces a fresh
   sign-in rather than silently reusing the existing session.
4. `POST /auth/google/step-up` with the resulting fresh credential; confirm a `rmp_stepup`-style
   cookie is set and its `auth_time` is within the freshness window.
5. **Confirm no approval row was created** by this sequence alone — query
   `approval_evidence`/whatever table records founder approvals and show it is unchanged. Only
   this step actually proves the design claim in §7.2: authenticating is not approving.

Nothing here publishes, renders, or writes an approval. Steps 1–4 exercise routes that already
exist; step 5 is a read-only DB check.

## 7. HeyGen live read — reaffirmed, still outstanding, still separate

Not touched by this directive and not authorized here. Before any paid A-Roll render, the
outstanding requirement stands unchanged: one authenticated, unpaid HeyGen v3 read via the
Studio avatar/voice surface. This directive authorizes neither that read nor any paid rendering.

## 8. Tests

`apps/gateway/test/configReport.test.ts` and `apps/gateway/test/config.test.ts` — see the final
report for the specific properties each proves (missing-secret/missing-principals disable only
their own capability and never surface as anything but the documented status words; `COOKIE_SECRET`
stays `required_to_start`; `STEP_UP_COOKIE_SECRET` stays `feature_required`).

**Not covered by an automated test, stated plainly rather than silently skipped:** a full
gateway-boot integration test proving the process itself doesn't crash on a missing
`STEP_UP_COOKIE_SECRET`, and a shell-level test of `deploy.sh`'s health gate against a real
crash-looping vs. stable container. The former is exercised today by `stepup.test.ts`'s
existing `assertStepUpCookieSecret` unit tests plus the (already-merged, in #71) `try/catch` in
`server.ts` that catches exactly that throw — server.ts itself has no test harness that boots it
as a module (it runs top-level as a script), so this is verified by code inspection, not by an
automated regression test. The latter would need either a Docker-in-Docker harness or a
significant `deploy.sh` refactor into independently-testable functions — out of proportion to
this directive's scope. Both are named here rather than claimed as done.

## 9. Incident record

See [`docs/atelier/audits/incident-2026-09-11-stepup-cookie-secret.md`](audits/incident-2026-09-11-stepup-cookie-secret.md).

## Files changed

- `apps/gateway/src/config.ts` (new)
- `apps/gateway/src/configReport.ts` (new)
- `apps/gateway/src/server.ts` (boot report + `/health` rework)
- `packages/types/src/index.ts` (`HealthResponse.readiness`, additive)
- `infra/control-server/deploy.sh` (real post-deploy health gate)
- `apps/gateway/test/config.test.ts` (new)
- `apps/gateway/test/configReport.test.ts` (new)
- `docs/atelier/b1-3-operational-activation.md` (this file)
- `docs/atelier/audits/incident-2026-09-11-stepup-cookie-secret.md` (new)
