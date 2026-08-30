import { defineConfig } from 'vitest/config';

// Sprint 1 (PR 1) — unit-test harness. See docs/atelier/testing-conventions.md.
//
// Unit tests live in a per-package/app `test/` directory, deliberately OUTSIDE each
// package's tsconfig `include` (`src/**`), so `pnpm build` / `pnpm typecheck` never
// compile or emit them — the harness is zero-impact on the production build.
//
// Node environment only for now: the first targets are pure Node/string logic. A
// jsdom project can be added later if/when a test needs browser globals (e.g. the
// `MediaRecorder`-dependent branch of pickRecorderMimeType).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{packages,apps}/*/test/**/*.test.ts'],
    // node_modules and dist are ignored by default; keep e2e (Playwright) out.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**']
  }
});
