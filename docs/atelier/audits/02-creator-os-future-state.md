# 02 — Creator OS: Required Future State

What the agentic production system needs Creator OS to be, derived from the initiative
directive and the governing contracts. Nothing here is a decision; it is the target the gap
analysis measures against.

## 1. The one-line requirement

Creator OS must become a system where **a long-running production job can be started by an
agent, paused indefinitely for a human decision, resumed, and audited afterwards — with every
action attributable to a role, not merely to a session.**

Everything below follows from that sentence.

## 2. Authority, not capability

The governing principle: **tools provide capability; roles provide authority.**

Creator OS today has capability without authority (§6–§8 of
[01](01-creator-os-current-state.md)): it can publish, but cannot say who was entitled to. The
future state requires authority to be a first-class, queryable property of every consequential
action.

Concretely, Creator OS must be able to answer, from stored state:

- which principal took this action, and under which role
- what that role was permitted to do at that moment
- which human authorized the gate this action crossed
- what was superseded, and by whom

## 3. Required capabilities, by area

### 3.1 Control plane

| Concept | Required because |
|---|---|
| **Initiative** | The Accord pipeline begins at an initiative, above production |
| **Producer job with explicit state** | Directive §6: no state may be inferred from documents or chat |
| **Producer type as configuration** | The engine must not be Accord-shaped; a second producer must be config, not code |
| **Actor / principal** | Attribution of every action |
| **Role + capability grant** | Authority separated from access |
| **Approval record** | Who, what role, when, on what artifact, with what verdict |
| **Audit log** | Directive §11's nine questions |
| **Artifact lineage** | Initiative → production → source → brief → copy → images → approval → package → publication |

### 3.2 Orchestration

The queue must support workflows that **pause for humans**:

- a durable `awaiting_approval` (or equivalent) job state that consumes no worker
- an atomic claim, so retries and concurrency cannot double-execute a paid render
- an idempotency key per (job, capability, placement), checked before the side effect
- a lease with expiry, and a reaper that returns expired `running` jobs to `queued`
- cancellation observed *during* execution, not only before claim
- a timeout per capability
- a dead-letter path with an operator-visible signal and a control that clears it

Every one of these is a precondition of unattended operation, and each maps to the
gate/signal/control law in `rmg-piaar-system/docs/AUTONOMY_CHECKS_AND_BALANCES.md`.

### 3.3 Human approval

Representable verdicts must extend to: *requested, pending, approved, rejected, revision
requested, escalated, overridden* — each carrying approver identity, role, timestamp and the
artifact version it applies to.

**Approval must be enforced at the boundary that acts**, not only rendered in the UI. A publish
path that does not read the approval record is not gated (see
[01](01-creator-os-current-state.md) §8).

### 3.4 Agent model

A Producer must be able to coordinate a specialist **without impersonating it**. That requires
distinct principals, an assignment/delegation record, and provenance on the resulting artifact
naming both the coordinator and the executor.

### 3.5 MCP

Creator OS must be able to be **both** an MCP consumer (agents invoking tools) and a target
(ALLIE supervising the factory). Its minimum obligations are registration/discovery, credential
isolation per principal, per-call authorization, an audit row per call, durable persistence of
tool results as workflow state, and idempotent replay. See
[05-mcp-readiness.md](05-mcp-readiness.md).

### 3.6 Accord pipeline

Creator OS must be able to receive, track and advance an article-shaped production — which it
cannot today, because `productions` is video-shaped and `production_jobs.production_id` is
`notNull` against it. See [04-accord-readiness.md](04-accord-readiness.md).

### 3.7 Observability

An operator must be able to answer the seven questions in directive §9I. Today three of the
seven are unanswerable (see [01](01-creator-os-current-state.md) §10).

## 4. What the future state explicitly does NOT require

Recording these prevents speculative building:

- **No event bus.** The existing Postgres queue plus `(capability, provider)` dispatch is the
  transport. `rmg-piaar-mcps`'s standing constraint forbids new baseline infrastructure absent a
  demonstrated requirement.
- **No BullMQ.** It is named in `README.md` and ADR-0001 but absent from the dependency tree.
  Adopting it is a *decision*, not an implied requirement — the DB queue already satisfies the
  functional need once the defects in §4 of [01](01-creator-os-current-state.md) are fixed.
- **No second publishing engine** while Postiz is deployed and the client is written.
- **No autonomy above L0** for the first reference run.
- **No new agent processes** before their contracts are ratified.
