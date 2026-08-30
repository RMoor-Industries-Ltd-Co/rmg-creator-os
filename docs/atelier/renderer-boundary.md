# Renderer / Provider Boundary

Sprint 1 PR 4 ("Provider/Renderer Interface + NullRenderer"). **Formalizes, does not expand,**
the worker's existing `(capability, provider)` dispatch — no new execution surface, no real
renderer automation. This is the interface layer Word Art (and any future AI-driven capability)
will later target; nothing here builds Word Art itself.

## What existed before this PR

`apps/gateway/src/worker.ts`'s `dispatch()` was an inline `if/else` chain: `aroll`+`heygen` called
the real HeyGen client; `broll`/`audio`/`thumbnail` each `console.log`'d a message and returned a
capability-prefixed stub id (`broll-${id}`, etc.); anything else fell through to a generic
`stub-${id}`. This worked, but had no name, no interface, and no test coverage.

## What this PR adds

**`packages/integrations/src/renderer.ts`** — three small pieces, mirroring the existing
`HiggsfieldClient` factory shape:

- **`Renderer`** — `{ name, capabilities: {capabilities: string[], headless: boolean}, render(job) => Promise<{resultId}> }`.
- **`NullRenderer`** — a headless renderer with no external side effects. Its `render()`
  reproduces the four prior stub behaviors **byte-for-byte** (same log lines, same result-id
  prefixes) — it is the old inline logic, named and testable, not new behavior.
- **`RendererRegistry`** — a `(capability, provider) → Renderer` lookup table with an optional
  fallback. `createDefaultRendererRegistry()` returns one with `NullRenderer` as the universal
  fallback — exactly matching what `dispatch()` did inline for every non-HeyGen path.

**`apps/gateway/src/worker.ts`** — `dispatch()` now resolves a `Renderer` from the registry for
everything except the unchanged `aroll`+`heygen` branch (still a direct client call, byte-for-byte
identical code). `registerWorkerRoutes()` gained one new **optional, defaulted** parameter
(`renderers: RendererRegistry = createDefaultRendererRegistry()`); its existing call site in
`server.ts` is untouched and behaves identically.

## What is explicitly NOT here

- No real renderer (Adobe, Resolve, or otherwise) — `NullRenderer` is the only implementation.
- No `wordart` capability value, no Word Art domain types or routes.
- No change to HeyGen or Higgsfield behavior.
- No migrations, no DB schema changes, no queue behavior changes.
- No new gateway routes — `registerWorkerRoutes`'s signature grew an optional parameter only;
  `POST /worker/tick` behaves identically.

## Rollback

Revert `apps/gateway/src/worker.ts` to restore the inline `if/else` chain, and drop
`packages/integrations/src/renderer.ts` + its `index.ts` export line. Both are additive; nothing
else in the repo depends on them yet.

## Tests

- `packages/integrations/test/renderer.test.ts` — `NullRenderer` output shape (exact log line +
  resultId per capability, verified against the prior inline strings), `RendererRegistry`
  lookup (exact match, fallback, no-match-no-fallback → `undefined`, exact-match-precedence),
  and `createDefaultRendererRegistry()` coverage across capabilities.
- `apps/gateway/test/worker.test.ts` — `dispatch()` behavior preservation: the HeyGen `aroll`
  path (success, missing client, missing payload field — unchanged), the
  broll/audio/thumbnail/unknown paths producing the exact prior result-id shapes through the
  default registry, an explicitly registered renderer taking precedence over the fallback, and
  the defensive stub when no renderer/fallback exists at all.

## Future direction (not this PR)

A future Word Art PR (out of Sprint 1) would register a `wordart` capability's own
`NullRenderer`-backed entry (or a real Adobe adapter) into this same registry — the boundary
this PR formalizes is designed to be extended by *registering*, not by re-branching `dispatch()`.
