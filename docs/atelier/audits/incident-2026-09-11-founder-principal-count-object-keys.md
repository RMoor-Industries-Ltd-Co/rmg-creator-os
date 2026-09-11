# Incident record — `founder_approval` readiness misreport (Object.keys on a Map)

Blameless. The purpose of this record is to prevent recurrence, not to assign fault.

## Window

- **Start:** B1.3's merge and first production deploy (`c125c281`, 2026-09-11 ~21:24 UTC).
- **End:** fix committed same day, pending merge.
- **Duration:** under one hour; caught during the same post-deploy verification pass that the
  deploy itself was being checked by.

## Impact

`GET /api/health`'s `readiness.founder_approval` reported `disabled_no_principals` in
production immediately after deploying a correctly-configured `FOUNDER_PRINCIPALS` (verified
separately: the founder's Doppler value parses to three valid entries with zero malformed
entries). **This was a reporting-only defect.** The actual authorization path —
`resolveFounderPrincipal()` / `isFounder()`, both `Map.prototype.get()`-based — was never
affected; there is no evidence, and no code path exists, by which this bug could have made an
actual founder-gated write more or less permissive than intended. No founder-gated write path
is live yet (B1.2 §13 step 6 remains blocked), so nothing was actually incorrectly authorized or
refused in production during this window — but the readiness signal itself was wrong, which is
exactly the property B1.3 was built to make trustworthy.

## Detection

Caught during the founder-directed post-deploy B1.3 verification pass (the same session that
built the readiness feature), by comparing the live `/api/health` output against the
independently-verified fact that the configured `FOUNDER_PRINCIPALS` value parses cleanly.

## Root cause

`server.ts` computed the readiness input as:

```ts
founderPrincipalCount: Object.keys(FOUNDER_PRINCIPALS).length,
```

where `FOUNDER_PRINCIPALS` is a `Map<string, string>` (the `map` field returned by
`parseFounderPrincipals()`). `Object.keys()` enumerates an object's own enumerable
string-keyed properties; a `Map`'s entries are not stored as such — they live in the engine's
internal slot, accessed only via `.get()`/`.has()`/`.entries()`/`.size`. `Object.keys(aMap)`
therefore returns `[]` for **any** Map, populated or not. This is a well-known JavaScript
footgun, not specific to this codebase, but it was not caught here because:

1. `configReport.ts`'s own module-level doc comment documented the buggy expression
   (`Object.keys(founderPrincipals).length`) as if it were the correct way to compute the
   count — the mistake was written down as the intended design, not merely typed once.
2. The unit tests added alongside this feature (`founder.test.ts`'s existing
   `parseFounderPrincipals` tests, `configReport.test.ts`'s `buildConfigReport` tests) each
   tested one layer correctly in isolation — the parser was tested directly, and the report
   builder was tested by passing in a plain `number` for `founderPrincipalCount` — but nothing
   tested the **wiring** between them in `server.ts`, which is exactly where the defect was.
   `server.ts` has no test harness (it boots as a top-level script), a gap already named
   explicitly, in advance, in `docs/atelier/b1-3-operational-activation.md` §8's test-coverage
   caveat.

## Why it wasn't caught before production

The same reason named in §8 of the B1.3 report before this incident: there is no automated test
of `server.ts`'s wiring, only of the pure functions it calls. This is the second time that
specific, pre-named gap was the proximate reason a defect reached production undetected by
tests — the first was the `STEP_UP_COOKIE_SECRET` module-scope crash (see
`incident-2026-09-11-stepup-cookie-secret.md`), also a `server.ts`-wiring defect no unit test
could see.

## Remediation

- `apps/gateway/src/founder.ts`: added `founderPrincipalCount(map): number`, returning
  `map.size`. This is the ONE place a Map's size may be read for reporting purposes.
- `apps/gateway/src/server.ts`: now calls `founderPrincipalCount(FOUNDER_PRINCIPALS)` instead of
  the inline `Object.keys(...).length` expression.
- `apps/gateway/src/configReport.ts`: corrected the doc comments that had documented the buggy
  expression as correct.
- `apps/gateway/test/founder.test.ts`: added a direct regression test that demonstrates the
  defect (`Object.keys(map).length === 0`) alongside the fix (`founderPrincipalCount(map) === 3`)
  against the real three-entry production shape, plus coverage for zero and one entries.
  Mutation-checked: reintroducing the exact original expression fails this test.

## Follow-up items

- The underlying gap — `server.ts` has no test harness for its own wiring, only for the pure
  functions it imports — remains open. Both `server.ts`-wiring incidents this repo has now had
  (`STEP_UP_COOKIE_SECRET` module-scope crash; this one) were wiring defects a pure-function
  unit test cannot see by construction. A future investment in a minimal server-boot integration
  test (constructing the Fastify app with injected env, without a real deploy) would close this
  class of gap generally, rather than one defect at a time. Not attempted here — out of
  proportion to this fix's scope, and not requested by this directive.
- Once this fix is deployed, re-verify `readiness.founder_approval` reports `enabled` and
  perform the remaining B1.3 post-deploy checks that were blocked on it.
