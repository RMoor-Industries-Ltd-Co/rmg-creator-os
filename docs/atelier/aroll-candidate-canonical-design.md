# Master Atelier — A-Roll candidate / canonical pipeline

**Status:** design only. No code changes accompany this document.
**Governs:** ratified founder decision **D-I** (Phase B design §14 decision 10).
**Why this document exists separately:** see §0.

---

## 0. Why this is its own track

D-I was first recorded as an amendment to §3.6 of the Phase B governance design. Two review
rounds established that it could not live there. Each round opened another subsystem rather
than closing the last:

| Round | What it found |
|---|---|
| 1 | The §4.1 gate mechanism cannot express "run once, then gate the output". No subject type exists for a render, and reusing `production` is circular. Rejection destroys its own evidence |
| 2 | Adding `gate_phase` changed nothing because enqueue/claim/retry/sweep never branched on it. The canonical pin had no storage. The approve route is an unguarded bypass. The queue's `done` means *submitted*, so a candidate would predate its own digest. Assembly reads bytes after the route returns |

That is a subsystem. Founder direction, 2026-09-11: **stop extending §3.6; design A-Roll as its
own bounded pass.** D-I stays ratified; PR #57 is preserved as its seed.

This document therefore does what an amendment could not: **walks the whole path in code
first**, then specifies. Every "today" claim below is a file and line, checked at `deae6a6`.

### D-I, preserved verbatim as the governing constraint

1. HeyGen **may generate a candidate before creative approval**.
2. Speaking-character lanes require **mandatory human review after generation**, before the
   output may become canonical, continue to assembly, or publish.
3. Rejected outputs are **preserved as non-canonical evidence** and may trigger regeneration.
4. Approval binds to the **exact rendered asset and content digest**.
5. Non-speaking lanes continue automatically **when server-side policy says so**.
6. Gate applicability is **server-side**, never caller input.
7. **No rejected or unreviewed speaking render may become the final-video reference.**
8. **Multiple render attempts are represented explicitly.**
9. The added wait is an **accepted quality-control cost**.
10. HeyGen execution moves **behind worker dispatch** for leased, recoverable, at-least-once
    execution — *not* for pre-generation approval.

---

## 1. The path as it exists today

Walked end to end. This section makes no proposals; it is the ground truth the rest rests on.

### 1.1 Request and enqueue — the paid call happens at the route

`POST /productions/:id/aroll` (`server.ts:1925-1975`) uploads the talking photo, hosts the
voice track, then calls `client.generateVideo(...)` — **the paid HeyGen call** — inserts a
`videos` row with `status: 'processing'`, advances the production to `generate`, and only then
calls `enqueueJob`. The code says so itself:

> `// One queue row per video row. The paid HeyGen call already happened above, so this key`
> `// cannot suppress real work — it only prevents a duplicate tracking row`

The `enqueueJob` call is additionally `.catch(() => undefined)` — non-fatal, because *the video
row is the source of truth*, not the queue row.

**Consequence.** The queue row is a tracking record of money already committed. Any gate over
`production_jobs` is downstream of the spend. D-I accepts this deliberately; item 10 moves the
call behind dispatch for *execution* reasons, which §4 specifies.

### 1.2 Worker dispatch — `done` means *submitted*

`dispatch` (`worker.ts:34-76`) returns `{ resultId: videoId }` the moment `generateVideo`
yields an id. `runWorkerTick` (`worker.ts:138-145`) then writes `status: 'done'`, `resultId`,
`completedAt` and clears the lease.

**Consequence, and it is the central one.** At the instant the queue calls the job *done*, the
render does not exist. There are no bytes, no URL, no checksum. D-I item 4 binds approval to
the exact rendered asset and its digest; on this timeline there is nothing to bind to.

### 1.3 Provider completion — polling is client-driven and non-durable

`GET /heygen/videos/:id` (`server.ts:379-425`) is the **only** thing that advances a render
past `processing`. It polls HeyGen on demand, writes `status`/`videoUrl`/`thumbnailUrl`, then
calls `saveVideoToDrive`.

**Consequence.** Completion depends on somebody's browser being open on the right page. No
server-side poller exists. If the dashboard is closed, a finished render stays `processing`
indefinitely — the paid asset exists at HeyGen and Creator OS never learns of it.

### 1.4 Drive persistence — no checksum anywhere

