# Contract — Production Recipe Architecture (Multi-Recipe Master Atelier)

> A contract captures the **ambition and boundaries** of a feature before it is built.
> It is a living document: update it as scope sharpens. Code should honor it.

- **Service id:** `production-recipe-architecture`
- **Status:** In design (discovery/design pass only — no implementation, no migration)
- **Phase:** Orchestration / cross-cutting (gateway + dashboard + db)
- **Owner:** Rahm Moore

## Mission

Let `productions` support more than one production archetype — **Creator Content**
(the existing Rahm social-video workflow), **Brand Promotion**, and **Promotion Story**
(cinematic/multi-scene narrative) — as workflow *recipes* applied to the same
Production entity, identity system, provider-execution layer, and Phase B governance,
instead of a duplicated "HVN Production page" / "Connection Circle Production page" per
brand. This document is the design pass requested before that build starts. It does not
implement or migrate anything.

## Why now — the boundary this repo already has, half-built

The **original architecture overview** (`docs/architecture/00-overview.md`) describes
the gateway itself as "the orchestrator... input → **Recipe** (which services, in what
order) → output → schedule," with `Job`/`Recipe` named as first-class entities from the
start. That vision was never built out: `productions` grew as one flat table with every
Creator-Content-specific field (script, voice direction, Higgsfield scenes, b-roll,
delivery) as columns directly on the row, and `stage` is free text advanced ad hoc by
whichever endpoint finishes its work. A **`recipes`/`jobs` pair already exists in the
schema** (`packages/db/src/schema.ts`, `recipes(id, name, inputKinds, outputKind,
steps: RecipeStep[])` + `jobs(recipeId, brand, status, input)`), but it operates at a
different altitude — a generic service/DAG orchestration model — and is dormant: nothing
populates `recipes` or drives execution off `jobs`. `productions` / `productionJobs` is
the pipeline that's actually alive.

This matters for scope: **"Production Recipe" is not a new idea for this repo, it's
completing an idea the repo already named and then didn't build.** The design below
must explicitly reconcile with (not duplicate) the dormant `recipes`/`jobs` pair —
see Open Decision D2.

`docs/contracts/20-hvn-accord-promotion-package.md` (status: planned, spec only) is the
existing evidence that a brand-flavored promotion pipeline was already anticipated — it
has HVN Global handing an approved article package to My Poster/Social Manager as a
"promotion brief" input, explicitly to avoid duplicating posting logic per brand. This
contract generalizes that same instinct into a formal recipe abstraction rather than a
one-off HVN carve-out.

## Current state (as built, not as documented)

Grounded directly in `packages/db/src/schema.ts`, `apps/gateway/src/server.ts`,
`apps/gateway/src/worker.ts`, `packages/integrations/src/renderer.ts`, and
`apps/dashboard/src/{Produce,ProductionWizard,ProductionList}.tsx`.

### `productions` — one flat table, one workflow's fields

- `brand: text` — free text. No `brands` table; validity is enforced only client-side
  against the static `BRANDS: BrandProfile[]` array in `packages/types`.
- `outputKind: text` (default `'post'`) and `stage: text` (default `'script'`) — both
  free text. `stage` is the *only* thing resembling a state machine, and nothing
  computes "what stage comes next for this production" — the dashboard's `STEPS` array
  (`ProductionWizard.tsx`) owns that ordering, not the backend.
- Every Creator-Content-specific field is a flat column on this one table: script
  fields, voice-direction fields (`voiceBrand`, `taggedScript`, `stability`, `voiceId`,
  `emotionLocked`, ...), `characterId`/`characterIds`, `higgsfieldScenes`/
  `higgsfieldShortlist`, `brollScenes`/`brollLibrary`, and delivery fields
  (`adIndexCode`, `finalVideoId`, `deliveryApprovals`, `deliveryChecklist`).
- **This is the load-bearing constraint**: a second recipe has nowhere to put its own
  stage-specific data without either reusing these Rahm-specific columns for an
  unrelated meaning, or bolting on more parallel columns forever. Column-per-feature,
  not model-per-recipe.
