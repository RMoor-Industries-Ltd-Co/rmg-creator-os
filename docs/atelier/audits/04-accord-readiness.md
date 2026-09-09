# 04 — Accord Readiness

Can Creator OS receive, track and advance an HVN Accord production today, and what must change
before the first **governed (L0)** reference run?

## 1. Answer

**No, not today** — for four structural reasons, not for want of polish.

1. `production_jobs.production_id` is `notNull` with an FK to the video-shaped `productions`
   table, so an article job cannot be enqueued without fabricating a dummy video production.
2. There is no way for ALLIE — or any agent — to authenticate to Creator OS at all.
3. A job cannot pause for a human decision, which is the defining requirement of L0.
4. No approval record carries approver identity or role, so a governed run could not
   *demonstrate* that a human authorized each gate even if one did.

## 2. What exists in Creator OS for the Accord today

| Surface | State |
|---|---|
| HVN as an identifier | `StoreKey = 'hvn'` only; **not** a `BrandKey` (`packages/types`) |
| Accord article model | **None** — no code surface; `grep -i accord` over `apps`/`packages` returns nothing |
| Promotion package | Contract only (`docs/contracts/20-hvn-accord-promotion-package.md`), spec, no implementation |
| My Poster | `deliveryApprovals` + `deliveryChecklist` + `/ad-index/*` — real, but video-lane |
| Drive | `packages/integrations/src/drive.ts` — real, reusable as-is |
| Social/publish | Postiz client — real; see [06](06-social-manager-disposition.md) |
| Chappie-T | **Nothing.** No reference in any repository (confirmed across all ten) |
| ALLIE / ALLEN | ALLEN reachable via `apps/gateway/src/allen.ts` (`ALLEN_URL`). ALLIE has no inbound path *into* Creator OS |

The direction of the ALLEN link matters: Creator OS **calls** ALLEN. Nothing calls Creator OS.
The supervision relationship the initiative requires is the reverse of the one that exists.

## 3. MUST change before the first governed Accord run

Minimum set. Each maps to a blocker in [03](03-gap-analysis.md) §2.

| # | Change | Blocker |
|---|---|---|
| A-1 | Agent front door: `POST /api/agent` + `GET /api/agent/report`, constant-time key check, matching the Cappo/Constance/Vale pattern | B-1 |
| A-2 | Producer job record with an explicit state field, and a **queue parent that is not the video `productions` row** (nullable/polymorphic + `enqueueJob`/worker/API migration) | B-3 |
| A-3 | An `awaiting_approval` job state that consumes no worker and is cleared only by a recorded decision | B-2 |
| A-4 | Approval records carrying approver, role, verdict, timestamp, artifact version | B-5 |
| A-5 | Atomic claim (`FOR UPDATE SKIP LOCKED` or conditional update) + `workerId` written | B-6 |
| A-6 | Lease expiry + reaper so a stranded `running` job has a **control** | B-7 |
| A-7 | Idempotency key per (job, capability, placement), checked before any paid or outward side effect | B-6 |
| A-8 | Publish path reads the approval record and refuses unapproved artifacts | B-4 |

A-5 through A-8 are worth doing **even if the Accord initiative were cancelled** — they are
defects in the live video lane today.

## 4. CAN wait until after the first run

| Change | Why it can wait |
|---|---|
| Initiative entity | One article can be tracked without it |
| Full audit log | The job's transition history covers the first run if each transition records actor + reason |
| Artifact lineage/versioning | Drive + Ad Index carry enough provenance for one article |
| MCP integration | The first run is manual-but-structured (directive Phase 3); MCP is Phase 4 |
| Structured logging, alerting | Operator is watching a single supervised run |
| Producer-type configuration registry | One producer type can be hard-configured; genericity is proven on the *second* |
| Promotion-package builder | Terminal state for the first run is an acknowledged handoff, not distribution |
| Distinctiveness-log write-back | Required before the **second** article, not the first — but it must exist before article two or the no-repeat rule silently stops working |

## 5. Cross-repo dependencies the Accord run inherits

| Repo | Dependency |
|---|---|
| `hvnglobalco-com` | Has no `src/lib/`, no API, no database. Gate A's transport and Gate C's CI checks both live there and do not exist |
| `rmg-piaar-system` | Contracts 31/32/33 unratified; registry has no `chappie-t`, no producer, no Accord governance principal |
| `rmg-piaar-mcps` | No downstream entry for `rmg-creator-os`; no grants for any new principal |
| `rmg-ai` | No tool reaches Creator OS; `rollup.py` has no atelier source |

**Creator OS is not the long pole.** Even with A-1…A-8 complete, the first governed run also
requires the governance decisions (P-4, P-5) and at least a Gate A transport in
`hvnglobalco-com`.
