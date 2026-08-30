# Testing Conventions — RMG Creator OS

Introduced in Sprint 1 ("Trust the Boundary"), PR 1. This is the unit/contract test layer;
it is **separate from** the existing Playwright E2E suite.

## Two test layers

| Layer | Tool | Runs against | Command | Location |
|---|---|---|---|---|
| **Unit / contract** | **vitest** | local TS sources, no services | `pnpm test` | `<package>/test/**/*.test.ts` |
| **E2E smoke** | Playwright | **live production** URL | `pnpm test:e2e` | `e2e/**/*.spec.ts` |

`pnpm test` runs `vitest run` (one-shot); `pnpm test:watch` for local TDD.

## Where tests live — and why

Unit tests live in a **per-package/app `test/` directory**, e.g.:

```
packages/types/test/index.test.ts
apps/dashboard/test/mediaRecording.test.ts
```

This is deliberate. Each package's `tsconfig.json` compiles only its `src/**` (`include`),
so tests placed under `test/` are **never seen by `tsc`** — `pnpm build` and `pnpm typecheck`
do not compile, typecheck, or emit them. The test harness is therefore **zero-impact on the
production build**: adding or changing a test can never change what ships in `dist/`.

Vitest discovers tests via the root [`vitest.config.ts`](../../vitest.config.ts) include glob
`{packages,apps}/*/test/**/*.test.ts`.

## Import style

Import the code under test from its `src/`, matching that package's own module style:

- NodeNext packages (`types`, `db`, `integrations`, `gateway`) use **`.js`-suffixed** relative
  imports (e.g. `from '../src/index.js'`) — vitest/esbuild resolves the `.js` specifier to the
  `.ts` source, exactly as the packages import each other at runtime.
- The dashboard (Bundler resolution) uses **extensionless** imports (e.g.
  `from '../src/mediaRecording'`).

Always import from a **`vitest`** entry explicitly (`import { describe, it, expect } from
'vitest'`) rather than relying on globals — no `types` wiring is needed in any tsconfig.

## Environment

The root config runs `environment: 'node'`. The first targets are pure Node/string logic.
When a test needs browser globals (e.g. the `MediaRecorder` branch of `pickRecorderMimeType`),
add a jsdom (or happy-dom) **project** rather than switching the whole suite — the dashboard
already ships `@vitejs/plugin-react` to reuse.

## What to test first (and the current scope)

PR 1 covers **existing exported pure functions / constants only** — no refactors, no runtime
change:

- `packages/types` — brand/service derivation invariants (`BRAND_KEYS`, `CONTENT_BRANDS`,
  `STORE_KEYS`, `BUSY_MF_PROMOTES`, `SERVICE_IDS`).
- `apps/dashboard` — `extensionForMimeType` (Whisper filename mapping).

Later Sprint 1 PRs add: zod schema tests at the ALLEN boundary (PR 3), a `Renderer`/
NullRenderer conformance test (PR 4), and test-driven extractions the Sprint 0 audit flagged
(worker retry/backoff, ad-index code formatting, Higgsfield `findId`/`parseModelParams`).

## Fixtures

Golden/fixture inputs live under a package's `test/fixtures/` directory and are loaded by
relative path. (No fixtures exist yet; the convention is established here for the validation
work in later PRs.)

## CI

A `pnpm test` gate is **not** wired into CI in PR 1 (kept as a pure, reversible harness
addition). It is added to `.github/workflows/ci.yml` — after Typecheck, before Build — in the
Sprint 1 CI-enforcement PR (PR 5), once the suite has proven itself locally.