`saveVideoToDrive` (`server.ts:327-349`) calls `drive.uploadFromUrl` and records `driveFileId`
and `driveLink`. It computes **no** checksum, and the `videos` table has no column for one
(`schema.ts`, `videos`: `id, productionId, heygenVideoId, status, avatarId, voiceId, inputText,
title, label, brand, videoUrl, thumbnailUrl, driveFileId, driveLink, source, approved, config,
createdAt, updatedAt`).

**Consequence.** D-I item 4's "content digest" has no producer and no storage today.

### 1.5 Approval — a boolean, with no authority check at all

`POST /videos/:id/approve` (`server.ts:2044-2069`) requires `status === 'completed'`, clears
`approved` on sibling rows of the same `(productionId, source)`, sets `approved = true` on this
one, and — for `source === 'heygen'` — advances the production to `stage: 'post'`.

No step-up. No founder check. No evidence row. No digest. **This is the route the A-Roll UI
calls**, so it is simultaneously the only way to approve a render and a complete bypass of the
governance model B1.1 just landed.

### 1.6 Rejection — destroys the artifact

`DELETE /videos/:id` (`server.ts:2073-2085`) deletes the Drive object and then the row.

**Consequence.** An operator rejecting a candidate through the existing UI destroys exactly what
D-I item 3 requires preserving. The evidence would survive; the thing its digest refers to would
not.

### 1.7 Attempts — implicit, and mutually clobbering

Re-rendering inserts another `videos` row. There is no attempt number, no lineage pointer, no
segment key. `approved` is a bare boolean whose uniqueness is maintained by the approve route
clearing siblings — application convention, not a constraint.

### 1.8 Selection and assembly — background, and after the fact

`POST /productions/:id/assemble` (`server.ts:1816-1834`) starts `renderAssembly` in the
background and returns. That task later re-reads each `videos` row and downloads its
**then-current** bytes (`server.ts:1747-1768`), producing a new row with `source = 'final'`.

**Consequence.** A canonical-and-evidence check at the assemble route binds nothing: the bytes
are fetched afterwards. And an A-Roll render is an *input* to assembly, while the thing publish
sends is the `final` row — two different assets.

### 1.9 Publish — reads neither pin

`POST /productions/:id/publish` (`server.ts:2229-2271`) selects the production's videos and
takes the newest by `updatedAt`. It does not read `productions.finalVideoId` (a Drive file id
from one producer, unset by the other) and does not read `final_video_row_id` (added in B1.1,
deliberately unpopulated).

### 1.10 What B1.1 already provides

Merged in `deae6a6`: `approval_evidence` (append-only, digest-bound, superseding, with
`decision_seq` ordering), `workflow_transitions`, `publication_intents`, `signing_keys`,
`work_items`, the `production_jobs` gate descriptor with `gate_resolution`, and
`productions.final_video_row_id` (`text`, ownership-triggered, unpopulated).

**This design adds no new governance primitive.** It uses those, and adds only what is specific
to renders.

---

## 2. The shape of the problem

Three facts from §1 decide the whole design:

1. **A candidate cannot exist before its bytes do** (§1.2, §1.3, §1.4). So "gate the output"
   requires a completion phase Creator OS does not have.
2. **A render is an input; the published asset is a different row** (§1.8). So one pin cannot
   carry both meanings, and the enforcement point is assembly, not publish.
3. **The only approval path is an unguarded boolean** (§1.5). So the gate is not an addition to
   the approve route; it is a replacement of it.

---

## 3. Data model

### 3.1 `render_attempts` — attempts become explicit (D-I item 8)

```sql
CREATE TABLE render_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id   text NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  segment_key     text NOT NULL,           -- which speaking segment this attempt is FOR
  attempt_no      int  NOT NULL,           -- 1, 2, 3 … per (production, segment)
  video_id        text REFERENCES videos(id),   -- NULL until the render completes
  provider        text NOT NULL DEFAULT 'heygen',
  provider_ref    text,                    -- heygen video id; the reconciliation handle
  job_id          uuid REFERENCES production_jobs(id),
  state           render_attempt_state NOT NULL DEFAULT 'submitting',
  content_digest  text,                    -- sha256 of the bytes; NULL until persisted
  supersedes      uuid REFERENCES render_attempts(id),  -- regeneration lineage
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (production_id, segment_key, attempt_no)
);

CREATE TYPE render_attempt_state AS ENUM
  ('submitting','submitted','rendering','persisted','failed','abandoned');
```

`segment_key` is what §1.7 lacks. Without it "which take is canonical" is a question about
timestamps; with it, it is a question about a row.

