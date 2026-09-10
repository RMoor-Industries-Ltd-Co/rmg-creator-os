# Phase B — Governance Primitives: Design

**Status:** **ratified** 2026-09-09 (§14). **No implementation yet** — Phase B1 only is authorized next (§16).
**Governing contract:** `rmg-piaar-system` [contract 36 — Approval Authority and Founder Identity](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/blob/main/contracts/36-approval-authority-and-founder-identity.md) (ratified 2026-09-09, `ed4ffbd`).
**Related:** contract 31 (Accord / HVN Pipeline MCP), contract 26 (PIAAR MCP), contract 29 (autonomy `L0–L4`).
**Baseline:** `main` at `b9cd956` — Phase A + A.1, live in production.

---

## 1. Executive recommendation

**Split Phase B in two, because one half is unblocked and the other is not.**

The reason is a fact found during this design pass and not previously recorded:

> **`hvnglobalco-com` has no server surface at all.** `src/app` contains pages and nothing
> else — no `api/` directory, no route handlers, no authentication, no agent endpoint. The
> domain that contract 36 makes the *approval authority* currently cannot authenticate anyone,
> and cannot sign anything.

Meanwhile the opposite is true in Creator OS, and is also unrecorded:

> **Creator OS already authenticates a human founder on every request.** `/auth/google`
> verifies a Google ID token, checks it against the allowlist, and sets `rmg_sess` to *the
> verified email itself*, signed. The `onRequest` guard unsigns it and re-checks the allowlist
> on every guarded route. A signed, allowlisted human identity is present at the moment
> `PATCH /productions/:id/approvals` executes — **and is thrown away.**

So:

| | Scope | Blocked on |
|---|---|---|
| **B1 — Attributed approval evidence** | Gates Creator OS *itself* owns: the per-brand My Poster delivery gate | Nothing. The human identity already exists; it is simply not recorded. |
| **B2 — Accord approval transport** | Gates the *HVN domain* owns, per contract 36 clause 1 | `hvnglobalco-com` gaining its first authenticated server surface. |

B1 delivers real contract-36-shaped evidence — principal, role, revision digest, decision,
timestamp, notes, provenance — for a gate that is live in production today and currently records
none of it, and adds **step-up authentication** so a founder approval proves the founder was
present, not merely that someone signed in this month (§7.1). B2 designs the transport and waits.

Recommended human-principal model: **per-domain human principals** (`rahm@business`), a new
principal *kind*, not a new identity shape. Recommended transport: **a signed domain assertion
carried over an authenticated fabric call**, so that "the founder decided", "the domain
transmitted", and "Creator OS recorded" are three separately verifiable facts.

---

## 2. Current-state constraints

Every item below was verified against the repositories at the SHAs named, not recalled.

### 2.1 Creator OS has no actor model at all

`packages/db/src/schema.ts` (`b9cd956`) declares 14 tables. **None** is a user, actor,
principal, session, or audit table. There is no place to put "who did this."

### 2.2 The existing approval gate stores a string in a map

```ts
// productions
deliveryApprovals: jsonb('delivery_approvals').$type<Record<string, string>>().default({})
```

`PATCH /productions/:id/approvals` (`apps/gateway/src/routes/delivery.ts:152`) reads the map,
sets one key, writes it back. **No attribution, no revision binding, no history, last write
wins, and the previous value is destroyed.** Phase A made this map *enforced* on publish; it
did not make it *evidence*. Measured against contract 36 clause 5, it carries one of seven
required fields — the decision — and even that is unqualified.

This is the single largest gap between what production does today and what contract 36 requires.

### 2.3 …but the identity it needs is already in the request

```ts
reply.setCookie(SESSION_COOKIE, t.email.toLowerCase(), { signed: true, httpOnly: true, ... })
```

and on every guarded request:

```ts
const un = raw ? request.unsignCookie(raw) : null;
if (!un?.valid || !isEmailAllowed(un.value, ALLOWED_EMAILS)) return reply.code(401)...
```

`un.value` is a verified, allowlisted human email. B1 is therefore not "build authentication";
it is "stop discarding the authentication you already performed."

### 2.4 The fabric cannot express a human

```ts
export type SystemKind = "agent" | "processor" | "domain-service";   // packages/contracts-client
export type PrincipalId = string;                                     // `<systemId>@<domain>`
```

`registry/piaar-systems.schema.json` enumerates the same three kinds. There is no `human`,
`person`, or `user`. Contract 36 clause 3 requires the fabric to *distinguish* human founder
authority from machine principals; today its type system cannot represent the distinction. This
is a schema change to the canonical registry, and therefore a governed change.

Also binding: *"Never introduce a single identity that spans domains"* (`rmg-piaar-mcps`
`CLAUDE.md`). This constrains §7 directly.

### 2.5 The approval domain has no server

`hvnglobalco-com` at `ce294d7`: `src/app` is pages, `src/components` is components. No `api/`.
Compare `hvnhavenry-com`, which does have `src/lib/agentAuth.ts` and `POST /api/agent` with a
constant-time key check. HVN Global has neither. B2 cannot ship until it does.

### 2.6 Contract 26 still blocks MCP writes

The Phase 1 ledger marks write capability **🔒 BLOCKED** behind four live items, and states that
clearing them *"is still not the same as deciding to enable writes."* Any transport that reaches
Creator OS *through the fabric* inherits that gate. B2's design must therefore also work when the
fabric is read-only — see §8.3.

### 2.7 The job status enum has no pause

```ts
productionJobStatus = ['queued','running','done','failed','cancelled']
```

No `awaiting_approval`. A gated job today can only be left `queued` (and therefore claimable) or
`cancelled` (and therefore lost).

### 2.8 The work item is video-shaped

`production_jobs.productionId` is `NOT NULL` → `productions.id`, `ON DELETE CASCADE`. And
`productions` is unambiguously a video: `scriptText`, `taggedScript`, `voiceId`, `stabilityMode`,
`brollScenes`, `higgsfieldScenes`, `finalVideoId`, `adIndexCode`. An Accord article has none of
these and needs a parent that is not this.

### 2.9 What Phase A already gives Phase B for free

Worth stating, because it removes work from this phase: the atomic claim, the lease, stale-job
recovery, idempotency, conditional cancellation, and a fail-closed machine credential are all
live. Phase B adds governance on top of a queue that is already concurrency-safe.

---

## 3. Data model

Four new tables and two additive column changes. Migration **`0023_governance_primitives.sql`**
(next free; `0022` is the Phase A migration).

### 3.1 `principal_kind` — a shared vocabulary, not an identity store

```sql
CREATE TYPE principal_kind AS ENUM ('human','agent','processor','domain-service');
```

The three machine values mirror the registry's `SystemKind` exactly, so Creator OS and the fabric
name the same things the same way. `human` is the addition contract 36 clause 3 requires.

**Creator OS records WHO acted. The fabric decides WHETHER they were authorized.** Creator OS
therefore stores `principal_id` as **opaque text** and never resolves, validates, or grants on it.
It is a label on a record, not a credential.

### 3.2 `approval_evidence` — append-only

