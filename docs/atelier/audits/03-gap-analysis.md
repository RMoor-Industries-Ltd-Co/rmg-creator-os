# 03 — Gap Analysis

Classification per directive §6. Ordered by operational importance within each class.

## 1. Executive verdict

### STRUCTURAL GAPS

Not "major rearchitecture": the durable spine — a Postgres job queue with retry and backoff, a
formalized `(capability, provider)` renderer registry, a staged production record, Drive-backed
asset lifecycle, Ad Index nomenclature, per-stage human review surfaces, aggregated health, and
a working CI→publish→deploy chain — is real, tested and worth preserving. Nothing in the
future state requires replacing it.

But three whole **layers** are absent rather than incomplete, and no amount of extension to
existing components produces them:

1. **Authority** — no actor, role, permission or audit concept exists anywhere.
2. **Durable pause** — the job model cannot represent "waiting for a human".
3. **Article-shaped production** — the job table is FK-bound to a video-shaped `productions`
   row.

Those are structural. Everything else is extension.

## 2. CURRENT INITIATIVE BLOCKER

Cannot proceed safely to a governed Accord reference run without resolving these.

| # | Finding | Evidence |
|---|---|---|
| B-1 | **No agent front door.** No `x-agent-key`/`AGENT_API_KEY`/`/api/agent*` in `apps/gateway`. ALLIE cannot authenticate to, read, or advance the factory. | `01` §7 |
| B-2 | **Job cannot pause for approval.** Status enum is `queued\|running\|done\|failed\|cancelled`. An L0 workflow that must stop at every gate has nowhere to stop. | `01` §4.3 |
| B-3 | **`production_jobs.production_id` is `notNull` FK to video-shaped `productions`.** An Accord job cannot be enqueued without fabricating a dummy video production. | `01` §2, §4 |
| B-4 | **Publish is ungated.** `POST /productions/:id/publish` never reads `deliveryApprovals`. At L0 every gate must be human; this one is not enforced at all. | `01` §8 |
| B-5 | **No approver identity on any approval.** Cannot demonstrate that a human authorized a gate — the core L0 requirement. | `01` §5 |
| B-6 | **Non-atomic claim + no idempotency.** Concurrent ticks can double-execute; a retry after a lost completion re-runs a paid render. | `01` §4.1 |
| B-7 | **Stranded `running` jobs are unrecoverable in-product.** Gate + signal, no control. | `01` §4.2 |

B-4 through B-7 are also **defects in the system as it stands today**, independent of this
initiative.

## 3. EXTENSION REQUIRED

Structurally correct; needs an interface, schema, state or adapter added.

| # | Component | Extension |
|---|---|---|
| E-1 | `production_jobs` | Polymorphic/nullable parent + idempotency key + lease/reaper + `awaiting_approval` state |
| E-2 | `productionJobCapability` enum | Add `editorial_review`, `image_plan`, `image_generate`, `implementation`, `promotion` |
| E-3 | Worker claim | `FOR UPDATE SKIP LOCKED` (or conditional update), write `workerId`, honour cancellation, per-capability timeout |
| E-4 | `deliveryApprovals` | Promote from jsonb blob to an approval record with approver, role, verdict, timestamp, artifact version |
| E-5 | Publish path | Read the approval record and refuse an unapproved artifact |
| E-6 | Queue API | Add an approval-queue read ("what needs my approval?") |
| E-7 | `/health` | Already good; add queue depth, stranded-job count, oldest pending approval |
| E-8 | Renderer registry | Already the right shape for Chappie-T as a *role* with subordinate renderers — extend, don't replace |
| E-9 | Postiz client | Add post-publication status/URL write-back (`createPost` result is currently returned but not persisted) |
| E-10 | `productions.brand` | Free text → validated identifier, once P-5 resolves |

## 4. FUTURE GAP

Does not exist; will eventually be required.