`provider_ref` is populated **before** the paid call returns where the provider supports a
client-supplied id, and immediately after where it does not — it is the handle §4.3's
reconciliation needs.

### 3.2 `canonical_renders` — one approved render per segment (D-I items 7–8)

As specified in PR #57 and unchanged here:

```sql
CREATE TABLE canonical_renders (
  production_id  text NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  segment_key    text NOT NULL,
  attempt_id     uuid NOT NULL REFERENCES render_attempts(id),
  video_id       text NOT NULL REFERENCES videos(id),
  evidence_id    uuid NOT NULL REFERENCES approval_evidence(id),
  content_digest text NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (production_id, segment_key)
);
```

`evidence_id` and `content_digest` are `NOT NULL` deliberately: a canonical render with no
approval, or with no bound bytes, is the state D-I item 7 forbids, and making either column
nullable would make that state representable.

### 3.3 `videos` gains a digest

```sql
ALTER TABLE videos ADD COLUMN content_digest text;   -- sha256 of the persisted bytes
ALTER TABLE videos ADD COLUMN drive_revision_id text; -- Drive headRevisionId at persist time
```

Both are written once, when bytes land in Drive (§4.4). Neither is mutable.

### 3.4 The `render` approval subject

`approval_evidence` already accepts any `subject_type`. This design adds the third value and
its projection:

| | |
|---|---|
| `subject_type` | `render` |
| `subject_id` | the `render_attempts.id` — **the attempt**, not the video row |
| `scope` | the `production_id` |
| projection | `content_digest`, `provider_ref`, the script text and voice id the attempt was generated from, the character/brand lane, and `segment_key` |

**The projection excludes every field derived from the production's approval state.** That is
what breaks the circularity round 1 identified: a render's digest is a fact about the render,
computable the moment its bytes exist.

`subject_id` is the attempt rather than the video row because an attempt is the thing that has
lineage. Two attempts can in principle produce byte-identical output; they are still different
decisions.

---

## 4. The pipeline, specified

### 4.1 Request and enqueue

`POST /productions/:id/aroll` stops calling the provider. It:

1. resolves `segment_key` and the gate via `resolveGate` (server-side policy, D-I item 6);
2. inserts a `render_attempts` row in `submitting` with the next `attempt_no`;
3. enqueues an `aroll` job carrying the attempt id, with the gate descriptor written atomically
   when policy says one applies (B1.1's `gate_origin` / `gate_subject_type` / `gate_subject_id`
   / `gate_scope` / `gate_resolution`, plus `gate_phase = 'post_render'`);
4. returns `202` with the attempt id.

`enqueueJob` is **no longer** `.catch(() => undefined)`. Once the queue owns the spend, a failed
enqueue must fail the request — the current swallow is correct only while the video row is the
source of truth.

### 4.2 Dispatch and submission

The worker performs the paid call. On success it records `provider_ref` and moves the attempt to
`submitted` — **it does not mark the job `done`** (§1.2 is the bug being fixed). The job moves to
a new `rendering` status and keeps its lease, renewed by the poller.

### 4.3 Provider completion — durable, and reconciling

A server-side poller runs on the same lease-and-recover machinery Phase A built. It is a worker
capability, not an in-process timer that dies with the request (§1.3).

For each `submitted` / `rendering` attempt it asks the provider for status and:

- still rendering → renew the lease, leave the attempt in `rendering`;
- completed → §4.4;
- failed → attempt `failed` with `failure_reason`, job `failed`; no candidate.

**Reconcile before retry (D-I item 10).** An attempt holding a `provider_ref` with no persisted
result is an *uncertain request*, not a lost one. Recovery **queries the provider by
`provider_ref`** and never resubmits blind. Where HeyGen supports a client-supplied idempotency
token, the attempt id is that token and the reconciliation is exact; where it does not,
`provider_ref` plus the `UNIQUE (production_id, segment_key, attempt_no)` key bounds duplication
to at most one extra render per attempt, which is the honest guarantee.

*Open item for implementation:* confirm against HeyGen's current API whether a client-supplied
idempotency key is available. The design works either way; the guarantee is stronger if it is.

### 4.4 Persistence and digest — the candidate is born here

On provider completion, in one durable step:

1. download the bytes;
2. **compute the sha256 while streaming**, not in a second pass;
3. upload to Drive, recording `driveFileId` and `headRevisionId`;
4. write `videos.content_digest` and `videos.drive_revision_id`;
5. move the attempt to `persisted` with the same `content_digest` and its `video_id`;
6. **only now** open the post-render gate: the job transitions to `awaiting_approval` with its
   stored descriptor naming `('render', <attempt id>, <production id>)`.