```sql
CREATE TABLE approval_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- what was decided about
  subject_type      text NOT NULL,          -- 'production' | 'accord_package'
  subject_id        text NOT NULL,
  scope             text NOT NULL,          -- brand slug for the delivery gate; '*' when whole-subject
  revision_digest   text NOT NULL,          -- digest of the approval-relevant content (§3.5)

  -- the decision
  decision          text NOT NULL,          -- approved | approved_with_note | rejected | revision_required
  notes             text,                   -- REQUIRED when decision = 'approved_with_note'

  -- who decided, and under what authority
  principal_id      text NOT NULL,          -- opaque: 'rahm@business', or an allowlisted email
  principal_kind    principal_kind NOT NULL,
  asserted_role     text NOT NULL,          -- 'founder'
  source_system     text NOT NULL,          -- 'rmg-creator-os' | 'hvnglobalco-com'
  authorization_ref text,                   -- signature id / fabric request id — the pointer to proof

  -- the exact outbound package this decision authorizes (§3.5); the digest covers it
  approved_package  jsonb,

  -- B2 assertion binding (NULL for decisions made inside Creator OS)
  signing_key_id    text,                   -- which domain key signed it; revocation is checked at read
  assertion_id      text,                   -- the single-use assertion/nonce

  -- lineage
  provenance        jsonb NOT NULL DEFAULT '{}',
  superseded_at     timestamptz,            -- set FIRST when superseding (see below)
  superseded_by     uuid REFERENCES approval_evidence(id),
  recorded_at       timestamptz NOT NULL DEFAULT now(),

  -- a noted approval without a note is not a noted approval
  -- Both halves are load-bearing. `btrim()` strips spaces only, so a lone tab or newline passed
  -- the round-1 check; but `notes ~ '...'` is NULL when notes is NULL, and Postgres ACCEPTS a
  -- CHECK evaluating to NULL — so the round-2 fix for the whitespace hole silently reopened the
  -- missing-note hole it replaced. An explicit NOT NULL test is required alongside it.
  CONSTRAINT note_required_for_noted_approval
    CHECK (decision <> 'approved_with_note'
           OR (notes IS NOT NULL AND notes ~ '[^[:space:]]'))
);

-- exactly one live decision per (subject, scope)
CREATE UNIQUE INDEX approval_evidence_live
  ON approval_evidence (subject_type, subject_id, scope)
  WHERE superseded_at IS NULL;

-- replay protection, enforced by the database rather than by an application existence check
CREATE UNIQUE INDEX approval_evidence_assertion
  ON approval_evidence (signing_key_id, assertion_id)
  WHERE assertion_id IS NOT NULL;

CREATE INDEX approval_evidence_subject
  ON approval_evidence (subject_type, subject_id);
```

#### `signing_keys` — the fact revocation needs

Recording `signing_key_id` is useless without something to join it to. A fourth table, small and
owned by B2 but modelled here so the gate predicate is satisfiable:

```sql
CREATE TYPE signing_key_status AS ENUM ('active','revoked');

CREATE TABLE signing_keys (
  key_id       text PRIMARY KEY,
  domain       text NOT NULL,          -- 'hvnglobalco-com'
  public_key   text NOT NULL,
  status       signing_key_status NOT NULL DEFAULT 'active',
  activated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  CONSTRAINT revoked_has_timestamp
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
```

**Revocation is one-way, and enforced.** A `text` column with a comment permits both a
misspelling — which would fail the `status = 'revoked'` test and silently leave compromised
evidence authoritative — and an `UPDATE … SET status = 'active'` that *un-revokes* a leaked key.
Either turns forged evidence back into good evidence. Hence an enum, and a trigger with the same
monotonic shape as `approval_evidence`: `key_id` and `public_key` are immutable, and `status` may
move `active → revoked` and never back.

Evidence carrying a `signing_key_id` whose row is `revoked` is **not live evidence**, whatever
its digest says. Rotation inserts a new key and marks the old one revoked; nothing is deleted, so
history stays readable.

#### Supersession — a sequence that actually commits

An earlier revision said "insert the new row and point the old one at it, in one transaction."
**That sequence cannot commit**, in either order, and the review caught it:

- insert first → two rows with `superseded_by IS NULL` → the partial unique index fires
  immediately;
- update first → `superseded_by` names a row that does not exist yet → the foreign key fires.

Postgres cannot defer a *partial unique index* (only unique **constraints** are deferrable, and
those cannot be partial), so "make it deferred" is not available either. Hence the split into two
columns, and this order inside one transaction:

1. `UPDATE old SET superseded_at = now()` — the row leaves the partial index immediately, so the
   liveness slot is free;
2. `INSERT new` — takes the slot;
3. `UPDATE old SET superseded_by = <new id>` — the FK target now exists.

Liveness is governed by `superseded_at`; `superseded_by` is the pointer, written last. Steps 1–3
are one transaction, so a reader sees either the old decision or the new one and never both or
neither.

#### Immutability, enforced rather than asserted

An earlier revision claimed rows are "never updated except to set `superseded_by`." Nothing
enforced that: the gateway's database role could `UPDATE` a decision, principal or digest in
place, or `DELETE` the row, and destroy the audit property this phase exists to add.

Enforce it:

```sql
CREATE FUNCTION approval_evidence_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval_evidence is append-only';
  END IF;
  IF (to_jsonb(NEW) - 'superseded_at' - 'superseded_by')
     IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by') THEN
    RAISE EXCEPTION 'approval_evidence: only supersession fields may change';
  END IF;
  -- supersession is monotonic: superseded_at fills once and never clears; superseded_by fills
  -- once, only after superseded_at is set, and never changes.
  IF OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at THEN
    RAISE EXCEPTION 'approval_evidence: superseded_at is immutable once set';
  END IF;
  IF NEW.superseded_at IS NULL AND NEW.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'approval_evidence: superseded_by requires superseded_at';
  END IF;
  IF OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
    RAISE EXCEPTION 'approval_evidence: superseded_by is immutable once set';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER approval_evidence_append_only
  BEFORE UPDATE OR DELETE ON approval_evidence
  FOR EACH ROW EXECUTE FUNCTION approval_evidence_immutable();
```

A trigger rather than role permissions because the gateway needs `UPDATE` for step 1 and 3 above;
revoking it wholesale would break supersession. The trigger permits exactly the two columns the
sequence needs and refuses everything else, including every `DELETE`.

**Monotonicity, not just one-timeness — second review round.** An earlier version checked only
"were both fields already set?", which permitted a second update to *clear* `superseded_at` while
setting `superseded_by`: the old pointer was null, so the check passed, and **the superseded row
became live again.** A fresh row could likewise set `superseded_by` alone and then rewrite it
indefinitely. The rules above constrain each `OLD → NEW` pair directly, which is what "one-time"
actually requires.

`workflow_transitions` gets the same treatment — `BEFORE UPDATE OR DELETE … RAISE`, with no
permitted mutation at all, since nothing about a recorded transition ever legitimately changes.
Calling a table append-only and leaving the gateway role able to rewrite it is the same gap this
section just closed for evidence.

`principal_kind = 'human'` is required for any row whose `asserted_role = 'founder'`. Enforce it
as a `CHECK`, not only as application logic, so no future write path can forget:

```sql
ALTER TABLE approval_evidence ADD CONSTRAINT founder_is_human
  CHECK (asserted_role <> 'founder' OR principal_kind = 'human');
```

**Corrected on founder review (ratified decision 7).** An earlier revision of this document
called this constraint "contract 36 clause 4 and clause 7 expressed where they cannot be argued
with." **That overstated it, and the overstatement was the dangerous kind — it described a
consistency check as if it were an authorization control.**

`principal_kind` is a *value the writer supplies*. A buggy or malicious caller can label itself
`'human'` and satisfy the constraint. What the check actually buys is narrow and worth having:
an obviously impossible combination — a row asserting founder authority while admitting it came
from a machine — can never be stored, by any code path, present or future.

**Authorization lives upstream, in the fabric and domain boundary**, and nowhere else:

| Layer | Answers | Trust |
|---|---|---|
| Fabric / domain (`rmg-piaar-mcps`, `hvnglobalco-com`) | *May this caller assert founder authority?* | **The authorization decision** |
| Creator OS write path | *Was that authority proven to me before I wrote?* | Enforcement point |
| `CHECK` constraint | *Is this row internally coherent?* | Defense in depth only |

Read bottom-up, the constraint catches a mistake. Read top-down, it decides nothing. Any design
that starts relying on it as the gate has already lost the property contract 36 exists to
protect.

### 3.3 `workflow_transitions` — attributed, append-only

```sql
CREATE TABLE workflow_transitions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type           text NOT NULL,
  subject_id             text NOT NULL,
  from_state             text,               -- NULL for creation
  to_state               text NOT NULL,
  requested_by           text NOT NULL,      -- opaque principal id
  requested_by_kind      principal_kind NOT NULL,
  asserted_role          text,               -- role claimed for THIS action
  source_system          text NOT NULL,      -- where the action came from
  auth_context           jsonb NOT NULL DEFAULT '{}',  -- session id, auth_age_seconds, request id
  authorized_by_evidence uuid REFERENCES approval_evidence(id),
  reason                 text,
  occurred_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_transitions_subject ON workflow_transitions (subject_type, subject_id, occurred_at);
```

