# Queue Execution Semantics

The exact behavior of the Creator OS production queue after Phase A. Written because the
recovery policy decides whether **paid** work can be repeated, and that must not be inferred
from reading the code.

**Decision D-B (ratified 2026-09-09):** Postgres is the authoritative job backbone for the
Master Atelier initiative. BullMQ is not introduced in this phase; any future queue migration
is a separate architectural decision based on demonstrated need. Redis remains for caching and
the `/health` probe and does not back the queue.

## The table

`production_jobs` — one row per unit of work, `(capability, provider)` dispatched through the
renderer registry. Statuses: `queued · running · done · failed · cancelled`.

Three columns carry the execution-safety semantics:

| Column | Meaning |
|---|---|
| `locked_until` | **Lease expiry.** Set on claim (`now + lease`) and on retry backoff (`now + backoff`). |
| `worker_id` | Identity of the worker holding the lease. Written on claim. |
| `idempotency_key` | Caller-supplied dedupe identity. `NULL` = no dedupe requested. Partial-unique. |

## 1. Claim — atomic

`claimNextJob` is **one statement**:

```sql
UPDATE production_jobs SET status='running', started_at=now(), worker_id=$1,
       locked_until = now() + make_interval(secs => $2)
 WHERE id = (SELECT id FROM production_jobs
              WHERE status='queued' AND (locked_until IS NULL OR locked_until < now())
              ORDER BY priority, enqueued_at
              FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *
```

`FOR UPDATE SKIP LOCKED` is what makes concurrency safe: a second worker running the same
statement **skips** the row the first has locked rather than blocking on it or reading it as
available. There is no window between "chosen" and "marked running" for a racing worker to
observe.

Selection order and backoff handling are unchanged from before Phase A: `queued` only,
respecting a future `locked_until`, ordered by priority then age.

> **Why this mattered.** The previous flow was a `SELECT ... LIMIT 1` followed by a *separate*
> `UPDATE`, with no `SKIP LOCKED`, no conditional status and no transaction. Two concurrent
> ticks could select the same row and both dispatch it — for `capability = 'aroll'`, a
> duplicated **paid** HeyGen render.

## 2. Lease and stale-job recovery

A claim holds a lease of `WORKER_LEASE_SECONDS` (default 900s). Recovery runs at the start of
every `POST /worker/tick`, and can be invoked alone via `POST /worker/recover`.

An expired lease means the worker stopped reporting. **It does not mean the work did not
happen** — a render may have completed remotely just before the crash. Completion is therefore
*uncertain*, and recovery must not silently re-run it.

| Condition | Outcome | Why |
|---|---|---|
| `idempotency_key` present **and** attempts remain | **`requeued`** | A re-run is provably safe: execution finds the completed result by key and reuses it instead of repeating the work. Bounded by `max_attempts`. |
| Otherwise | **`failed`** | Completion is uncertain and cannot be deduplicated. The job stops with an explicit error naming the worker and the next step. |

The failure message is deliberate, not decorative:

```
lease expired: <worker> did not report completion. Completion is uncertain, so the job was
not re-run automatically (no idempotency key, or attempts exhausted). Inspect the provider,
then POST /queue/<id>/retry to re-queue it.
```

### Gate, signal, control

Every condition that can stop work needs all three. Two out of three is a silent halt.

| | |
|---|---|
| **Gate** | The job stops — `failed`, or `requeued` with a bounded attempt count. |
| **Signal** | Visible in `GET /queue`, in words, naming the worker and why it was not re-run. |
| **Control** | `POST /queue/:id/retry` clears a `failed` job. `DELETE /queue/:id` now also cancels a `running` job **whose lease has expired** — see *Cancellation* below. |

> **Why this mattered.** Before Phase A nothing ever moved a job out of `running`: the claim
> query matched only `queued`, cancel returned `409` for anything running, and retry accepted
> only `failed`/`cancelled`. A crashed worker stranded a job permanently and clearing it
> required direct SQL — a gate and a signal with no control.

A **live** lease is still protected: `DELETE /queue/:id` returns `409` while `locked_until` is
in the future, because that job genuinely belongs to a running worker.

## 2a. Cancellation is one conditional statement

