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
reconciles with (not duplicates) the dormant `recipes`/`jobs` pair — per ratified
Decision D2, they are retired rather than repurposed.

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
selector that reads "Brand" needs this resolved** — resolved per ratified Decision D4
below (a new `production_brands`/`brand_profiles` table).

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

### "Story Director" naming — resolved (D1, ratified 2026-09-13)

The original draft of this contract flagged a naming collision: `docs/contracts/
02-story-director.md` (status: in build) named "Story Director" as post-generation
editing/finishing, while this contract's "Story Director" (brief → shot/scene plan →
Human Storyboard Gate → provider production) is a different, earlier-in-the-pipeline
role. Since neither role was live in code, the founder ratified the clean fix rather
than inventing a workaround name: **contract 02 is renamed Composer**
(`docs/contracts/02-composer.md`) — its actual responsibility (assembly/finishing) was
always closer to a Composer than a director. **Story Director** is now reserved
exclusively for the pre-production role and has its own contract,
`docs/contracts/22-story-director.md`. Every reference to "Story Director" in this
document from here on means the pre-production role; every reference to "Composer"
means the renamed assembly/finishing service.

### A cross-repo alignment worth naming directly

RPS contract 37 (HVN Havenry Adam intro promotion, just repaired) requires exactly a
named durable store called **`production_jobs`**, keyed by an idempotency key, with
`pending/accepted/failed/rolled_back` status and rollback-on-partial-failure semantics.
**This repo already has a table with that exact name.** They are not automatically the
same thing — contract 37's `production_jobs` is an administration-layer concept RPS
owns; this repo's `productionJobs` is Master Atelier's own execution queue — but the
naming and shape overlap enough that building the Promotion Story recipe without
reconciling the two would produce two same-named, different-shaped stores across two
repos administering the same campaign. Resolved per ratified Decision D5: the two stores
stay separate and domain-owned, correlated by an explicit cross-system identifier rather
than merged into one table.

## Proposed hierarchy

```
Brand
  └─ Production Recipe          (Creator Content | Brand Promotion | Promotion Story | ...)
       └─ Brand/Character Configuration
            └─ Production Workflow Instance   (a `productions` row)
```

- **Brand** — which organization/property this belongs to, resolved via the new
  `production_brands`/`brand_profiles` table per ratified Decision D4.
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

1. **A new recipe-definition table**, `production_recipes` (name settled — D2 ratified
   retiring the dormant `recipes` table rather than repurposing it): `key` (stable slug,
   e.g. `creator-content`, `brand-promotion`,
   `promotion-story`), `name`, `intake_schema` (jsonb — the fields a recipe's "New
   Production" form must collect), `stages` (ordered list, each with a `key`, whether it
   carries a human gate, and which `production_jobs.capability` values it may use),
   `completion_criteria`. This is what the dormant `recipes` table was reaching for at a
   different altitude (service DAG, not workflow entry-contract + stage list) — per
   ratified Decision D2, that table is retired rather than repurposed, so the two never
   coexist under similar names.
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
  ratified Decision D5's cross-system correlation identifier (the two `production_jobs`
  stores stay separate, correlated) has to be wired through before real implementation,
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
- Identify the Story Director naming collision and record the founder's ratified
  resolution (contracts 02 and 22).

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

## Provider authority (Artlist — founder-ratified 2026-09-13)

Recorded here per founder decision alongside D1–D6, since it constrains what Story
Director (contract 22) may assign per shot: **Artlist is approved as Master Atelier's
B-roll / environmental / commodity visual-generation provider** — it passed realistic
urban B-roll evaluation. Artlist is **not** character identity authority, avatar-
performance authority, canonical voice authority, orchestration authority, approval
authority, or final-render authority. A prior virtual-artist/music-composition test
failed materially, so **Artlist is not approved as Master Atelier's music-composition
authority**. Full detail lives in contract 22's Provider Authority section, since that's
where a shot plan actually consumes this; this contract records the decision so it isn't
missed when reading only the recipe architecture.

## Dependencies

- **Services:** gateway, dashboard, ALLEN (script drafting stays Creator-Content-specific
  input, not a recipe-wide assumption), Story Director (contract 22, pre-production),
  Composer (contract 02, assembly/finishing — formerly named Story Director).
- **Cross-repo:** `rmg-piaar-system` contract 37 (HVN Havenry Adam intro — first
  Promotion Story validation case), contract 12 (brand/jurisdiction model), contract 20
  (HVN Accord promotion package — prior art for this exact instinct).
- **Data:** `productions`, `characters`, `production_jobs`, the dormant `recipes`/`jobs`
  pair (retired per D2, not repurposed).

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

## Founder decisions (ratified 2026-09-13 — implementation still not started)

- **D1 — RATIFIED.** "Story Director" is reserved for the pre-production creative-
  direction role: brief/script → scene/shot plan → storyboard gate (contract 22).
  Contract 02's post-generation editing/finishing role is renamed **Composer** /
  **Production Composer** (`docs/contracts/02-composer.md`), since its responsibility
  aligns with assembly/finishing rather than directing. Done in this revision — see the
  "Story Director naming" section above.
