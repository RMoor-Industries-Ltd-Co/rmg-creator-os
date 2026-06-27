# Contract — Production Queue

- **Capability id:** `production-queue`
- **Status:** Planned (spec)
- **Phase:** Master Atelier / Infrastructure
- **Owner:** Rahm Moore
- **Depends on:** `production-wizard` (13)

## Mission

A **persistent, ordered job queue** that sits behind every render-intensive operation in
the Creator OS (A-Roll, B-Roll, lip-sync, thumbnail, audio, My Poster approvals). The
queue decouples the UI from slow external provider calls, gives Rahm visibility into what
is running and what is waiting, and prevents runaway parallel credit spend.

---

## Why a queue first

Without a queue:
- Multiple simultaneous provider calls burn credits for renders Rahm may never use.
- Long-running API calls block the UI or require fragile polling logic scattered across
  every feature.
- Failed renders have no retry mechanism.

With a queue:
- Jobs submit instantly; the UI shows a card with status `queued`.
- A background worker pulls and executes one (or a small number of) jobs at a time.
- Retries and dead-letter handling live in one place.
- Future: priority lanes (urgent A-Roll vs. overnight B-Roll batch).

---

## Job schema

```
Job {
  id              uuid
  production_id   uuid               # parent production
  capability      text               # aroll | broll | lipsync | audio | thumbnail | poster
  provider        text               # higgsfield | supercool | canva | heygen | elevenlabs | ...
  payload         jsonb              # provider-specific params (prompt, ref_ids, etc.)
  status          enum               # queued | running | done | failed | cancelled
  priority        int                # lower = higher priority (default 10)
  attempt         int                # retry count (0 = first attempt)
  max_attempts    int                # default 2
  result_id       text?              # Drive file id or provider asset id on success
  error           text?              # last error message on failure
  enqueued_at     timestamptz
  started_at      timestamptz?
  completed_at    timestamptz?
  worker_id       text?              # for distributed workers later
}
```

---

## State machine

```
queued ──worker picks──▶ running ──success──▶ done
                │
                └──failure──▶ failed (attempt < max_attempts → re-queue with backoff)
                                       (attempt >= max_attempts → dead-letter: failed)

any state ──cancel──▶ cancelled
```

---

## Worker

A simple **polling worker** runs on the gateway server (Next.js API route on a cron
schedule, or a lightweight Node process). Every 10 seconds it:

1. Claims the next `queued` job (`status = running`, `worker_id = self`, `started_at = now`).
2. Calls the provider's API (Higgsfield, SuperCool, etc.).
3. On success: saves the result to Drive → updates job `status = done`, `result_id`.
4. On failure: increments `attempt`; if `< max_attempts` re-queues with `CEIL(attempt * 30s)`
   backoff (so attempt 1 retries after 30 s, attempt 2 after 60 s); otherwise marks `failed`.
5. Updates the parent `productions` row if the job outcome changes a stage field.

Single-server for now. `worker_id` + a `locked_until` timestamp (claim with
`WHERE status = 'queued' AND (locked_until IS NULL OR locked_until < now())`) prevents
double-claim when we add a second worker later.

---

## Gateway API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/queue` | List all jobs (optionally filter by `production_id`, `status`) |
| GET | `/queue/:id` | Single job status + result |
| POST | `/queue` | Enqueue a job (internal — features call this, not the client) |
| DELETE | `/queue/:id` | Cancel a queued job (cannot cancel running) |
| POST | `/queue/:id/retry` | Re-queue a failed job manually |

The UI **polls** `GET /productions/:id` (the production already carries derived queue
state) or `GET /queue?production_id=:id` for the full job list. WebSocket/SSE is a
future upgrade — polling every 5 s is fine for v1.

---

## Queue status widget

A **persistent floating widget** (bottom of the dashboard, always visible) shows:

```
⚙ 2 rendering  ✓ 5 done  ✗ 1 failed   [View queue →]
```

Clicking opens a drawer listing all active/recent jobs with provider, capability, and
status chips. Failed jobs have a **[Retry]** button inline.

---

## Priority lanes (future)

| Lane | Priority | Use case |
|---|---|---|
| `urgent` | 1 | Manual "render now" from Rahm |
| `normal` | 10 | Standard A-Roll / B-Roll render |
| `batch` | 50 | Overnight bulk thumbnail or ad-variant generation |

Implement when batch workflows are added.

---

## Build order (Phase 0)

1. **`jobs` table** migration — create the schema above.
2. **Enqueue helper** — a gateway utility `enqueueJob(production_id, capability, provider, payload)`.
3. **Worker loop** — cron-triggered Next.js API route (`/api/worker/tick`); call via
   `node-cron` on startup or Vercel Cron.
4. **`GET /queue` + `DELETE` + `POST /retry`** endpoints.
5. **Queue widget** on the dashboard — polling `/queue?status=running,failed`.
6. Wire A-Roll render to use the queue (first consumer).

Everything after step 5 is feature work that slots jobs into the queue. Phase 0 is
complete once A-Roll renders queue and complete end-to-end.
