# ADR 0001 — RMG Creator OS Ecosystem Architecture

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Rahm Moore

## Context

Story Director began as a single video post-production app. The vision has grown into
a multi-service **Creator Suite** ("RMG Creator OS") that turns minimal high-value
input (image, video, music, transcript, or topic) into scheduled, brand-voiced,
social-ready output (content, ads, posts) for marketing and sales.

The suite comprises: Gateway/Orchestrator, Dashboard, Story Director, Social Manager,
A.L.L.E.N, A.L.L.I.E, My Poster, and a personal Life OS utility.

## Decisions

1. **Single TypeScript monorepo** (`rmg-creator-os`). Story Director folds in as a
   service. Shared logic (brand voice, integrations, types, DB, auth, queue, storage)
   lives in `packages/`. Rationale: the services share heavily; multi-repo would
   create sync pain for a small team.

2. **Microservices, one deployable per service.** Accepted the operational tax in
   exchange for clear boundaries and independent scaling. Mitigation: a shared
   **Redis + BullMQ** job queue is the communication backbone so services exchange
   durable jobs rather than brittle synchronous calls.

3. **Two nodes joined by Tailscale.** A new **control Linode** runs the stack; the
   **former Story Director Linode becomes a dedicated render node**. Postgres and
   Redis bind to the tailnet — never the public internet.

4. **Caddy reverse proxy** terminates TLS for `rmg-creator-os.rmasters.group` and
   routes to the dashboard and gateway.

5. **Shared Postgres** (Drizzle ORM) for state; **Google Drive** for media assets;
   **Google Docs** for creative writing.

6. **Life OS stays a separate Python service.** It tracks personal daily activity and
   pushes to ClickUp; the dashboard surfaces it under "Personal" with a Fillout link.
   It is not part of the content pipeline.

## Consequences

- Each service needs its own Dockerfile, health check, and deploy path.
- A first-class `Recipe`/`Job` model in the gateway + DB defines the input→output
  pipeline; this is the core product surface.
- Model selection for A.L.L.E.N / A.L.L.I.E is deferred.
- The existing Story Director Postgres work migrates into `packages/db`.

## Open questions

- Auth/identity provider for the dashboard.
- Hosting model for LLM inference (A.L.L.E.N brain).
- Whether render stays single-node or scales to a pool.

---

## Superseded in part — queue technology (2026-09-09, decision D-B)

This ADR names **Redis + BullMQ** as the job-queue backbone. That was never implemented:
`bullmq` is not a dependency of any workspace package, Redis serves caching and the `/health`
probe only, and the durable queue is the Postgres `production_jobs` table claimed by
`POST /worker/tick`.

**D-B ratifies the implementation as built.** Creator OS retains and hardens its
Postgres-backed queue as the authoritative job backbone for the Master Atelier initiative.
BullMQ is not introduced merely to conform to this document. Any future migration to BullMQ,
a Redis-backed queue, or another queue technology requires a separate architectural decision
based on demonstrated need.

The rest of this ADR is unchanged. Current execution semantics — atomic claim, leases,
stale-job recovery and idempotency — are documented in
[`../atelier/queue-execution-semantics.md`](../atelier/queue-execution-semantics.md).
