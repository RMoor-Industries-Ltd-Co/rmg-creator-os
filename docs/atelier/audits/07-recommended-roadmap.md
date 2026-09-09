# 07 — Recommended Roadmap

Dependency-aware. Every item names repo, component, reason, dependency, risk, whether it blocks
the Accord run, and sequence. **Nothing here is authorized by this audit** — it is a
recommendation for the implementation plan.

## NOW — required for the Accord MCP / reference production initiative

| Seq | Repo | Component | Change | Reason | Depends on | Risk | Blocks Accord |
|---|---|---|---|---|---|---|---|
| 1 | `rmg-creator-os` | `worker.ts` | Atomic claim (`FOR UPDATE SKIP LOCKED` or conditional update); write `workerId` | Concurrent ticks can double-execute a paid render | — | Low; contained, testable | **Yes** (B-6) |
| 2 | `rmg-creator-os` | `worker.ts` + `routes/queue.ts` | Lease expiry + reaper returning stale `running` → `queued`; allow force-cancel of `running` | A stranded job today has no control at all | 1 | Low | **Yes** (B-7) |
| 3 | `rmg-creator-os` | `server.ts` publish path | Read the approval record; refuse unapproved artifacts | Publish is ungated; at L0 every gate is human | 6 | Low, but changes live behaviour — **stage behind a flag** | **Yes** (B-4) |
| 4 | `rmg-creator-os` | `packages/db` | Queue-parent migration: nullable/polymorphic parent + `enqueueJob`/worker/API migration | `production_id` is `notNull` FK to a video-shaped row | — | Medium — touches the live queue; needs a migration test | **Yes** (B-3) |
| 5 | `rmg-creator-os` | `packages/db` | `producer_jobs` + explicit state (text + inline union, per contract 29) incl. `awaiting_approval` | A job cannot pause for a human today | 4, and **P-5** for `brand` | Medium | **Yes** (B-2) |
| 6 | `rmg-creator-os` | `packages/db` | Approval record: approver, role, verdict, timestamp, artifact version | Cannot demonstrate a human authorized a gate | 5 | Low | **Yes** (B-5) |
| 7 | `rmg-creator-os` | `packages/db` + worker | Idempotency key per (job, capability, placement), checked before the side effect | Retry after a lost completion re-runs paid work | 1, 4 | Medium | **Yes** (B-6) |
| 8 | `rmg-creator-os` | `apps/gateway` | Agent front door: `POST /api/agent`, `GET /api/agent/report`, constant-time key | ALLIE cannot reach the factory at all | 5, 6 | Low — copy the Cappo/Constance/Vale pattern | **Yes** (B-1) |
| 9 | `rmg-ai` | `allen/tools_atelier.py`, `rollup.py` | Delegate + pull-report tool; `("atelier", …)` rollup source | ALLEN cannot summarize production status | 8 | Low | **Yes** |
| 10 | `hvnglobalco-com` | new `/api/agent` | Gate A transport | Editorial governance has no machine surface | governance P-4 | Medium — first backend in that repo | **Yes** |
| 11 | `rmg-piaar-system` | contracts 31/32/33 + registry | Ratify; register `chappie-t`, `accord-producer`, governance principal | No role may exist before its contract | P-4, P-5 | Low | **Yes** |

Items 1, 2, 3 and 7 fix **defects in the live video lane** and are worth doing regardless of
this initiative.

## NEXT — reusable Master Atelier agentic framework

| Seq | Repo | Component | Change | Reason | Blocks Accord |
|---|---|---|---|---|---|
| 12 | `rmg-creator-os` | `packages/db` | Actor/principal + role + capability-grant tables | Authority as first-class state | No |
| 13 | `rmg-creator-os` | `packages/db` | Audit log answering directive §11's nine questions | Automation with institutional memory | No |
| 14 | `rmg-creator-os` | `apps/gateway` | Producer-type configuration registry | Second producer must be config, not code | No |
| 15 | `rmg-creator-os` | queue | Per-capability timeout; cancellation observed mid-flight; dead-letter with signal + control | Unattended operation | No |
| 16 | `rmg-creator-os` | `apps/gateway` | Structured logging with correlation ids | "Who/what acted?" | No |
| 17 | `rmg-piaar-mcps` | config | Downstream entry for `rmg-creator-os`; minimal default-deny grants | Least authority | No |
| 18 | `rmg-creator-os` | new `McpClient` iface | MCP consumption behind the renderer-style abstraction | Tools resolved for a capability, never chosen by the holder | No |
| 19 | `hvnglobalco-com` | CI | Gate C's real checks (routes, metadata, canonical, sitemap, redirects, alt text, links) | Gate C has no evidence otherwise | No — but blocks Gate C trust |
| 20 | `hvnglobalco-com` | docs | Authorized append to the distinctiveness log on approval | No-repeat silently stops working after article one | **Blocks article TWO** |

## LATER — distribution, multi-platform, analytics, higher autonomy

| Seq | Item | Note |
|---|---|---|
| 21 | Promotion-package builder emitting contract 30's shape | After the handoff terminal state is proven |
| 22 | Post-publication status/URL write-back | `createPost`'s result is currently discarded |
| 23 | Publishing-engine decision (D-E) and any Social Manager work | See [06](06-social-manager-disposition.md) — deferred, not cancelled |
| 24 | Drive move-on-post automation | `contracts/11-asset-lifecycle.md` assumes it; unimplemented |
| 25 | Operational alerting | The single biggest barrier to genuinely unattended running |
| 26 | Autonomy above L0 | Only on demonstrated reliability at the current level |
| 27 | Analytics / performance feedback loop | Last stage of the directive's §14 flow |

## DO NOT BUILD

| Item | Why |
|---|---|
| Event bus / Redis Streams / n8n | The DB queue is the transport; no demonstrated requirement |
| BullMQ adoption **as an assumption** | Resolve D-B first; the DB queue may simply be ratified |
| A second publishing engine alongside Postiz | Redundant while Postiz is deployed and D-E is open |
| Multi-tenant RBAC for humans | Roles are needed for *agents*; the human allowlist is right-sized |
| Rewriting `productions` for articles | Add a sibling record; do not migrate the working video lane |
| Any MCP integration before D-A is decided | Contract 14 currently forbids it for headless stages |
| Migrating `Social_Manager_v2.0` | Evaluate under authorized read access first |

## Sequencing note

Items 1–3 are independent of the Accord initiative and independently valuable, so they can
start immediately once authorized. Items 4–8 form one dependent chain and should be one
reviewed sequence, not parallel work. Item 5 is **hard-blocked on P-5** (HVN brand identity),
which is a founder decision, not an engineering task.