- Contract 13's *documented* 5-stage machine (`script → assets → generate → schedule →
  post → done`) has already drifted from the *as-built* 8-step wizard (`script, voice,
  assets, scenes, aroll, broll, finalcut, post`) — `ProductionList.resumeStep()` has to
  hand-map the old coarse `stage='generate'` onto the newer, finer step. This exact
  tension (frontend-owned step list vs. backend `stage` column) has already caused one
  documented drift; a recipe abstraction should retire it, not add a second instance of
  it per recipe.

### `productionJobs` — the queue, and a real constraint

`capability` is a **closed Postgres enum** (`aroll | broll | lipsync | audio |
thumbnail | poster`). A cinematic recipe's distinct steps (e.g. a shot-plan generation
step, a composite/assembly step) would need new enum values, which is a real migration,
not a config change — flagged for the migration sequence below, not for now.

### Brand modeling is fragmented, and HVN doesn't fit today's `BrandKey`

`packages/types` defines `BrandKey` (8 RMG micro-brands, `rmg/mstr-rahm/com/...`) and a
*separate* `StoreKey` (`hvn/orr/mstr-rahm/vlog`) for Shopify stores. **HVN exists only
as a `StoreKey`, never a `BrandKey`.** Contract 12 documents HVN Global as its own
*jurisdiction* (own Drive folder, own ClickUp space) — a peer of RMG/AMG, not a
micro-brand under it. There is no single DB-backed table unifying brand / store /
jurisdiction. `productions.brand` is a raw string column that will happily accept
`'hvn'` even though nothing today treats HVN as a valid production brand. **A recipe
selector that reads "Brand" needs this resolved** — see Open Decision D4.

### Provider execution: three coexisting patterns, one already-flagged bypass

A formal `Renderer` interface + `RendererRegistry` exists (`renderer.ts`) but is
explicitly a placeholder — only a `NullRenderer` fallback is registered; nothing real is
wired in. Meanwhile:
- HeyGen a-roll generation bypasses the registry entirely — `worker.ts`'s `dispatch()`
  special-cases `capability==='aroll' && provider==='heygen'` with a direct inline
  client call, commented as intentionally "unchanged... stays a direct client call."
- Higgsfield scene/image generation isn't queued through `production_jobs` at all — the
  route handler (`POST /productions/:id/higgsfield`) calls the Higgsfield client
  synchronously and writes straight into `videos`.
- `youtube.ts`'s `BRAND_QUERY` is a small, concrete instance of the exact anti-pattern
  the directive warns against: a hard-coded `Record<BrandKey, string>` lookup map.

None of this blocks a recipe design — the `characters` table (brand-scoped, holds
`soulId`/`elementId`, decoupled from any workflow) is exactly the "Adam"/"Vale" logical
identity model the directive asks for, and it transfers into a multi-recipe design
unchanged. But the provider layer's inconsistency is real technical debt adjacent to
this work; see Open Decision D6 on whether to fold its cleanup into this effort or defer
it.

### Human gates: one real precedent, narrowly scoped

`productions.deliveryApprovals`/`deliveryChecklist` (jsonb keyed maps, PATCH'd via
`delivery.ts`) is a working "human review gate before publish" pattern — but it's
hard-wired to the My Poster/publish stage only, not a general per-stage gate mechanism.
It's the right shape to generalize (see Data Model below), not the right scope.

### "Story Director" already means something specific here — a naming collision

`docs/contracts/02-story-director.md` (status: in build) already names **Story
Director** as the service that turns a raw scripted recording into a
segmented/captioned/music-backed *editable timeline package* — i.e. **post-generation
editing/finishing**, not pre-production shot planning. The founder directive's "Story
Director" (brief → shot/scene plan → Human Storyboard Gate → provider production) is a
**different, earlier-in-the-pipeline role** that happens to share the name. No code
implements either version yet, so nothing is broken, but the name cannot be reused for
both roles without confusion. **This needs a founder decision before implementation** —
see Open Decision D1. "Composer" is unclaimed (the one hit is an unrelated UI term in
`HiggsfieldPanel.tsx`).

### A cross-repo alignment worth naming directly

RPS contract 37 (HVN Havenry Adam intro promotion, just repaired) requires exactly a
named durable store called **`production_jobs`**, keyed by an idempotency key, with
`pending/accepted/failed/rolled_back` status and rollback-on-partial-failure semantics.
**This repo already has a table with that exact name.** They are not automatically the
same thing — contract 37's `production_jobs` is an administration-layer concept RPS
owns; this repo's `productionJobs` is Master Atelier's own execution queue — but the
naming and shape overlap enough that building the Promotion Story recipe without
reconciling the two would produce two same-named, different-shaped stores across two
repos administering the same campaign. This is a genuine founder-level architecture
decision, not an implementation detail — see Open Decision D5.

## Proposed hierarchy

```
Brand
  └─ Production Recipe          (Creator Content | Brand Promotion | Promotion Story | ...)
       └─ Brand/Character Configuration
            └─ Production Workflow Instance   (a `productions` row)
