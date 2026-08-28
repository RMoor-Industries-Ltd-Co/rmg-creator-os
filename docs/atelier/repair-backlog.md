# Master Atelier — Repair Backlog & Broken/Fragile Systems

Companion to [`sprint-00-readiness-audit.md`](sprint-00-readiness-audit.md). **Planning artifact
only — no fixes are applied in Sprint 0.** Items are prioritized P0 (production-blocking) → P3
(hygiene). Each names the evidence, the risk, and a proposed (not-yet-approved) fix. Effort is
S/M/L.

## Broken / fractured systems (findings)

| ID | Finding | Evidence | Risk |
|---|---|---|---|
| F-01 | No automated test safety net | no vitest/jest, no `*.test.ts`, no fixtures; `ci.yml` runs typecheck+build only | Regressions ship silently; every change is unguarded. |
| F-02 | AI/boundary output is unvalidated | `allen.ts` casts JSON to TS type, no `zod`/schema check | Malformed/adversarial model output reaches production logic. |
| F-03 | Single hard dependency on external ALLEN | all AI/voice via `ALLEN_URL`; 503-gated, no fallback | ALLEN down ⇒ script/voice/assistant all dead. |
| F-04 | Higgsfield is a host-installed CLI | `higgsfield.ts` `execFile` of a host binary + creds | Not portable; ties scene generation to one host; hard to test/CI. |
| F-05 | Release-hygiene hazard: squash-merge + shared branch names | Word Art branch reused PR #28's squash-merged name; caught this session | A naïve PR re-introduces already-merged code; confusing diffs. |
| F-06 | Contract/status drift | contracts 06/07/10/15 documented but no in-repo wrapper/route | Docs overstate reality; misleads planning. |
| F-07 | Duplicated + frozen contract locations | `rmg-creator-os/docs/contracts/` (00–19, frozen) vs `rmg-piaar-system/contracts/` (00–29) | Readers land on stale copies. |
| F-08 | Provider abstraction hard-branched | `worker.ts` `if (capability===… && provider===…)` | Adding a provider means editing the worker; no conformance surface. |
| F-09 | Brand keyed as free text in DB | `brand: text('brand')` on productions/characters/posts/videos | No integrity vs `BrandKey`; typos/drift across brands. |
| F-10 | Monolithic gateway | `apps/gateway/src/server.ts` ~2669 lines | Change risk; hard to review; hot file for merge conflicts. |
| F-11 | Queue is HTTP-tick driven, not the documented BullMQ | `POST /worker/tick`; architecture doc says Redis+BullMQ | Doc/impl mismatch; throughput bound to tick cadence. |
| F-12 | No render/AI provenance standard | ad-hoc `videos.config` blob only | Can't reliably reproduce or audit an output. |
| F-13 | Migration snapshot gaps | `drizzle/meta` snapshots only 0000–0003; later hand-written | `drizzle-kit generate` misbehaves; migrations are hand-authored. |
| F-14 | Stale in-tree artifact | `rmg-piaar-session-3-handoff.md` at repo root | Noise; unclear authority/currency. |
| F-15 | HeyGen v2 API sunset | `heygen.ts` header note: v2 supported through 2026-10-31 | Hard deadline; A-Roll breaks if not migrated. |

## Prioritized repair backlog

### P0 — production-blocking (do first)
- **R-01 · Establish a test foundation** *(fixes F-01)* — add `vitest`, a `test` script per
  package, a golden-fixture corpus, and a **CI test gate** in `ci.yml`. Effort **M**. *Also
  unblocks Word Art Phase 1.*
- **R-02 · Validate the AI/boundary** *(F-02)* — introduce `zod` schemas at the ALLEN boundary and
  highest-risk request intakes; derive TS types from them. Effort **M**.
- **R-03 · Resilience for the ALLEN dependency** *(F-03)* — define graceful-degradation behavior
  (clear operator-facing states, retries, timeouts) so one service outage doesn't blank the
  wizard. Effort **M**.
- **R-04 · HeyGen v2→v3 migration plan** *(F-15)* — dated, because the deadline is real. Effort
  **M**.

### P1 — high (foundation & hygiene)
- **R-05 · Branch/merge convention that survives squash-merge** *(F-05)* — documented rule:
  branch off latest `main` for follow-up work; never reuse a squash-merged branch name without
  reset. Effort **S** (doc + checklist).
- **R-06 · Retire the frozen contract mirror to a pure pointer** *(F-07)* — leave only the
  pointer note in `docs/contracts/`; ensure every reader is routed to `rmg-piaar-system`. Effort
  **S**.
- **R-07 · Reconcile contract statuses with code** *(F-06)* — audit each contract's Status field
  against actual routes/wrappers; correct overstatements (the same honesty pass already applied
  to contracts 24/25 in `rmg-piaar-system`). Effort **S/M**.
- **R-08 · Formal `Provider`/`Renderer` interface + NullRenderer** *(F-08)* — a conformance
  surface so providers register instead of being hard-branched; a Null path enables headless
  CI. Effort **M**. *Also a Word Art Phase-1 prerequisite.*

### P2 — medium (integrity & maintainability)
- **R-09 · Brand integrity in the DB** *(F-09)* — move `brand` toward a validated key
  (enum/lookup) tied to `BrandKey`; add write-time validation. Effort **M** (needs migration —
  **deferred, requires later approval**).
- **R-10 · Provenance standard for renders + AI decisions** *(F-12)* — a documented minimal
  provenance shape (source, provider/model, config version, checksum) reused across outputs.
  Effort **M**.
- **R-11 · Decompose the gateway** *(F-10)* — carve `server.ts` into route modules like the
  existing `routes/*`. Effort **L**.
- **R-12 · Queue/BullMQ reconciliation** *(F-11)* — decide: adopt BullMQ as documented, or update
  the architecture doc to describe the tick model honestly. Effort **M**.

### P3 — hygiene
- **R-13 · Triage `rmg-piaar-session-3-handoff.md`** *(F-14)* — archive or remove. Effort **S**.
- **R-14 · Migration tooling note** *(F-13)* — document the hand-authored-migration workflow and
  the snapshot-gap caveat so contributors don't trust `drizzle-kit generate`. Effort **S**.

## Guardrail note

R-01/R-02/R-08 describe **new packages/runtime code and CI changes** and R-09 needs a migration —
none are implemented in Sprint 0. They are recorded here for Sprint 1 approval, consistent with
the sprint's "no engine/runtime/migration changes without later approval" guardrail.
