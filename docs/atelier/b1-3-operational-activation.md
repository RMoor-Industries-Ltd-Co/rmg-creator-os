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

## 5. B1.2 production activation — corrected status (updated after founder follow-up)

**Both `STEP_UP_COOKIE_SECRET` and `FOUNDER_PRINCIPALS` have been added to Doppler
(`master-atelier`, `prd`) by the founder.** This section previously said both "still need to be
added" — that was accurate when B1.3 was first drafted and is now stale; it is corrected here
rather than left standing. Neither value was added, read, or modified by this session — this
session has no write access to the `master-atelier` Doppler project (this session's
`DOPPLER_TOKEN` grants access only to the unrelated `axis-tekhen` project — confirmed via
`curl -u "$DOPPLER_TOKEN:" https://api.doppler.com/v3/projects`, not assumed) and secret values
are never printed or retrieved by any check in this document.

**A. Configuration presence (Doppler)** — done, per the founder. Not independently verifiable
from this session (no Doppler read/write access to `master-atelier`); taken on the founder's
word, as it must be — this session cannot and must not attempt to confirm a secret's presence by
any means that would expose it.

**B. Deployment wiring (Doppler → container env)** — verified from source, both variables:

```
infra/control-server/docker-compose.yml:91   STEP_UP_COOKIE_SECRET: ${STEP_UP_COOKIE_SECRET:-}
infra/control-server/docker-compose.yml:92   STEP_UP_MAX_AGE_SECONDS: ${STEP_UP_MAX_AGE_SECONDS:-}
infra/control-server/docker-compose.yml:96   FOUNDER_PRINCIPALS: ${FOUNDER_PRINCIPALS:-}
```

`deploy.sh` sources `doppler secrets download` with `set -a` (auto-export) before
`docker compose up -d`, so any variable Doppler holds under these exact names reaches the
gateway container's environment on the next deploy that runs this script. No gap here.

**C. Currently-running production image has consumed it** — **not verified, and not claimed.**
This session has no SSH access to the production server. What *is* verifiable from here: a
read-only `GET https://rmg-creator-os.rmasters.group/api/health` (public endpoint, no secret
exposure) right now returns

```json
{"status":"ok","service":"gateway","checks":{"postgres":"ok","redis":"ok","heygen":"ok","higgsfield":"ok","drive":"ok","allen":"ok"},"time":"..."}
```

— no `readiness` field, confirming the currently-running image predates this PR (expected,
since #72 is not merged/deployed). This says nothing about whether the *currently-running*
container's process environment already contains the founder's newly-added Doppler values:
`docker compose up -d` reads Doppler only at deploy time, containers do not hot-reload
environment changes, and this session cannot determine from outside whether a deploy has run
since the values were added. **This is exactly why §6's live validation, and simply watching
`/health.readiness` after the next normal deploy, is the actual proof — not anything checkable
before then.**

### Critical finding: the configured `FOUNDER_PRINCIPALS` value does not parse as intended

The founder-supplied value is a **plain comma-separated list of email addresses**:

```
rahm@rmasters.group,rmoorindustries@gmail.com,rahmind.consulting@rmoorind.com
```

`parseFounderPrincipals()` (`apps/gateway/src/founder.ts`) — unchanged by this follow-up, exactly
as originally documented and tested — requires **comma-separated `email=principalId` pairs**
(e.g. `rahm@rmasters.group=rahm@business`), consistent with §7.2's mapping design (an
authenticated Google email is not the same identity space as a Contract-36 canonical principal
id, so a plain set of emails cannot record evidence under an id the fabric will recognize).

Run against the exact configured string, the parser produces:

```
map.size === 0
malformed === ['rahm@rmasters.group', 'rmoorindustries@gmail.com', 'rahmind.consulting@rmoorind.com']
```

**All three identities are currently rejected. The founder set is empty; every founder-gated
write will refuse (fail closed — this is expected and correct behavior given the parser's
contract, not a crash or a security gap).** This was verified directly (running the parser
against the literal string, both ad hoc and as
`apps/gateway/test/founder.test.ts`'s new assertion) — not inferred.

**This was NOT worked around.** Per this follow-up's explicit instruction, the configured Doppler
value was not changed, and the parser was not loosened to accept a bare email list merely to
make it pass. The expected syntax, to fix this, is `email=principalId` pairs:

```
rahm@rmasters.group=<canonical-principal-id>,rmoorindustries@gmail.com=<canonical-principal-id>,rahmind.consulting@rmoorind.com=<canonical-principal-id>
```

The `<canonical-principal-id>` for each identity is a decision under Contract 36 (Approval
Authority and Founder Identity, `rmg-piaar-system`), not something this session should invent —
`apps/gateway/test/founder.test.ts` demonstrates the corrected shape mechanically using
placeholder ids (`rahm@business`, etc.) only to prove the parser accepts it; those exact
placeholder strings are not a recommendation for what the real ids should be.

**Operator action required, replacing what was previously listed:**

1. ~~Add `STEP_UP_COOKIE_SECRET` to Doppler~~ — done.
2. **Re-enter `FOUNDER_PRINCIPALS` in Doppler using `email=principalId` syntax** (see above) once
   the three canonical principal ids are decided. The current value is not silently wrong in a
   dangerous direction — it fails closed to "no founder" — but it does not authorize the
   identities it was clearly meant to.
3. **GCP redirect URI** — no evidence in this repository that this has been done; still an
   outstanding one-time console step (add
   `https://<dashboard host>/stepup-callback.html` as an authorized redirect URI on the
   `GOOGLE_CLIENT_ID` OAuth client). This blocks the *interactive* step-up flow from completing
   even once `STEP_UP_COOKIE_SECRET` is live; it does not block this PR's operational-hardening
   merge, and does not block `FOUNDER_PRINCIPALS` resolution (an unrelated, non-interactive
   check).

## 6. Live step-up validation plan (not executed)

Not run — `STEP_UP_COOKIE_SECRET` is reportedly configured, but `FOUNDER_PRINCIPALS` currently
parses to an empty founder set (see §5's critical finding), so step 2 below cannot pass yet
regardless of step-up's own state, and this directive does not authorize creating a fake Founder
approval or publishing anything. The smallest non-destructive proof, once `FOUNDER_PRINCIPALS`
is re-entered in the correct `email=principalId` syntax and a normal deploy has run:

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