| # | Gap |
|---|---|
| F-1 | Initiative entity above production |
| F-2 | Actor/principal + role + capability-grant tables |
| F-3 | Audit log (directive §11's nine questions) |
| F-4 | Artifact lineage/versioning across the full chain |
| F-5 | Structured logging with request/correlation ids |
| F-6 | Operational alerting (no alerting exists anywhere) |
| F-7 | Dead-letter path with signal and control |
| F-8 | MCP client/registry surface |
| F-9 | Producer-type configuration registry |

## 5. ARCHITECTURAL DECISION REQUIRED

Multiple legitimate designs; founder/architecture authority must choose. Detailed in
[08-open-decisions.md](08-open-decisions.md).

| # | Decision |
|---|---|
| D-A | **MCP vs. contract 14's "assistant-in-loop only" rule.** The rule currently forbids headless pipeline stages from depending on MCP. The initiative requires exactly that. Amend the contract deliberately, or route MCP calls through an authorized headless bridge. |
| D-B | **BullMQ vs. the Postgres queue.** `README.md` and ADR-0001 name BullMQ; it is not installed. Ratify the DB queue, or adopt BullMQ. Do not leave both documented. |
| D-C | **HVN brand identity** — `BrandKey` vs `StoreKey` (P-5). Already codified as open in `packages/types/test` and `packages/wordart`. |
| D-D | **Where Producer job state lives** — Creator OS, or a new service. |
| D-E | **Publishing architecture** — Postiz / direct provider APIs / hybrid adapter. See [06](06-social-manager-disposition.md). |
| D-F | **Approval authority model** — role-based grants in Creator OS, or delegated to the PIAAR MCP fabric's `authz` package (which already implements default-deny per principal). |

## 6. STALE / CONTRADICTORY

| # | Claim | Reality |
|---|---|---|
| S-1 | `README.md:33` — *"Redis + BullMQ is the job backbone"* | BullMQ is not a dependency; Redis serves a health ping only |
| S-2 | `README.md:32` — *"Render Linode … dedicated render worker"* | No render-worker service in compose; nothing in-repo consumes a second node |
| S-3 | `production-capability-inventory.md` — CI gate is *"typecheck + build only, no tests"*, testing 1/5 | CI now runs `pnpm test`; 11 unit test files exist. **Stale in the system's favour** |
| S-4 | Contract 29 status — *"Planned (spec — Phase 0/research)"* | `packages/wordart` exists with source, tests and fixtures |
| S-5 | `docs/contracts/` declared *frozen and unmaintained* | `20-hvn-accord-promotion-package.md` was added post-freeze and collides with contract 20 (MAAT) in the canonical set |
| S-6 | ADR-0001 ecosystem architecture | Predates the renderer registry and the DB queue as built |

## 7. KEEP AS-IS

Do not regress these while fixing the above.

1. `(capability, provider)` renderer registry — already the correct abstraction for role-vs-tool
2. Drive-as-source-of-truth asset lifecycle
3. Ad Index nomenclature and issuance
4. Approved-voice-take lock (`voiceTakeAssetIdV3`) — a working anti-drift guarantee
5. Soul/Element character consistency
6. Aggregated `/health` with the deep ALLEN sub-check
7. Tailscale-only binding of Postgres and Redis
8. Postiz client's `postizConfigured()` fail-closed gating
9. CI → publish → deploy chain
10. Single-tenant allowlist auth **for humans** (it is right-sized; it is machine auth that is missing)

## 8. NOT REQUIRED

| # | Item | Why not |
|---|---|---|
| N-1 | Event bus / Redis Streams / n8n | The DB queue is the transport; no demonstrated requirement |
| N-2 | Multi-tenant RBAC | Small-team model is deliberate; roles are needed for *agents*, not for many humans |
| N-3 | A second publishing engine alongside Postiz | Until D-E resolves, one engine |
| N-4 | Rewriting `productions` | Add a sibling producer-job record; do not migrate the video lane |
| N-5 | Extracting the Word Art package | Recently built, tested, in the right place |
