# Sprint 0 — Stabilize the Atelier: Production-Readiness Audit

**Epic:** Bring the Atelier Online · **Sprint:** 0 (readiness / audit / stabilization)
**Mode:** Planning & audit only — **no implementation code added** in this sprint.
**Repos audited:** `rmg-creator-os` (product/control plane) · `rmg-piaar-system` (canonical contracts).
**Date:** 2026-08-28 · **Branch:** `sprint/00-stabilize-the-atelier`

> This document is the narrative baseline. Its companions:
> - [`production-capability-inventory.md`](production-capability-inventory.md) — what exists and how mature, plus the sustained-assets list.
> - [`repair-backlog.md`](repair-backlog.md) — broken/fragile systems + prioritized repairs.
> - [`readiness-scorecard.md`](readiness-scorecard.md) — the 0–5 scorecard across 15 areas.

## Why this sprint exists

Master Atelier has grown quickly: a staged production wizard, Soul/Element character
consistency, approved-voice locking, multi-character casts, Final Cut, Ad Index, and a new Word
Art **contract** lane (draft PRs, unmerged). Before adding more production features, we need an
honest current-state baseline: what works, what to protect, what is fragile or broken, and what
must be repaired first. Sprint 0 produces that baseline and a prioritized backlog — it builds
no new runtime capability.

## Method

- Reused this session's structured exploration of `packages/db/src/schema.ts`,
  `apps/gateway/src/{server.ts,worker.ts,allen.ts,routes/*}`, `packages/integrations/src/*`,
  `apps/dashboard/src/*.tsx`, `.github/workflows/*`, `e2e/`, and `docs/`.
- Cross-referenced the contract set in `rmg-piaar-system/contracts/` (00–29) and the frozen
  mirror in `rmg-creator-os/docs/contracts/` (00–19).
- Scored 15 areas on a 0–5 maturity scale (see scorecard). Findings are evidence-linked to real
  paths; where a contract claims more than the code delivers, that gap is recorded, not smoothed.

## What already works (preserve)

- **The production spine is real and in production.** Staged wizard
  (`script → voice → assets → generate → post → complete`) on a `productions` record; a durable
  `production_jobs` queue with attempt/backoff/lock/cancel; a `(capability, provider)` dispatch
  in `worker.ts`. This is the load-bearing pattern — protect it.
- **Character consistency & voice integrity (from PR #28).** `characters` (Soul/Element) +
  per-scene binding, and A-Roll lip-syncing the **approved** ElevenLabs v3 take
  (`voiceTakeAssetIdV3`) rather than re-synthesizing. These solve the two hardest drift problems.
- **Drive-as-source-of-truth asset lifecycle** (`drive.ts` + asset routes + shared library).
- **Human review at every stage** (VoiceDirection, Assets, HiggsfieldPanel, ARoll, Atelier/Stock
  B-Roll, FinalCut, Post) + a per-brand delivery approval gate (`deliveryApprovals`).
- **Contract/ADR discipline.** A house template, a canonical registry in `rmg-piaar-system`, and
  (new this session) DECIDED/PROVISIONAL/EXPERIMENTAL/OPEN tagging on the Word Art lane.
- **CI → Publish → Deploy automation** (Doppler-injected, GHCR, auto-deploy on green `main`).

Full detail and the ranked list in [`production-capability-inventory.md`](production-capability-inventory.md).

## What is fragile or broken

Headline items (full list + fixes in [`repair-backlog.md`](repair-backlog.md)):

- **No automated test safety net.** No unit/integration runner, no fixtures/goldens; CI gates
  merges on **typecheck + build only**. The sole tests are 3 Playwright smoke checks against
  *live production*. This is the single biggest production-readiness gap.
- **No runtime validation at boundaries.** No `zod`/schema checks; AI JSON from ALLEN is cast to
  a TS type and trusted as-is. A malformed or adversarial model response reaches production logic
  unchecked.
- **Single hard dependency on the external ALLEN service** for all AI + voice; health-gated to
  503 with no fallback.
- **Higgsfield is a host-installed CLI + credentials**, not a portable HTTP client — a runtime
  coupling to one machine, not just an API key.
- **Release-hygiene hazard from squash-merge + shared branch names.** The Word Art work first
  reused the branch name PR #28 was squash-merged from; a naïve PR would have re-introduced all
  of #28's merged code. Caught and corrected this session, but the pattern will recur.
- **Contract/status drift & duplicated locations.** Several contracts overstate build status
  (e.g. My Poster, Life OS, ElevenLabs, SuperCool have docs but no in-repo wrapper/route), and
  contracts live canonically in `rmg-piaar-system` while a frozen 00–19 copy persists in
  `rmg-creator-os/docs/contracts/`.

## What is missing

- A test/validation foundation (runner + fixtures + a headless "no external engine" path).
- A formal provider/renderer interface (today providers are hard-branched in the worker).
- Brand integrity in the DB (brand is free-text, not keyed to `BrandKey`).
- A provenance/observability standard for renders and AI decisions.

## How the Word Art draft PRs fit

The Word Art lane is **architecture only** (draft PRs #30 in `rmg-piaar-system`, #32 in
`rmg-creator-os`; both green, both to remain **unmerged** pending review). It is referenced here
strictly as an existing draft artifact — this sprint does not alter it. Notably, Word Art's
Phase-1 prerequisites (a **NullRenderer** headless path, a **Gate-2 validator**, golden
fixtures, and — recommended — `zod` at the AI boundary) are the *same* foundations this audit
finds missing system-wide. Stabilizing the Atelier and unblocking Word Art are the same work.

## Sprint 1 recommendation — "Trust the Boundary"

Make the AI→production boundary trustworthy and testable **before** any feature expansion:

1. Introduce a unit-test runner (`vitest`) + a small golden-fixture corpus; add a **test gate**
   to `ci.yml` (today: typecheck + build only).
2. Introduce runtime validation (`zod`) at the ALLEN/AI boundary and at request intake for the
   highest-risk routes; derive TS types from the schemas.
3. Define a formal `Provider`/`Renderer` interface and a **NullRenderer**-style headless path so
   pipelines can be exercised in CI without HeyGen/Higgsfield/ALLEN present.
4. Repair release hygiene: a branch/merge convention that survives squash-merges; retire the
   frozen duplicate contract dir to a pure pointer; triage stale artifacts.

This theme de-risks the whole platform and simultaneously satisfies Word Art Phase 1 — no new
production feature required. Detailed, ranked tasks are in
[`repair-backlog.md`](repair-backlog.md).

## Scope coverage (audit checklist)

| # | Area | Where covered |
|---|---|---|
| 1 | Master Atelier contracts & architecture docs | this doc · inventory · scorecard |
| 2 | Production capabilities & maturity | inventory |
| 3 | Brand & store model support | inventory · scorecard · backlog |
| 4 | Gateway/queue/worker/provider/renderer patterns | inventory · scorecard · backlog |
| 5 | Dashboard/review/approval surfaces | inventory |
| 6 | Asset/prompt/scene/video/caption/image/social flows | inventory |
| 7 | Test/validation/CI/QA coverage | backlog · scorecard (QA, CI areas) |
| 8 | Documentation gaps & frozen/deprecated locations | this doc · backlog |
| 9 | Risks from stale branches / squash-merge / duplicated contracts | backlog (release hygiene) |
| 10 | Word Art draft PRs' fit in the roadmap | this doc ("How the Word Art draft PRs fit") |