**Authority context lives on the row, not only on a linked evidence record.** Creation, operator
cancellation and timeout handling have no `authorized_by_evidence` to point at, so with only a
principal id and kind they could not satisfy Phase B's requirement to attribute a consequential
action with its role and authority context. `asserted_role`, `source_system` and `auth_context`
are therefore columns on every transition. An optional foreign key cannot carry a mandatory
property.

**The state change and its transition row commit together, or neither does.** Because state lives
on the subject row and this table only records it, two writes exist — and nothing previously
required them to share a transaction. If the state update commits alone, a consequential
transition has no attribution; if the insert commits alone, history claims something that never
happened. Both are audit failures, in opposite directions. One transaction, always.

Deliberately **not** event sourcing: state still lives on the row it describes, and this table is
a record of *how it got there*. Nothing reads it to reconstruct state. The directive's "unless
demonstrably required" test is not met, and adopting event sourcing to get attribution would be
paying for a cathedral to hang a lock on a door.

### 3.4 `work_items` — the smallest article-capable parent

```sql
CREATE TABLE work_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,        -- 'video' | 'accord_article'
  brand       text NOT NULL,
  title       text,
  state       text NOT NULL DEFAULT 'active',
  external_ref text,                -- the domain's own id, e.g. the Accord article slug
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE production_jobs ADD COLUMN work_item_id uuid REFERENCES work_items(id) ON DELETE CASCADE;
ALTER TABLE production_jobs ALTER COLUMN production_id DROP NOT NULL;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_one_parent
  CHECK (num_nonnulls(production_id, work_item_id) = 1);
```

Why this shape rather than the alternatives:

| Option | Verdict |
|---|---|
| Generalise `productions` to hold articles | Rejected. It carries ~20 video-only columns; an article row would be almost entirely NULL, and every video code path would have to start asking "is this actually a video?" |
| Shell `productions` row per article | Rejected. Fabricating a fake video to hang an article off it is the kind of shortcut that is never removed. |
| Parent above `productions`, jobs reach through it | Rejected. Requires a join on the hot claim path Phase A just made atomic. |
| **Sibling parent, jobs point at exactly one** | **Recommended.** Existing rows keep `production_id`; the claim query is untouched; video behaviour is bit-identical. |

Dropping `NOT NULL` is a relaxation: every existing row already satisfies the new `CHECK`, and no
data is rewritten.

**The column alone does not make an article-capable queue.** `enqueueJob`'s input requires a
non-null `productionId` and has no `workItemId`; its insert always populates `production_id`. So
without a matching change to the enqueue contract and the queue API, **no Accord job could
satisfy the one-parent CHECK without fabricating the video production this design rejects** —
the shortcut §3.4 exists to avoid, reintroduced through the back door. The enqueue surface,
its one-parent validation, and the `/queue` filters that currently accept only `production_id`
are part of the work-item work, not a follow-on to it.

### 3.5 `revision_digest` — what exactly is hashed

A digest over the **approval-relevant projection** of the subject, not the whole row — otherwise
`updated_at` invalidates approvals.

- `production`: `brand`, `thumbnailDriveId`, `adIndexCode`, `taggedScript`, **the exact video row
  publish will send**, and **the complete outbound post package** — per-platform captions and
  hashtags from `posts`, plus the target platforms, publish type and date.

> **Defect this exposes, confirmed in live code.** `POST /productions/:id/publish` does **not**
> read `productions.finalVideoId`. It queries `videos` for this production and picks
> `source = 'final'` → else `approved` → else *any* completed row, newest `updatedAt` first. A
> digest over `finalVideoId` would therefore bind nothing: insert another completed render after
> approval and publish sends that one, unapproved, with the digest still matching.
>
> **B1 must close this**, and there are only two honest ways: make publish use a pinned asset,
> or compute the digest over the same selection expression publish uses.
> **Recommended: pin.** A selection rule that can silently change its answer after a human said
> yes is the same defect class as the approval map Phase A had to enforce.

> **But `finalVideoId` cannot be that pin as it stands** — second review round, confirmed in
> code. `routes/delivery.ts:236` sets `productions.finalVideoId` to the **Drive file id**, while
> the `videos` row it just created has a random `videos.id`; and `server.ts:1816-1834` creates
> assembled final cuts **without setting `finalVideoId` at all**. Pinning to it would resolve
> uploaded cuts by the wrong key and leave assembled cuts unpublishable. **Defining one pin with
> consistent semantics, and populating it from both producers, is a prerequisite** — see §3.6.

> **And the package has to exist when the approval is made.** `platforms`, `type` and `date` are
> not properties of the production at all — `PATCH /productions/:id/approvals` accepts only
> `brand` and `state`, and publish receives those three in *its own request body*, later. So a
> digest "covering the outbound package" is unsatisfiable as stated: at approval time two of
> the four inputs do not exist anywhere to be hashed.
>
> **B1 therefore changes the approval action, not only the digest.** Approving captures the
> complete outbound package — per-platform caption and hashtags, target platforms, publish type
> and date — and stores it as `approval_evidence.approved_package jsonb`, which the digest
> covers. Publish then **sends that stored package** and ignores request-supplied platforms,
> type and date for an approved production. Approving a post whose destination and timing are
> still undecided is not approving a post; making the founder choose them at the gate is the
> point, not a side effect.

> **The captions half matters as much as the video.** `server.ts:2238-2271` reads captions and
> hashtags from `posts` and takes `platforms`, `type` and `date` from the *request body*. After
> approval, any allowlisted user can rewrite the caption, add a platform, or flip a draft to
> publish-now — and none of it touches the digest. The evidence would still authorize a
> materially different post than the one that goes out. The digest covers a canonical snapshot
> of the whole outbound package, and publish sends the snapshot rather than re-reading mutable
> rows and trusting the request.
- `accord_package`: the package manifest digest supplied by the domain (contract 31 already
  requires a content-addressed revision, so Creator OS should *carry* that digest, not compute
  a second one).

The projection is defined in one pure function per subject type, unit-tested, and versioned —
`digest_v1:<sha256>` — so a later change to what counts as approval-relevant is visible rather
than silently re-validating old evidence.

### 3.6 Two prerequisites B1 inherits, both larger than a schema change

Found in the second review round, both confirmed in live code. Neither is a defect in this
design; both are properties of the existing system that the approval binding this design
promises **cannot be built on top of without changing first.** They are stated here rather than
discovered during implementation.

#### (a) The queue is not the spend boundary for A-Roll

§4.1 pauses gated work by inserting the job as `awaiting_approval`, on the premise that the paid
provider call happens at dispatch. **For A-Roll it does not.** `server.ts:1935-1964` calls
`client.generateVideo` — the paid HeyGen render — at the route, and only then calls
`enqueueJob`. The code says so itself:

> `// One queue row per video row. The paid HeyGen call already happened above, so this …`

So a gate over `production_jobs` cannot stop A-Roll spend. The job row is a tracking record of
money already committed. Pausing it pauses nothing that costs anything.

Two ways to fix it, and the choice is a scoping decision:

| Option | Cost | Consequence |
|---|---|---|
| **Move the provider call behind worker dispatch** | Restructures a live A-Roll route | The queue becomes the real spend boundary, and every future gate works uniformly. Touches the path Phase A was written to protect |
| **Evaluate and enforce the gate at the route**, before any provider call | Smaller, local | Two gate mechanisms to keep consistent; a later capability that spends at the route must remember to add one |

**Recommended: move the call behind dispatch**, because the alternative distributes the gate
across every route that might ever spend, and a gate you have to remember to add is one that
eventually is not added. But this is real work on a live path and should be confirmed, not
assumed, before B1 starts.

#### (b) There is no consistent "the approved video" pointer