`cancelJob` encodes the allowed transitions in the `WHERE` clause and lets the database decide:

| From | To |
|---|---|
| `queued` | `cancelled` |
| `running` **with an expired lease** | `cancelled` |
| anything else | **refused** — zero rows updated |

Reading the row and then updating it by id alone is unsafe even though the read looks like a
guard. Between the two statements a worker can atomically claim the job, so the caller is told
"cancelled" while the worker goes on to dispatch **paid** work and then overwrites the row as
`done`. The same unconditional update could also rewrite an already `done` or `failed` job as
`cancelled`, destroying its outcome.

With the predicate, a racing claim flips the row to `running` with a live lease, the predicate
stops matching, and the cancel **loses the race cleanly** (`409`) instead of lying.

## 3. Idempotency

Scope is deliberately narrow — the minimum durable primitive, not a generic distributed
framework.

**Key boundary.** Caller-supplied, per enqueue. It identifies *the work*, not the request:
`aroll:<videoRowId>` is one queue row per video row.

**Storage.** `production_jobs.idempotency_key`, with a **partial** unique index
(`WHERE idempotency_key IS NOT NULL`) so the many NULL rows never collide.

> Because the index is partial, `ON CONFLICT` must repeat the predicate — Postgres cannot
> infer a partial index from the target column alone and raises `42P10` otherwise.

**Duplicate submission.** `enqueueJob` uses `ON CONFLICT DO NOTHING` then selects the existing
row, returning `{ job, deduplicated: true }`. The unique index is the arbiter, so it is
race-safe: six concurrent identical submissions collapse to exactly one job. The original
payload is never overwritten — a duplicate must not silently change work already queued.

**Duplicate execution.** Before dispatch, the worker looks for a *completed* job with the same
key (excluding itself). If one exists, it copies that `result_id` and finishes without
repeating the work. This is what makes a recovery re-queue safe.

**Jobs without a key** behave exactly as before Phase A, and recover to `failed` for an
operator rather than being re-run.

### Where keys are and are not applied

| Call site | Key | Reasoning |
|---|---|---|
| A-Roll (`/productions/:id/aroll`) | `aroll:<videoRowId>` | The paid HeyGen call has already happened when the job is enqueued, so the key cannot suppress real work — it prevents a duplicate tracking row and makes an abandoned job safely re-runnable. |
| B-Roll (`/productions/:id/broll/scenes/:sid/generate`) | **none** | An operator may legitimately request a second take of the same scene+provider; a key would silently return the first job instead of rendering a new take. Without a key, an abandoned b-roll job recovers to `failed` rather than auto-re-running paid work. |

## 4. Delivery approval on publish

`POST /productions/:id/publish` reads the approval record before doing anything else. A
completed render is **not** an approval.

The rule (`apps/gateway/src/approval.ts`, pure and unit-tested): publication requires the
production's **own brand** to be explicitly `approved` in `productions.deliveryApprovals`.
Absent map, missing brand, `pending`, `rejected`, an unrecognized value, or a production with
no brand all **fail closed** with `403` and `code: 'delivery_not_approved'`.

> **Why this mattered.** The endpoint previously required only that *some* completed render
> existed, falling back to any completed row. The per-brand My Poster gate was rendered in the
> UI and unenforced on the path that actually publishes to live channels — the clearest case
> in the repository of technical capability becoming governance authority.

