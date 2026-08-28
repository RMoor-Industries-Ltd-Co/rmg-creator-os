# Master Atelier — Production-Readiness Scorecard

Companion to [`sprint-00-readiness-audit.md`](sprint-00-readiness-audit.md). Assessed
2026-08-28 on `sprint/00-stabilize-the-atelier` (base `main` @ `9ae75c9`, includes PR #28).

**Scale:** 0 absent · 1 concept only · 2 partially documented · 3 implemented but fragile ·
4 repeatable with known gaps · 5 production-ready & validated.

| # | Area | Score | Basis |
|---|---|:---:|---|
| 1 | Contract architecture | **4** | 00–29 in `rmg-piaar-system`, house template, ADRs, DECIDED/PROVISIONAL tagging; gaps: status drift, frozen duplicate mirror. |
| 2 | Type/schema discipline | **3** | Shared TS interfaces, but **no runtime validation**, mixed enum styles (pgEnum vs text-union), hand-authored migrations w/ snapshot gaps. |
| 3 | Gateway/API readiness | **3** | Broad live route surface, works in prod; but no request-schema validation, manual guards, ~2669-line monolith. |
| 4 | Queue/worker readiness | **3** | Durable `production_jobs` w/ retry/backoff/lock/cancel; **HTTP-tick driven**, not the documented BullMQ. |
| 5 | Renderer/provider abstraction | **3** | `(capability, provider)` axis works, but hard-branched in the worker; no formal interface, no Null path. |
| 6 | Brand/profile support | **3** | `BrandKey`/`BrandProfile` + `brandPostDefaults` exist; DB keys `brand` as **free text** (no FK/enum). |
| 7 | Asset management | **4** | Drive-backed lifecycle, library, thumbnails, attach — repeatable; single-provider (Drive). |
| 8 | Prompt & AI orchestration | **3** | Functioning via external ALLEN; **single dependency, output unvalidated**, no fallback. |
| 9 | Human review & approval | **4** | Review UI at every stage + per-brand delivery gate; gaps: no autonomy/bypass model, ad-hoc state. |
| 10 | QA / testing / validation | **1** | No unit runner, no fixtures/goldens; only 3 Playwright smoke tests vs **live prod**; CI has no test gate. |
| 11 | CI / release hygiene | **3** | CI→Publish→Deploy chain works & auto-deploys; gate = typecheck+build only; squash-merge/branch-reuse hazard. |
| 12 | Documentation quality | **4** | Strong contracts/architecture/ADR/CLAUDE.md; gaps: status drift, frozen dir, stale handoff file. |
| 13 | Social/content production readiness | **3** | Post composition + Postiz publish + Ad Index end-to-end; maturity/validation thin. |
| 14 | Virtual studio / scene production readiness | **3** | Higgsfield scenes + Soul/Element + A-Roll/B-Roll real (PR #28); CLI host coupling, non-deterministic. |
| 15 | Cross-brand scalability | **2** | Brand model documented (contract 12) but free-text-keyed and untested across brands; no isolation guarantees. |

## Summary

- **Overall readiness: ≈ 3.1 / 5** (sum 46/75) — *implemented but fragile, trending toward
  repeatable-with-known-gaps.* The Atelier **produces real output in production**, but rests on
  thin validation and testing.
- **Strengths (≥4):** contract architecture, asset management, human review/approval,
  documentation quality.
- **Weakest link (1):** QA/testing/validation — the decisive gap. It drags down every other
  score's confidence, because nothing guards against regression.
- **Fragile core (3):** type/schema discipline, gateway, queue/worker, provider abstraction,
  brand support, AI orchestration, CI, social, scene production — all *work but are unhardened*.
- **Scalability risk (2):** cross-brand — the free-text brand key is the integrity gap to close
  before multiplying brands.

## Reading the scores against Sprint 1

Lifting the two lowest areas — **QA/testing/validation (1)** and **cross-brand scalability
(2)** — plus hardening the AI boundary (area 8) is exactly the "Trust the Boundary" Sprint 1
theme. Those moves also raise the confidence ceiling on areas 2–6, and are the precise
prerequisites for merging and building the Word Art lane (PRs #30/#32, unmerged). No new
production feature is required to move the overall score materially.