**No candidate exists until its digest does.** That single rule is what makes D-I item 4
satisfiable.

For an **ungated** lane (D-I item 5) step 6 is replaced by: mark the attempt canonical directly,
write a `workflow_transitions` row recording that policy — not a human — authorised it, and
complete the job. The transition row is what keeps "it was ungated" auditable rather than
inferable.

### 4.5 Post-render approval — replacing the boolean

`POST /videos/:id/approve` is replaced by `POST /render-attempts/:id/approve`, and the old route
**refuses** for any attempt-backed render rather than being left as a parallel path (§1.5).

For a gated attempt the route requires, in one transaction:

- a valid session **and** a `rmg_stepup` credential within its window (Phase B §7.1);
- founder-set membership (Phase B §7.2) — `AUTH_ALLOWED_EMAILS` is not sufficient;
- the attempt in `persisted`;
- a **recomputed** digest matching `render_attempts.content_digest` — approval binds to bytes
  as they are now, not as they were recorded;

and then writes, atomically:

- `approval_evidence` with `subject_type = 'render'`, the attempt id, the production scope, the
  digest, `decision`, `decided_at`, `decision_seq`, and the mapped canonical principal;
- the `canonical_renders` row (inserted, or superseding the existing one for that segment);
- a `workflow_transitions` row;
- the legacy `videos.approved` flag, so the existing UI keeps working during the transition.

Rejection takes the same route with `decision = 'rejected'` and writes evidence **without** a
canonical row.

### 4.6 Rejection retention (D-I item 3)

`DELETE /videos/:id` **refuses** for any render carrying a `render_attempts` row. Rejection is a
decision, recorded; it is not a deletion. The row and the Drive object both remain, so the
evidence digest stays checkable for as long as the evidence does.

Behaviour is unchanged for renders with no attempt row — the ad-hoc Studio path the route was
written for.

Retention costs Drive storage. That cost is the point: evidence you have deleted is not
evidence.

### 4.7 Regeneration

Regenerating a segment creates a new `render_attempts` row with `attempt_no + 1` and
`supersedes` pointing at the previous attempt. The prior attempt keeps its state, its bytes and
its evidence. Approving the new attempt supersedes the `canonical_renders` row for that segment;
the old evidence row is superseded in the `approval_evidence` sense, not deleted.

A rejected attempt is never silently retried: regeneration is an explicit action.

### 4.8 Assembly-time enforcement — the real gate

`renderAssembly` verifies, **as it downloads each source** (§1.8):

- the source is named by a `canonical_renders` row for its `(production_id, segment_key)`;
- that row's `evidence_id` is live, approving, and not superseded;
- the bytes it is reading hash to that row's `content_digest`.

Any failure aborts the assembly rather than continuing. The check cannot live at the assemble
route, because the route returns before the bytes are read.

Assembly writes `productions.final_video_row_id` to the `final` row it produces. That pin is the
**assembled output**; `canonical_renders` names the **approved inputs**. Two facts, two places.

### 4.9 Publish-time enforcement

Publish reads `final_video_row_id` and refuses if it is unset — it never re-derives a winner by
`updatedAt` (§1.9). Everything else at the publish boundary is already specified by Phase B
§3.5 and §4.3 (approved package, resolved destination, digest-bound raw read, publication
intents) and is not re-specified here.

### 4.10 UI

The A-Roll surface gains: attempts listed per segment with state and attempt number; an
explicit **Approve / Reject / Regenerate** control on a `persisted` attempt; the step-up
re-authentication prompt and retry (server-side check without the prompt makes approval
unreachable); a visible "waiting for review" state; and rejected attempts shown as retained and
non-canonical rather than disappearing.

---

## 5. Failure modes