Phase A enforces the mechanism already present. **Approver identity and role semantics are
Phase B** — today the record says *that* a brand was approved, not *who* approved it.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_LEASE_SECONDS` | `900` | Lease length on claim. A render that legitimately runs longer would be recovered mid-flight. |
| `WORKER_ID` | `gateway-<pid>-<rand>` | Worker identity written on claim. Set it explicitly when running more than one worker process. |
| `WORKER_SECRET` | — | **Required.** Machine credential for `/worker/tick` and `/worker/recover`. Unset means the lane is **closed**, not open (see Phase A.1 below). |
| `WORKER_TICK_ENABLED` | unset (off) | `true` — and only that exact string — starts the in-process dispatcher. |
| `WORKER_TICK_INTERVAL_MS` | `15000` | Gap between in-process ticks. |

## Phase A.1 — dispatch reachability

Phase A hardened a queue that **nothing dispatched from**. The evidence, gathered read-only:

| Candidate dispatcher | Finding |
|---|---|
| A worker service in compose | Absent. Services are `caddy`, `db`, `redis`, `gateway`, `allen`, `dashboard`. |
| A cron entry | Absent for the worker. The only crontab line in `infra/` is `30 3 * * *` for `backup-db.sh` — proving cron *is* used on this server, just not for this. |
| The dashboard | No source file under `apps/dashboard/src/` references `worker`. |
| A GitHub workflow | None of `ci.yml`, `deploy.yml`, `publish-images.yml` mentions the worker. |
| A manual/operator call | Would have needed the credential below, which was never set. |

So queued jobs stayed queued. `/worker/recover`, added in Phase A, inherited the same problem.

### The credential was fail-open

The route check read `if (WORKER_SECRET && secret !== WORKER_SECRET) return 401`, and
`WORKER_SECRET` appears nowhere in `infra/` or `.github/`. With it unset the condition is
never true — the check was a **no-op**. The only thing standing in front of `/worker/tick`
was the browser session guard, which is also precisely what made the route unreachable to a
headless caller: a machine has no session cookie and receives `401`.

That is the full contradiction: **unreachable by a machine, and unprotected by its own
credential.**

### What replaces it

`checkWorkerSecret` (`apps/gateway/src/workerAuth.ts`) is pure, constant-time, and fails
closed on all three paths — no configured secret, no supplied header, or a mismatch. An
unconfigured `WORKER_SECRET` now closes the lane instead of opening it.

Reachability and authorization are kept as two separate statements, deliberately:

- `isWorkerRoute` tells the session guard in `server.ts` to **skip** these paths.
- An **encapsulated** `onRequest` hook inside `registerWorkerRoutes` then authenticates them
  with the machine credential, so a worker route added later cannot forget its own check.

`isPublicRoute` is untouched. Widening it would have been the easy fix and the wrong one:
public means *no credential at all*, and the worker lane always requires one. Session
authentication is not weakened anywhere, and no human session credential is reused for
machine execution. This is **not** the agent credential — worker execution authority and
future agent/MCP authority stay separate surfaces.

### The dispatcher

An interval in the gateway process, calling `runWorkerTick` **directly**:

```
setInterval → runWorkerTick(db, clients, renderers) → recover → claim → dispatch → record
```

Chosen because it is the smallest mechanism consistent with what already exists — no new
service, image, broker, repository, or infrastructure primitive; no Redis queue, no BullMQ, no
n8n; and no "someone remembers to curl it". The gateway is already a long-running container
under compose's `restart: unless-stopped`, so the dispatcher survives restarts by construction.
It matches the in-process scheduler pattern used across the rest of the fleet.

It calls the function rather than its own HTTP route on purpose: a self-call would need the
machine credential inside the process that owns it, and would add a second way into the
execution lane for no benefit. The HTTP route remains for an operator or an external scheduler.

Two properties, unit-tested via `createNonOverlappingRunner`:

- **No overlap.** A tick still running when the next interval fires is skipped, not queued.
- **No throw.** A failing tick is logged and swallowed; an unhandled rejection in an interval
  callback would otherwise be able to take the gateway down.

Concurrency was already safe — the Phase A claim is atomic, so even several gateway replicas
ticking simultaneously cannot claim the same job.

### Off by default

`WORKER_TICK_ENABLED` is unset, and this change does not set it in `infra/`. Enabling the
dispatcher starts executing queued work, some of which is paid external rendering, so it is a
deliberate deploy-time decision rather than a consequence of deploying this build. Compose now
*names* the variable — a variable compose does not name never reaches the container — but
assigns it no value.

## Testing

Concurrency semantics cannot be proven against a mock, so they run against real Postgres:

```bash
TEST_DATABASE_URL=postgres://user@host:5432/db pnpm test
```

The suite **skips** automatically when `TEST_DATABASE_URL` is unset, so the default `pnpm test`
and CI stay green without a database. Coverage includes concurrent claims over one job and over
N jobs, lease writing, live-lease protection, backoff preservation, priority ordering, both
recovery branches, attempt bounding, concurrent duplicate submission, and completed-result
reuse.
