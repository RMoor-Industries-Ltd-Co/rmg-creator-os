# 05 — MCP Readiness

## 1. Current posture

Creator OS contains **no MCP client, server, or registry code**. `grep -i mcp` over the
repository returns documentation only, plus one comment in `server.ts:1502` explaining that
SuperCool is "assistant/MCP-in-loop (not callable server-side)".

## 2. The governing rule — and the collision I wrongly reported

**Correction (2026-09-09).** An earlier revision of this audit claimed contract 14 forbids
headless pipeline stages from depending on MCP, and raised that as decision **D-A**, the
"single most important MCP finding." **That claim was wrong, and D-A is withdrawn.**

`rmg-piaar-system/contracts/14-integration-contract.md` does classify **MCP + OAuth** as
**"⚠️ assistant-in-loop only"**, and does state:

> **Rule:** headless pipeline stages may only depend on headless-safe integrations.

But an explicit callout sits directly above that Rule, and it settles the question:

> **Direction matters (see contract 26).** The ⚠️ row below is about PIAAR *consuming*
> somebody else's MCP server, which still needs a browser-ish OAuth session. It says nothing
> about PIAAR *publishing* its own tools as an MCP server — that is contract 26, it is live in
> `rmg-ai`, and it authenticates machine-to-machine with an `x-allen-key`, so it is
> headless-safe. **Conflating the two is how the open question at the bottom of this contract
> stays open.**

`rmg-piaar-system/CLAUDE.md` says the same thing in one line: *"Contract 14's 'MCP =
assistant-in-loop' line is about consuming an external MCP server and is a different problem."*

The initiative's agentic production system publishes and consumes **PIAAR-internal**,
machine-credentialed MCP. Contract 14 already permits that. There is no collision, no contract
amendment required, and nothing here blocks MCP work.

I read both of those sources during discovery and then wrote the opposite. Recording the error
rather than quietly deleting it, because a false blocker in an audit is a governance defect in
its own right: it invents a ratification step, and it teaches the next reader to mistrust the
document that got it right.

### What the rule *does* still constrain

The ⚠️ row remains binding where it actually applies — **consuming a third party's MCP server**
that authenticates with a per-user OAuth session (SuperCool, ClickUp, Google Docs in that
table). A headless pipeline stage may not borrow a person's session for those. That constraint
is unchanged and is a real design boundary for any stage that wants SuperCool or Docs.

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