As §3.5 records, `finalVideoId` holds a Drive file id from one producer and is never set by the
other. Before approval can bind an asset, B1 needs one pin with one meaning — most plainly a
`final_video_row_id` referencing `videos.id`, populated by **both** the upload path and the
assembly path, with publish reading it instead of re-deriving a winner by `updatedAt`.

Both prerequisites are B1's, and both are additions to the scope estimated in §13.

---

## 4. State transitions

### 4.1 `awaiting_approval`

```sql
ALTER TYPE production_job_status ADD VALUE 'awaiting_approval';
```

**This is safe against Phase A's live code by construction, not by care:** `claimNextJob` matches
`status = 'queued'`, and `recoverStaleJobs` matches `status = 'running'`. A new enum value is
invisible to both. A paused job cannot be claimed and cannot be recovered — which is exactly what
"paused" should mean.

| Transition | Who may | Condition |
|---|---|---|
| **insert directly as `awaiting_approval`** | enqueue | a gate applies — see below |
| `queued → awaiting_approval` | **the stale-gate sweep only** | a gated job whose gate no longer holds (below); never a general path |
| `running → awaiting_approval` | **nobody** | a running job holds a lease and may have paid work in flight; pause it and the external side effect still lands with nothing tracking it |
| `awaiting_approval → queued` | evidence presentation | live evidence for the subject with **`decision ∈ {approved, approved_with_note}`** AND **`revision_digest` = current digest** |
| `awaiting_approval → cancelled` | authorized principal, or timeout | attributed transition; `gate_origin` preserved (below) |
| `awaiting_approval → failed` | **never automatically** | — |
| `awaiting_approval → done` | **nobody** | a gate must never be able to complete work |

Three corrections from review, each closing a hole a worker or an operator could have walked
through:

**A gated job is never `queued`, even briefly.** The original design inserted it as `queued` and
transitioned it afterwards. `claimNextJob` runs `FOR UPDATE SKIP LOCKED` against exactly that
status, so a worker could claim and dispatch **paid work** in the window between the insert and
the pause. Gated jobs are therefore **inserted directly in `awaiting_approval`** — the gate is
evaluated in the same transaction that makes the row visible, so the runnable state never exists.
There is consequently no `queued → awaiting_approval` transition at all.

**Resuming requires an *approving* verdict, not merely evidence.** §5 stores rejections as live
evidence deliberately — a rejection nobody can find is how the same package gets resubmitted. But
the original resume condition said only "live, digest-matching evidence", which a live `rejected`
row satisfies. That would have returned **rejected work to the queue and paid to process it.**
The predicate now requires `decision ∈ {approved, approved_with_note}`.

**A resumed job re-validates the whole gate at claim — not just the digest.** Digest comparison
fails closed only *while* resuming. Once the job is `queued`, the world can move: the content can
change, **the founder can withdraw or reject the approval**, or the signing key can be revoked —
none of which alters the subject digest. An earlier revision re-checked only
`approved_revision_digest`, which would have let a withdrawn approval dispatch. Claim-time
validation therefore requires, atomically, all four:

1. live evidence for the subject exists, and is **not** superseded;
2. its `decision` is approving;
3. its `signing_key_id` (if any) is not revoked;
4. its `revision_digest` equals the subject's current digest.

**And the failure path needed a legal transition, which it did not have.** The same revision
promised to "return the job to `awaiting_approval`", while the table above forbids both
`queued → awaiting_approval` and `running → awaiting_approval` — and the claim statement sets
`running` before anything could inspect the gate. That was a contradiction, not a policy.

Resolved by making the gate part of the claim predicate rather than a check after it: a job whose
`gate_origin` is set is claimable **only** while the four conditions hold, so a stale-gated job is
simply never claimed — it stays `queued` and invisible to workers, exactly as an unsatisfied
`WHERE` clause should behave. A separate sweep (the same shape as `recoverStaleJobs`) moves such
jobs back to `awaiting_approval` **from `queued`**, and that transition is legal *only* for the
sweep and *only* when the gate is unsatisfied. It is added to the table below as such: narrowly
permitted, never a general path.

**Non-approving verdicts move the job, rather than leaving it waiting for ever.** A live
`rejected` or `revision_required` decision matched no transition at all, so a job would sit in
`awaiting_approval` and keep being reported as waiting after the founder had already decided —
which fails the Phase B acceptance condition that rejection and revision have an explicit path
(`master-atelier-agentic-production-plan.md:236-242`). Committed **with the evidence write**, in
one transaction:

| Verdict | Job goes to |
|---|---|
| `rejected` | `cancelled`, `gate_origin` preserved so retry still refuses |
| `revision_required` | `cancelled`, same — the revised work is a new job against a new revision |
| `withdrawn` | stays `awaiting_approval`; the decision was un-made, not made |

**Who may request approval:** any principal, human or machine. Requesting is not deciding
(clause 7). **What is required to resume:** live, *approving*, digest-matching evidence — nothing
else, and notably not "an operator clicked resume".

**Timeout and escalation.** A timeout may *notify* and may *expire to `cancelled`*. It may
**never** transition to `queued`.

> **And the back door out of that, also from review.** `POST /queue/:id/retry` accepts **any**
> `cancelled` job and sets it straight to `queued`. A gated job timed out to `cancelled` could
> therefore be released by an ordinary operator retry, with no evidence consulted — exactly the
> outcome the timeout rule forbids, reached by a different door. Jobs therefore carry
> `gate_origin` (the gate that paused them), which survives cancellation, and **retry refuses a
> job with `gate_origin` unless live approving, digest-matching evidence exists.**
>
> **A second, pre-existing defect in that same route, which is mine.** `retry` reads the job,
> checks its status, then updates **by id alone with no status predicate** — the identical
> read-then-write race I fixed in `cancelJob` during Phase A while leaving this one untouched. A
> retry racing a completing worker can reset a `done` job to `queued`; a retry racing a claim can
> re-queue a job a worker is holding, dispatching paid work twice. It is live in production
> today. It is not caused by Phase B, and it should be fixed as a small conditional-update change
> in the same shape as `cancelJob` — reported separately rather than folded in here.

### 4.2 `approved_with_note` operationally

Contract 31 defines it as approval that advances on the approved path, with a mandatory note that
blocks `PUBLICATION_READY` until discharged. In Creator OS terms:

- it satisfies the resume condition in §4.1 (work proceeds);
- it does **not** satisfy the publish gate until every note is discharged;
- discharge is itself `approval_evidence` — `decision = 'approved'` superseding the noted row, or
  an explicit founder-attributed waiver. Never a flag someone clears.

The note itself is protected, not merely required: §3.2's `note_required_for_noted_approval`
CHECK rejects a blank one, and §8.2's assertion signs `notes`, so a transporter cannot strip or
rewrite an obligation and still verify.

### 4.2a Withdrawal — what `pending` means now

The dashboard already sends `pending` when an operator toggles an approved or rejected decision
off, and B1 keeps that UI working by dual-writing. But the evidence model enumerated no
`pending`, so the map could read "pending" while live `approved` evidence still satisfied the
publish gate — **the UI showing a revoked approval over a gate that still opens.**

`withdrawn` is therefore a decision value. Setting the map to `pending` supersedes the live
evidence with a `withdrawn` row **in the same transaction as the map update**, so the two can
never disagree. `withdrawn` is non-approving: it does not satisfy the resume predicate or the
publish gate.

### 4.3 The publish gate, after B1

`checkDeliveryApproval(brand, approvals)` becomes `checkDeliveryApproval(subject, evidence, currentDigest)`:

1. live evidence exists for `(production, id, brand)`; else fail closed;
2. `decision ∈ {approved, approved_with_note}`; else fail closed;
3. `evidence.revision_digest === currentDigest`; else fail closed with `approval_stale`;
4. if `approved_with_note`, all notes discharged; else fail closed.

Its purity and its 12 unit tests survive; the signature widens.

---

## 5. Approval evidence model — the rules that matter

**Uniqueness.** One live row per `(subject_type, subject_id, scope)`, by partial unique index.
Concurrent approvals collide at the database rather than interleaving — the same technique Phase A
used for idempotency keys, and the reason that one worked.

**Supersession.** New decision inserts, old row's `superseded_by` is set, both in one
transaction. History is complete and immutable.

