# ADR 0003 — Trust the Boundary: test runner + runtime validation

- **Status:** Accepted (Sprint 1). Testing harness landed in PR 1; runtime validation and the
  renderer abstraction are approved in principle and land in later Sprint 1 PRs.
- **Date:** 2026-08-29
- **Deciders:** Rahm Moore
- **Related:** [`../atelier/sprint-00-readiness-audit.md`](../atelier/sprint-00-readiness-audit.md)
  (findings F-01, F-02, F-08), [`../atelier/testing-conventions.md`](../atelier/testing-conventions.md),
  ADR 0002 (Word Art domain-vs-renderer).

## Context

The Sprint 0 audit scored **QA/testing/validation at 1/5** — the platform's decisive gap:
- No unit-test runner or fixtures; CI gated merges on typecheck + build only (F-01).
- AI JSON from the external ALLEN service is cast unchecked (`… as T`) straight into
  production logic (F-02).
- Providers are hard-branched in the worker with no formal interface or headless path (F-08).

Every future AI-driven capability (Word Art first) has to cross this boundary. Sprint 1's
mission is to make the boundary **reliable, testable, and understandable before** creative
expansion — not to build Word Art. This ADR records the tooling decisions so they are chosen
deliberately, not adopted silently.

## Decisions

1. **Adopt `vitest` as the unit/contract test runner.** Rationale: the repo is a Vite + ESM
   (NodeNext) TypeScript monorepo; vitest runs TS sources directly (esbuild) with no separate
   build step, matches the existing toolchain (Vite 6, the pinned `esbuild >=0.25` override),
   and coexists with — rather than replaces — the Playwright E2E suite. Alternatives (jest +
   ts-jest, node:test + tsx) add config friction against NodeNext ESM for no benefit here.
   *(Landed in PR 1.)*

2. **Tests are build-invisible.** Unit tests live in per-package `test/` directories, outside
   each `tsconfig` `include` (`src/**`), so `pnpm build`/`typecheck` never compile or emit
   them. The harness cannot change shipped output — a hard requirement for a zero-runtime-change
   introduction. *(Landed in PR 1.)*

3. **Adopt `zod` for runtime validation at the AI/request boundary.** *(Approved; lands in a
   later Sprint 1 PR.)* AI output becomes a **candidate** that is `parse()`d, not cast. Parse
   failure surfaces a clean, explicit upstream error rather than letting a malformed value flow
   into production logic. This is a new discipline — the repo has no runtime validator today —
   and is the concrete realization of ADR 0002's "typed, versioned, validated contract"
   boundary. Scope starts with the three highest-risk ALLEN responses (`allenDraft`,
   `allenDirect`, `allenMetadata`) and the highest-risk request bodies.

4. **A formal `Provider`/`Renderer` interface + `NullRenderer`.** *(Approved; lands in a later
   Sprint 1 PR.)* Mirrors the existing `HiggsfieldClient` factory shape; the worker's
   `(capability, provider)` switch becomes a registry lookup. `NullRenderer` formalizes today's
   ad-hoc `stub-${id}` behavior into a headless, testable path — the default for CI and future
   Word Art planning, with **no external renderer automation** (Adobe/Resolve explicitly out).

## Consequences

- New dev dependency: `vitest` (root). Later PRs add `zod` (gateway runtime dependency).
- A `pnpm test` gate is added to CI in the Sprint 1 CI-enforcement PR (not PR 1), after the
  suite proves itself locally — so a red test blocks merges going forward.
- The validation and renderer decisions here are deliberately staged across separate, small,
  reviewed PRs (see the sprint sequence) to keep each change reversible.

## Out of scope (this sprint)

Word Art engine/domain types, a `wordart` capability value, Adobe/Resolve automation, scene or
social generation, schema migrations, and broad IAM. This ADR governs the *boundary*, not the
capabilities that will later cross it.

## Sprint 1 PR sequence

1. **PR 1 — Test runner + fixture conventions** *(this ADR's decisions 1–2)*.
2. PR 2 — Auth/session UX hardening.
3. PR 3 — Runtime validation boundary (decision 3).
4. PR 4 — Provider/Renderer interface + NullRenderer (decision 4).
5. PR 5 — CI test gate + release hygiene.
