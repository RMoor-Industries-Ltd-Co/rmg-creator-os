# 05 — MCP Readiness

## 1. Current posture

Creator OS contains **no MCP client, server, or registry code**. `grep -i mcp` over the
repository returns documentation only, plus one comment in `server.ts:1502` explaining that
SuperCool is "assistant/MCP-in-loop (not callable server-side)".

## 2. The governing rule, and the collision

`docs/contracts/14-integration-contract.md:38-40` classifies **MCP + OAuth** as
**"⚠️ assistant-in-loop only"** and states:

> **Rule:** headless pipeline stages may only depend on headless-safe integrations.

The initiative's agentic production system is, by construction, a set of **headless pipeline
stages that depend on MCP**. That is a direct collision with a ratified contract, and it is the
single most important MCP finding in this audit.

It is not a defect — the rule exists for a good reason (an OAuth/MCP session is a *person's*
session, and a headless stage that borrows one is impersonating them). It is an
**ARCHITECTURAL DECISION REQUIRED** (D-A), and it must be resolved deliberately rather than
discovered mid-implementation.

Two legitimate resolutions:

- **Amend contract 14** to distinguish *user-session MCP* (still assistant-in-loop) from
  *machine-principal MCP* (headless-safe, per-principal credential, default-deny), which is
  precisely what `rmg-piaar-mcps` already implements.
- **Keep the rule and add a bridge**: an authorized headless service holding its own credential
  fronts MCP for pipeline stages, so no stage borrows a human session.

The first is cleaner and matches the fabric that already exists. Neither should be assumed.

## 3. What Creator OS must EXPOSE

For ALLIE to supervise the factory (directive §3):

| Surface | Purpose |
|---|---|
| `POST /api/agent` | Live delegation — a keyed, free-text task from a trusted internal agent |
| `GET /api/agent/report` | Cached factory status — instant, never triggers live work |
| Constant-time key comparison | The pattern every other PIAAR M2M endpoint uses from day one |
| Job/approval read surface | "What is running, what is waiting, what needs approval" |
| Transition endpoint | Advance a producer job by an **authenticated, attributed** action |

This is the first implementation milestone, and it is exactly the shape Cappo, Constance and
Vale already ship — so it is a pattern to copy, not to design.

## 4. What Creator OS must CONSUME

For agents inside Creator OS to invoke MCP tools:

| Requirement | Note |
|---|---|
| Server registration/discovery | Config-driven, mirroring `rmg-piaar-mcps/config/*/downstream.json` — env-var **names**, never values |
| Per-principal credentials | Never a shared key. The fabric derives `PIAAR_DOWNSTREAM_<X>_KEY_<SYSTEM>_<DOMAIN>` |
| Per-call authorization | Default deny; an explicit deny beats an allow |
| Audit row per call | Principal, tool, arguments summary, result, duration, outcome |
| Durable result persistence | A tool result must become workflow state, not a transient value in a request |
| Idempotency | An MCP call with an outward side effect needs the same key discipline as a renderer job |
| Failure propagation | An MCP failure must set a job state with a signal **and a control** |
| Approval interaction | An MCP action behind a gate must not execute until the gate's recorded human decision exists |

## 5. What Creator OS must NOT do

- **Never reproduce `MCP_SCOPE`.** A process-wide scope cannot express per-caller authorization;
  `rmg-piaar-mcps`'s standing constraint forbids it explicitly.
- **Never store secrets.** Config names environment variables; Doppler holds values.
- **Never extract domain capability into the fabric.** "Connect, do not extract" — Creator OS
  owns production capability; the fabric owns the front door.
- **Never let an MCP tool's availability imply authority.** The renderer registry is the
  existing, correct precedent: a tool is resolved *for* a capability, not chosen by whoever
  holds it.

## 6. Required interfaces (identified, deliberately not implemented)

```
POST /api/agent                      keyed delegation
GET  /api/agent/report               cached status
GET  /api/agent/approvals            what awaits a human
POST /api/jobs/:id/transition        attributed state change
     — body: { to, actor, role, reason, idempotencyKey }
```

Plus, internally: an `McpClient` interface parallel to `Renderer`, resolved per (capability,
provider) so MCP tools enter through the abstraction the repository already trusts.
