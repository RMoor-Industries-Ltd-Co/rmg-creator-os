# Master Atelier Agentic Production — Implementation Plan

## Purpose

This plan converts the 2026-09-08 Creator OS audit into a dependency-aware implementation sequence for the Master Atelier Agentic Production Initiative, using the HVN Global Accord pipeline as the first governed reference workflow.

The plan is intentionally conservative: preserve the working Creator OS spine, repair live execution weaknesses first, add governance primitives second, expose agent access only after control exists, then integrate the Accord/HVN MCP capability, implemented as a downstream domain MCP in `hvnglobalco-com` and reached through the `rmg-piaar-mcps` fabric.

The audit evidence is captured in draft PR #50 (`docs/atelier/audits/` on branch
`claude/master-atelier-agentic-production-s4bxil`). The corrected audit commit is `b9a528d`.

Governance references: the Accord/HVN Pipeline MCP is **contract 31** in `rmg-piaar-system`
(renumbered from 30 on 2026-09-09, when the 30–35 block was reserved as one allocation).

## System boundaries

Master Atelier is the full RMG creator suite. `rmg-creator-os` is its technical control plane and implementation platform.

Company repository boundaries for this initiative are:

| Repository | Authority / responsibility |
|---|---|
| `RMoor-Industries-Ltd-Co/rmg-piaar-system` | Governance, contracts, roles, cross-system architecture, initiative authority |
| `RMoor-Industries-Ltd-Co/rmg-creator-os` | Master Atelier control plane, durable workflow state, approvals, orchestration, agent front door |
| `RMoor-Industries-Ltd-Co/rmg-piaar-mcps` | Shared MCP **fabric** — front door, principal identity, authentication, authorization, routing, audit, observability, transport. Owns **no** domain capability |
| `RMoor-Industries-Ltd-Co/hvnglobalco-com` | HVN Global domain — Accord editorial doctrine, package validation rules, image/content rules, distinctiveness logic, and the **downstream Accord MCP implementation** |
| `RMoor-Industries-Ltd-Co/hvnhavenry-com` | HVN Havenry domain system when applicable |
| Social publishing implementation | Deferred until the distribution phase; not a blocker for the Accord MCP/reference run |

Do not create additional repositories for the Accord MCP. Its domain implementation belongs
inside **`hvnglobalco-com`**, which already exists — so the anti-repo-sprawl decision holds
without weakening the fabric.

`rmg-piaar-mcps` is the shared MCP fabric and, by its own governing file, *"owns no domain
capability"* — *"Connect, do not extract."* `rmg-piaar-system`'s repository-ownership table
agrees: the fabric owns gateways, identity, authn/authz, routing, audit, observability and
transport, while **domain-specific capabilities and downstream MCP implementations belong to
domain repositories**. Accord is an HVN Global domain capability, so it lives with its domain;
Creator OS orchestrates it but does not own its editorial doctrine or domain rules.

**Standing rule:** domain capability stays with the domain; the MCP fabric connects it; Creator
OS orchestrates it.

## Governing principles

1. **Tools provide capability; roles provide authority.**
2. Creator OS remains the durable workflow/control-plane authority.
3. MCP services provide governed domain capabilities and role-scoped tool surfaces; they do not become competing orchestration engines.
4. L0 is the starting autonomy level for the first Accord reference production: consequential gates remain human-approved.
5. Do not let a technically callable tool imply permission to use it.
6. Do not broaden the implementation footprint until the current phase exit criteria are satisfied.

## Audit disposition

The audit verdict is **STRUCTURAL GAPS**, not major rearchitecture.

The existing Creator OS spine should be protected:

- Postgres-backed production job queue with retry/backoff
- `(capability, provider)` renderer registry
- staged production records
- Drive-backed asset lifecycle
- Ad Index terminology and surfaces
- per-stage review UI
- aggregated health reporting
- working CI -> image publish -> deploy path

The missing layers are primarily:

- authority / actor / role / approval attribution
- durable pause for governed human gates
- an article-capable workflow parent that is not structurally tied to video productions
- machine-principal agent access

The implementation order below is designed to add those layers without replacing the existing working spine.

---

# Phase A — Stabilize the Existing Execution Lane

## Objective

Repair live job-execution and publish-path weaknesses before adding agentic access.

These items are valuable even if the Accord initiative were cancelled.

## Required work

### A1. Atomic job claim

Replace the current non-atomic `SELECT ... LIMIT 1` followed by separate `UPDATE` behavior with an atomic claim strategy.

The implementation must guarantee that concurrent workers cannot dispatch the same queued job.

Acceptance conditions:

- one queued job can be claimed by only one worker;
- claim includes worker identity;
- claim includes a lease/lock expiration;
- concurrent claim test proves no duplicate dispatch;
- paid provider jobs cannot be duplicated through a claim race.

### A2. Lease and recovery / reaper

A worker crash must not strand a job in `running` forever.

Acceptance conditions:

- claimed jobs have a lease expiration;
- expired leases are discoverable;
- a safe recovery/reaper path returns eligible work to a recoverable state or explicitly fails it according to policy;
- operators do not require direct SQL to recover stranded jobs;
- recovery is observable and auditable.

### A3. Idempotency

Introduce idempotency at the execution boundary for operations that can incur external side effects or cost.

Acceptance conditions:

- duplicate requests with the same idempotency identity do not execute paid work twice;
- retry and worker recovery preserve idempotency identity;
- result persistence is associated with the idempotency key;
- tests cover lost-response/retry behavior.

### A4. Enforce delivery approval on publish

`POST /productions/:id/publish` must not fall back to an arbitrary completed render when an approval gate is required.

Acceptance conditions:

- publish reads the authoritative delivery approval record;
- missing/unapproved delivery returns a blocked response;
- the published asset is the asset covered by the approval evidence;
- tests prove a completed-but-unapproved render cannot publish.

## Phase A exit gate

Do not begin Phase C agent access until all four controls are implemented, tested, and deployed through the normal CI/CD path.

---

# Phase B — Add L0 Governance Primitives

## Objective

Make human approval, authority and long-running pause first-class durable system state.

## Required work

### B1. Actor / principal representation

Creator OS must be able to attribute consequential actions to an authenticated actor/principal and associated role.

Minimum information:

- actor/principal id
- actor type (human, service, agent/machine principal)
- role / authority context
- source system / authentication context where relevant

Do not treat the actor record alone as authorization policy; authorization may be delegated to the MCP/fabric layer while Creator OS records evidence.

### B2. Approval evidence

Approval records must include:

- approver identity
- approver role
- decision
- timestamp
- object/package/asset scope
- optional required note/reason
- provenance/source of the action

Approval must be durable evidence, not a UI boolean.

### B3. Durable pause / awaiting approval

Introduce a governed state that allows a workflow to pause without being treated as failed or running.

Conceptual state: `awaiting_approval` or equivalent.

Acceptance conditions:

- job/workflow can enter the pause state intentionally;
- it is not claimable by a worker while waiting;
- an authorized transition can resume it;
- rejection/revision has an explicit path;
- the dashboard/report surface can show what is waiting and for whom.

### B4. Article-capable workflow parent

Remove the requirement that every future production job must be parented to a video-shaped `productions` row.

Introduce or extend a generic production/workflow parent capable of representing at least:

- video production
- Accord editorial/article production
- future Master Atelier production types

Do not redesign all existing video entities unnecessarily. Preserve compatibility with the existing lane.

## Phase B exit gate

A synthetic Accord-like workflow must be able to exist, pause for founder approval, record who approved in what role, and resume without external MCP integration.

---

# Phase C — Establish the Agent Front Door

## Objective

Allow authorized machine principals to supervise and advance Creator OS workflows only after the control plane can safely attribute, pause, authorize and recover work.