| # | Failure | Control |
|---|---|---|
| 1 | A candidate is recorded before its bytes exist | The gate opens only at `persisted`, after the digest is computed (§4.4) |
| 2 | A crash between provider acceptance and persistence pays twice | Reconcile-before-retry against `provider_ref`; never a blind resubmit (§4.3) |
| 3 | A finished render is never noticed because no browser was open | Durable server-side poller on the worker's lease machinery (§4.3) |
| 4 | An operator approves a render with no step-up and no evidence | The old boolean route refuses for attempt-backed renders; approval is an evidence transaction (§4.5) |
| 5 | Rejecting a candidate destroys the artifact its evidence refers to | `DELETE` refused for attempt-backed renders (§4.6) |
| 6 | An unapproved render is baked into the assembled output | Verified at the download, not at the route (§4.8) |
| 7 | Two takes both claim to be canonical for a segment | `canonical_renders` is keyed on `(production_id, segment_key)` (§3.2) |
| 8 | A canonical render exists with no approval | `evidence_id NOT NULL` (§3.2) |
| 9 | Approval binds to a digest recorded earlier, not the bytes now | The approve route recomputes before writing (§4.5) |
| 10 | An ungated lane's automatic progression is indistinguishable from an unaudited one | A `workflow_transitions` row records the policy decision (§4.4) |
| 11 | Publish sends the A-Roll input instead of the assembled cut | Two pins; publish reads `final_video_row_id` only (§4.8, §4.9) |
| 12 | Regeneration loses the rejected take | `supersedes` lineage; prior attempts retained (§4.7) |

---

## 6. Test strategy

Every row of §5 gets a test that fails against today's code. The three that cannot be found by
accident, and should be written first:

1. **Crash between submission and persistence.** Kill the worker after `provider_ref` is stored
   and before the bytes land; assert recovery **queries** the provider and issues no second paid
   call. This is the only test here that costs money each time it fails in production.
2. **Assembly race.** Replace the Drive object after the assemble request and before the
   background download; assert the assembly aborts.
3. **Approve without step-up.** Assert refusal, and assert that a successful approval writes
   evidence, the canonical row, the transition and the legacy flag **in one transaction** —
   neither half landing alone.

Plus: a `persisted` attempt with no digest is impossible; a gated attempt completing does not
become canonical; an ungated lane does, with a transition row; `DELETE /videos/:id` refuses an
attempt-backed render; two approvals for one segment supersede rather than duplicate; publish
refuses an unset pin.

All database assertions run against **real PostgreSQL via the real migrations**, per the
standing mandate and the harness merged in `deae6a6`.

---

## 7. Migration and sequencing

| Step | Contents |
|---|---|
| **A** | `render_attempt_state` enum (its own migration — `ALTER TYPE`/first-use and Drizzle's single-transaction migrator, as `deae6a6` established) |
| **B** | `render_attempts`, `canonical_renders`, `videos.content_digest`, `videos.drive_revision_id` |
| **C** | Durable poller + persistence/digest step — behaviour-neutral until D |
| **D** | Move the provider call behind dispatch; attempts created at enqueue |
| **E** | The approval route, step-up, evidence writes; old route refuses |
| **F** | Assembly enforcement; publish reads the pin |
| **G** | UI |

Steps C and D are the risky pair — they touch a live paid path. Each is its own PR, and D does
not ship until C has been running against production traffic.

**Existing in-flight renders.** At deploy, `videos` rows in `processing` have no attempt row.
They are backfilled as `attempt_no = 1` in `rendering` with their `heygenVideoId` as
`provider_ref`, so the poller adopts them rather than stranding them.

---

## 8. Out of scope

Not in this design, and not to be added to it without a founder decision:

- **B2 entirely** — no `hvnglobalco-com` changes, no signed domain assertions, no Accord MCP,
  no `rmg-piaar-mcps` write gates, no higher autonomy.
- **Enabling the worker ticker.** `WORKER_TICK_ENABLED` stays unset. This design assumes
  dispatch happens; turning it on is a separate founder decision.
- **Publishing architecture** beyond reading the pin — Phase B §3.5 and §4.3 own it.
- **B-Roll, Higgsfield and stock renders.** They share the `videos` table and are deliberately
  untouched: no attempt row, no gate, current behaviour exactly.
- **Issue #55** (the `POST /queue/:id/retry` read-then-write race).

---

## 9. Open questions for the founder

1. **HeyGen idempotency tokens.** §4.3 is stronger if the provider accepts a client-supplied
   key. Needs confirming against their current API before step D.
2. **`segment_key` derivation.** Today an A-Roll render has no segment identity; productions
   carry `characterIds` and per-segment structure lives in `config`. Whether `segment_key` is
   the character id, an index, or an explicit script-segment id is a product question, and it
   determines what "one canonical render per segment" means.
3. **Retention horizon.** Rejected candidates are kept indefinitely under §4.6. If that is not
   acceptable, the horizon must be stated — and deletion after it must supersede the evidence
   rather than orphan it.
