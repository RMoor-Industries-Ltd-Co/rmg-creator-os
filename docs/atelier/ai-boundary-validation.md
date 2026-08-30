# AI Boundary Validation — ALLEN responses

Sprint 1 PR 3 ("Runtime Validation Boundary"). Realizes ADR 0002's "typed, versioned, validated
contract" and ADR 0003's decision to adopt `zod` — the first runtime validation in the repo.

## What changed

Three ALLEN client functions (`apps/gateway/src/allen.ts`) previously **cast** the parsed JSON
straight into the production pipeline (`… as T`). They now **parse** it through a `zod` schema
(`apps/gateway/src/allen.schemas.ts`) before returning:

| Function | Endpoint | Feeds | Crash-critical field(s) validated |
|---|---|---|---|
| `allenDraft` | `/draft` | script → whole production | `script` is a string |
| `allenDirect` | `/direct` | tagged script + stability → ElevenLabs TTS | `tagged_script` is a string |
| `allenMetadata` | `/metadata` | publish metadata | `hashtags` is an **array of strings** |

On a malformed response the function throws a clean, non-sensitive error
(`ALLEN <label> returned malformed data (<field>: <reason>)`) which the existing route handlers
already surface as a `502` — instead of letting `undefined`/wrong-typed values reach TTS or
publish logic and crash or mis-drive them.

## Design: permissive, not pedantic

- **Only crash-critical fields are required** (`script`, `tagged_script`, and that `hashtags` is
  an array). Everything else is optional with a sensible default, so a valid-but-loose response
  is accepted, not rejected.
- **`.passthrough()`** keeps unknown/extra keys — a new ALLEN field never breaks validation.
- **`stability` is coerced** (accepts a numeric string) and defaults to a neutral `0.5` when
  absent, so a loose voice-direction response still works.
- The error message names the failing fields only — it never dumps the raw payload.

## Scope & rollback

- Scope is deliberately the **three highest-risk** responses. The remaining ALLEN functions
  (`topics`, `meeting`, `chat`, `listen`, `emotion/profiles`) already default their fields and
  are lower-risk; they can be brought under schemas in a later pass.
- **Rollback is a single-file revert** of `allen.ts` (restore the casts); `allen.schemas.ts` and
  its tests are additive and inert if unused.
- No request-body validation is included here (a separate, later concern). No change to any route
  path, the queue, or the DB.

## Tests

`apps/gateway/test/allen.schemas.test.ts` — for each schema: full-valid, valid-but-loose
(defaults applied), passthrough of unknown keys, coercion (`stability`), and genuinely-malformed
rejection (missing `script`/`tagged_script`, `hashtags` as a string). Plus `parseAllen` success
and clean-error-on-failure. Run with `pnpm test`.
