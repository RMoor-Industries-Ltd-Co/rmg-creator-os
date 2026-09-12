# B1.3 — Operational Activation & Deployment Health Guard

**Status: COMPLETE** (closed 2026-09-12). Scope: configuration preflight, a secret-free startup
configuration report, a three-tier `/health` model (process / dependency / capability
readiness), a real post-deploy health gate, and the operator actions needed to bring B1.2's
governance primitives fully live in production. **A-Roll candidate/canonical implementation and
B2 were not started at any point during B1.3.**

## Closing summary

All of the following are true in production as of the `#73` deploy
(`38aaf1f73bb39a6a47d8eef371627dd9348f029e`):

| Item | Status |
|---|---|
| Configuration preflight (`config.ts` classification table) | Implemented |
| Secret-free startup configuration report (`configReport.ts`) | Implemented |
| Process / dependency / capability-readiness `/health` split | Implemented |
| Deployment stabilization gate (`deploy.sh`) | Implemented, **proven in production** (caught a real deploy on `c125c281` reporting a defect live, and passed cleanly on `38aaf1f`) |
| `STEP_UP_COOKIE_SECRET` | Live (`readiness.step_up: enabled`) |
| `FOUNDER_PRINCIPALS` | Live (`readiness.founder_approval: enabled`) |
| Google step-up OAuth redirect URI | Configured (`https://rmg-creator-os.rmasters.group/stepup-callback.html`, matching `StepUp.tsx`'s constructed `redirect_uri` exactly) |
| `#65`–`#71` boot-crash incident | Documented — `docs/atelier/audits/incident-2026-09-11-stepup-cookie-secret.md` |
| `#73` readiness-reporting defect | Documented and fixed — `docs/atelier/audits/incident-2026-09-11-founder-principal-count-object-keys.md`. **This was a reporting bug (`Object.keys()` on a `Map`), never a Founder-authorization failure or a Doppler/parser problem** — the distinction matters and is preserved here rather than conflated. |

## Interactive Founder step-up: infrastructure vs. end-to-end validation

**Infrastructure status: configured and production-ready.** Every piece exists and is wired
correctly:

- `StepUpPrompt` (`apps/dashboard/src/StepUp.tsx`) is mounted globally in `App.tsx` (its footer).
- `apps/dashboard/src/api.ts`'s `req()` checks every response for `code: 'step_up_required'` and
  calls `requestStepUp()` when it sees one.
- `STEP_UP_REQUIRED_CODE` (`apps/gateway/src/stepup.ts:22`) is the discriminator the gateway
  would use to signal this.
- The OAuth redirect URI the popup constructs matches what's now configured in the Google
  console.

**Interactive end-to-end validation status: deferred, not failed, not blocked.** Verified by
grepping the entire gateway source: **no deployed route currently returns
`STEP_UP_REQUIRED_CODE`.** Founder authorization (`resolveFounderPrincipal()` / `isFounder()`)
is likewise parsed and counted (for the readiness report) but never consulted by any live route
handler. There is therefore no UI action today that can reach the `step_up_required` branch —
not because anything is broken, but because B1.2 §13 step 6 (the founder-gated write path that
would consume this) has not been implemented yet. This is a scope boundary, not a defect: never
worked around here with a temporary trigger, test endpoint, or fabricated approval.

**Future acceptance condition — binding on whichever PR implements the first Founder-gated
write path.** That PR's acceptance tests (live or integration) must prove the full chain:

1. An ordinary authenticated human session exists.
2. That session's email resolves to a mapped Founder principal (`resolveFounderPrincipal`).
3. The sensitive write requires a fresh step-up credential.
4. Absent one, the gateway returns `step_up_required`.
5. The dashboard's `req()` catches this and invokes `StepUpPrompt`.
6. Google's OAuth flow returns through `/stepup-callback.html`.
7. A fresh step-up credential is issued and accepted (`POST /auth/google/step-up`).
8. The original write is retried and succeeds.
9. The recorded approval evidence names the **mapped** Founder principal id (e.g.
   `rahm@business`), never the raw authenticating email.
10. Authenticating alone — steps 1-7 with no write attempted — creates no approval evidence and
    advances no workflow state.

## HeyGen v3 unpaid-read gate

A safe, existing, read-only Studio action satisfies this gate without any code change:

- **Navigation:** dashboard top nav → **Studio** tab (`/studio`). No further click needed.
- **Mechanism:** `Studio.tsx`'s mount effect (`Studio.tsx:26`) calls `api.avatars()` and
  `api.voices()` automatically, which hit `GET /heygen/avatars` / `GET /heygen/voices`
  (`server.ts:435-444`) → `listAvatars()` / `listVoices()` (`packages/integrations/src/heygen.ts`)
  → HeyGen **v3** `GET /v3/avatars/looks` and `GET /v3/voices` respectively, both paginated via
  `next_token` until exhausted. Purely read-only: no video is created, no generation submitted,
  no provider state mutated.
- **Observable evidence:** on success, the avatar/voice pickers populate with real data. On
  failure, `Studio.tsx:93` renders `"Couldn't load HeyGen: <error>"` with the underlying error
  message — nothing is silently swallowed.
- **Status:** the safe UI trigger exists; this session cannot itself drive a browser as the
  Founder (no interactive session/credentials), so the live read itself is pending the Founder
  opening the Studio tab once. **Gate: STILL OUTSTANDING** until that navigation happens and is
  confirmed clean (no `loadError` banner, non-empty avatar/voice lists).

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
make it pass. The expected syntax, `email=principalId` pairs, was documented; a second follow-up
investigated the correct principal id against `rmg-piaar-system`/`rmg-piaar-mcps`'s existing
identity conventions rather than inventing one (below).

### Resolved: correct principal id, and the corrected value now in Doppler

`rmg-piaar-mcps/packages/identity/src/index.ts` fixes the fabric's identity shape as
`<systemId>@<domain>` with exactly two domains, `business` and `personal` — there is no
per-email or per-third-domain scheme anywhere in the fabric. `docs/atelier/phase-b-governance-primitives-design.md`
§14's **Ratified Decision #1** (founder-approved 2026-09-09) states plainly: *"Human identities
are domain-scoped. The initial founder principal is `rahm@business`."* §7 of the same document:
*"Rahm is one person; `rahm@business` and `rahm@personal` are two capabilities that person
holds."* Three email addresses authenticating into the same business-domain founder-gated write
path are three **credentials** for one **capability** — not three principals. Inventing
`rahm@business-alt` / `rahm@rmoorind`-style per-email ids would have fragmented one ratified
principal into three and matched no existing convention.

**The founder has corrected `FOUNDER_PRINCIPALS` in Doppler to:**

```
rahm@rmasters.group=rahm@business,rmoorindustries@gmail.com=rahm@business,rahmind.consulting@rmoorind.com=rahm@business
```

Verified directly against the exact literal string (both ad hoc and as
`apps/gateway/test/founder.test.ts`'s existing assertion, unchanged from before): **parses
cleanly, zero malformed entries, all three emails resolve to `rahm@business`.**

```
map.size === 3
malformed === []
map: rahm@rmasters.group -> rahm@business
     rmoorindustries@gmail.com -> rahm@business
     rahmind.consulting@rmoorind.com -> rahm@business
```

One noted, non-blocking consequence of the domain-scoped model (not an ambiguity requiring a
decision here — Contract 36 already frames it this way): approval evidence will record
`rahm@business` as the approving principal, never which of the three emails was used for that
particular authentication. That is the intended shape — Contract 36 asks "was this caller a
human founder," not "which of his emails."

**Operator action list, updated:**

1. ~~Add `STEP_UP_COOKIE_SECRET` to Doppler~~ — done.
2. ~~Re-enter `FOUNDER_PRINCIPALS` in Doppler using `email=principalId` syntax~~ — done, verified
   above.
3. **GCP redirect URI** — no evidence in this repository that this has been done; still an
   outstanding one-time console step (add
   `https://<dashboard host>/stepup-callback.html` as an authorized redirect URI on the
   `GOOGLE_CLIENT_ID` OAuth client). This blocks the *interactive* step-up flow from completing
   even once `STEP_UP_COOKIE_SECRET` is live; it does not block this PR's operational-hardening
   merge, and does not block `FOUNDER_PRINCIPALS` resolution (an unrelated, non-interactive
   check).
4. **Deploy #72 to production** — this is the one remaining precondition for §6/§6a below: the
   currently-running production image predates this PR (confirmed by a fresh `GET /api/health`
   immediately before this update — still no `readiness` field), so `/health.readiness`,
   `deploy.sh`'s new health gate, and the live step-up plan are all necessarily **post-merge**
   activities. They cannot be verified against a build that isn't running.

## 6. Live step-up validation plan (not executed)

Not run — `FOUNDER_PRINCIPALS` now parses correctly (above) and `STEP_UP_COOKIE_SECRET` is
reportedly configured, but this directive does not authorize creating a fake Founder approval or
publishing anything, and — see §6a — the code that would make any of this observable
(`/health.readiness`) is not yet deployed. The smallest non-destructive proof, once #72 is merged
and a normal deploy has run:

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

## 6a. Pre-merge verification performed (this follow-up)

What could be checked **before** merging/deploying #72, and was:

- **Parser correctness against the exact corrected Doppler value** — done, see above (3/3
  identities resolve to `rahm@business`, zero malformed).
- **PR #72 mergeability and CI** — `mergeable_state: clean` against current `main`
  (`8dc430c`), no merge conflict; the branch is a fast-forward-safe merge. CI (`validate`) and
  both CodeQL jobs green on the current head (`d45f1c0`).
- **Full regression** — `pnpm -r typecheck` (6/6 packages) and the real-Postgres suite (378/378
  tests) pass unchanged on this branch, confirming no drift since the last run.
- **Ordinary auth / worker fail-closed behavior** — unchanged by this follow-up (no source edits
  to `auth.ts`, `workerAuth.ts`, `worker.ts`, or `stepup.ts` in any B1.3 commit); covered by
  their existing, still-passing test suites (`auth.test.ts`, `workerAuth.test.ts`,
  `worker.test.ts`, `stepup.test.ts`).
- **Current production baseline** — a fresh, read-only `GET /api/health` immediately before this
  update still returns `{"status":"ok",...}` with no `readiness` field, confirming the
  currently-running image is pre-#72 (as expected — #72 is not deployed).

What **cannot** be checked before merge, and why — this is sequencing, not a gap in the work:

- **`/health.readiness` reporting step-up/founder as configured** — the `readiness` field is
  code that ships *in* #72. It cannot appear in a response from a container running the
  pre-#72 image. This becomes checkable the moment a deploy carrying #72's commit completes.
- **Gateway stability post-deploy** — by definition, a statement about a deploy that hasn't
  happened. `deploy.sh`'s own new health gate (§4) is exactly the mechanism that will make this
  self-verifying on the next deploy: if the gateway is not stable, the deploy workflow fails
  before "success" is ever reported.
- **The live step-up validation plan (§6 above)** — needs the deployed code (for
  `STEP_UP_CONFIGURED`/founder-resolution to be reachable) and the still-outstanding GCP
  redirect URI (operator action #3 above) for the interactive Google flow to complete at all.

**Recommendation:** merging #72 is the next required step to make the remaining checks
possible, not a skipped step in verifying them. `deploy.yml`'s pipeline (CI → Publish Images →
Deploy, the last stage now gated by §4's stabilization check) runs automatically on merge to
`main`. Immediately after that deploy completes, this session will re-check `/api/health` for
the `readiness` field and its reported values (never a value round-trip, only status words),
confirm the deploy workflow itself reported success under the new gate, and report back before
considering B1.3's production-activation verification fully closed.

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
