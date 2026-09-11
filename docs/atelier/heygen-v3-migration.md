# HeyGen v2 → v3 migration

**Status:** the client, its callers and its tests are ported. Nothing about *when* A-Roll
renders, or who approves them, changes here.

**Why now.** HeyGen retires v1/v2 on **2026-11-01** (operational through 2026-10-31), and this
repository's client called `POST /v2/video/generate` and `GET /v1/video_status.get`. That
deadline is external and unconditional. The A-Roll design's decision **D-J3** then made the
same migration a prerequisite of its step D, for an independent reason: v2 offers no
idempotency handle, so a paid submission cannot safely be moved behind a queue on it.

This is a compatibility and execution-safety track. It is **not** Phase B1.2, and it does not
implement `render_attempts`, `canonical_renders`, post-render approval, or webhooks.

---

## Endpoint mapping

| Purpose | v2 / v1 (before) | v3 (after) |
|---|---|---|
| Submit a render | `POST /v2/video/generate` | `POST /v3/videos` |
| Read one render | `GET /v1/video_status.get?video_id=…` | `GET /v3/videos/{id}` |
| Search renders | *(none existed)* | `GET /v3/videos` — `title`, `limit`, `token`, `folder_id` |
| List avatars | `GET /v2/avatars` | `GET /v3/avatars/looks` |
| List voices | `GET /v2/voices` | `GET /v3/voices` |
| Upload a still | `POST upload.heygen.com/v1/talking_photo` | `POST /v3/assets` |
| Make it renderable | *(the upload's id was directly usable)* | `POST /v3/avatars` → poll `GET /v3/avatars/looks/{id}` |

Every request the client can now make is under `api.heygen.com/v3/`. A test asserts exactly
that, including the absence of the separate `upload.heygen.com` host.

---

## Request body: a rewrite, not a rename

v2 took a nested array; v3 takes a flat body discriminated on `type`. Mapping the fields one
by one:

| v2 | v3 | Note |
|---|---|---|
| `video_inputs[0].character.talking_photo_id` | `avatar_id` | A photo avatar is addressed by **look id** now — see below |
| `video_inputs[0].character.avatar_id` | `avatar_id` | Same field for both kinds |
| `video_inputs[0].character.avatar_style` | — | **Dropped.** v3 has no equivalent |
| `video_inputs[0].character.use_avatar_iv_model: true` | `engine: { type: 'avatar_iv' }` | |
| `video_inputs[0].character.custom_motion_prompt` | `motion_prompt` | Now top-level |
| `video_inputs[0].voice.{type:'audio',audio_url}` | `audio_url` | |
| `video_inputs[0].voice.{type:'text',input_text,voice_id}` | `script` + `voice_id` | |
| `video_inputs[0].background` | `background` | Unchanged in shape |
| `dimension: {width,height}` | `aspect_ratio` + `resolution` | **Narrowed** — see below |
| `title` | `title` | Unchanged, and now load-bearing (reconciliation) |
| *(none)* | `callback_id`, `callback_url` | New |
| *(none)* | `Idempotency-Key` header | New |

### Catalogs are paginated now — v2's were not

`GET /v2/avatars` and `GET /v2/voices` returned the whole catalog in one response. v3 pages,
capped at 50 looks and 100 voices. **One page is therefore not a port of the old behaviour, it
is a silent truncation** — and on the Studio avatar picker, which loads the list once and
filters client-side, an avatar past the cut is not merely missing from a page, it is
permanently unselectable. `listAvatars()` and `listVoices()` follow `next_token` to exhaustion,
with a page bound as a safety stop against an endless token chain rather than as a product
limit.

### `dimension` → `aspect_ratio` + `resolution`

v2 accepted arbitrary pixel dimensions. v3 accepts an aspect ratio from a fixed set plus a
resolution tier. `dimensionToFormat()` does the conversion and is deliberately lossy in one
stated direction: nearest supported ratio, and the tier the requested pixels fit within.

The two dimensions this repository actually uses map exactly, so no current render changes
shape:

| Requested | v3 |
|---|---|
| 720×1280 | `9:16` at `720p` |
| 1280×720 | `16:9` at `720p` |

**The tier is read off the short edge, not the long one.** A tier name is a vertical-pixel
count in landscape (1080p is 1920×1080) and the same count on the narrow axis in portrait
(1080p is 1080×1920) — in both, the number is the short edge. A long-edge rule assumes every
tier is 16:9 and silently downgrades anything squarer: 1080×1080 is a 1:1 frame that genuinely
needs the 1080p tier, but its longest edge is 1080, below the 1920 a long-edge rule would
demand, so it would be cut to 720p and lose a third of its pixels without saying so.

An unusual dimension is snapped rather than refused. Refusing would convert a call the
provider would have absorbed into a 4xx, which is a worse outcome for a difference nobody
asked about. A zero or negative dimension *is* refused, because the alternative is sending a
`NaN` ratio.

### `avatar_style` is gone

v2's `avatar_style` (we only ever sent `'normal'`) has no v3 equivalent, so the client no
longer accepts it and the two routes that passed it no longer do. The routes still *accept* it
in their request bodies and still record it in `videos.config`, because that is provenance for
renders that were made under v2 — it simply is not sent to the provider any more.

---

## The one genuine behaviour change: photo avatars

This is the part that is not a rename, and it is worth being plain about.

**v2:** one synchronous POST to `upload.heygen.com/v1/talking_photo` returned a
`talking_photo_id` that was immediately usable in the very next call.

**v3:** three steps, and the third is asynchronous.

1. `POST /v3/assets` (multipart) → `asset_id`
2. `POST /v3/avatars` with `{type: 'photo', file: {type: 'asset_id', asset_id}}` → a look id
   and a group id
3. `GET /v3/avatars/looks/{look_id}` until `status` is `completed` — the look is **not
   renderable** before that

So `createPhotoAvatar()` polls, and can time out (120s default, configurable). The A-Roll
route, which uploads a still and renders in the same request, is therefore slower than it was
under v2 and can now fail with a training timeout where before it could not. That is inherent
to v3, not a choice made here.

Two details worth keeping:

- **An absent `status` means ready.** HeyGen only returns `status` for private avatars, so
  treating "no status" as "not ready" would poll to the deadline on every public look.
- **The two mutating steps get distinct idempotency keys** (`…:asset`, `…:avatar`). One key
  reused across two different mutations would make the second replay the first.

`uploadTalkingPhoto()` is **removed rather than kept as an alias**. It returned a
talking-photo id; the replacement returns a look id. The same name over a different identifier
is exactly the kind of quiet substitution that produces a render addressed to the wrong avatar.

---

## Idempotency

`Idempotency-Key` is a request header: 1–255 characters matching `[A-Za-z0-9_\-:.]` (a UUID
qualifies). A repeat within **24 hours** replays the original response instead of rendering —
and charging — again. A retry while the original is still in flight returns **409**.

The client:

- sends the header only when a caller supplies a key — no key is invented, because a key the
  caller does not know cannot be reused on the retry that matters;
- **validates the key locally before the request**, so a malformed key fails without spending
  a paid call;
- **rejects an empty-string key** rather than silently omitting the header. Dropping it would
  send an unprotected paid request while the caller believes the submission is idempotent.
  (This was a real bug in the first draft of this port; a test now covers it.)
- **validates a base key with the derived suffix already budgeted.** `createPhotoAvatar`
  appends `:asset` and `:avatar`, so a base key near the 255 limit passes at the boundary and
  then produces an over-length header partway through. Checking only at use would let the
  asset upload succeed and the avatar creation fail on length, stranding an uploaded asset
  with nothing to attach it to; the base key is therefore validated against `255 - len(':avatar')`
  before anything is uploaded.
- exposes `HeyGenError.isIdempotencyConflict` so a 409 is distinguishable from a failure. A
  retry loop that treats "still in flight" as "failed" either abandons work that is about to
  succeed or resubmits it under a fresh key — which is the duplicate charge the whole
  mechanism exists to prevent.

Nothing in this PR *generates* keys. Callers pass them, and under the A-Roll design the key
will be `render_attempts.id` — a value that exists before the call and is stable across a
crash. That table does not exist yet, which is why the client takes the key rather than
deriving it.

---

## Reconcile before retry

`reconcileBeforeRetry()` (exported, and available as `client.generateVideoReconciled`) handles
the failure D-J3 names: HeyGen accepts a paid submission and the process dies before the
response is persisted. The request succeeded; we just do not know its id. Retrying naively
renders and charges a second time, and a local uniqueness constraint cannot prevent it —
it deduplicates rows, not outbound calls.

Two mechanisms, because neither covers the whole window:

| Window | Mechanism |
|---|---|
| Inside 24h, key supplied | `Idempotency-Key`. Exact: HeyGen replays, no second render |
| Past 24h (`assumeKeyExpired`) | Search `GET /v3/videos?title=…` and adopt an existing render |
| **No key supplied at all** | Search first — an unprotected submission is the same exposure |
| 409 (in flight) | Search rather than fail — it is the same situation |

Five properties the tests pin:

1. **No speculative search while the key is live.** The normal path is one call.
2. **No key means search.** With no `Idempotency-Key` the submission is unprotected, so a lost
   response is exactly the unrecoverable double-charge this helper exists to close. "No key"
   must mean "search", not "submit and hope".
3. **Exact title match on the way back out.** `title` is a *substring* filter server-side, so
   searching for `attempt-1` also returns `attempt-10`. Adopting that would bind this attempt
   to a different segment's render. The filter narrows; the comparison decides.
4. **Every page is walked.** Because the filter is a substring, a short title can match far
   more rows than the attempt's own, and the exact match may sit several pages in. Stopping at
   page one turns "not found yet" into "not found", and the cost of that mistake is a second
   paid render. If the page bound is reached without resolving, the helper **throws rather
   than submitting** — an incomplete search has not established that no prior render exists,
   and treating it as a miss would authorize the very duplicate it is meant to prevent.
5. **A failed prior render is not adopted.** It is something to supersede, not to inherit.

The caller supplies the title, and it must be unique to the attempt — a production title is
not, since two attempts at one segment would share it. That is why the function takes
`reconcileByTitle` explicitly and overrides `opts.title` with it: the value searched for and
the value sent cannot drift apart.

**Nothing calls this yet.** It is the primitive A-Roll step D will use; wiring it to a durable
attempt record is that step's work, not this one's.

---

## Caller changes

| File | Change |
|---|---|
| `apps/gateway/src/server.ts` — `POST /heygen/videos` | Stops sending `avatarStyle` |
| `apps/gateway/src/server.ts` — `POST /productions/:id/generate` | Stops sending `avatarStyle` |
| `apps/gateway/src/server.ts` — `POST /productions/:id/aroll` | `uploadTalkingPhoto` → `createPhotoAvatar`; the look id is passed as `avatarId`, stored on the video row's `avatarId` (previously `''`), and carried in the queue payload as `photoAvatarId` |
| `apps/gateway/src/worker.ts` | `WorkerClients.heygen` is typed against the real `GenerateVideoOptions` instead of `Record<string, unknown>`; the `aroll` branch reads `photoAvatarId` |

The dashboard is **unchanged**. v3 renamed a look's `avatar_id` to `id`, but the client maps it
back, so `apps/dashboard/src/Studio.tsx` keeps reading `avatar_id`/`avatar_name`. The rename
carries no information and did not need to reach the UI.

### Queued v2 payloads

A `production_jobs` row enqueued before this change carries `talkingPhotoId`. The worker
**refuses** it with a message telling the operator to re-enqueue, rather than forwarding a v2
id to v3. A talking-photo id is not a look id; forwarding one would 4xx at best and address an
unrelated avatar at worst.

In practice the blast radius is nil: `WORKER_TICK_ENABLED` is unset, so nothing dispatches, and
the paid call for every existing A-Roll row already happened at the route. The refusal exists
because "nothing dispatches today" is a deployment fact, not a guarantee.

---

## What was deliberately not done

- **Webhooks.** v3 offers signed `avatar_video.success`/`.fail` deliveries, a `callback_id`
  correlation id, and `GET /v3/webhooks/events` for missed deliveries. `callback_id` and
  `callback_url` are plumbed through so a caller *can* use them, but this client neither
  requires nor receives deliveries. Adopting them means a public authenticated endpoint and a
  signature-verification path — new surface and a separate decision. The A-Roll design's step C
  chooses poll-versus-webhook against this client as it now stands.
- **`render_attempts` / `canonical_renders` / post-render approval.** The A-Roll track.
- **Calling `reconcileBeforeRetry` from anywhere.** It needs a durable attempt id to key on.
- **Enabling `WORKER_TICK_ENABLED`.** Unchanged and still off.

---

## Post-merge review fixes

The first automated review of this port landed seventeen seconds after it merged, with five
P2 findings. All five were verified against the code and were real; they are fixed in a
follow-up, together with one the review did not name:

| # | Finding | Consequence if left |
|---|---|---|
| 1 | `listAvatars()` took only the first page | An avatar past the 50-look cut becomes permanently unselectable in Studio |
| — | `listVoices()` had the same bug, unflagged | Same, past 100 voices |
| 2 | Reconciliation searched only page one | A missed match on a later page authorizes a **second paid render** |
| 3 | Derived idempotency keys could exceed 255 | Asset uploads, avatar creation then fails on length, asset stranded |
| 4 | No idempotency key skipped the search | An unprotected submission with no recovery path — the exact double-charge the helper exists to close |
| 5 | Resolution read off the long edge | A 1:1 or squarer frame silently downgraded a tier |

Findings 2 and 4 are the serious pair: both end in a duplicate charge on a paid API, which is
the failure D-J3 was written to prevent. Finding 1 is the only one visible to a user.

## Verification

`pnpm typecheck` and `pnpm lint` clean; the full suite runs against real Postgres.

The client tests assert the wire shape rather than just the return value — path, method,
headers, body — because a wrong field name against a paid API costs either a rejected render or
a duplicate charge, and neither shows up in a test that only checks the happy-path return.
Specifically covered: the v3 body shape and the *absence* of every v2 spelling; the dimension
mapping including the snap, the refusal and the short-edge tier; catalog pagination across
pages for both avatars and voices; `Idempotency-Key` sent, omitted, validated, length-budgeted
and 409-classified; `callback_id` sent and omitted; status and history reads; every
reconciliation branch including multi-page search, the exhausted-search refusal and the
no-key path; the photo-avatar upload/create/poll sequence including timeout, failure,
absent-status and per-step keys; and a sweep asserting every URL the client emits is under
`/v3`.

Each of the seven tests added for the review fixes was run against the pre-fix source first
and observed to fail. A test that cannot fail is not a check.
