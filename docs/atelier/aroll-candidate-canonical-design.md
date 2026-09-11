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
CREATE TYPE render_attempt_state AS ENUM
  ('submitting','submitted','rendering','persisted','failed',
   -- D-J3a (§10.3.1). NOT a kind of 'failed': a failed attempt is safe to retry, and this
   -- one is precisely the attempt we must not retry, because we could not establish whether
   -- it already produced a paid render. It is terminal until a human resolves it.
   'reconcile_inconclusive',
   'abandoned');

CREATE TABLE render_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id   text NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  segment_key     text NOT NULL,           -- which speaking segment this attempt is FOR
  attempt_no      int  NOT NULL,           -- 1, 2, 3 … per (production, segment)
  video_id        text REFERENCES videos(id),   -- NULL until the render is persisted
  provider        text NOT NULL DEFAULT 'heygen',
  provider_ref    text,                    -- provider's render id; reconciliation handle
  job_id          uuid REFERENCES production_jobs(id),
  state           render_attempt_state NOT NULL DEFAULT 'submitting',
  content_digest  text,                    -- sha256 of the bytes; NULL until persisted
  supersedes      uuid REFERENCES render_attempts(id),  -- regeneration lineage

  -- The complete, immutable set of inputs the provider call needs, captured at enqueue.
  -- Today the route derives talkingPhotoId, audioUrl, dimensions, motion prompt and title
  -- inline and passes them straight to HeyGen (server.ts:1929-1941). Once the call moves to
  -- the worker, none of that survives the request — and re-deriving it later would read
  -- MUTABLE production state, so a retry could render something different from what was
  -- requested. It also makes the §3.4 projection's "script text and voice" claim
  -- unverifiable. Durable asset references, never ephemeral URLs: a hosted voice-track URL
  -- expires, so the snapshot stores the asset id and the worker re-hosts from it.
  input_snapshot  jsonb NOT NULL,

  failure_reason  text,

  -- D-J3a audit. A resubmission is authorized by the conclusion that no prior render
  -- exists, so the search that reached that conclusion has to be recorded — otherwise a
  -- paid call rests on reasoning nothing kept. `reconcile_outcome` is 'exhausted' (the
  -- search completed and found nothing), 'recovered' (it found one) or 'inconclusive'.
  reconcile_outcome     text,
  reconcile_checked_at  timestamptz,
  reconcile_detail      text,              -- why a search was inconclusive, in words

  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (production_id, segment_key, attempt_no),

  -- A 'persisted' attempt is the condition that opens the gate (§4.4) and §6 promises one
  -- without a digest is impossible. Promise it in the schema, not the prose: a partial
  -- update would otherwise leave a terminal-looking attempt that can be neither approved
  -- nor reconciled.
  CONSTRAINT persisted_attempt_is_complete
    CHECK (state <> 'persisted'
           OR (video_id IS NOT NULL AND provider_ref IS NOT NULL
               AND content_digest IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT submitted_attempt_has_provider_ref
    CHECK (state NOT IN ('submitted','rendering') OR provider_ref IS NOT NULL),
  CONSTRAINT failed_attempt_has_reason
    CHECK (state <> 'failed' OR failure_reason IS NOT NULL),

  CONSTRAINT reconcile_outcome_vocabulary
    CHECK (reconcile_outcome IS NULL
           OR reconcile_outcome IN ('exhausted','recovered','inconclusive')),

  -- An inconclusive attempt must say when the search ran and why it could not resolve.
  -- Without both, the state is indistinguishable from an attempt nobody has looked at.
  CONSTRAINT inconclusive_attempt_is_documented
    CHECK (state <> 'reconcile_inconclusive'
           OR (reconcile_outcome = 'inconclusive'
               AND reconcile_checked_at IS NOT NULL
               AND reconcile_detail IS NOT NULL))
);
```

`segment_key` is what §1.7 lacks. Without it "which take is canonical" is a question about
timestamps; with it, it is a question about a row. Its semantics are ratified as **D-J1**
(§10.1): a **stable logical identifier for a speaking segment, stored on the production plan**
— never an attempt id, never a provider id, and never derived from mutable text such as the
script body.

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

**Four foreign keys are four existence proofs, not one coherence proof.** Each column above
proves only that *something* with that id exists. Nothing in the declaration says the attempt
belongs to this production and segment, that the video is the attempt's video, that the
evidence is about this attempt, or that its digest is this digest — so a misbound row could
authorize one attempt's bytes with another attempt's approval, and B1.1's experience says an
FK that is only an existence proof eventually gets bound to the wrong thing. A trigger,
`BEFORE INSERT OR UPDATE`, asserting the whole tuple:

```
attempt.production_id  = NEW.production_id
attempt.segment_key    = NEW.segment_key
attempt.state          = 'persisted'
attempt.video_id       = NEW.video_id
attempt.content_digest = NEW.content_digest
evidence.subject_type  = 'render'
evidence.subject_id    = NEW.attempt_id::text
evidence.scope         = NEW.production_id
evidence.revision_digest = NEW.content_digest
evidence.decision      IN ('approved','approved_with_note')   -- or the policy decision, §4.4
evidence.superseded_at IS NULL                                -- live at the moment of writing
```

Video reparenting is covered by the same rule B1.1 already applies to
`productions.final_video_row_id`: `videos.production_id` may not change while a
`canonical_renders` row names it.

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
2. builds the **`input_snapshot`** — the talking-photo asset, the voice asset id (not a hosted
   URL, which expires), dimensions, motion prompt, title, character and brand — so the worker
   can reproduce the exact requested call without re-reading mutable production state;
3. **in one database transaction**, inserts the `render_attempts` row in `submitting` with the
   next `attempt_no` *and* the `production_jobs` row, cross-referencing each other, with the
   complete gate descriptor (B1.1's `gate_origin` / `gate_subject_type` / `gate_subject_id` /
   `gate_scope` / `gate_resolution`, plus `gate_phase = 'post_render'`);
4. returns `202` with the attempt id.

**Step 3 is one transaction, and merely un-swallowing the error is not enough.** `enqueueJob`
is currently `.catch(() => undefined)` (§1.1) — removing that is necessary but insufficient. If
the attempt insert commits and the enqueue then fails, the request returns an error while
leaving a permanent `submitting` attempt with no job: a client retry allocates `attempt_no + 1`
while the orphan can never execute, never reconcile, and never be cleaned up by anything that
knows what it is. Both rows, or neither.

> **Step D has a hard prerequisite: something must actually dispatch.**
>
> `WORKER_TICK_ENABLED` is unset in production and the repository ships no other scheduler that
> calls `/worker/tick` — Phase A built the ticker and deliberately left it off. Today that is
> harmless, because the A-Roll route does the paid work synchronously. The moment step D removes
> that call, an ordinary A-Roll request returns `202` and **sits queued forever.**
>
> So enabling a dispatcher is not an assumption this design may leave outside itself: it is
> **step D's precondition**, and turning it on is a founder decision in its own right (it is the
> first time automatic dispatch runs at all). Step D does not ship until dispatch is enabled and
> observed working. This is now the first row of §7.

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
`provider_ref`** and never resubmits blind.

**But there is a window before `provider_ref` exists, and it is the dangerous one.** A crash
after HeyGen accepts the paid request and before its response is persisted leaves an attempt in
`submitting` with **nothing to query**. An earlier draft claimed the local
`UNIQUE (production_id, segment_key, attempt_no)` key bounds this to one extra render; that is
wrong, and the review was right to say so. A local uniqueness constraint deduplicates *rows*,
not *outbound calls* — repeated crashes in that window produce repeated paid renders, and the
constraint never sees them.

Only the provider can close it. Two cases, and the design does not pretend they are equivalent:

| Provider capability | Consequence for step D |
|---|---|
| **Client-supplied idempotency key.** The attempt id is the key; a retry returns the original render | Step D proceeds. Exactly-once against the provider |
| **A listable/searchable render history** keyed by something we set before calling (title, metadata, external ref) | Step D proceeds. Recovery searches before submitting; at-most-one extra render in a narrow window |
| **Neither** | **Step D does not ship.** The paid call stays at the route, where the request's own lifetime bounds duplication |

That third row is a real possible outcome, not a formality. Moving a paid call behind a queue
without a provider-side handle trades a bounded failure for an unbounded one, and this design
declines that trade.

**Which row applies is now answered, not assumed — see §11.** HeyGen's **v3** create-video
endpoint documents an `Idempotency-Key` header ("Optional client-supplied key for safely
retrying mutations. Subsequent calls within 24 hours that share this key replay the original
response"), which is row 1. The **v2** endpoint this repository currently calls documents no
such header, and v2's only handle is the `video_id` in its own response — which is exactly the
value a crash in this window loses, so v2 alone is row 3. **Step D is therefore gated on the v3
migration** (D-J3, §10.3).

### 4.4 Persistence and digest — the candidate is born here

On provider completion, in one durable step:

1. download the bytes;
2. **compute the sha256 while streaming**, not in a second pass;
3. upload to Drive, recording `driveFileId` and `headRevisionId`;
4. **insert the `videos` row** — idempotently, keyed on the attempt, with every column the
   table requires (`id`, `heygen_video_id` = `provider_ref`, `avatar_id`, `production_id`,
   `source = 'heygen'`, `status = 'completed'`, `brand`, `title`, `label`, `config`, plus
   `video_url`, `drive_file_id`, `drive_link`) and the new `content_digest` /
   `drive_revision_id`;
5. move the attempt to `persisted`, setting `video_id`, `content_digest` and `completed_at`;
6. **only now** open the post-render gate: the job transitions to `awaiting_approval` with its
   stored descriptor naming `('render', <attempt id>, <production id>)`.

*Step 4 was missing from an earlier draft, which said only "write columns on the videos row" —*
*with no step that creates one.* Today the route inserts it before the render exists (§1.1);
once the call moves to the worker, nothing does until here. Idempotent because a retried
completion must not produce a second row: the insert is `ON CONFLICT` on a uniqueness key
derived from the attempt.

**No candidate exists until its digest does.** That single rule is what makes D-I item 4
satisfiable.

**The ungated lane (D-I item 5) still writes evidence.** An earlier draft said step 6 is
replaced by "mark it canonical and write a transition row" — which **cannot execute**, because
`canonical_renders.evidence_id` is `NOT NULL`. That was a real contradiction inside this
document, and the fix is not to relax the column: a canonical render with no evidence is
precisely the unrepresentable state §3.2 is built around.

Instead the ungated path writes **policy-authored evidence**: an `approval_evidence` row for the
same `('render', attempt, production)` subject with

- `decision = 'approved'`, bound to the same `content_digest`;
- `principal_kind = 'processor'` and `principal_id` naming the policy rule, **not** a human;
- `asserted_role = 'policy-ungated'` — never `founder`, which B1.1's `founder_is_human` CHECK
  would reject for a processor anyway;
- `source_system = 'rmg-creator-os'`, and the `resolveGate` decision recorded in `provenance`.

Plus the `workflow_transitions` row, which keeps "this went out under policy, not review"
greppable. **A human approval and a policy approval are then distinguishable by `asserted_role`
rather than by the absence of a record** — which is the property an auditor actually needs.

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

Retention costs Drive storage. Indefinite hot storage for every rejected take is not the
answer either, so the horizon is **tiered rather than binary** — D-J2, §10.2. In short: the
record is permanent, the bytes are not.

- The `render_attempts` row, its `content_digest`, `input_snapshot`, provenance, rejection
  reason and `approval_evidence` row are retained **indefinitely**. Nothing in this section
  ever deletes them.
- The Drive **bytes** of a rejected candidate are retained for an operational window
  (`REJECTED_MEDIA_RETENTION_DAYS`, default **180**), after which they may be archived or
  purged — unless the attempt carries `retain_media = true`, set from the UI to mark a take as
  reference material.
- A purge **records itself**: `media_purged_at` and `media_purge_reason` on the attempt. It
  never deletes the attempt row, never deletes or supersedes the evidence, and never clears
  `content_digest`. An auditor reading a purged attempt still learns what was rejected, by
  whom, against which digest, and that the bytes were removed on policy at a stated time.
- A purge is refused for any attempt that is currently canonical for its segment, or whose
  digest appears in the recorded canonical set of an assembled output still pinned by a
  production. Rejected-and-superseded is purgeable; rejected-but-still-referenced is a bug.

### 4.7 Regeneration

Regenerating a segment creates a new `render_attempts` row with `attempt_no + 1` and
`supersedes` pointing at the previous attempt. The prior attempt keeps its state, its bytes and
its evidence.

**The old evidence is NOT superseded, and cannot be.** An earlier draft said it was "superseded
in the `approval_evidence` sense". That is impossible under B1.1's schema and would abort the
approval transaction for every regeneration: each attempt's evidence uses *its own attempt id*
as `subject_id`, and `approval_evidence_supersession_complete` refuses a successor whose
`subject_id` differs. Cross-attempt supersession is not representable — by design, since
supersession means *a later decision about the same thing*, and two attempts are two things.

So the lineage lives in exactly one place:

| Layer | On regeneration |
|---|---|
| `approval_evidence` | Attempt 1's row stays **live historical evidence** about attempt 1. Untouched. It correctly records that this render was approved, and it remains checkable against bytes that are still retained |
| `render_attempts.supersedes` | Attempt 2 points at attempt 1. This is the regeneration chain |
| `canonical_renders` | The row for that segment is **replaced** — this is the only place "which take is current" changes |

Superseding evidence within a subject still happens where it should: approving and then
rejecting *the same attempt* supersedes that attempt's own row, as B1.1 intends.

A rejected attempt is never silently retried: regeneration is an explicit action.

### 4.8 Assembly-time enforcement — the real gate

**The predicate applies to governed A-Roll inputs only.** `renderAssembly` accepts image
assets and `videos` rows of every source — Higgsfield, stock, custom, legacy (`server.ts:1745-
1768`). An earlier draft said "each assembly source", which would have rejected all of them,
since none has a `canonical_renders` row and §8 says they stay untouched. The rule is:

| Source | Requirement |
|---|---|
| A `videos` row **with a `render_attempts` row** (a governed render) | Must be canonical, live-approved and digest-matching — below |
| Any other `videos` row, or an image asset | Unchanged. No canonical row, no check, current behaviour exactly |

For a governed render, `renderAssembly` verifies **as it downloads** (§1.8):

- the row is named by a `canonical_renders` row for its `(production_id, segment_key)`;
- that row's `evidence_id` is live, approving, and not superseded;
- the bytes it is reading hash to that row's `content_digest`.

Any failure aborts the assembly rather than continuing. The check cannot live at the assemble
route, because the route returns before the bytes are read.

**Assembled output is invalidated when its inputs change.** Assembly writes
`productions.final_video_row_id` to the `final` row it produces — but that pin then long
outlives the canonical set it was built from. Approve a regenerated take after assembly and the
old cut stays pinned and publishable, containing an input that is no longer canonical. Two
rules close it, and both are needed:

1. **Replacing a `canonical_renders` row clears `final_video_row_id` transactionally**, in the
   same transaction as the approval (§4.5). The production returns to needing assembly, which is
   the truth.
2. **Assembly records the canonical set it consumed** — the `(segment_key, content_digest)`
   pairs — on the `final` row, and installs the pin **only if that set is still current** at the
   moment of installation. A conditional update, in the shape Phase A used for the job claim.
   Otherwise a human approving mid-assembly races the background task and the resulting pin
   describes a cut nobody approved.

The pin is the **assembled output**; `canonical_renders` names the **approved inputs**. Two
facts, two places — and rule 2 is what keeps them consistent over time rather than only at the
instant of writing.

### 4.9 Publish-time enforcement

Publish reads `final_video_row_id` and refuses if it is unset — it never re-derives a winner by
`updatedAt` (§1.9). Everything else at the publish boundary is already specified by Phase B
§3.5 and §4.3 (approved package, resolved destination, digest-bound raw read, publication
intents) and is not re-specified here.

**Assembly is not the only producer of a final cut, and an earlier draft stranded the other
one.** `POST /productions/:id/final-cut` (`routes/delivery.ts:191`) is the supported workflow
for a manually edited CapCut upload: it inserts a completed `source = 'final'` row and writes
`finalVideoId` — the Drive file id — but not the row pin. Making assembly the *sole* writer of
`final_video_row_id`, and then having publish refuse a null pin, would silently remove the
ability to publish any hand-edited final.

So the upload path sets the pin too, on the row it just created, with the same ownership rule
B1.1 enforces. It carries **no canonical-input guarantee** — a human assembled it outside the
system and the system cannot know what went into it — and that distinction is recorded rather
than hidden: the `final` row is marked as externally assembled, and a `workflow_transitions`
row says so. Whether an externally assembled cut may publish for a speaking-character brand at
all is a governance question, not a schema one, and §9 puts it to the founder.

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

### 7.1 The enum/commit-boundary constraint governs the ordering

`deae6a6` established the rule the hard way: Drizzle runs **all pending migrations in one
transaction**, and PostgreSQL refuses to *use* a value added by `ALTER TYPE … ADD VALUE` in the
transaction that added it (`55P04`). Splitting the statements into separate migration *files*
does not create a commit boundary. So every new enum value this design needs must land in a
**deploy that ships no statement using it**, and the first use waits for the next deploy.

Two enum changes are required, and neither was in B1.1:

| Enum | New value | First use |
|---|---|---|
| `render_attempt_state` (new type) | — created whole (including `reconcile_inconclusive`, D-J3a §10.3.1), so no boundary problem | §3.1's table |
| `production_job_status` (existing) | **`rendering`** (§4.2 — the job stays leased through provider render rather than being marked `done` at submission) | step D's dispatcher |

`production_job_status` already carries `awaiting_approval` from B1.1's `0023`. `rendering` is a
second `ALTER TYPE` on a live type; it gets its own enum-only migration in step A and is not
referenced by any DDL or seeded row in that same deploy.

`gate_phase` is **a column, not an enum value** — B1.1 shipped the gate descriptor
(`gate_origin` / `gate_subject_type` / `gate_subject_id` / `gate_scope` / `gate_resolution`) and
**no `gate_phase`**. §4.1 requires it. Adding it is plain DDL with no commit-boundary
constraint, but it must respect the two existing constraints it interacts with:

- `production_jobs_gate_complete` counts exactly the original four columns. `gate_phase` is
  **not** added to that `num_nonnulls` set; instead it carries its own
  `CHECK (gate_phase IS NULL OR (gate_origin IS NOT NULL AND gate_phase IN
  ('pre_dispatch','post_render')))` — a phase is meaningless on an ungated job, and the
  vocabulary is closed.
- `production_jobs_gate_descriptor_frozen` freezes the four descriptor columns once
  `gate_origin` is set. `gate_phase` must be added to that trigger's tuple comparison in the
  same migration, or a phase becomes the one mutable part of an otherwise frozen descriptor.

### 7.2 The sequence

| Step | Contents | Gate |
|---|---|---|
| **A** | Enum-only, no uses: `render_attempt_state` created; `production_job_status` gains `rendering` | — |
| **B** | `render_attempts` (incl. `retain_media`, `media_purged_at`, `media_purge_reason` — D-J2; `reconcile_outcome`, `reconcile_checked_at`, `reconcile_detail` — D-J3a), `canonical_renders`, `videos.content_digest`, `videos.drive_revision_id`, `production_jobs.gate_phase` + its CHECK + the widened freeze trigger, **and the production-plan segments array D-J1 requires** (`segment_key` is `NOT NULL` and has nothing to point at without it) | A deployed |
| **C** | Durable poller + persistence/digest step — behaviour-neutral until D | B deployed |
| **D** | Move the provider call behind dispatch; attempts created at enqueue; job moves to `rendering`; `Idempotency-Key` sent as the attempt id | **Three preconditions:** a dispatcher is enabled and observed working (§4.1); C has run against production traffic; **the HeyGen v3 migration has landed** (D-J3 / §11 — v2 offers no idempotency handle, and is retired 2026-11-01 regardless) |
| **E** | The approval route, step-up, evidence writes; old route refuses | D deployed |
| **F** | Assembly enforcement; publish reads the pin | E deployed, and §7.4's adoption pass complete |
| **G** | UI | F deployed |

Steps C and D are the risky pair — they touch a live paid path. Each is its own PR.

### 7.3 In-flight renders at deploy

`videos` rows in `processing` have no attempt row. They are backfilled as `attempt_no = 1` in
`rendering` with their `heygenVideoId` as `provider_ref`, so the poller adopts them rather than
stranding them.

### 7.4 Renders that already completed — the larger population

The in-flight backfill above covers only rows still `processing`. **Every A-Roll render that
already finished is the bigger problem**, and step F breaks on it if nothing is done: assembly
enforcement refuses any segment without a `canonical_renders` row, and every existing completed
render has none. Left alone, step F makes every current production unassemblable.

These rows cannot be adopted uniformly, because they differ in exactly the way that matters:

| Population | State today | Disposition |
|---|---|---|
| `ready`, `approved = true` | A human clicked approve through §1.5's unguarded boolean. There is no evidence row, no digest, no record of who or against what | **Adopt as unbound history.** Compute `content_digest` from the Drive object, write an `approval_evidence` row with `asserted_role = 'legacy-unattributed'` and `revision_digest = 'legacy:unbound'` — the same shape B1.1's `approved_package_required_for_positive_decisions` already exempts for legacy production approvals — and a `canonical_renders` row pointing at it |
| `ready`, `approved = false` | Rendered, never approved | **No adoption.** It becomes a candidate with no canonical row; the founder approves it through §4.5 like any new one |
| `failed` | — | **No adoption.** Nothing to make canonical |

Two properties of the adoption pass are not optional:

1. **It computes a real digest.** A legacy approval is unbound as to *who* and *against what
   copy*, but the bytes exist now and are hashable. Writing `legacy:unbound` into
   `videos.content_digest` as well would make the adopted row permanently unverifiable at
   assembly, which is the one thing step F exists to check. The evidence is unbound; the
   artifact is not.
2. **It runs before step F, and only once.** `canonical_renders` is one row per segment
   (§3.2), so a second pass must be a no-op, not a conflict. And a production approved
   *between* the adoption pass and step F would hold a live evidence row the backfill then
   collides with — the same ordering hazard as B1.2 §13.5-before-§13.6.

**Segment identity for legacy rows — resolved by D-J1 (§10.1).** `canonical_renders` is keyed
by `segment_key`, and a legacy render has no segment identity, so the adoption pass has to
*create* one. It does not invent a derivation rule for old data: for each legacy A-Roll video
it **mints one segment** on that production's plan and assigns the render to it, one segment
per adopted render. This is deterministic, runs once, and is consistent with D-J1's rule that
the key is a stored identifier rather than something re-derived from mutable text — a legacy
production simply turns out to have had one segment per render all along, which is true.

Productions whose renders were superseded before the pass keep only the adopted one as
canonical; the rest are ordinary historical attempts under that same segment.

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
- **The HeyGen v2 → v3 migration itself.** Step D depends on it (§11.3) and it is on a fixed
  external deadline of 2026-11-01, but it touches every HeyGen call in the repository, not
  just A-Roll. Specified elsewhere, tracked on issue #56.

---

## 9. Questions raised by this design — and how each was resolved

This document went to the founder with three open questions. All three are now answered:

| # | Question | Resolution |
|---|---|---|
| 1 | Does HeyGen support a client-supplied idempotency token? | **Yes, on v3; no, on v2.** Verified against the current API reference — §11. Recorded as **D-J3** |
| 2 | How is `segment_key` derived? | It is **not derived** — it is stored. **D-J1**, §10.1 |
| 3 | What is the retention horizon for rejected candidates? | Tiered: record permanent, bytes time-boxed. **D-J2**, §10.2 |

Nothing in this design is now waiting on an unanswered question.

---

## 10. Founder decisions D-J1 – D-J3, recorded verbatim

Ratified 2026-09-11, and governing for this track in the same way D-I is.

### 10.1 D-J1 — Segment identity

> **D-J1 — Segment identity:** `segment_key` is a stable logical segment identifier within a
> production. Render attempts are children of that segment; approval selects one attempt as
> canonical.

The founder's stated model, which this design adopts without amendment:

- one production can have multiple speaking segments;
- one segment can have multiple render attempts;
- one approved attempt becomes canonical for that segment.

So: **production + `segment_key` → many render attempts → one canonical approved render.**

The key is **deterministic from the production plan** — either an explicit path-like identifier
such as `scene-03/master-rahm-intro` or a generated stable segment UUID stored on the plan. The
founder's stated preference, and the rule this design implements: **a stored stable segment
identifier, never a value derived from mutable text such as the script body.**

That last clause is the load-bearing one, and it is worth stating why rather than just
recording it. If `segment_key` were a hash of the script text, then editing a word of copy
would silently re-key the segment: the production would acquire a second segment, the old
canonical render would still exist but would no longer be canonical *for anything*, and
assembly would find a segment with no approved take. Approval is supposed to be invalidated by
a copy change — that is what the digest is for — but the *identity of the segment* must
survive it. Mutable input, stable identity.

**What this obliges, and where it lands.** Productions today have no segment structure at all
(§1.7): `characterIds` and free-form `config`, nothing that names a speaking segment. So D-J1
requires a production-plan change — a segments array on the plan, each entry carrying its
stable id — and that work belongs to the A-Roll track's step B, alongside `render_attempts`.
It is a prerequisite of the schema, not a later refinement, because `render_attempts.segment_key`
is `NOT NULL` and has nothing to point at until the plan can produce one.

For productions that predate the change, §7.4's adoption pass mints segments rather than
deriving them.

### 10.2 D-J2 — Rejected-asset retention

> **D-J2 — Rejected asset retention:** audit metadata is permanent; rejected media bytes use a
> tiered retention policy rather than permanent hot storage.

Concretely, as the founder framed it:

- metadata, digest, provenance, rejection reason and audit evidence — retained **indefinitely**;
- the actual media bytes — retained for a defined operational period (**90–180 days**; this
  design takes **180** as the default, configurable, and the longer end deliberately), unless
  marked important/reference;
- after that window the bytes may move to cheaper archival storage, or be deleted where policy
  permits, **while the audit record remains**.

§4.6 implements this. The two properties that make it safe rather than merely cheap:

1. **A purge is a recorded event, not an absence.** `media_purged_at` and `media_purge_reason`
   are written on the attempt. The failure mode this avoids is an auditor finding a rejected
   attempt with no bytes and being unable to tell policy expiry from tampering.
2. **The digest outlives the bytes.** A purged attempt can no longer be *re-verified* against
   its content — that capability is genuinely given up, and the 180-day default is where the
   founder's range buys the most of it — but the record of *what* was rejected, by whom, and
   against which digest remains complete and permanent. Evidence is not deleted; a copy of the
   artifact is.

Purging is refused while an attempt is canonical, or while its digest is still named in the
canonical set of a pinned assembled output.

### 10.3 D-J3 — Provider retry semantics

> **D-J3 — HeyGen retry semantics:** use provider idempotency if available; otherwise require
> reconcile-before-retry and explicitly model paid submission as at-least-once until provider
> capability proves otherwise.

§11 discharges the conditional: **provider idempotency is available, on v3.** So the
"if available" branch governs, and the design binds to it:

- The **`Idempotency-Key` header is sent on every create-video call**, and its value is the
  `render_attempts.id` — a value that exists *before* the call, is unique per attempt by
  construction, and is exactly what a crash-and-retry in §4.3's dangerous window would reuse.
  Reused inside HeyGen's 24-hour replay window, it returns the original response rather than
  rendering again.
- **Reconcile-before-retry remains, and is not made redundant by it.** The replay window is 24
  hours; an attempt stranded longer than that falls outside it. Recovery past the window
  queries `GET /v3/videos` filtered by `title` (and `callback_id`, §11) before deciding to
  resubmit.
- **Paid submission is still modelled as at-least-once outside that window.** The design does
  not claim exactly-once as a property of the system; it claims it as a property of a bounded
  window the recovery path is built to stay inside.
- **Step D does not ship on v2.** v2 offers neither the header nor a searchable history, which
  is §4.3's third row — the row on which this design already committed to not shipping. The
  v3 migration is therefore step D's second precondition, alongside an enabled dispatcher.

#### 10.3.1 D-J3a — the exhausted-search rule

Founder direction, 2026-09-11, after the v3 migration and two rounds of review on it
(`27178e2`, and the follow-up fixes) surfaced five and then three real defects, most of them
in exactly this area:

> **Only a provably exhausted history search may authorize a new paid submission when prior
> completion is uncertain. Incomplete, truncated, inconsistent, or bounded-out history must
> fail closed.**

This is a **generalization of D-J3, not a restatement of it**, and it is recorded here rather
than only in the client because the client is the wrong place for it to live. Reconciliation
is not "query history before retry" — that phrasing is what produced the defects. The rule is
about which conclusions a search is entitled to reach.

The distinction that matters: a search that finds nothing on the page it looked at has **not**
established that nothing exists. Only exhaustion establishes that. And "nothing exists" is
precisely the conclusion that authorizes spending money, so every way a search can end short
of exhaustion has to be a failure rather than a miss:

| How the search ended | Entitled to conclude | Behaviour |
|---|---|---|
| A **usable** match was found (exact title, not `failed`) | It exists | Adopt it |
| Explicit "no more pages" **and** no continuation cursor | Nothing exists | Submit |
| Page bound reached with pages remaining | **Nothing** | Fail closed |
| More pages claimed, but no cursor to follow | **Nothing** | Fail closed |
| No explicit "no more pages" **and** no cursor | **Nothing** | Fail closed |
| "No more pages" **contradicted by** a continuation cursor | **Nothing** | Fail closed |
| The search itself errored | **Nothing** | Fail closed |

Two rows deserve their exact wording, because a looser version of each was written first and
was wrong:

- **"usable"**, not merely "found". An exact-title match whose own status is `failed` is
  something to supersede, not inherit (§4.6, §4.7). Adopting one binds the attempt to a
  provider reference that produced nothing. A failed match therefore does **not** end the
  search: it is skipped, and the search continues to exhaustion, because a usable duplicate
  may sit on a later page.
- **"and no continuation cursor"**, not just the flag. The two signals are independent
  fields, so they can disagree, and a response asserting the end while still offering a way
  to continue is internally inconsistent — which this rule says fails closed. Treating the
  flag as authoritative and the cursor as trailing noise is a guess, and the thing it guesses
  about is whether to spend money.

Each of the last three was, at some point in the migration, implemented as "return not-found
and carry on" — and each would have authorized a duplicate paid render. They are not exotic:
a bounded loop that returns its accumulator is the obvious way to write the code, and it is
wrong for this reason alone.

**What this obliges of `render_attempts` (§3.1, §4.3).** When step D wires reconciliation to
a durable attempt record, the rule travels with it:

- An attempt whose reconciliation search failed closed is **not** eligible for resubmission.
  It takes the distinct terminal state `reconcile_inconclusive` (§3.1) — "completion unknown,
  search inconclusive" — and needs an operator decision, not a retry. It must not fall back
  into the ordinary attempt/backoff path, which exists for failures that are safe to repeat.
  This is why it is an enum value rather than a flavour of `failed`: `failed` is safe to
  retry and this is precisely the attempt that is not, so collapsing them would feed it to
  the machinery the rule exists to keep it away from.
- The retry/sweep machinery must therefore be able to tell "this attempt failed" from "we
  could not establish whether this attempt produced a render". Collapsing the two is the same
  mistake one level up from the client.
- A resubmission must record *why* it was permitted: `reconcile_outcome`,
  `reconcile_checked_at` and, when inconclusive, `reconcile_detail` (§3.1). A paid call
  authorized by a conclusion nothing recorded is not auditable after the fact.

The same rule applies to any future provider on the same path, not only HeyGen.

What a provider must offer to satisfy it is **a way to prove, at the moment of retry, whether
the earlier submission produced a render.** Searchable history is one way. A durable
idempotency key is another and a better one: if replaying it always returns the original
response rather than rendering again, the replay *is* the proof, and no search is needed.
That is §4.3's first row, and it remains sufficient on its own.

HeyGen needs both only because its key expires after 24 hours (§11.2). Past that window the
key proves nothing, and history becomes the only remaining handle — which is why this client
implements both.

So the provider that cannot satisfy the rule is the one with **neither** a durable idempotency
guarantee **nor** searchable history — §4.3's third row, where "step D does not ship" is the
correct outcome rather than a cautious default. A provider whose idempotency never expires
needs no history endpoint and is not excluded.

---

## 11. HeyGen capability verification

> **Superseded in part, 2026-09-11.** §11.1 below records what the client called *at the time
> of this verification*. The v2 → v3 migration has since landed — see
> [`heygen-v3-migration.md`](./heygen-v3-migration.md) — so the client now calls v3 throughout
> and §11.3's deadline item is discharged. The capability findings in §11.2 are unchanged and
> are what D-J3 rests on; step D's remaining preconditions are an enabled dispatcher and step C.

Checked 2026-09-11 against `developers.heygen.com` (the current documentation host;
`docs.heygen.com` 301-redirects there) and against this repository's own client,
`packages/integrations/src/heygen.ts`.

### 11.1 What the repository calls today

| Call | Endpoint | Idempotency handle |
|---|---|---|
| Submit | `POST /v2/video/generate` | **None.** The client sends `X-Api-Key` and `Content-Type` only; the body carries `video_inputs`, `dimension` and an optional `title` |
| Status | `GET /v1/video_status.get?video_id=…` | Requires the `video_id` from the submit response |

The only handle v2 gives back is the `video_id` in the response to the paid call — precisely
the value lost in §4.3's dangerous window. There is no documented v2 list-by-title endpoint to
search with instead. **On v2, the design's third row applies and step D cannot ship.**

### 11.2 What v3 provides

| Capability | v3 |
|---|---|
| Idempotency | **`Idempotency-Key` request header** on create-video — documented as "Optional client-supplied key for safely retrying mutations. Subsequent calls within 24 hours that share this key replay the original response" |
| Searchable history | **`GET /v3/videos`** with `limit`, `token`, `folder_id` and a **`title` substring filter**; each row returns `id`, `title`, `status`, `created_at`, `completed_at`, media URLs, and `failure_code`/`failure_message` |
| Caller-set correlation id | **`callback_id`** on the create body, alongside `callback_url` |
| Completion push | **Webhooks** — `avatar_video.success` / `.fail` and siblings, signed with an endpoint secret, with `GET /v3/webhooks/events` to browse delivered events |
| Status read | `GET /v3/videos/{id}` |

So v3 supplies **all three** of the handles §4.3 asks for: a true idempotency key, a searchable
history, and a caller-set correlation id. This is a better answer than the design assumed.

### 11.3 The finding that is not about idempotency

**v2 is retired on 2026-11-01** — the documentation's stated end-of-support date, with the
operational window running through 2026-10-31. The repository's own client comments say the
same. That is roughly seven weeks from this writing.

Two consequences, and they point the same way:

1. The v3 migration is **already mandatory** on a fixed external deadline, independent of
   anything in this track. D-J3 does not create that work; it schedules step D behind work that
   has to happen regardless.
2. Sequencing step D after the migration is therefore the cheap ordering, not the expensive
   one. Building step D against v2 would mean building it against an endpoint that is retired
   before the step is finished, and building it without the one header that makes it safe.

**The v3 migration is not in this design's scope** and is not specified here — it touches every
HeyGen call in the repository, not just A-Roll. It is recorded on issue #56 as a prerequisite
of step D and as a deadline item in its own right.

### 11.4 Webhooks — noted, not adopted here

v3's signed completion webhooks plus `callback_id` would let §4.3 be push-driven rather than
polled, and `GET /v3/webhooks/events` covers a missed delivery. That is a genuinely better
shape than the poller this design specifies.

It is recorded and **not adopted in this pass.** §4.3's poller is specified, bounded, and built
on lease machinery Phase A already proved; swapping it for an inbound webhook introduces a
public authenticated endpoint and a signature-verification path, which is new surface and a
new decision. **Step C evaluates poll-versus-webhook against the v3 client as it actually
lands**, and either choice satisfies this design — what §4.3 requires is a durable server-side
completion path, not specifically a poller.