**Invalidation is by comparison, not by cascade.** The read path compares the stored digest with
the subject's current digest and refuses on mismatch. A cascade — triggers or application code
invalidating evidence whenever content changes — requires *every* mutation path, present and
future, to remember. Comparison requires nothing to remember, and a path that forgets fails
**closed** rather than open. That asymmetry is the whole argument.

**Rejection is evidence too.** `rejected` and `revision_required` are stored identically. A
rejection nobody can find is how the same package gets resubmitted unchanged.

---

## 6. Human-principal options compared

| | Security boundary | Impersonation risk | Revocation | Auditability | Fabric fit | Creator OS fit | HVN fit | Complexity | Delegation later |
|---|---|---|---|---|---|---|---|---|---|
| **1. Per-domain human principals** (`rahm@business`) | Strong — matches the existing domain boundary | Low: one credential per domain | Per domain, independently | Principal id names domain and person | **Native** — same `<id>@<domain>` shape, needs only a new `kind` | Maps onto the session email | Needs a server (§2.5) | Moderate | Clean: new principal, same kind |
| **2. One human identity, domain-scoped grants** | Weaker — one credential reaches both domains | Higher: a single phish crosses the personal boundary | All-or-nothing per grant | Simple | **Violates** *"never introduce a single identity that spans domains"* | Same | Same | Low | Clean |
| **3. Signed assertion from an authenticated domain UI** | Strong for the *act*; says nothing about the *identity* | Low if keys are held server-side only | Rotate the signing key | Excellent — the assertion is the evidence | Needs a verifier, not a principal | Needs verification code | **Needs a server** | Moderate | Independent of it |
| **4. Reuse an existing company mechanism** | Google Workspace SSO already backs Creator OS sign-in and the allowlist | Low | Google admin | Good | No fabric integration today | **Already in place** | Would be new there | Lowest for Creator OS | Google groups |

**These are not mutually exclusive, and treating them as a single choice is the trap.** Options 1,
2 and 4 answer *"who is the principal?"* Option 3 answers *"how does a decision travel without a
machine being able to forge it?"* A complete design needs one answer from each column.

---

## 7. Recommended founder authentication model

**Option 1 + Option 4: per-domain human principals, backed by Google Workspace SSO.**

- **Per-domain**, because `rmg-piaar-mcps` states plainly that no identity may span domains, and
  that rule protects *more* here, not less: a human credential is the likeliest thing in the
  system to be phished, and the personal domain is the one holding health data. The domain split
  is a blast-radius boundary, not a claim about personhood. Rahm is one person; `rahm@business`
  and `rahm@personal` are two capabilities that person holds.
- **Backed by Google Workspace SSO**, because it is already the authenticator of record for
  Creator OS, already enforces the allowlist, and introduces no new credential store, no new
  password, and no new thing to rotate. Option 2's simplicity is real but it buys it by breaking
  a standing constraint; option 4 alone leaves the fabric with no notion of the principal at all.

**What this requires, stated as work rather than assumed:**

1. `SystemKind` in the canonical registry gains a companion `PrincipalKind` including `human`, or
   the registry gains a separate `people` collection. **This is a governed change to
   `rmg-piaar-system/registry/`, mirrored into `rmg-piaar-mcps` — not an implementation detail.**
2. `packages/identity` learns to construct and resolve a human principal.
3. `packages/authz` gains grants for it, default-deny preserved.
4. Creator OS records `un.value` (the verified email) as `principal_id` with
   `principal_kind = 'human'`, **plus a proof of recent authentication** — see §7.1.

**Explicitly not recommended:** minting a machine credential for the founder as a stopgap.
Contract 36's interim rule forbids it, and it is the design that ships permanently.

### 7.1 Step-up authentication for approval actions (ratified decision 2)

A 30-day session is adequate proof that *someone signed in this month*. It is not adequate proof
that **the founder is at the keyboard right now**, and a final creative approval needs the
second claim, not the first.

**Ratified:** ordinary session authentication is unchanged; a founder approval additionally
requires a **fresh authentication within a 15-minute step-up window**, with explicit
re-authentication before a final approval.

**The obstacle, stated plainly:** freshness cannot be derived from the current session, because
`rmg_sess` carries only the email — no issued-at, no authentication time. There is nothing in
the cookie to age.

**Design.** A second, separate credential, minted only by a fresh sign-in:

- The client requests a **deliberately fresh authentication** — OIDC `max_age=900` (and
  `prompt=login` where the provider honours it), which asks the issuer to re-authenticate the
  user rather than mint a token from an existing session.
- `POST /auth/google/step-up` accepts the resulting ID token, verifies it exactly as
  `/auth/google` does (audience, `email_verified`, allowlist), **and validates the `auth_time`
  claim — the time the user actually authenticated — is within `STEP_UP_MAX_AGE_SECONDS`
  (default 900).**

> **Corrected, second review round.** An earlier revision checked `iat`. **`iat` is when the
> token was issued, not when the user authenticated.** Google will happily mint a token with a
> fresh `iat` from a browser session established weeks ago, without prompting for anything — so
> the check would have passed while proving nothing about presence, which is the entire point of
> step-up. `auth_time` is the claim that carries the fact, and `max_age` is what makes the
> issuer produce and honour it. A token lacking `auth_time` is **refused**, not accepted with a
> fallback to `iat`.
- On success it issues `rmg_stepup` — signed, `httpOnly`, `secure`, `sameSite: 'lax'`,
  `maxAge` 900 — carrying **the verified email**, the step-up id, and the authentication instant.
  The email is in the signed value deliberately: the next rule refuses a credential belonging to
  a different session, and with only an id there is nothing to compare, since B1 adds no
  server-side step-up store.

  **Signed with its own key, `STEP_UP_COOKIE_SECRET` — not `COOKIE_SECRET`.** Second review
  round, and the point is sharp: if step-up were signed with the session secret, then the single
  scenario where forgery matters — that secret compromised — would let an attacker mint *both* a
  session and a matching fresh step-up. The mitigation would close stolen-session replay while
  leaving forged-session untouched, which is the case failure 11 actually names. A second,
  independently rotatable key makes the two credentials independent proofs. It fails closed if
  unset in production, exactly as `assertCookieSecret` already does for the session key.
- Approval write paths require a valid, unexpired `rmg_stepup` **in addition to** the session.
  Absent, expired, or belonging to a different email than the session: **refuse**, with a
  distinct discriminator (`step_up_required`) so the UI can prompt for re-authentication rather
  than showing a generic error.
- The evidence row records the proof: `authorization_ref` = the step-up id, and
  `provenance.auth_age_seconds` = the age of the authentication at the moment of decision.
  **How fresh the authority was is itself part of the evidence**, not a transient the record
  forgets.

**Fails closed in all four directions:** no step-up cookie, expired cookie, unverifiable
signature, or email mismatch against the session all refuse. `STEP_UP_MAX_AGE_SECONDS` unset
falls back to 900 — never to "no limit", which is the fail-open shape Phase A.1 already had to
remove once from `WORKER_SECRET`.

**Scope.** Step-up gates *approval* writes only — recording a founder decision. Reading, listing,
queueing renders and every other authenticated action keep the ordinary session. Requiring
re-authentication for routine work trains people to click through it, which costs more security
than it buys.

**The UI half is not optional, and lands first.** The dashboard calls the approval `PATCH`
directly and never asks for a fresh Google credential. Ship the server check alone and *every*
approval returns `step_up_required` with no way to complete the action. The re-authentication
prompt and retry flow are part of the same step as the endpoint — §13 sequences them together,
ahead of enforcement on writes.

### 7.2 Authorization: the founder is not "anyone allowlisted"

Step-up proves *recent control of an allowlisted identity*. It does **not** prove the founder
role, and `AUTH_ALLOWED_EMAILS` is explicitly a multi-value list the auth model supports adding
people to. As drafted, B1 would have let any allowlisted user's valid session + step-up record
**founder** approval evidence.

This is the same mistake decision 7 corrected, arriving from a different direction: a proof of
*authentication* treated as a proof of *authority*.

