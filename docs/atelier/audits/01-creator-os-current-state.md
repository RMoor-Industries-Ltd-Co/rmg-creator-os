# 01 — Creator OS: Current State (evidence-linked)

Audited at `8cffdc4`. Every claim below cites the file that establishes it. Where earlier
Master Atelier documents disagree with the code, the code is treated as authoritative and the
divergence is recorded.

## 1. Repository topology

pnpm workspace, Node 22, TypeScript.

| Path | Contents |
|---|---|
| `apps/gateway` | Fastify API — `server.ts` (2670 lines), `worker.ts`, `auth.ts`, `allen.ts`, `postiz.ts`, `compose.ts`, `feeds.ts`, `youtube.ts`, `routes/{queue,delivery,atelier_broll}.ts` |
| `apps/dashboard` | Vite/React operator UI |
| `packages/db` | Drizzle schema, client, migrations, `queue.ts` |
| `packages/types` | `BrandKey`, `StoreKey`, `Channel`, `BRANDS`, `ServiceId` |
| `packages/integrations` | `drive.ts`, `heygen.ts`, `higgsfield.ts`, `stock.ts`, `renderer.ts` |
| `packages/wordart` | Word Art domain logic **+ tests + fixtures** |
| `infra/control-server` | `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `.env.example` |
| `docs/` | `adr/` (4), `architecture/`, `atelier/` (10), `contracts/` (frozen mirror + one addition) |
| `e2e/` | `smoke.spec.ts` |

## 2. Control plane — what Creator OS can represent today

| Concept | Representation | Status |
|---|---|---|
| Production | `productions` table | **Implemented** — but video-shaped (`scriptText`, `taggedScript`, `voiceTakeAssetIdV3`, `higgsfieldScenes`, `brollScenes`, `finalVideoId`) |
| Recipe | `recipes` + `jobs` tables | Declared in schema; **no execution engine found** |
| Job | `production_jobs` | **Implemented** — see §4 |
| Asset | `assets` table, Drive-backed | **Implemented** |
| Video render | `videos` table with `approved` boolean | Implemented |
| Post | `posts` table, per-platform | Implemented |
| Ad Index | `ad_index` table + `/ad-index/*` | **Implemented** — canonical publication nomenclature |
| Character | `characters` table (Higgsfield Soul/Element) | Implemented |
| Approval | `productions.deliveryApprovals` jsonb; `videos.approved` bool | **Partial** — see §5 |
| **Initiative** | — | **Absent** |
| **Actor / agent** | — | **Absent** |
| **Role / authority** | — | **Absent** (the only `role` column is `assets.role`: `source \| brand \| generated` — asset provenance, not authority) |
| **Audit log** | — | **Absent** |
| **Step / workflow state** | — | **Absent** — `productions.stage` is free text with default `'script'` |
| **External provider state** | `videos.status`, `resultId` | Partial, per-capability |

`productions.stage` and `productions.status` are **free-text with defaults**, not enums. There
is no finite-state machine and no transition validation anywhere in the codebase.

## 3. Brand model

`packages/types/src/index.ts` — `BrandKey` is `rmg | mstr-rahm | com | busy-mf | orr | vlog |
trc | tgl`. HVN is **not** a `BrandKey`; it is `StoreKey = 'hvn'`.

`packages/types/test/index.test.ts:41` asserts this deliberately:

> `"STORE_KEYS includes 'hvn', which is a store but NOT a content BrandKey"`

and `packages/wordart/src/wordArt.ts:174` carries `// DECIDED — a real BrandKey/StoreKey from
contract 12; HVN/AMG scope OPEN`.

**This is codified, tested evidence that HVN's content-brand identity is an open question in
this repository today** — independently corroborating decision P-5 in
`rmg-piaar-system/docs/master-atelier/04-founder-decisions.md`.

`productions.brand` is nonetheless stored as **free text** with no FK or enum
(`packages/db/src/schema.ts:29`).

## 4. Orchestration — the queue as built

`production_jobs` (`packages/db/src/schema.ts:236`): `id`, `productionId` (**notNull**, FK to
`productions`), `capability` (enum: `aroll | broll | lipsync | audio | thumbnail | poster`),
`provider` (text), `payload` jsonb, `status` (enum: `queued | running | done | failed |
cancelled`), `priority`, `attempt`, `maxAttempts`, `resultId`, `error`, `lockedUntil`,
`workerId`, three timestamps.

Execution is `POST /worker/tick` (`apps/gateway/src/worker.ts`), dispatching through
`renderers.resolve(capability, provider)` (`packages/integrations/src/renderer.ts`).

### 4.1 The claim is not atomic — **defect, not repaired**

`worker.ts` performs a `SELECT … LIMIT 1` and then a **separate** `UPDATE … SET status =
'running'`. There is no `FOR UPDATE SKIP LOCKED`, no conditional `WHERE status = 'queued'` on
the update, and no transaction around the pair. Two concurrent ticks can select the same row
and both proceed to `dispatch()`.

`lockedUntil` is written **only on retry backoff**, never on claim — so it does not serialize
claims. `workerId` is declared in the schema and **never written by any code path**
(`grep workerId` returns only the schema line).

Consequence: a duplicated claim on `capability = 'aroll'` is a duplicated **paid HeyGen
render**. There is no idempotency key anywhere in the job model.

### 4.2 A crashed worker strands a job forever — **defect, not repaired**

Nothing in the codebase moves a job out of `running`. The claim query matches only
`status = 'queued'`, so a `running` row is never re-claimed. There is no reaper, no lease
expiry applied to `running`, and no timeout around `dispatch()`.

The recovery paths both refuse it:

- `DELETE /queue/:id` → `409 cannot cancel a running job` (`routes/queue.ts:80`)
- `POST /queue/:id/retry` → `409 only failed or cancelled jobs can be retried`

So a stranded job has a **gate** (it stops) and a **signal** (visible in `GET /queue`) but
**no control** — the exact two-out-of-three failure that `rmg-piaar-system`'s
`docs/AUTONOMY_CHECKS_AND_BALANCES.md` was written after. Clearing one requires direct SQL.

### 4.3 No pause-for-approval status

The status enum has no `waiting_for_approval` / `blocked` member. A job cannot durably park
awaiting a human decision; the only ways to stop are `done`, `failed` or `cancelled`.

### 4.4 Cancellation is not observed mid-flight

`dispatch()` never re-reads the row, so a job cancelled after claim continues to completion.

### 4.5 No dead-letter queue

Exhausted retries set `status = 'failed'` in place. There is no DLQ table, no alert, and no
escalation.

## 5. Human approval / governance as built

Two mechanisms exist:

- `productions.deliveryApprovals` jsonb — `{ [brandSlug]: 'pending' | 'approved' | 'rejected' }`
- `videos.approved` boolean, with `POST /videos/:id/approve` clearing prior approvals for the
  same production + source

Representable: **pending, approved, rejected**. Not representable: *revision requested*,
*escalated*, *overridden*.

Neither mechanism records **who** approved, **in what role**, or **when** — there is no
approver column and no timestamp on the approval itself, only the row's `updatedAt`.

**Approval authority cannot be associated with a role**, because no role concept exists (§2).

## 6. Agent model

**There is none.** No `agents`, `actors`, `roles`, `capabilities`, `permissions`,
`assignments`, `provenance`, `actions`, `decisions` or `tool_calls` table exists. `grep` over
`packages/db/src/schema.ts` for `actor|agent|role|audit|permission|principal|provenance`
returns a single hit: `assets.role`.

Consequence: a Producer agent cannot coordinate a specialist *as itself* — any action it takes
is indistinguishable from any other authenticated session (§7).

## 7. Authentication and authorization

`apps/gateway/src/auth.ts` — single-tenant Google sign-in against a comma-separated
`AUTH_ALLOWED_EMAILS` allowlist, cookie session. Every allowlisted human is equivalent; there
are no scopes, roles or per-route permissions.

**There is no machine/agent authentication surface at all** — no `x-agent-key`, no
`AGENT_API_KEY`, no `/api/agent*` route (`grep` over `apps/gateway/src` returns nothing). Cappo,
Constance and Vale each expose exactly such a surface; the production engine does not.

## 8. Publication authority — **defect, not repaired**

`POST /productions/:id/publish` (`server.ts:2196`) requires only:

1. `postizConfigured()`
2. `PUBLIC_API_BASE` set
3. a completed video — preferring `source = 'final'`, then any `approved`, then **any completed
   render at all**
4. at least one composed platform draft

It **never reads `deliveryApprovals`**. The per-brand My Poster approval gate — described in
`production-capability-inventory.md` as a high-value asset to protect — is enforced nowhere on
the path that actually publishes. Any allowlisted session can push an unapproved cut to live
social channels.

This is the clearest instance in the repository of **technical capability becoming governance
authority**.

## 9. Social Manager as built

Creator OS's Social Manager **is self-hosted Postiz**:

- `apps/gateway/src/postiz.ts` — *"Client for the self-hosted Postiz public API (the Social
  Manager engine)"*. Surface: `listIntegrations`, `uploadFromUrl`, `createPost`,
  `matchIntegration`. Gated on `POSTIZ_API_KEY`, inert without it.
- `infra/control-server/Caddyfile:28` — *"Social Manager for RMG (self-hosted Postiz) — separate
  app, owns its host"*, reverse-proxying `social.rmasters.group` → `postiz:5000`.
- `infra/control-server/.env.example:38-39` — `POSTIZ_API_KEY`, `POSTIZ_API_URL`.
- `apps/dashboard/public/{privacy,terms}.html` — platform-review pages for *"Social Manager for
  RMG"*, i.e. the OAuth-facing identity is already published.
- `packages/types/src/index.ts:87` — `'social-manager'` is a declared `ServiceId`.

Postiz itself runs at `/opt/postiz`, **out of repo**, bridged onto the Caddy network. It is not
a compose service here.

## 10. Observability

- `GET /health` aggregates postgres, redis, heygen, higgsfield, drive and a **deep** ALLEN probe
  (inspects ALLEN's `llm` sub-check, not just HTTP 200).
- `GET /queue` lists jobs with status/attempt/error.
- Logging is `console.log`; **no structured logger, no request ids, no audit log**.
- No alerting of any kind.

An operator can answer *"what failed?"* and *"what is waiting?"* from `/queue`. They **cannot**
answer *"who or what acted?"*, *"what needs my approval?"* (no approval queue endpoint), or
*"what happened after publication?"* (no post-publication status write-back).

## 11. Infrastructure

`infra/control-server/docker-compose.yml` — services: `caddy`, `db` (postgres:16),
`redis` (redis:7), `gateway`, `allen`, `dashboard`. Postgres and Redis bind to
`${TAILSCALE_IP}` only, never `0.0.0.0`.

`README.md:32-33` states: *"**Render Linode** … is a dedicated render worker"* and *"**Redis +
BullMQ** is the job backbone."*

**Neither is true in this repository.** `bullmq` is not a dependency of any package
(`apps/gateway/package.json` lists `ioredis` only), Redis is used solely for a `/health` ping
(`server.ts:183`), there is no render-worker service in compose, and no code consumes a second
node. The job backbone is the Postgres `production_jobs` table driven by HTTP `POST
/worker/tick`.

## 12. Testing and CI

`.github/workflows/ci.yml` runs `pnpm typecheck` → **`pnpm test`** → `pnpm build`. 11 unit test
files plus one Playwright smoke spec.

This is **better than `production-capability-inventory.md` records** (that document says the CI
gate is "typecheck + build only, no tests" and scores testing 1/5). The inventory is stale on
this point; unit tests now gate CI.

## 13. MCP posture

Creator OS contains **no MCP client, server, or registry code**. MCP appears only in docs, and
`docs/contracts/14-integration-contract.md:40` states the governing rule:

> **Rule:** headless pipeline stages may only depend on headless-safe integrations. MCP/OAuth
> [is] **assistant-in-loop only**.

That rule is ratified and currently **prohibits** the headless, MCP-driven production the
initiative envisages. See [05-mcp-readiness.md](05-mcp-readiness.md).
