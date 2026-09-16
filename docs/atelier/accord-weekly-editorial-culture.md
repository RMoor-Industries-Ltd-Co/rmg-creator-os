# Master Atelier — Accord Weekly Editorial Culture

**Founder notice — 2026-09-15**

This document is a design-level founder notice describing intended execution-lane behavior
only. It is not an implementation record: no schema migration, dispatcher/worker code, new
database table, or agent-auth wiring exists yet for anything described below. See
"Implementation status" for what is gated and what is still to be designed.

Master Atelier is to support a repeatable weekly editorial pipeline for HVN Global's **The Accord**.

This is not a generic blog-writing feature. The Accord is a governed editorial culture with a masculine frame centered on self-command, standards, judgment, restraint, cultivated presence, atmosphere, charisma, responsibility, and the intentional life of a man.

## Canonical reference modes

Two founder-reviewed reference articles define the initial acceptance standard:

- **Elevate Your Private Space**: practical/application Accord mode.
- **The Intentional Private Space**: foundational/doctrinal Accord mode, with SEO handled outside visible prose.

Neither is an "SEO version" of the other — "SEO version" is not Accord terminology. There is
one Accord voice, expressed in these two modes; conventional search-language optimization
belongs in metadata, structured data, taxonomy, internal links, alt text, and surrounding
architecture, never in visible Accord prose.

Master Atelier must recognize these as two modes of one culture, not two separate voices.

## Required writing model

1. Start from an HVN thesis, not a keyword.
2. Select the editorial mode: foundational/doctrinal or practical/application.
3. Preserve established HVN controlled vocabulary and meaning.
4. Keep conventional SEO language primarily in metadata, structured data, internal links, taxonomy, alt text, and surrounding architecture.
5. Keep visible copy recognizably HVN.
6. Avoid generic AI filler, commodity lifestyle-blog voice, grievance culture, misogyny, domination rhetoric, manipulative dating tactics, and empty luxury signaling.
7. Product presence is optional and subordinate to editorial purpose.
8. New controlled vocabulary remains founder-gated.
9. Final publication remains founder-gated until authority is explicitly delegated.

## Not the legacy `recipes`/`jobs` tables

`rmg-creator-os/packages/db/src/schema.ts` has a dormant, older `recipes`/`jobs` table pair
(`recipes(id, name, inputKinds, outputKind, steps)` + `jobs(recipeId, brand, status, input)`).
That pair is a different, unrelated orchestration concept — a generic service/DAG model, not
a workflow entry-contract + stage list — and is slated for retirement per
[Contract 33](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/blob/main/contracts/33-master-atelier-production-recipe-architecture.md)'s
ratified decision D2 (after its still-live `GET /recipes` / `GET /jobs` / `POST /jobs` routes
are explicitly deprecated first).

**The Accord weekly editorial mechanism is not built on the legacy `recipes`/`jobs` pair.** It
uses the Contract 33 architecture — `production_recipes`, `production_brands`,
`production_brand_configs` (all still to be added; none of these tables exist yet) — plus the
existing non-video parent pattern `work_items(kind='accord_article')` and `production_jobs`
(the `accord_article` capability already reserved in `production_job_capability`, enqueueable
but not yet dispatchable). Do not confuse the two `recipes`/`jobs`-shaped names.

## Weekly production expectation

The production lane must durably retain:

- topic brief
- HVN thesis
- research/source packet when needed
- outline
- visible article draft
- SEO outside-copy packet
- brand/culture audit
- image brief/prompt packet
- approvals
- site handoff package
- preview QA evidence
- post-publication record

No production state should depend on reconstructing an ephemeral chat transcript.

## Relationship to PIAAR contracts

The governing contract is
[**Contract 38 — Master Atelier Accord Weekly Editorial Pipeline**](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/blob/main/contracts/38-master-atelier-accord-weekly-editorial-pipeline.md).

Contract 38 is itself a specialization of
[**Contract 33 — Master Atelier Production Recipe Architecture**](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/blob/main/contracts/33-master-atelier-production-recipe-architecture.md)'s
generic Production Recipe architecture, not a fourth recipe type. Contract 33 ratified exactly
three v1 recipe types — Creator Content, Brand Promotion, and Promotion Story — and that set is
unchanged here. The weekly Accord editorial pipeline is an Accord-specific profile of the
**Brand Promotion** recipe type; Contract 33 owns the generic recipe hierarchy, versioning,
and brand configuration, while Contract 38 owns the Accord-specific intake, 13-stage sequence,
artifacts, culture rules, gates, and completion criteria.

Creator OS owns execution semantics, durable production records, queue/workflow state, recipe implementation, and operator surfaces. Domain-specific Accord rendering/publication rules remain with `hvnglobalco-com`.

## Implementation status

This document is design-only. It does not authorize, and nothing below should be read as
implying, any of the following exist today: a schema migration; dispatcher or worker code;
the `production_recipes` / `production_brands` / `production_brand_configs` tables named
above; or agent-auth/approval wiring for autonomous execution. In particular:

- The "Weekly production expectation" durable-artifact list above and the "Initial acceptance
  test" below describe intended behavior, not built behavior. Durably retaining those
  artifacts requires a durable-artifact schema (an `accord_editorial_artifacts`-style table,
  still to be designed) that does not exist yet.
- Any human/founder gate in this pipeline (Thesis Gate, Founder Approval Gate, Publication
  Gate, etc.) routes through Contract 36's approval-evidence mechanism
  (`approval_evidence` / `workflow_transitions`), per Contract 33 — it is never a bespoke
  approval mechanism invented for Accord. That wiring is not yet implemented.
- None of this is imminent or in progress by default: it requires the durable-artifact schema
  design above and Contract 36 approval-evidence wiring before any of it is implemented.

## Initial acceptance test

The first recipe implementation must use the two founder-reviewed articles as fixtures and demonstrate that it can:

- classify each article's editorial mode correctly;
- preserve one Accord culture across both;
- generate an SEO packet without contaminating visible prose with keyword stuffing;
- produce a founder-ready handoff package rather than publishing autonomously.

This acceptance test is a design-level target for the first implementation pass, not a
description of an existing or in-progress recipe implementation — see "Implementation
status" above.