- **D2 — RATIFIED.** Do not repurpose the dormant `recipes`/`jobs` tables. They are a
  legacy/dormant service-DAG abstraction at a different altitude than Production
  Recipes. Verify they are unused/empty, then retire/rename/remove them through a later
  controlled migration (Phase 1, below) rather than conflating them with the new model.
- **D3 — RATIFIED.** v1 Production Recipes are exactly `Creator Content`, `Brand
  Promotion`, and `Promotion Story`. Contract 20's "Article Promotion Package" remains
  an input/source package for Brand Promotion, not a fourth recipe, for now — revisit
  only if its workflow proves materially distinct once the first three prove the
  hierarchy.
- **D4 — RATIFIED DIRECTION.** Do not collapse `BrandKey`, `StoreKey`, and jurisdiction
  into one overloaded concept, and do not make HVN pretend to be an existing `BrandKey`.
  Introduce a canonical Master Atelier production-brand/property identity — tentatively
  `production_brands` or `brand_profiles` — with stable slugs (`hvn`,
  `connection-circle`, `mstr-rahm`, ...) and optional references to `StoreKey`,
  jurisdiction, Drive roots, and publishing identity where applicable. Production
  Recipe's "Brand" step consumes this one authoritative identity instead of overloading
  `BrandKey`/`StoreKey`. This table is new schema (Phase 1/2, below), not merely a
  reinterpretation of an existing one.
- **D5 — RATIFIED.** Keep RPS's and Creator OS's `production_jobs` as separate,
  domain-owned durable stores — do not share one physical table across repos merely
  because the names match. RPS owns administrative/campaign orchestration for contract
  37; Creator OS owns Master Atelier's execution queue. Add explicit cross-system
  correlation (e.g. an `external_job_id`/`origin_system` pair, or a shared
  correlation/idempotency identifier threaded through both records) and document the two
  as distinct, qualified concepts (e.g. `rps.production_jobs` vs.
  `creator_os.production_jobs`) rather than one name meaning two things.
- **D6 — RATIFIED.** Provider-execution consolidation (Renderer-registry vs.
  inline-route-call vs. inline-worker-bypass) is a separate cleanup track, not a
  precondition for Production Recipe implementation. The recipe design defines a clean
  capability/provider boundary (Story Director's per-shot provider assignment, contract
  22) that a later consolidation can adopt without redesigning the recipe layer.

## Migration sequence (ratified direction above — implementation not started)

1. **Phase 0 (this document + contracts 02/22).** Design pass; no code. Complete.
2. **Phase 1 — schema, additive only.** New `production_recipes` table; new
   `production_brands`/`brand_profiles` table per D4; `productions.recipeKey` and
   `productions.brandRef` columns defaulting all existing rows to `creator-content` and
   each existing `BrandKey` respectively; verify the dormant `recipes`/`jobs` tables are
   empty/unused, then retire them per D2. No existing column removed, no existing
   behavior changed.
3. **Phase 2 — gateway generalization.** A generic "what stage is next / what does this
   stage require" read path driven by `production_recipes`, introduced alongside (not
   replacing) today's bespoke per-step routes for Creator Content. Brand resolution
   reads the new `production_brands` table. New recipe-specific routes only as Brand
   Promotion/Promotion Story are actually built.
4. **Phase 3 — dashboard recipe selector.** The "What are we producing?" entry point;
   `ProductionWizard.STEPS` becomes recipe-driven; Creator Content's rendered form is
   byte-for-byte the same as today.
5. **Phase 4 — Story Director / Composer / human-gate generalization.** Builds the
   heavier Promotion Story path per contract 22 (shot plan → Human Storyboard Gate →
   per-shot provider execution, respecting the Artlist/Higgsfield/HeyGen provider
   authority split → canonical shot selection → Composer, contract 02 → composition
   manifest → finishing → Human Final-Cut Gate), validated first against HVN's Adam/Vale
   case under contract 37, with the D5 cross-system correlation identifier wired through
   from the first Promotion Story job.
6. **Phase 5 (optional, separate track) — provider-execution consolidation** per D6.

## Open questions

- What does a shot-plan/storyboard record actually look like in the DB once Phase 4
  starts — a jsonb blob on the production row, or a proper `shot_plans`/`shots` child
  table? (Likely the latter once Promotion Story's shape stabilizes, per the `recipeData`
  guidance above — deferred to Phase 4 design, not this pass; also open in contract 22.)
- Where does Composer's "composition manifest" concretely live, and does it reuse
  `videos`/`assets` or need its own table? Same deferral as above.
- Exact shape of the `production_brands`/`brand_profiles` table per D4 — deferred to
  Phase 1 schema design, not this pass.
- Exact shape of the D5 cross-system correlation identifier between RPS's and Creator
  OS's `production_jobs` — deferred to Phase 4/contract 37 implementation, not this pass.
