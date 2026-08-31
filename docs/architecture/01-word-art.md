# Word Art — Implementation Architecture (RMG Creator OS)

**How the Word Art capability lands in *this* codebase.** The canonical, vendor-independent
feature contract is [`rmg-piaar-system/contracts/29-word-art.md`](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/blob/main/contracts/29-word-art.md)
and its child schemas in
[`contracts/word-art/`](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/tree/main/contracts/word-art).
The load-bearing decision is recorded in [`../adr/0002-word-art-domain-vs-renderer.md`](../adr/0002-word-art-domain-vs-renderer.md).
This document is the creator-os-specific mapping — it does **not** restate the contract; read
that first.

Status: **Phase 0 (spec)**, with one exception: **Sprint 2 PR 1** landed the domain types only
— `packages/types/src/wordArt.ts` (exported via the package barrel) transcribes all 11 child
specs into TypeScript interfaces (`WordArtEvent`, `WordArtPlan`, `TypographyProfile`,
`MotionProfile`, `WordArtBrandProfile`, `CompositionContext`, `VisualAnalysis`,
`WordArtRenderRequest`, `WordArtRenderResult`, `QaResult`, `ApprovalDecision`). This is
**types only** — no runtime validation, no routes, no DB migrations, no `wordart` capability
enum, no worker/dispatch changes, no renderer registry or `WordArtNullRenderer`. Everything
else below remains the plan a future engineer follows, not yet applied.

Note: the render request/result types are named `WordArtRenderRequest`/`WordArtRenderResult`
(not the bare `RenderRequest`/`RenderResult` the table below uses informally) to avoid
colliding with `packages/integrations`'s existing, much simpler `RenderJob`/`RenderResult`
(Sprint 1 PR 4) — the two live at different levels (domain vs. renderer-boundary) but share a
workspace.

**Sprint 2 PR 2** added Gate 2 (deterministic contract validation) beside those types, in
`packages/types/src/wordArt.validate.ts` (`WordArtEventSchema`/`WordArtPlanSchema` — zod,
same parse-not-cast pattern as `apps/gateway/src/allen.schemas.ts`'s `parseAllen`, see
[`../atelier/ai-boundary-validation.md`](../atelier/ai-boundary-validation.md) — plus
`validateWordArtEvent`/`validateWordArtPlan`, which layer the timing/density rules the zod
schema alone can't express: `durationMs >= minReadableMs`, strict event ordering/non-overlap,
and the minimum-spacing density rule between cinematic events). This validates a candidate
`WordArtEvent`/`WordArtPlan` shape, range, and timing — it does **not** resolve `primitive`/
`motionProfile`/`brandProfile` against a live config allow-list (no such config exists yet;
tracked as a known limitation, not silently assumed done), and it still adds no routes, DB
migrations, worker/dispatch wiring, renderer/registry changes, or a `wordart` capability enum.

**Placement decision (approved):** the validator lives in `packages/types`, not a new
`packages/wordart` or `packages/integrations` — this slice is deterministic validation of the
domain types themselves, not renderer integration or full plan/scoring orchestration. Extract
into a dedicated `packages/wordart` only once scope grows into Gate 1 density/composition
logic, scoring formulas, config-versioned threshold tables, transcript-to-plan orchestration,
or fixture-corpus management — i.e. domain lifecycle work that outgrows "shared vocabulary
plus its validation."

**Sprint 2 PR 3** added the headless exercise path proving `validated WordArtEvent →
WordArtRenderRequest → synthetic WordArtRenderResult`, in
`packages/types/src/wordArt.compile.ts` (`compileWordArtRenderRequest`,
`computeMotionParameters`, `buildSyntheticWordArtRenderResult`). Package-level only: proven by
a vitest suite in `packages/types/test/wordArt.compile.test.ts`, with no worker, route, DB, or
live renderer involved. Not exported from the main barrel — same reasoning as PR 2's
`wordArt.validate` fix — only via `@rmg-creator-os/types/wordArt.compile`, so it never reaches
the dashboard bundle. Deliberately not a `packages/integrations` `Renderer`: that interface's
`RenderJob`/`RenderResult` are the simpler Sprint 1 PR 4 shapes, and forcing the richer
domain-level request/result through them would be lossy — see the compile module's own header
comment. `wordart` remains **out** of `productionJobCapability`, and `WordArtNullRenderer`
remains undeferred, pending a real persisted-job/runtime route (Phase 2+).