## Required surface

Final paths may vary, but provide equivalents of:

- `POST /api/agent` — authenticated command/request entry
- `GET /api/agent/report` — operational/status report
- approvals read surface
- attributed transition/action endpoint

Use the existing Cappo / Constance / Vale machine-principal pattern as a reference rather than inventing an incompatible model.

## Security requirements

- default deny;
- dedicated machine-principal credentials;
- no secrets returned by report endpoints;
- every consequential transition attributed;
- tool access does not imply authority;
- idempotency applies to agent-triggered actions;
- failure returns a durable state plus an operator-visible control path.

## Phase C exit gate

An authorized test machine principal can request a permitted transition and retrieve status, while an unauthorized principal cannot invoke that transition. All actions are attributed and durable.

---

# Phase D — Accord L0 Reference-Run Readiness

## Objective

Prepare the minimum cross-system path for the first governed Accord reference production before introducing the Accord domain MCP.

## Required decisions / dependencies

### D1. HVN canonical brand identity

Resolve the current open relationship among HVN BrandKey, store identity, site/domain identity and Word Art/Accord scope.

This is a hard blocker because validation, branding rules and production metadata need one canonical representation.

### D2. Gate A transport in `hvnglobalco-com`

Define the minimum authorized transport for an Accord package/work item to enter the governed Master Atelier flow.

Do not overbuild the HVN Global application. The first transport may be deliberately narrow, but it must be explicit, authenticated and attributable.

### D3. Approval authority decision

Ratify the boundary:

- Creator OS stores durable approval evidence and workflow state.
- The authorized principal/fabric layer determines whether a caller may execute the approval action.

### D4. MCP policy clarification

