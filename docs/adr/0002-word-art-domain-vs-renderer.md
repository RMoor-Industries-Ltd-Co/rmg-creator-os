# ADR 0002 — Word Art: Master Atelier owns the domain; renderers are implementations

- **Status:** Accepted (architecture; feature is Phase 0 / spec)
- **Date:** 2026-08-28
- **Deciders:** Rahm Moore
- **Related:** [`../architecture/01-word-art.md`](../architecture/01-word-art.md);
  canonical contract `rmg-piaar-system/contracts/29-word-art.md` (+ `contracts/word-art/`)

## Context

Master Atelier is adding an intelligent Word Art / cinematic-caption engine: interpret spoken
content, decide when a plain caption suffices vs. when designed typography is warranted, plan a
treatment, render it through a motion-graphics engine, and QA it. Two temptations would sink it
architecturally:

1. **Letting a vendor own the creative model** — modeling treatments as After Effects `.mogrt`
   template ids (`after_effects_template = "Architect_01.mogrt"`). That welds the domain to one
   tool and makes a future Resolve/Fusion path, or headless planning, impossible.
2. **Letting a generative model's free-form output be the production spec** — the current
   gateway pattern (`allen.ts`) casts AI JSON to a TS type with no runtime validation. For a
   feature that drives expensive renders and brand-critical output, "trust the model" is a
   correctness and safety hole.

## Decisions

1. **Master Atelier owns the Word Art specification; renderers implement it.** The canonical
   creative language is renderer-independent intent — `primitive`, `motion_profile`,
   `brand_profile` — never a vendor asset id. Vendor identifiers exist only *inside* a renderer
   adapter, resolved late from domain intent.

2. **AI proposes; deterministic code disposes.** AI (via ALLEN / future providers) produces
   **candidate** decisions carrying confidence, a machine reason code, provider/model metadata,
   and a contract version. A deterministic **Gate 2 validator** is the only path from candidate
   to an enqueued render. Humans govern the creative *standard* the AI optimizes toward.

3. **The AI→production boundary is a typed, versioned, validated contract.** Realized as the
   `word-art/*` child schemas, mirrored by `packages/types` interfaces. **We will validate at
   runtime** (recommended: `zod`, deriving the TS types) — a *new* discipline; the repo has no
   runtime schema validation today. This is the one deliberate convention change.

4. **Adobe is the initial reference renderer, not a domain dependency.** After Effects
   (motion) + Premiere (assembly) are the first adapter. A **NullRenderer** is required and is
   the default for Phase 1 and CI: it satisfies the whole contract with a deterministic
   descriptor instead of pixels, so planning, scoring, validation, state, and provenance run
   with **no workstation motion-graphics app installed**. A future Resolve/Fusion adapter must
   drop in without a domain-schema change.

5. **Brand behavior and scoring are versioned configuration, not code.** `WordArtBrandProfile`
   layers typography/motion rules onto existing `BrandKey`/`StoreKey` (contract 12 — no second
   brand registry). Scoring weights, treatment thresholds, and intensity→parameter motion
   curves live in a versioned config the plan records — tunable empirically, never hard-coded.

6. **Reuse the existing production spine.** Word Art is a new `productionJobCapability`
   (`wordart`) dispatched by the existing `(capability, provider)` worker branch and enqueued
   through the existing queue (retries, idempotency, cancellation) — not a parallel pipeline.

## Consequences

- A new runtime-validation dependency (`zod`) and a new test runner (`vitest`) enter the repo
  — both previously absent. Golden fixtures run against NullRenderer, so CI needs no Adobe.
- The AI providers must be wrapped behind analyzer interfaces (provider-independent), not called
  ad hoc — extends today's single ALLEN client.
- Provenance grows: plans/events/renders carry enough to reproduce a render. Extends the
  existing `videos.config`-as-provenance pattern rather than adding a logging system.
- Autonomy is a level (L0–L4) evaluated per event, ratcheted up only on demonstrated
  reliability — more than the repo's current binary approval flags.

## Open questions

- Adopt `zod` repo-wide or only at the Word Art boundary?
- HVN/AMG brand scope: content `BrandKey` vs. `StoreKey` keying (contract 29 OPEN).
- Which Adobe automation surface (expressions vs. text animators vs. `.mogrt` packages vs.
  scripting) — deferred until tested; must stay inside the adapter.
- Prosody (`P`) source when the voice take doesn't expose it — re-analyze audio or degrade to
  semantic/emotional signals only.
- Visual-regression tooling/host for preview QA.