**Contract ambiguity found:** `word-art-event.md`'s schema nests `composition: {anchor,
safeZone}` directly on the event, but the `textBox` rectangle `WordArtRenderRequest.composition`
actually needs lives in `composition-context.md`'s richer `CompositionContext` — neither spec
wires the two together explicitly. `compileWordArtRenderRequest` takes the resolved `textBox`
as an explicit caller-supplied option rather than guessing at a mapping.

**Sprint 2 PR 4** closes the contract's own Phase 1 "gate of done" (`contracts/29-word-art.md`,
"Implementation phases": *"A fixture transcript → validated plan, no AI, no Adobe"*), which PRs
1–3 had not yet reached — they proved the mechanics starting from a hand-authored event, not
from a transcript. `packages/types/src/wordArt.plan.ts` adds `buildWordArtPlanFromSegments`
(plus its PROVISIONAL scoring heuristic, `scoreSegment`), which deterministically turns
`TranscriptSegment[]` + a caller-supplied `WordArtPlanBuilderConfig` into a `WordArtPlan` +
`WordArtEvent[]` — no AI, no ALLEN, no network calls. Proven end-to-end by
`packages/types/test/wordArt.plan.test.ts` against three fixture transcripts
(`test/fixtures/word-art/`: a declaration scenario that produces a Word Art event, a plain
non-Word-Art caption scenario that correctly produces zero events, and a low-confidence
scenario — a keyword present but not enough alone — that also correctly produces zero) chained
through Gate 2 validation (PR 2) and the compile/synthetic-result path (PR 3). Not exported
from the main barrel — only via `@rmg-creator-os/types/wordArt.plan`. The scoring heuristic
(keyword/exclamation/word-count) is explicitly a fixture-level stand-in for the contract's real
`W = f(S,E,P,B,C,T)` model — PROVISIONAL, not a creative strategy decision.

**With this PR, Sprint 2: Word Art Phase 1 — Plan Before Render is complete** against the
contract's own stated gate. `wordart` remains out of `productionJobCapability`; no DB, routes,
worker dispatch, `RendererRegistry`, `WordArtNullRenderer`, Adobe/Resolve, or AI work exists
anywhere in the repo.

**Sprint 3 PR 1 — Word Art Domain Boundary Extraction.** All Word Art source and tests moved
from `packages/types` into a dedicated `packages/wordart` package: `wordArt.ts` (domain types),
`wordArt.validate.ts` (Gate 2), `wordArt.compile.ts` (compile + synthetic result), and
`wordArt.plan.ts` (fixture plan builder), plus their tests and fixtures. This is the PR 2
extraction trigger firing (transcript-to-plan orchestration now exists) — `packages/types` is
restored to shared vocabulary only, with zero Word Art surface area and zero runtime
dependencies (`zod`/`@types/node` moved with the code that needed them). Purely mechanical: no
behavior changed, all 83 tests pass unchanged, dashboard bundle unchanged at baseline.
`@rmg-creator-os/wordart`'s main export is types-only (mirroring `packages/types`'s own
barrel discipline); Gate 2, the compiler, and the plan builder are each their own subpath
(`./validate`, `./compile`, `./plan`) — never the main entry — so no consumer of the bare
package import can pull in zod or `node:crypto` by accident. The one import fix this required:
`wordArt.ts`'s `BrandKey`/`StoreKey` reference now resolves via `@rmg-creator-os/types` (a real
cross-package import) instead of the local `./index.js` it could rely on while co-located.

Sprint 4 decides whether the next slice is fixture-corpus expansion, AI-assisted planning
(Phase 2), or runtime job integration — all now landing inside `@rmg-creator-os/wordart`
rather than reopening the packaging question.

## The one principle, in this repo's terms

*AI proposes creative meaning; deterministic code owns production correctness; the boundary
between them is a typed, versioned, validated contract.* Concretely: AI output (from ALLEN /
future providers) becomes a **candidate** that must pass a deterministic **Gate 2 validator**
before any `productionJobs` render is enqueued. This is a *new discipline* — today the gateway
trusts AI JSON as-is (`allen.ts` casts responses with no runtime check). See ADR 0002.

## Package boundaries (reuse, don't fork)

| Layer | Where | What Word Art adds |
|---|---|---|
| **Domain types + Gate 2 + compile + planning** | `packages/wordart/src/` (Sprint 3 PR 1 — moved out of `packages/types`) | `WordArtEvent`, `WordArtPlan`, `TypographyProfile`, `MotionProfile`, `WordArtBrandProfile`, `CompositionContext`, `VisualAnalysis`, `WordArtRenderRequest`, `WordArtRenderResult`, `QaResult`, `ApprovalDecision` (types, main export) + Gate-2 validation (`./validate`) + render-request compile/synthetic result (`./compile`) + fixture plan builder (`./plan`). `packages/types` stays shared vocabulary only. |
| **Brand model** | `packages/types` `BrandKey`/`BrandProfile` | Word Art *references* existing `BrandKey`/`StoreKey`; a `WordArtBrandProfile` layers typography/motion rules on top. `COACH_RAHM→'mstr-rahm'`, `RMG→'rmg'`; HVN/AMG scope OPEN. **No second brand registry.** |
| **Renderer adapters** | `packages/integrations/src/` | `wordart/` adapters mirroring the `HiggsfieldClient` interface shape: `AdobeRenderer`, `ResolveRenderer`, `NullRenderer`, all satisfying one `WordArtRenderer` interface that advertises `RendererCapabilities`. |
| **DB** | `packages/db/src/schema.ts` + `drizzle/` | New tables `word_art_plans`, `word_art_events`, `word_art_renders`, `word_art_config`; new `productions` columns (`word_art_plan_id`, `word_art_status`, `word_art_autonomy`, `word_art_config_id`). Defensive migration (`IF NOT EXISTS`, `--> statement-breakpoint`), registered in `drizzle/meta/_journal.json`, auto-run by `runMigrations`. |
| **Queue / worker** | `packages/db/src/queue.ts`, `apps/gateway/src/worker.ts` | Add `'wordart'` to the `productionJobCapability` pgEnum; a `(capability==='wordart')` branch in `runJob()` dispatching by `provider` (`adobe`/`resolve`/`null`) to the adapter — exactly the existing `(capability, provider)` pattern. |
| **Gateway routes** | `apps/gateway/src/routes/` | `wordart.ts` with the `/productions/:id/wordart/*` surface (analyze, plan, validate, approve, preview, qa, render, renders) + `GET /wordart/renderers`. Manual `reply.code(400)` guards, matching existing routes — plus the Gate-2 validator (see below). |
| **Scoring/motion config** | new `word_art_config` table / versioned JSON | `{configVersion, scoringWeights, thresholdModel, motionCurves}`. Every plan records the `configVersion` it was scored under. **No** hard-coded weights/thresholds/curves in route or renderer code. |
| **Dashboard** | `apps/dashboard/src/` | A Word Art review panel in the Assets/Generate stage (Gate 1 review, Gate 3 Approve/Regenerate/Edit/Reject). Phase 3+; not in the first cut. |
| **AI providers** | `apps/gateway/src/allen.ts` + future | `TranscriptAnalyzer`/`SemanticScorer`/`RhetoricalClassifier`/`EmphasisDetector`/`VisualDirector`/`CompositionAnalyzer`/`VisualQAInspector` interfaces, first implemented over ALLEN endpoints; provider-independent so a direct model or local provider can be swapped in. |

## The `(capability, provider)` fit

The repo already dispatches render work by two axes: `productionJobCapability` (what) +
free-text `provider` (which vendor), branched in `worker.ts`. Word Art is simply a new
capability `wordart` with providers `adobe | resolve | null`. **NullRenderer (`provider:'null'`)
is the Phase-1 and CI default** — it satisfies the full contract and returns a deterministic
descriptor instead of pixels, so planning/scoring/validation/state/provenance run with no Adobe
installed. Enqueue stays the existing `enqueueJob(db, {capability:'wordart', provider, payload})`.

## State & status, mapped to repo conventions

- **Event lifecycle** (`PROPOSED → … → APPROVED` + failure states) is stored as a `text` status
  with an inline-union comment — the repo's dominant per-row pattern (`characters.status`,
  `assets.status`).
- **Render jobs** reuse the `productionJobStatus` pgEnum (`queued|running|done|failed|cancelled`)
  and the worker's existing attempt/backoff/lock/cancel machinery (idempotency, retries,
  cancellation — no new queue).
- **`productions.word_art_status`** is a coarse rollup for the wizard, advanced inline per route
  like the existing `stage`.

## Gate 2 — the validator (new discipline)

A pure, deterministic module (`packages/` or gateway lib) that takes a candidate plan/event and
returns typed pass/fail with structured errors: schema + contract-version, primitive/motion/
brand allow-lists (from config), duration ≥ min-readable, word-count, brand compliance
(approved fonts/palette/prohibited), renderer-capability satisfaction, safe-zone/collision. It
is the only path from AI candidate → enqueued render. **Recommendation:** author the schemas in
`zod` and derive the TS types from them, so the boundary is validated at runtime — the repo has
no runtime validation today, so this is EXPERIMENTAL and called out in ADR 0002.

## Provenance

Extend the existing `videos.config`-as-provenance-blob pattern: `provenance jsonb` on
plans/events/renders carrying source transcript/segment, proposing provider/model + prompt +
`configVersion`, confidence, approver, contract & brand-profile versions, primitive
*implementation*, renderer + version, validation & QA rulesets, output + checksum — enough to
reproduce a render (same plan + same config version + same renderer version → same output).

## Testing (new for this repo)

The repo has only Playwright e2e today. Word Art needs unit/contract/golden coverage —
**recommend introducing `vitest`** (EXPERIMENTAL). Golden fixtures (`transcript + scene →
expected plan`) run against **NullRenderer**, so the whole planner/validator is testable in CI
with no Adobe. Renderer conformance tests treat NullRenderer as the reference oracle every
adapter must match.

## Build order (creator-os slice)

1. `packages/types` interfaces mirroring the child specs; `wordart` added to
   `productionJobCapability`.
2. `NullRenderer` + `WordArtRenderer` interface + `RendererCapabilities` in
   `packages/integrations`.
3. Gate-2 validator module (zod-backed) + scoring/threshold/motion **config** table.
4. DB migration (`word_art_*` tables + `productions` columns); worker `wordart` branch.
5. Gateway `/productions/:id/wordart/*` routes; the Planner produces a validated plan from a
   fixture transcript (Phase 1 done — no AI, no Adobe).
6. ALLEN-backed analyzers behind the provider interfaces + Gate 1 (Phase 2); then the Adobe
   adapter + first primitive implementations + preview (Phase 3); Phases 4–7 per the contract.

## What this feature must NOT do (guardrails)

- Never let a vendor asset id (`*.mogrt`, AE project path) into `packages/types`, the DB, or a
  `RenderRequest` — those live only inside an adapter.
- Never hard-code scoring weights, thresholds, or motion curves in route/renderer code — they
  are versioned config.
- Never enqueue a render from unvalidated AI output — Gate 2 is mandatory.
- Never make the domain schema assume Adobe — NullRenderer and a future Resolve adapter must
  keep working unchanged.