**Narrowed 2026-09-09.** Half of what this item once implied is already settled and needed no clarification. Contract 14's ⚠️ "MCP + OAuth = assistant-in-loop only" row carries an explicit callout limiting it to PIAAR *consuming* somebody else's MCP server; PIAAR *publishing* its own tools as a machine-authenticated MCP server is stated to be headless-safe, is contract 26, and is already live in `rmg-ai`. Nothing forbids the Accord MCP this plan proposes. (The audit's decision **D-A**, which claimed the opposite, is withdrawn — see `docs/atelier/audits/08-open-decisions.md`.)

What genuinely remains open is narrower: **machine-principal *consumption* of an external MCP server.** The ⚠️ row still binds where it applies — a headless stage must not borrow a person's OAuth session to reach SuperCool, ClickUp or Google Docs. Clarify policy so that an authenticated machine principal consuming an external MCP server, where one is available on machine credentials, is explicitly governed rather than implicitly allowed.

## Reference-run constraint

The first Accord run remains L0. No consequential gate is automatically approved.

## Phase D exit gate

A representative Accord article/work item can enter Creator OS, move through the generic workflow, pause for founder approval, record attributed approval/rejection, and resume without requiring the future Accord MCP to compensate for missing Creator OS governance.

---

# Phase E — Accord / HVN MCP Integration

## Objective

Implement the governed Accord/HVN image-and-content pipeline capability inside
`RMoor-Industries-Ltd-Co/hvnglobalco-com` as a downstream domain MCP, register it in
`rmg-piaar-mcps`'s downstream configuration with its own per-principal credential reference,
and reach it from Creator OS through the authorized machine-principal path. The fabric routes;
it does not host the domain logic.

The governing contract is maintained in `rmg-piaar-system` as **Contract 30 — Accord / HVN Image & Content Pipeline MCP**.

## Repository boundary

Do not create `accord-pipeline-mcp` as a separate repository.

Conceptually:

```text
hvnglobalco-com/                 domain — owns the capability
  <accord MCP surface>           package validation, brand rules, distinctiveness

rmg-piaar-mcps/                  fabric — owns the front door only
  config/business/downstream.json    registration + credentialRef (a NAME, never a value)
  packages/{authn,authz,routing,audit}

rmg-creator-os/                  control plane — owns durable workflow state
```

Use the actual repository conventions discovered during implementation. Note that
`rmg-piaar-mcps` names environment variables rather than storing values, and its security
packages carry zero runtime dependencies — a domain capability placed there would violate both.

## Ownership split

### Creator OS

Owns:

- production/workflow identity
- durable job/workflow execution state
- pause/resume
- actor/role attribution
- approval evidence
- orchestration

### Accord MCP

Owns:

- Accord package schema
- structural package validation
- visual/rule findings
- brand contamination checks
- distinctiveness operations
- domain-specific role-scoped tools
- determination that domain requirements for promotion readiness are satisfied

### MCP authorization layer

Owns:

- machine-principal authentication
- tool exposure
- default-deny authorization
- credential isolation

Do not duplicate Creator OS workflow state inside the MCP.

## Accord package requirements

The MCP design must enforce at least:

- article/content `copy`
- prompt/spec records
- generated image candidates mapped one-to-one to prompts
- metadata linking prompt -> asset -> placement -> findings/approval
- downstream promotion content only after the authorized boundary

A package missing required copy or another required component must fail at submission with a specific error.

## Required validation

Before founder review is reachable:

- complete prompt/image pairing;
- real/non-empty valid images;
- no missing required content;
- prohibited visible smoke check where applicable;
- cross-brand text/logo/mark check against explicit allowed marks;
- standalone-vs-composite placement check;
- HVN branding-discipline check;
- distinctiveness comparison against the canonical log.

Where a visual rule cannot be checked reliably enough by automation, require an explicit attributed CC attestation. Never silently pass an uncertain check.

## Role boundary acceptance tests

The Phase E implementation must reproduce and permanently block the three historical failure classes:

1. A coordinating agent cannot invoke canonical image generation through the Accord MCP.
2. A package with prohibited visual content or wrong-brand contamination cannot silently reach approved/promotion-ready state.
3. A package without the article copy cannot be accepted as complete.

Founder visual approval remains founder-only.

## Master Atelier read boundary

Distinguish two uses:

- **Control plane:** authorized Master Atelier orchestration can inspect status and request allowed domain actions.
- **Downstream promotion:** promotion/publishing consumers can consume only `PROMOTION_READY` packages and cannot mutate upstream creative state.

## Migration

Do not break Article 1/2 or existing Drive/Markdown history.

- inventory existing artifacts first;
- map them into the new schema without fabricating provenance;
- preserve rejected/superseded assets;
- keep Drive as an asset location during transition;
- after successful governed runs, determine which manual Markdown/folder controls can become generated views.

## Distinctiveness timing

Distinctiveness-log write-back may not block Article 1, but it must be operational before Article 2 or the no-repeat control becomes unenforced.

## Phase E exit gate

One Accord package completes the MCP-backed L0 path with complete audit evidence, role-scoped tool enforcement, validation findings, founder approval, and a valid `PROMOTION_READY` output consumed by Master Atelier without upstream authority leakage.

---

# Phase F — Distribution / Publishing Evaluation

## Objective

Evaluate publishing architecture only after the governed content pipeline reaches the real distribution boundary.

## Current disposition

Social publishing is not required for Phases A–E.

The 2026-09-08 audit established:

- Creator OS does not currently use `Social_Manager_v2.0`.
- No implemented Social Manager service is required for the current Accord MCP work.
- Creator OS documentation currently models Social Manager around self-hosted Postiz.
- Creator OS does not yet expose a generic `PublishEngine` abstraction.

Therefore `Social_Manager_v2.0` is **Deferred / Not Required for Current Initiative**.

## Phase F bounded evaluation

When publishing becomes necessary, compare:

1. Postiz-backed publishing;
2. direct provider APIs;
3. a hybrid provider-adapter model;
4. any proven alternative that preserves one Master Atelier publishing contract.

If `Social_Manager_v2.0` is evaluated, inspect its actual implementation before deciding whether to adopt, adapt, partially reuse, replace or archive it. Do not merge systems merely because they share the name Social Manager.

## Decision requirement

Publishing architecture is an ADR-level decision and must be explicit before adding another production publishing path.

---

# Deferred / Later Capabilities

The following should not block the first Accord governed run unless later evidence changes the dependency graph:

- full initiative entity inside Creator OS
- comprehensive generic audit-log subsystem beyond the minimum approval/action evidence
- generalized artifact-lineage platform
- structured logging overhaul
- advanced alerting
- producer-type registry
- automated promotion-package authoring
- multi-platform distribution
- analytics / attribution feedback loop
- higher autonomy levels

These are legitimate future-state capabilities but should not widen the current implementation footprint prematurely.

# Founder decisions

The current decision register for this plan is:

| Decision | Current recommendation | Timing |
|---|---|---|
| MCP policy vs. Contract 14 | Distinguish assistant-session MCP from authenticated machine-principal MCP | Before Phase E; policy clarified by Phase D |
| Queue architecture | Ratify the existing Postgres queue unless another requirement justifies migration | Phase A/B; BullMQ is not required to remove current blockers |
| HVN canonical identity | Resolve once for Accord, Word Art and future production | Hard blocker before Phase D exit |
| Producer/workflow state | Creator OS owns durable state | Ratify before Phase B implementation |
| Publishing architecture | Defer and run bounded evaluation | Phase F |
| Approval authority | Creator OS records evidence; authorization delegated to authorized principal layer | Before Phase B/C completion |
| Contract numbering collisions | Resolve clerically in governance repo without affecting implementation sequencing | As governance cleanup |

# Security maintenance track

The audit also surfaced Dependabot findings on the default branch. Dependency remediation should be handled as a separate security-maintenance track so it is not mixed with the Accord implementation scope.

Do not ignore high-severity vulnerabilities, but do not silently combine dependency upgrades with workflow/governance PRs unless a vulnerability directly blocks or compromises the current phase.

# Change discipline

For each phase:

1. document exact scope;
2. implement locally/development first;
3. run unit/integration tests appropriate to the control being changed;
4. open a focused PR;
5. require CI to pass;
6. deploy through the normal GitHub-driven path;
7. validate production only after deployment;
8. document the milestone and observed behavior before widening scope.

Do not use direct production edits to substitute for deploy parity unless an explicitly authorized emergency requires it.

# Program milestones

| Milestone | Definition |
|---|---|
| **M-A** | Existing execution lane is concurrency-safe, recoverable, idempotent and publish-gated |
| **M-B** | Creator OS can durably represent actors, approvals, pauses and article-shaped workflow state |
| **M-C** | Authorized machine principals can interact with Creator OS through an attributed, default-deny agent surface |
| **M-D** | First Accord-like L0 workflow can run through Creator OS governance without the Accord MCP |
| **M-E** | Accord MCP is implemented inside `hvnglobalco-com`, registered as a downstream in `rmg-piaar-mcps`, and one L0 package reaches `PROMOTION_READY` under enforced role/validation rules |
| **M-F** | Publishing architecture is deliberately selected and integrated behind a stable Master Atelier distribution contract |

# Definition of success for the initiative

The initiative succeeds when Master Atelier can take an Accord work item through a governed, attributable and recoverable production lifecycle where:

- coordinating agents cannot acquire specialist authority simply because a tool is reachable;
- incomplete packages fail structurally;
- visual/brand rule findings are system-enforced or require explicit attributed attestation;
- founders approve actual validated candidates rather than checklist defects;
- workflow state can pause safely and resume deliberately;
- MCP capabilities live in the centralized company MCP repository;
- Creator OS remains the durable orchestration authority;
- downstream promotion consumes only governed `PROMOTION_READY` outputs;
- publishing remains a separate, deliberate integration decision rather than an accidental dependency.