So the approval write boundary checks three things, in order, and refuses on any:

1. a valid session on the allowlist — *are you a user here?*
2. a valid, matching, unexpired step-up — *are you here right now?*
3. **the principal is in the founder set** — *may you assert founder authority?*

The founder set is its own configuration, **not** `AUTH_ALLOWED_EMAILS`, and unset means empty —
no founder, refuse — never "everyone".

**It is a mapping, not a set.** Second review round: B1 authenticates a *Google email*, while the
ratified principal is `rahm@business`. A set of principals cannot be membership-tested against an
email, and a set of emails would record evidence under an id the fabric will never recognise —
so the correlation breaks precisely when authorization moves upstream. `FOUNDER_PRINCIPALS` is
therefore `email → canonical principal id` (e.g. `rahm@rmasters.group → rahm@business`).
Membership is "does this authenticated email map?", and **the evidence records the mapped
canonical id**, not the email. When the fabric gains a human principal, this mapping is what it
replaces — and evidence written before the handover still names the right subject. Adding a colleague to the
allowlist must never silently grant approval authority; that is a decision with its own record.

Check 3 is Creator OS enforcing a boundary the fabric will eventually own (§9). Until a human
principal exists in the registry, this local set *is* the founder mapping, and it should be
stated as an interim in the same breath as it is built.

---

## 8. Approval transport (B2)

### 8.1 The three facts that must stay separable

```
  the founder decided        →  a signature only the domain's server can produce,
                                over the decision + subject + revision digest
  the domain transmitted     →  the authenticated caller that delivered it
  Creator OS recorded        →  the approval_evidence row, naming both of the above
```

A machine may carry the assertion. It cannot mint one, because it does not hold the signing key.
That is the property that makes clause 7 enforceable rather than merely stated.

### 8.2 Recommended: signed domain assertion over an authenticated call

The domain signs
`{subject, revision_digest, decision, notes, principal_id, asserted_role, issued_at, key_id, nonce}`.
Creator OS verifies against the domain's published key, then writes evidence with
`source_system = 'hvnglobalco-com'`, `signing_key_id = key_id`, `assertion_id = nonce`, and the
transmitting principal in `provenance`.

`notes` is inside the signature because §4.2 makes a note a binding obligation; unsigned, a
transporter could strip or rewrite it and the signature would still verify.

**Replay is refused by the database, not by a lookup.** `approval_evidence_assertion` is a unique
index on `(signing_key_id, assertion_id)`. Two concurrent deliveries of the same assertion cannot
both pass — one commits, the other violates the index. An application-level "have I seen this
nonce?" check is exactly the read-then-write race Phase A had to remove from the job claim.

**Key revocation reaches existing evidence.** Evidence records the `signing_key_id` that produced
it, and the gate read joins against a key-status table: evidence signed by a revoked key is not
live evidence, whatever its digest says. Without that, "revocation invalidates evidence written
under a leaked key" is a sentence with no mechanism — forged evidence written before revocation
stays authoritative for ever.

Verification failure is not an error to log and continue past — it is a refusal.

### 8.3 Why this survives contract 26's write block

The assertion is a **signed artifact**, not a transport. Creator OS can accept it over the fabric
when fabric writes open, or over a direct authenticated call in the meantime, without the security
property changing. Designing the artifact rather than the pipe is what makes that true — and
avoids Phase B blocking on a contract-26 decision that is not ours to make.

### 8.4 The prerequisite

**B2 cannot begin until `hvnglobalco-com` has an authenticated server surface with a signing key.**

**Authorized on founder review (ratified decision 4), and deliberately narrow:** HVN Global gains
the *minimum* authenticated surface required for the governed approval/evidence path — a founder
approval route and a signing key in Doppler. **It does not become a general API platform.**

**Correction from review, and it matters more than it looks.** An earlier revision said this
route would use "the constant-time auth pattern already used across the fleet." That pattern
authenticates *possession of a shared machine secret*. This route **holds the signing key** — so
a machine credential accepted there could mint an assertion claiming `asserted_role = 'founder'`,
which is contract 36 clause 7 defeated at the point the whole transport exists to protect.

Two different authentications, and they must not be confused:

| Action | Authenticates | Mechanism |
|---|---|---|
| **Minting** an assertion (the founder decides) | a **human** | Google SSO + step-up, the same shape as §7.1 |
| **Transporting** an already-minted assertion | a **machine** | the fleet's constant-time key pattern |

A machine may carry. Only a human may mint. The signing key sits behind the human path. A repository that is pages today
acquires exactly one server capability, for one governed purpose, and each future route is its
own decision rather than a consequence of this one.

Until that exists, per contract 36's interim rule, Accord approvals are made and recorded outside
the automated path — never approximated inside it on a machine credential.

---

## 9. Ownership boundaries

| Concern | Owner | Never |
|---|---|---|
| Is this creative approved? | `hvnglobalco-com` | Creator OS decides it |
| Is this caller who they claim, and permitted? | `rmg-piaar-mcps` | Creator OS grants on `principal_id` |
| What happened, when, on whose authority, and what does the workflow do now? | `rmg-creator-os` | The domain drives workflow state |
| Package/schema validation, brand rules, distinctiveness | Accord MCP (contract 31) | Creator OS reimplements them |

Creator OS storing `principal_id` as opaque text is the mechanical expression of row 2: a value it
can record and display but cannot interpret is a value it cannot accidentally authorize on.

---

## 10. Migration compatibility

- Three new tables — nothing existing reads them.
- One new enum value — invisible to Phase A's claim and recovery queries (§4.1).
- `production_jobs.work_item_id` nullable; `production_id` relaxed to nullable with a `CHECK`
  every existing row already satisfies.
- `productions.deliveryApprovals` is **not dropped.** B1 dual-writes: evidence becomes the source
  of truth for the gate, the map stays as a projection for the existing UI. It is removed in a
  later, separate change once nothing reads it.
- Backfill: existing `approved` entries become evidence rows with
  `principal_kind = 'processor'`, `asserted_role = 'legacy-unattributed'`, and a
  `revision_digest` of `'legacy:unbound'`. **Legacy rows deliberately fail the digest check**, so
  a pre-Phase-B approval cannot silently satisfy a post-Phase-B gate. They are history, not
  authority. Re-approval under the new model is a founder action, and that is the correct cost.
- Rollback: **not simply "drop three tables and two columns."** Once `awaiting_approval` has been
  used, rows carry it. The enum value persisting is harmless; the *rows* are not. Dropping the
  evidence tables removes the only mechanism that could release them, and deploying code that
  does not know the status leaves them unclaimable and unexplained — durably paused work with
  nothing able to resume it, which is the failure durable pause was added to prevent.

  Rollback therefore has a required first step: **every `awaiting_approval` job is explicitly
  migrated or cancelled, with its transition recorded, before the governance schema is removed.**
  A rollback that strands paused work is not a rollback.

---

## 11. Security failure modes

