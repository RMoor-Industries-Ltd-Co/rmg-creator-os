# Sprint 1 Production-Boundary Checklist

Sprint 1 PR 5 ("CI Enforcement + Release Hygiene"). A short, practical checklist for any PR that
touches the AI-to-production boundary — the thing every PR in "Trust the Boundary" (PR 1–4)
built. Use it as a review aid, not a gate that blocks unrelated work (a docs-only PR doesn't need
"renderer boundary respected" to be true, it needs to not touch the renderer).

## The checklist

- [ ] **Tests present.** New logic that can be unit-tested has a test in the vitest harness
  (`{packages,apps}/*/test/**/*.test.ts` — see
  [`testing-conventions.md`](testing-conventions.md)). CI now runs `pnpm test` on every PR and
  push to `main` (this PR), so an untested regression is caught before merge, not after.
- [ ] **Runtime validation where applicable.** Any new code that accepts AI-generated or
  external JSON parses it through a schema (see
  [`ai-boundary-validation.md`](ai-boundary-validation.md)) rather than casting it — permissive
  on optional fields, strict only where a wrong type would crash downstream.
- [ ] **Auth/session safety checked.** A new route is either intentionally public (added to
  `isPublicRoute` with a stated reason) or falls under the existing session guard by default —
  never assume a route is safe without checking which side of that line it's on (see
  [`auth-and-session.md`](auth-and-session.md)).
- [ ] **Renderer/provider boundary respected.** New provider/capability work registers a
  `Renderer` into the registry (see [`renderer-boundary.md`](renderer-boundary.md)) rather than
  adding another inline branch to `dispatch()`.
- [ ] **No unreviewed production expansion.** A PR does what its title says. A "hardening" or
  "boundary" PR does not quietly add a new capability, route, or migration — if scope needs to
  grow, that is a conversation before the diff, not inside it.
- [ ] **Branch/merge hygiene followed** — see [`branch-merge-convention.md`](branch-merge-convention.md):
  branched from current `main`, diffed against `origin/main` before opening the PR.
- [ ] **Contract location respected** — new contracts go in `rmg-piaar-system/contracts/`, never
  in this repo's frozen `docs/contracts/` (see that directory's own pointer, and
  `production-capability-inventory.md`'s "Contracts/docs" row for the current state).

## Where this came from

Every line item here maps to a Sprint 0 finding this sprint closed:

| Checklist item | Sprint 0 finding | Closed by |
|---|---|---|
| Tests present + CI gate | F-01 (no test safety net) | PR 1 + this PR |
| Runtime validation | F-02 (unvalidated AI JSON) | PR 3 |
| Auth/session safety | (briefing-card incident, tracked as S1-Boundary-Hardening) | PR 2 |
| Renderer/provider boundary | F-08 (hard-branched providers) | PR 4 |
| Branch/merge hygiene | F-05 (squash-merge/branch-reuse hazard) | this PR |
| Contract location | F-07 (duplicated/frozen contract locations) | Word Art lane + this PR |

This checklist is deliberately not automated or enforced by a bot — it is a review habit, sized
to a two-person team. If it later needs to become a PR template or a CI check, that is a
separate, explicitly-scoped change.
