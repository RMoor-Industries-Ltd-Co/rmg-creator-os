# Contract — Story Director

> This name was reserved for this role by founder decision D1 in
> `docs/contracts/21-production-recipe-architecture.md` (2026-09-13). The
> service previously named Story Director (post-generation editing/
> finishing) is renamed **Composer** — see `docs/contracts/02-composer.md`.
> Neither role was live in code at the time of this decision.

- **Service id:** `story-director`
- **Status:** Planned (spec only, no implementation)
- **Phase:** Orchestration / Promotion Story recipe
- **Owner:** Rahm Moore

## Mission
Turn a creative brief — for a Brand Promotion or Promotion Story recipe — into
a structured, gated shot/scene plan that downstream provider execution
follows, instead of leaving generation services to improvise the narrative.
As contract 21 puts it: "your generation services aren't deciding the movie —
they're executing the storyboard."

## Inputs
- A Brand Promotion or Promotion Story brief: narrative goal, cast
  (referencing `characters` — e.g. Adam, Vale), locations/world, desired
  duration, format/platform, visual realism/style requirements, references.
- For the lightweight Brand Promotion case: objective, campaign/message,
  audience, CTA — Story Director's output here can be a simple composition
  order rather than a full scene plan.
- Brand/Character Configuration (visual language, approval requirements) for
  the requesting Brand.

## Outputs
- A **storyboard / shot plan**: an ordered list of scenes/shots, each with
  purpose, provider assignment, camera direction, cast, and audio notes —
  e.g. (from contract 21's worked example) "Scene 2 — Adam approaching
  Havenry — Provider: Higgsfield — Character: Adam canonical Soul — Camera:
  medium tracking shot from 3/4 rear."
- A gate event for the **Human Storyboard Gate** — the plan is not sent to
  provider execution until approved.
- Per-shot provider/capability assignments consumed by the existing
  provider-execution layer (Higgsfield for identity-bound shots, HeyGen for
  spoken/lip-synced dialogue, Artlist for realistic B-roll/environmental/
  commodity visuals — see the Provider authority section of contract 21).

## Responsibilities (in scope)
- Interpret a brief into a scene-by-scene plan without inventing narrative
  facts the brief didn't establish (e.g. don't add dialogue if the campaign
  invariant says none).
- Assign each shot to a provider/capability based on what that shot actually
  needs (identity continuity → Higgsfield Soul; lip-synced speech → HeyGen;
  realistic non-identity B-roll → Artlist), not a fixed per-recipe default.
- Resolve logical character references (e.g. `Adam`, `Vale`) against the
  `characters` table's brand-scoped identity bindings — never invent or
  hard-code a provider-specific ID in the plan itself.
- Hold the plan at the Human Storyboard Gate until a founder/authorized
  reviewer approves it, per Brand Promotion/Promotion Story's human-gate
  requirements (contract 21's Data Model direction, item 4).
- Hand off approved, per-shot execution requests to provider execution; hand
  off resulting candidate shots' canonical selection to Composer (contract
  02) for assembly into a composition manifest.

## Out of scope (for now)
- Actually calling providers to render a shot — that's the provider-execution
  layer (Higgsfield/HeyGen/Artlist clients), which Story Director assigns to
  but does not itself invoke.
- Assembly/finishing of generated shots into a timeline or composition
  manifest — that is Composer's role (contract 02), downstream of this one.
- Scriptwriting for the Creator Content recipe — that path's script already
  carries its own structure and does not need a shot plan (contract 21's
  "For Creator Content, Story Director can remain relatively lightweight").
- Final-cut technical QA and publication approval (site-handoff / publication
  gates — recipe- and, for HVN specifically, RPS contract 37's own gates).
- Canonical shot selection itself — a human/founder decision informed by
  candidate shots, not Story Director's own call.

## Dependencies
- **Services:** gateway (recipe/production orchestration), Composer (contract
  02, downstream handoff), provider-execution layer (Higgsfield, HeyGen,
  Artlist clients in `packages/integrations`).
- **Data:** `characters` (cast resolution), `production_recipes` /
  `productions.recipeKey` (contract 21's proposed recipe model), the shot
  plan's own data shape (see contract 21's open questions — likely a
  `shot_plans`/`shots` child table once this recipe's shape stabilizes, not
  designed here).
- **Governance:** for HVN specifically, RPS contract 37's gates (asset
  selection, continuity, production-brief, render-authorization) constrain
  what a shot plan may authorize before render.

## Interface (high-level)
- **Consumes:** an approved Brand Promotion / Promotion Story brief.
- **Exposes:** a storyboard/shot-plan record, a Human Storyboard Gate
  approval action, and per-shot provider-assignment output consumed by
  provider execution.

## Provider authority (informs Story Director's per-shot assignment)

Founder-ratified provider authority for Master Atelier, recorded here since
Story Director is what actually reads it when assigning a shot to a
provider:

- **Artlist** is approved as Master Atelier's B-roll / environmental /
  commodity visual-generation provider — it passed realistic urban B-roll
  evaluation. Artlist is **not** character identity authority, avatar-
  performance authority, canonical voice authority, orchestration authority,
  approval authority, or final-render authority, and it is **not** approved
  as a music-composition authority (a prior virtual-artist/music-composition
  test failed materially).
- Higgsfield remains identity/character authority (Soul-bound cast, per the
  `characters` table).
- HeyGen remains the path for spoken/lip-synced dialogue.

A shot plan must not assign character-identity or dialogue work to Artlist,
and must not request music composition from Artlist — it may only assign
Artlist to realistic B-roll/environmental/commodity visual shots.

## Brands / stores touched
HVN · Connection Circle · (Brand Promotion / Promotion Story recipes
generally — not the Creator Content recipe, where this role stays
lightweight)

## Success criteria
A brief like "Adam discovers the Havenry, enters from a busy Manhattan
street, and is greeted by Vale" produces a scene-by-scene plan with correct
provider/camera/cast assignment per shot, holds at the Human Storyboard Gate
until approved, and never assigns identity or music work to a provider not
authorized for it.

## Open questions
- Exact data shape for a shot plan (jsonb on the production row vs. a proper
  `shot_plans`/`shots` child table) — deferred to contract 21's Phase 4.
- How lightweight Story Director's output needs to be for Brand Promotion
  specifically before it's worth calling a "shot plan" at all, versus a
  simple composition order.
- Relationship between this contract's Human Storyboard Gate and RPS contract
  37's own gates for HVN specifically (see contract 21, Open Decision D5) —
  Story Director's gate is Master Atelier's; contract 37's gates are RPS's
  administration layer, and the two must not be conflated into one approval.