| # | Failure | Mitigation |
|---|---|---|
| 1 | A machine principal writes founder approval | **Authorization at the write boundary** (§7.2): the caller's principal must be in the founder-principal set, proven by session + step-up. The `CHECK` only refuses an *incoherent* row and is **not** the gate — see §3.2 and failure 12. *(An earlier revision named the CHECK as the mitigation here; that row was missed when §3.2 was corrected, and the review caught it.)* |
| 2 | Approval survives a content change | Digest comparison at read time; mismatch fails closed (§5) |
| 3 | A timeout releases gated work | No transition from `awaiting_approval` to `queued` exists except evidence presentation (§4.1) |
| 4 | Replayed assertion re-approves | Single-use nonce, short expiry, recorded (§8.2) |
| 5 | Domain signing key leaks | Key rotation; assertions carry a key id; revocation invalidates evidence written under it |
| 6 | Creator OS grants on a principal id it does not understand | It never grants — the fabric authorizes (§9) |
| 7 | Legacy unattributed approvals inherit new authority | Backfilled with a digest that cannot match (§10) |
| 8 | Two approvals race | Partial unique index on live rows |
| 9 | A stopgap machine credential becomes permanent | Contract 36 interim rule; §7 declines it explicitly |
| 10 | Evidence is edited after the fact | Append-only; only `superseded_by` is ever written |
| 11 | Stolen/forged 30-day session → forged founder approval | **Closed by ratified decision 2:** approval writes additionally require a fresh `rmg_stepup` credential, ≤15 minutes old, verified against Google's `iat` (§7.1). A stolen session alone can no longer approve. `assertCookieSecret` continues to fail closed in production |
| 13 | A rejection resumes gated work | Resume requires `decision ∈ {approved, approved_with_note}`, not merely live evidence (§4.1) |
| 14 | A worker claims a gated job before it is paused | Gated jobs are inserted directly as `awaiting_approval`; the runnable state never exists (§4.1) |
| 15 | Content changes between resume and claim | `approved_revision_digest` on the job, re-compared at dispatch (§4.1) |
| 16 | Timed-out gated work released via `POST /queue/:id/retry` | `gate_origin` survives cancellation; retry refuses without live approving evidence (§4.1) |
| 17 | Any allowlisted user records founder approval | Founder-set check at the write boundary, separate from `AUTH_ALLOWED_EMAILS`, empty by default (§7.2) |
| 18 | A machine credential mints a founder assertion at HVN Global | Minting authenticates a human; machine auth only transports (§8.4) |
| 19 | Evidence edited or deleted in place | Append-only trigger permitting only the two supersession columns (§3.2) |
| 20 | Assertion replayed | Unique index on `(signing_key_id, assertion_id)` (§8.2) |
| 21 | Evidence forged before a key was revoked stays authoritative | `signing_key_id` recorded; gate reads join key status (§8.2) |
| 22 | Approval survives the asset changing under it | Digest binds the video publish actually selects; publish pins `finalVideoId` (§3.5) |
| 23 | UI shows a withdrawn approval over a gate that still opens | `withdrawn` supersedes live evidence in the same transaction as the map write (§4.2a) |
| 24 | A noted approval carries no note, or the note is stripped in transit | CHECK for a non-blank note; `notes` inside the signed assertion (§3.2, §8.2) |
| 25 | Rollback strands paused jobs | Paused work migrated or cancelled before the schema is removed (§10) |
| 26 | Caption, platform or schedule changed after approval | Digest covers the whole outbound package; publish sends the approved snapshot (§3.5) |
| 27 | Paid A-Roll render fires before any gate can pause it | **Open — §3.6(a).** The queue is not the spend boundary for A-Roll; needs the provider call moved behind dispatch, or a route-level gate |
| 28 | Approval withdrawn or key revoked between resume and claim | Claim predicate requires live + approving + key-valid + digest-matching, atomically (§4.1) |
| 29 | A superseded row is revived by clearing `superseded_at` | Trigger constrains each `OLD → NEW` pair; both fields are monotonic (§3.2) |
| 30 | Step-up forged with the compromised session secret | Independent `STEP_UP_COOKIE_SECRET` (§7.1) |
| 31 | A fresh token proves nothing about a fresh login | `auth_time` validated, `max_age` requested; a token without `auth_time` is refused (§7.1) |
| 32 | Whitespace-only approval note | `notes ~ '[^[:space:]]'` (§3.2) |
| 33 | `workflow_transitions` rewritten after the fact | Its own append-only trigger (§3.2) |
| 34 | Legacy backfill collides with a live row written in between | Backfill runs before the write path exists (§13) |
| 35 | Evidence and legacy map disagree | Every decision's two writes share one transaction (§13) |
| 36 | Rejected work waits for ever, still reported as pending | Non-approving verdicts move the job, committed with the evidence write (§4.1) |
| 37 | Evidence recorded under an id the fabric cannot resolve | `FOUNDER_PRINCIPALS` maps email → canonical principal; evidence stores the mapped id (§7.2) |
| 38 | A `NULL` note satisfies the noted-approval CHECK | Postgres accepts a CHECK evaluating to NULL, so the regex alone was not a constraint. `notes IS NOT NULL AND notes ~ '[^[:space:]]'` (§3.2) |
| 39 | Platforms, type or date chosen after approval | The approval action captures the whole outbound package into `approved_package`; publish sends it and ignores the request's copies (§3.5) |
| 40 | A revoked signing key is set back to `active` | Enum vocabulary plus a monotonic `active → revoked` trigger; `key_id` and `public_key` immutable (§3.2) |
| 41 | A transition with no linked evidence carries no authority context | `asserted_role`, `source_system` and `auth_context` are columns on every transition (§3.2) |
| 42 | Concurrent approvals for different brands lose one from the UI map | Row lock or `jsonb_set` on the single key, inside the transaction (§13) |
| 43 | The test suite vouches for behaviour the design has abandoned | Step-up cases rewritten to `auth_time`, including refusal when the claim is absent (§12) |
| 12 | The `CHECK` constraint is mistaken for the authorization gate | **Corrected by ratified decision 7** (§3.2): the constraint prevents an incoherent row and decides nothing. Authorization lives in the fabric/domain boundary. Called out here because *this document* made that mistake once, in writing, and a reader could inherit it |

Failure 11 was the one B1 *introduced* rather than mitigated, and it is now mitigated by design
rather than accepted. Failure 12 is a documentation failure mode, which is a real category: a
design document that overstates a control teaches every later implementer to under-build the
real one.

---

## 12. Test strategy

Following Phase A's split, which worked: pure logic in unit tests, semantics that only Postgres
can prove against real Postgres.

**Pure (`vitest`, no DB)** — digest projection stability, digest changes on approval-relevant
change and *not* on `updated_at`, the widened `checkDeliveryApproval` matrix (absent, pending,
rejected, stale digest, note undischarged, approved), transition legality table, assertion
verification including tampered, expired, wrong-key and replayed.