```

- **Brand** — which organization/property this belongs to (resolves D4 below).
- **Production Recipe** — a workflow *definition*: required intake fields, ordered
  stages, which stages carry a human gate, which capabilities/providers each stage may
  use, and completion criteria. Recipes are data, not code branches.
- **Brand/Character Configuration** — the brand-specific parameters a recipe consumes
  (visual language, approval requirements, cast bindings from `characters`, CTA/channel
  defaults) — this is what varies per brand *within* a shared recipe, matching the
  directive's explicit anti-pattern warning: never `if brand === HVN`, always `Brand +
  Recipe + Configuration = Instantiated Workflow`.
- **Production Workflow Instance** — today's `productions` row, extended with a recipe
  discriminator and a place for recipe-specific stage data that isn't Creator-Content
  shaped.

## Recipe-specific entry contracts (per the founder's brief)

**Creator Content** (existing, unchanged): Brand → Persona → Topic/Brief → Script →
Voice → Assets → Production. This is the current `Produce.tsx` form and 8-step wizard,
verbatim.

**Brand Promotion**: Brand → Objective → Campaign/message → Audience → Call to action →
Cast/Characters → Source material/references → Story Director (lightweight — composing
from B-roll/graphics/captions/voice/CTA, not a scene plan).

**Promotion Story**: Brand Promotion's intake plus narrative goal, cast, locations/world,
desired duration, format/platform, visual realism/style requirements, references → Story
Director in its heavier form (shot/scene plan → Human Storyboard Gate → per-shot provider
execution, per the directive's Manhattan/Havenry/Vale example).

## Data model direction (design only — not a migration)

This section states direction and constraints for a future migration, not schema to
apply now.

1. **A new recipe-definition table**, tentatively `production_recipes` (name TBD against
   D2): `key` (stable slug, e.g. `creator-content`, `brand-promotion`,
   `promotion-story`), `name`, `intake_schema` (jsonb — the fields a recipe's "New
   Production" form must collect), `stages` (ordered list, each with a `key`, whether it
   carries a human gate, and which `production_jobs.capability` values it may use),
   `completion_criteria`. This is what the dormant `recipes` table was reaching for at a
   different altitude (service DAG, not workflow entry-contract + stage list) — D2
   decides whether to repurpose that table, rename it, or retire it in favor of this new
   one; they should not both exist under similar names.
2. **`productions` gains a recipe discriminator** (`recipeKey`, FK to
   `production_recipes.key`), defaulting existing rows to `creator-content` — additive,
   non-breaking.
3. **Recipe-specific data does not become more flat columns.** Fields that only
   Brand Promotion / Promotion Story need (objective, campaign message, audience, CTA,
   narrative goal, shot plan) belong in a `recipeData: jsonb` column scoped by recipe
   `key`, or — if a recipe's shape stabilizes and needs real query/FK support (e.g. a
   `shot_plan` table with per-shot rows referencing `characters` and
   `production_jobs`) — a proper child table keyed by `production_id`, the same pattern
   `assets`/`videos`/`posts` already use. Either way, Creator Content's existing flat
   columns are left exactly as-is; nothing about the current Rahm workflow moves.
4. **Human gates generalize** the `deliveryApprovals`/`deliveryChecklist` jsonb-map
   pattern into a per-stage concept driven by `production_recipes.stages[].humanGate`,
   rather than a second bespoke jsonb column hard-wired to a different stage.
5. **`production_jobs.capability` enum** gets new values for recipe-specific stages
   (e.g. `scene_plan`, `shot_composite`) only once a real recipe needs them — this is a
   migration to plan for, not to run in this design pass.
6. **`characters` needs no structural change.** It is already brand-scoped and
   workflow-agnostic; a recipe's Cast step reads from it directly.

## UX recommendation

Keep `Produce.tsx` and the 8-step wizard exactly as they are for Creator Content — that
preserves the screen as directed. The only new UI surface at first:

- **At the top of New Production**, before Brand: a "What are we producing?" selector
  (`Creator Content | Brand Promotion | Promotion Story`), driving which intake fields
  render below it. Selecting Creator Content renders today's form unchanged.
- **`ProductionWizard.STEPS`** stops being one hardcoded array and becomes a function of
  the selected recipe's `stages` — Creator Content's stage list is exactly today's
  8 steps, so nothing visibly changes for that path.
- **`ProductionList`** gains a small recipe-type badge alongside the existing stage
  badge (`Creator Content` / `HVN · Promotion Story` / `Connection Circle · Brand
  Promotion`), reusing the existing badge styling.

## Validation cases (evaluated, not hard-coded)

- **HVN** → Promotion Story recipe; cast resolves `Adam`/`Vale` from the existing
  `characters` table (already brand-scoped, already holds Higgsfield `soulId`/
  `elementId` — no schema change needed for this part); brand configuration carries
  HVN's cinematic-realism profile, RPS contract 37's gates (affirmative rights
  clearance, named-authority render approval, exact provider/model/version, final-cut
  technical QA), and the Havenry-only publication boundary. This is also where Open
  Decision D5 (the two `production_jobs`) has to resolve before real implementation,
  since contract 37 is the concrete first consumer.
- **Connection Circle** → Brand Promotion recipe, same machinery, different cast
  (none/human), different visual language, different CTA/channels — proving the
  hierarchy doesn't special-case either brand.

## Responsibilities (in scope for this design)

- Define the Brand → Recipe → Configuration → Instance hierarchy.
- Direction for a recipe-definition data model that doesn't flatten onto `productions`.
- Reconcile naming against the dormant `recipes`/`jobs` pair and against RPS's
  `production_jobs`.
- UX entry point for recipe selection without disturbing Creator Content.
- Identify the Story Director naming collision and the founder decisions it forces.

## Out of scope (for now)

- Any schema migration or code change.
- Consolidating the three provider-execution patterns (Renderer registry vs. inline
  route call vs. inline worker bypass) — real debt, but a separate cleanup, not blocking
  this design (Open Decision D6).
- Building the shot-plan generation logic itself (what an LLM-driven Story
  Director/shot-planner actually outputs) — that's the next design pass once the
  founder decisions below are resolved.
- Article Promotion Package, Ad Creative, and other future recipes named in the
  directive as "eventually" — the hierarchy accommodates them; none are specified here.

## Dependencies

- **Services:** gateway, dashboard, ALLEN (script drafting stays Creator-Content-specific
  input, not a recipe-wide assumption).
- **Cross-repo:** `rmg-piaar-system` contract 37 (HVN Havenry Adam intro — first
  Promotion Story validation case), contract 12 (brand/jurisdiction model), contract 20
  (HVN Accord promotion package — prior art for this exact instinct).
- **Data:** `productions`, `characters`, `production_jobs`, the dormant `recipes`/`jobs`
  pair (to be reconciled, not extended blind).

## Brands / stores touched

VLOG · COM · The Rahm Council · Royal Reservations · BU$Y_MF · HVN · R+R ·
Connection Circle

## Success criteria

- A second and third recipe (Brand Promotion, Promotion Story) can be added without
  touching Creator Content's schema, API routes, or wizard UI.
- No `if (brand === 'hvn')`-shaped branching appears anywhere in the recipe machinery.
- `characters` (Adam/Vale) plug into Promotion Story's Cast step with zero schema
  change.
- The dormant `recipes`/`jobs` pair and the new `production_recipes` design don't
  coexist as two same-purpose, differently-shaped things with similar names.
- HVN's Promotion Story recipe and RPS contract 37 agree on one `production_jobs`
  meaning, not two.

## Open decisions (founder-level, block implementation)

- **D1 — Story Director naming collision.** Contract 02's Story Director (post-generation
  editing/finishing, in build) and the directive's Story Director (pre-production brief →
  shot plan, per Promotion Story) are different roles with the same name. Options: (a)
  rename the new pre-production role (e.g. "Creative Director" / "Shot Planner") and keep
  contract 02's name for finishing; (b) expand contract 02's Story Director to own both
  ends of the pipeline; (c) rename contract 02's existing role instead, since it's still
  only "in build," not live. Recommend (a) — least disruption to an in-flight contract —
  but this is the founder's call.
- **D2 — Dormant `recipes`/`jobs` tables.** Repurpose them into the new
  `production_recipes` model, rename them out of the way, or drop them outright (nothing
  reads/writes them today). Recommend renaming/retiring rather than repurposing, since
  their shape (service DAG) doesn't match a workflow entry-contract + stage list.
- **D3 — Recipe list for v1.** Confirm exactly `Creator Content`, `Brand Promotion`,
  `Promotion Story` for the first implementation pass, and whether contract 20's
  "Article Promotion Package" becomes its own fourth recipe now or stays a future
  addition once these three prove the hierarchy.
- **D4 — Brand/Store/Jurisdiction unification.** `BrandKey`, `StoreKey`, and contract
  12's prose-only "jurisdictions" don't share a table. A recipe selector needs to know
  "is HVN a valid Brand for production purposes" with one authoritative answer. Decide
  whether Production Recipe's "Brand" step reads a new unified table, or whether HVN
  gets treated as a `BrandKey`-equivalent specifically for recipe purposes without
  touching its `StoreKey`/jurisdiction meaning elsewhere.
- **D5 — Two `production_jobs`.** RPS contract 37 names `production_jobs` as its durable
  job store; this repo already has a table with that name serving a different purpose.
  Decide whether Master Atelier's `production_jobs` table is extended to also satisfy
  contract 37's idempotency-key/rollback requirements for HVN Promotion Story jobs
  specifically (one store, two consumers, careful key-namespacing), or whether RPS's
  administration layer keeps its own separate record and this repo's table stays
  execution-only with a documented mapping between the two. This must be resolved before
  any Promotion Story implementation touches HVN, since contract 37 is already merged
  and live as written.
- **D6 — Provider-execution consolidation.** Fold the Renderer-registry vs.
  inline-route-call vs. inline-worker-bypass cleanup into this work, or file it as a
  separate contract/cleanup pass. Recommend separate — it's real debt but orthogonal to
  the recipe hierarchy itself, and coupling them risks stalling the recipe work on an
  unrelated refactor.

## Migration sequence (once founder decisions above are made — not started)

1. **Phase 0 (this document).** Design pass; no code.
2. **Phase 1 — schema, additive only.** New `production_recipes` table (or the
   repurposed/renamed equivalent per D2); `productions.recipeKey` column defaulting all
   existing rows to `creator-content`; no column removed, no existing behavior changed.
3. **Phase 2 — gateway generalization.** A generic "what stage is next / what does this
   stage require" read path driven by `production_recipes`, introduced alongside (not
   replacing) today's bespoke per-step routes for Creator Content. New recipe-specific
   routes only as Brand Promotion/Promotion Story are actually built.
4. **Phase 3 — dashboard recipe selector.** The "What are we producing?" entry point;
   `ProductionWizard.STEPS` becomes recipe-driven; Creator Content's rendered form is
   byte-for-byte the same as today.
5. **Phase 4 — Story Director / shot-plan / human-gate generalization.** Only after D1
   is resolved; builds the heavier Promotion Story path (shot plan → Human Storyboard
   Gate → per-shot provider execution → canonical shot selection → Composer →
   composition manifest → finishing → Human Final-Cut Gate), validated first against
   HVN's Adam/Vale case under contract 37.
6. **Phase 5 (optional, separate track) — provider-execution consolidation** per D6.

## Open questions

- What does a shot-plan/storyboard record actually look like in the DB once Phase 4
  starts — a jsonb blob on the production row, or a proper `shot_plans`/`shots` child
  table? (Likely the latter once Promotion Story's shape stabilizes, per the `recipeData`
  guidance above — deferred to Phase 4 design, not this pass.)
- Where does Composer's "composition manifest" concretely live, and does it reuse
  `videos`/`assets` or need its own table? Same deferral as above.
- Does contract 02's Story Director (finishing) become a stage *inside* every recipe's
  pipeline (including Creator Content, retroactively), or stay scoped to whichever
  recipes need heavier finishing? Depends on D1's outcome.
