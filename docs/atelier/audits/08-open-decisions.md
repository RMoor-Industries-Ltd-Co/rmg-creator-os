# 08 — Open Decisions

Only decisions that **cannot responsibly be made from repository evidence**. Each states what is
known, what is genuinely undetermined, and a recommendation where the evidence supports one.

## D-A — WITHDRAWN (2026-09-09): there was no collision

**This decision should never have been raised.** It rested on my misreading of contract 14, and
it is withdrawn rather than deleted so the correction is auditable.

**What I claimed.** That contract 14's "MCP + OAuth = assistant-in-loop only" row forbids
headless pipeline stages from depending on MCP, putting the initiative in direct conflict with a
ratified contract and requiring an amendment before any MCP work.

**What contract 14 actually says.** An explicit callout immediately above that Rule states the ⚠️
row is about PIAAR *consuming* an external MCP server, and that PIAAR *publishing* its own tools
as a machine-authenticated MCP server is headless-safe — naming the conflation of the two as the
reason the contract's own open question stays open. `rmg-piaar-system/CLAUDE.md` repeats it.
Both were available to me, and read, before I wrote the opposite.

**Consequence.** No contract amendment is required. Nothing in contract 14 blocks the roadmap's
MCP work; the dependency recorded against roadmap item 18 is removed.

**What remains true.** Consuming a *third party's* per-user-OAuth MCP server (SuperCool, ClickUp,
Google Docs) from an unattended worker is still prohibited — a headless stage must not borrow a
person's session. That is a real boundary, and it is not a decision: it is already decided.

## D-B — BullMQ vs. the Postgres queue

**Known.** `README.md:33` and ADR-0001 name "Redis + BullMQ" as the job backbone. BullMQ is not
a dependency of any package. Redis serves only a `/health` ping. The real backbone is
`production_jobs` + `POST /worker/tick`.

**Undetermined.** Whether to ratify the DB queue (and correct the docs) or adopt BullMQ (and
build it).

**Recommendation.** Ratify the DB queue. It already provides retry, backoff and cancellation;
its real defects (atomic claim, lease, idempotency) are fixable in place and must be fixed
either way. Adopting BullMQ would add baseline infrastructure against the standing constraint
without removing a single blocker. **Do not leave both documented.**

## D-C — HVN brand identity (P-5)

**Known.** `BrandKey` has no HVN member; HVN is `StoreKey = 'hvn'`.
`packages/types/test/index.test.ts:41` asserts this deliberately. `packages/wordart/src/wordArt.ts:174`
records "HVN/AMG scope OPEN". Contract 29 records the same question as OPEN.

**Undetermined.** Whether HVN gains a content `BrandKey`, or Master Atelier producers key off
`StoreKey` for store brands.

**Recommendation.** Answer **once, for both** the Accord Producer and Word Art. This is a
founder/architecture decision about the brand model, not an engineering preference.

**Blocks:** roadmap item 5 — hard block.

## D-D — Where producer job state lives

**Known.** Creator OS owns the queue, the renderer registry and the approval surfaces.

**Undetermined.** Whether producer job state belongs in Creator OS beside `production_jobs`, or
in a separate service.

**Recommendation.** Creator OS. A separate service would need its own queue, worker, auth and
deploy chain to reach parity with what already exists. But this is an architecture call.

## D-E — Publishing architecture

**Known.** Postiz is deployed at `social.rmasters.group`, the client is written and inert
without a key, and the "Social Manager for RMG" name is publicly bound to it through published
privacy/terms pages. `Social_Manager_v2.0` is referenced nowhere in Creator OS and could not be
read under this audit's authorized scope.

**Undetermined.** Postiz / direct provider APIs / hybrid adapter — and consequently the
disposition of `Social_Manager_v2.0`.

**Recommendation.** **Defer, with a bounded evaluation.** Nothing is blocked by it. Before
deciding, grant read access and compare against the Postiz contract documented in
[06](06-social-manager-disposition.md) §5. Note that Creator OS has **no `PublishEngine`
abstraction** — a hybrid model would require building one, which is itself a reason to decide
deliberately.

## D-F — Approval authority model

**Known.** Creator OS has no role concept. `rmg-piaar-mcps/packages/authz` implements
default-deny, per-principal, immutable-deny authorization already.

**Undetermined.** Whether approval authority is modelled inside Creator OS or delegated to the
fabric.

**Recommendation.** Model *approval records* (who, role, verdict, when, on what) in Creator OS —
they are production state. Delegate *authorization* (may this principal approve at all) to the
fabric. Do not build a second authorization engine.

## D-G — Contract 20 numbering collision

**Known.** `docs/contracts/` in this repo is declared "frozen and unmaintained", yet
`20-hvn-accord-promotion-package.md` was added after the freeze, and `20` is MAAT in the
canonical set.

**Undetermined.** Nothing architectural — but someone must decide the renumber and the move.

**Recommendation.** Migrate to `rmg-piaar-system/contracts/30-…`, leave a pointer here, re-freeze.
Clerical, but it should be deliberate.

## What is NOT an open decision

For clarity, these were determined by evidence and need no founder input:

- Whether Creator OS references `Social_Manager_v2.0` — **it does not**
- Whether a publishing engine blocks the Accord initiative — **it does not**
- Whether the job claim is atomic — **it is not**
- Whether publish checks approvals — **it does not**
- Whether Creator OS has any agent/role/audit model — **it does not**
- Whether BullMQ is installed — **it is not**