**Postgres-backed (skipped without `TEST_DATABASE_URL`)** — the `founder_is_human` CHECK rejects a
machine founder row; concurrent approvals collide on the live index; supersession is atomic;
`awaiting_approval` is invisible to `claimNextJob` and `recoverStaleJobs` (**a direct regression
test on Phase A's live queries**); the `one_parent` CHECK; `0023` applied twice against a clean
database through the real runner, as `0022` was.

**Step-up (§7.1)** — pure: **`auth_time`** older than the window is rejected; `auth_time` in the
future is rejected; **a token with no `auth_time` claim at all is refused, never accepted by
falling back to `iat`**; email mismatch between step-up and session is rejected; missing or
expired credential is rejected; a step-up signed with `COOKIE_SECRET` rather than
`STEP_UP_COOKIE_SECRET` is rejected; `STEP_UP_MAX_AGE_SECONDS` unset falls back to 900 and never
to unlimited. Integration: an approval write without a valid step-up is refused with
`step_up_required`, and a successful one records `auth_age_seconds` in provenance.

> These cases previously tested `iat`, which §7.1 now rejects as proof of anything. A test list
> left behind when the design moves is worse than no list: an implementation could pass every
> case and still ship the stale-login hole, with the suite reporting green. Same failure shape as
> the failure-table row missed in round one — **the fix landed in one place and the document
> kept vouching for the old behaviour somewhere else.**

#### The decision-7 acceptance test — required, and it is a pair

Named explicitly by the founder as a B1 acceptance condition, because it is the test that
demonstrates *where authorization actually lives*. It is **two assertions against the same
falsified input**, and neither half means anything alone:

| Half | Input | Required result |
|---|---|---|
| **A — the constraint is not the gate** | a row with `principal_kind = 'human'` and `asserted_role = 'founder'`, inserted directly | the database **accepts** it |
| **B — the write path is the gate** | the same falsified claim presented through `PATCH /productions/:id/approvals` by a caller that is not a founder | **refused**, and **no evidence row exists afterwards** |

Half A alone reads like a bug report. Half B alone reads like an ordinary authorization test.
Together they state the architecture: *the database will happily store this; the application will
not create it.* Anyone who later tries to "harden" the constraint into an authorization control
has to delete half A to do it, which is precisely the tripwire wanted.

Run half B across every way the claim can be falsified — but **split it, because one case cannot
prove what it looks like it proves:**

| Case | Caller | Assert |
|---|---|---|
| B1 | machine principal with a valid session | refused; no evidence row |
| B2 | allowlisted **non**-founder with a valid step-up (§7.2) | refused; no evidence row |
| B3 | **an authorized founder**, body supplying `principal_kind: 'agent'` / `asserted_role: 'x'` | **succeeds**, and the stored row reads `human` / `founder` |

**B3 must use an authorized founder** — second review round. Running the body-injection case as a
non-founder proves nothing: that caller is already refused by founder-set membership, so the test
passes identically whether the handler trusts the body or ignores it. It would go green while the
authorized path happily accepted forged fields. Only a caller who gets *past* authorization can
demonstrate that the write path derives both values from the authenticated identity and discards
what the request said.

**From the review findings**, each gets the test that would have caught it: a live `rejected` row
does **not** resume a job; a gated job is never observable as `queued` (insert and pause in one
transaction, asserted by a concurrent claim finding nothing); a mutation between resume and claim
sends the job back to `awaiting_approval` instead of dispatching; `retry` refuses a `gate_origin`
job without approving evidence; an allowlisted non-founder is refused at the write boundary; the
supersession sequence commits (and the naive orders provably do not); the append-only trigger
rejects an edit and a delete; a replayed assertion violates the unique index; a `withdrawn` row
closes the publish gate the map's `pending` implies.

**Deliberate negative tests.** Every clause of contract 36 that says *never* gets a test proving
the never. A control with no test proving it fails is not a control.

---

## 13. Implementation sequence

**B1 — unblocked**

1. `0023` migration + schema (nothing reads it yet).
2. Digest projection functions + tests.
3. Step-up credential (§7.1) **and its UI**: `POST /auth/google/step-up`, the `rmg_stepup` cookie
   carrying the verified email, the `step_up_required` refusal, **and the dashboard
   re-authentication prompt and retry flow**. Server and UI in the same step — shipping the check
   without the prompt makes every approval unreachable.
4. Founder-set authorization at the write boundary (§7.2), separate from `AUTH_ALLOWED_EMAILS`.
5. **Backfill legacy approvals as unbound history — before any live write path exists.** Second
   review round: backfilling *after* enabling writes means a production re-approved in between
   already holds a live row, so the backfill collides with `approval_evidence_live` and either
   fails or silently drops the legacy record. Backfilling first makes the collision impossible.
6. `approval_evidence` write path behind `PATCH /productions/:id/approvals`, requiring session +
   step-up + founder-set membership, recording the **mapped canonical principal** as `human` with
   `auth_age_seconds` in provenance; `withdrawn` on `pending`.
   **Every decision's evidence write and legacy-map projection share one transaction** — not only
   withdrawal. If either half commits alone the dashboard and the gate disagree, in whichever
   direction is worse for that decision.
   **One transaction is necessary and not sufficient.** `deliveryApprovals` is a single JSONB
   column, so two approvals for *different brand scopes* can each read the same old map, insert
   non-conflicting evidence, and then write back separate whole-map values — both commit, and one
   brand silently vanishes from the UI. Either `SELECT … FOR UPDATE` the production row before
   reading the map, or update the one key in place with `jsonb_set` inside the transaction rather
   than round-tripping the whole object. The evidence rows would be correct and the projection
   wrong, which is the worst shape for a bug that only the UI shows.
7. **The two inherited prerequisites (§3.6)** — a consistent final-video pin populated by both
   producers, and the A-Roll spend-boundary decision. Both gate step 8.
8. Widen `checkDeliveryApproval`; publish reads evidence, sends the **approved snapshot** of the
   whole outbound package, and resolves the video by the pin rather than by `updatedAt`.
9. `workflow_transitions`, written in the same transaction as the state change it records, with
   its own append-only trigger.
10. `work_items`, the `production_jobs` parent columns, **and the `enqueueJob` / `/queue` contract
    changes they require** (§3.4). Ratified decision 5 places the work-item parent in B1; only the
    *article-shaped production* that uses it is B2.
11. A waiting-for-approval surface: `/queue` filterable by `awaiting_approval`, exposing what is
    waiting, on whom, and since when. Phase B's own acceptance conditions ask for it, and an
    approval queue nobody can see is a durable pause that behaves like a lost job.

**B1.5 — small, sequencing-critical**

12. `awaiting_approval` enum value, `gate_origin`, `approved_revision_digest`, the gate-aware
    claim predicate, the stale-gate sweep, the non-approving verdict transitions, the retry
    guard, and the Phase A invisibility regression tests.

**B2 — blocked on `hvnglobalco-com`**

13. Registry `PrincipalKind` change (governed, `rmg-piaar-system` first, mirror second).
14. HVN Global's first authenticated route + signing key — human-authenticated minting per §8.4.
15. `packages/identity` / `authz` human principal support; the founder mapping moves out of
    Creator OS config and into the fabric (§7.2's interim ends).
16. Assertion verification, `signing_keys` lifecycle, and ingest in Creator OS.
17. Article-shaped production on the B1 work-item parent.

Steps 1–12 are safe to build and merge without any of the B2 steps that follow. That is the point of the split, and
ratified decision 5 authorizes exactly that.

---

## 14. Ratified decisions

All five open decisions were resolved by the founder on 2026-09-09, together with two additions.
Recorded here as the design's fixed points.

| # | Decision |
|---|---|
| 1 | **Human identities are domain-scoped.** The initial founder principal is `rahm@business`. No cross-domain human identity is created — the fabric's existing rule applies equally to humans. |
| 2 | **Founder approval requires fresh / step-up authentication** and may not rely on the 30-day session alone. Target window 15 minutes, with explicit re-authentication before a final approval. Ordinary session auth is unchanged. → §7.1 |
| 3 | **Legacy approvals do not become valid evidence.** Existing map entries stay visible for compatibility but do not satisfy the digest-bound gate until re-consented under the new model. → §10 |
| 4 | **`hvnglobalco-com` is authorized** to gain the minimum authenticated server surface for founder approval and signed domain assertions — **and no more.** Not a general API platform. → §8.4 |
| 5 | **B1 may proceed alone**, before the HVN transport exists. |
| 6 | **Signed domain assertions are the preferred B2 transport.** → §8.2 |
| 7 | **Database constraints are defense in depth, not authorization authority.** → §3.2 |

Decision 7 corrected this document. The earlier text described the `founder_is_human` CHECK as
contract 36's clauses "expressed where they cannot be argued with"; a caller can in fact label
itself `human` and satisfy it. Overstating a control is how the real one ends up under-built, so
§3.2 now states what the constraint does and does not do, and §12 adds a test proving the
negative.

## 15. Standing merge discipline

Adopted for every remaining implementation PR in this initiative:

> **Mark ready → let the Codex review finish → then merge.**

Marking a draft ready triggers a Codex review; merging seconds later kills it mid-run. That
happened twice in this initiative — on the Phase A code PR (#52) and on contract 36
(`rmg-piaar-system#36`) — and in both cases the review layer was lost silently, with the PR
still showing green. Neither loss changed an outcome, but the failure mode is repeatable and
costs nothing to avoid.

## 16. What is authorized next

**Phase B1 implementation only.** B2 and `hvnglobalco-com` stay untouched until B1 is merged and
validated.

| Phase B1 — Creator OS governance primitives | Phase B2 — HVN Global approval transport |
|---|---|
| Actor / principal attribution | Authenticated founder action in `hvnglobalco-com` |
| Approval evidence | Signed domain assertion |
| `awaiting_approval` | Fabric-compatible human principal |
| Workflow transitions | Delivery of immutable evidence into Creator OS |
| Work-item parent **+ the `enqueueJob` / `/queue` contract it needs** | *Article-shaped production on that parent* |
| Waiting-for-approval surface (`/queue` by `awaiting_approval`) | |
| **Acceptance test: a falsified `principal_kind='human'` cannot obtain approval through the write path, though the constraint accepts the value** (§12) | |
| Dual-write compatibility with the legacy approvals map | |
| Step-up authentication (§7.1) | |
