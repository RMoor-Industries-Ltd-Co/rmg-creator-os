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

Four new tables and two sets of additive column changes — the `work_items` parent columns on
`production_jobs` (§3.3) and the gate descriptor (§4.1). Migration
**two** migrations — `0023_governance_enums.sql` then `0024_governance_primitives.sql` (`0022`
is the Phase A migration). The split is not cosmetic: Postgres cannot use an
`ALTER TYPE … ADD VALUE` result inside the adding transaction, and Drizzle wraps each migration
in one. See §4.1 and §10.

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
  decision_seq      bigint NOT NULL,        -- monotonic per (subject_type, subject_id, scope); see §8.2

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

-- replay protection, enforced by the database rather than by an application existence check.
-- The pairing CHECK is not decoration: NULLs are distinct in a unique index, so a row that
-- carried an assertion_id while omitting signing_key_id would satisfy the index on EVERY
-- replay. Both together, or neither.
ALTER TABLE approval_evidence ADD CONSTRAINT assertion_fields_paired
  CHECK ((signing_key_id IS NULL) = (assertion_id IS NULL));

CREATE UNIQUE INDEX approval_evidence_assertion
  ON approval_evidence (signing_key_id, assertion_id)
  WHERE assertion_id IS NOT NULL;

CREATE INDEX approval_evidence_subject
  ON approval_evidence (subject_type, subject_id);

-- ordering is per subject+scope and never repeats, so an out-of-order redelivery cannot
-- reoccupy an ordinal that has already been decided
CREATE UNIQUE INDEX approval_evidence_seq
  ON approval_evidence (subject_type, subject_id, scope, decision_seq);
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

**"Nothing is deleted" has to be enforced too — fifth review round.** One-way *status* is not
one-way *existence*. `approval_evidence.signing_key_id` carried no foreign key, and the
monotonicity trigger above constrained `UPDATE` only, so a lifecycle path (a rotation script, a
cleanup job, a compromised role) could `DELETE` the revoked row and `INSERT` the same `key_id`
as `active`. Because the gate reads the *current* status row rather than re-verifying the
original assertion, every piece of evidence written under that formerly revoked id would become
authoritative again — revocation undone by two ordinary statements. Three things close it:

```sql
-- 1. key rows are append-only in existence as well as in status
CREATE FUNCTION signing_keys_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signing_keys is append-only: key % may not be deleted', OLD.key_id;
  END IF;
  IF NEW.key_id <> OLD.key_id OR NEW.public_key <> OLD.public_key OR NEW.domain <> OLD.domain THEN
    RAISE EXCEPTION 'signing_keys: identity columns are immutable';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'signing_keys: revocation is one-way';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER signing_keys_no_delete
  BEFORE UPDATE OR DELETE ON signing_keys
  FOR EACH ROW EXECUTE FUNCTION signing_keys_append_only();

-- 2. evidence points at a key row that must therefore continue to exist
ALTER TABLE approval_evidence
  ADD CONSTRAINT approval_evidence_signing_key_fk
  FOREIGN KEY (signing_key_id) REFERENCES signing_keys(key_id);
```

3. **`key_id` is never reused**, including for a key that was never used to sign anything. The
   primary key already refuses a duplicate while the row exists; the delete refusal is what makes
   that guarantee permanent. Rotation therefore mints a fresh id (`<domain>-<yyyymmdd>-<n>`), and
   a key-id collision at registration is an operational error to surface, not a row to replace.

The foreign key also removes a quieter failure: evidence naming a `signing_key_id` with no key
row at all. Under the previous model the gate's join found nothing, and "no revocation row" is
indistinguishable from "not revoked" unless every read remembers to treat a missing key as fatal.
With the FK the unresolvable state cannot be written in the first place.

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

**Completeness, at commit rather than per statement — fifth review round.** The trigger above
constrains each `OLD → NEW` pair, which is what monotonicity needs, but it is a `BEFORE ROW`
trigger and therefore cannot see how the transaction ends. A path that ran step 1 and then
stopped — a bug, an early `RETURN`, a compromised role issuing a single `UPDATE` — could commit
with `superseded_at` set and `superseded_by` still `NULL`: the row has left the live partial
index, no successor has taken the slot, and **the subject now has no live decision at all**,
which the gate reads as "unapproved" while the audit trail claims a supersession that names
nothing. Nothing above prevented it, and §3.2 nevertheless claimed lineage completeness was
database-enforced. Likewise `superseded_by` was only checked for monotonicity, not for *being a
plausible successor*: it could point at a row for a different subject, a different scope, or at
the superseded row itself.

A deferred constraint trigger closes both, and deferral is available here because this is a
`CONSTRAINT TRIGGER` rather than the partial unique index discussed above.

**It must validate the row as it finally stands, not the tuple that queued the event — sixth
review round, and the first version of this trigger was broken by exactly that.** Postgres queues
a *separate* deferred event per row-update, each carrying its own frozen `NEW` snapshot. The
legitimate three-step sequence updates the row twice, so at `COMMIT` two events fire: step 3's
event sees both columns populated, but **step 1's event still sees `superseded_by IS NULL`** and
raised. The check as first written therefore failed every correct supersession while permitting
nothing extra — a constraint that rejects only valid transactions. The function must re-read the
current row by `NEW.id` and judge that:

```sql
CREATE FUNCTION approval_evidence_supersession_complete() RETURNS trigger AS $$
DECLARE cur approval_evidence%ROWTYPE;
        succ approval_evidence%ROWTYPE;
BEGIN
  -- re-read: the queued NEW tuple is an intermediate state of a multi-statement sequence
  SELECT * INTO cur FROM approval_evidence WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;          -- append-only trigger already refuses DELETE
  IF cur.superseded_at IS NULL THEN RETURN NULL; END IF;
  IF cur.superseded_by IS NULL THEN
    RAISE EXCEPTION 'approval_evidence %: superseded_at set with no successor', cur.id;
  END IF;
  IF cur.superseded_by = cur.id THEN
    RAISE EXCEPTION 'approval_evidence %: cannot supersede itself', cur.id;
  END IF;
  SELECT * INTO succ FROM approval_evidence WHERE id = cur.superseded_by;
  IF succ.subject_type IS DISTINCT FROM cur.subject_type
     OR succ.subject_id IS DISTINCT FROM cur.subject_id
     OR succ.scope      IS DISTINCT FROM cur.scope THEN
    RAISE EXCEPTION 'approval_evidence %: successor % is for a different subject/scope',
                    cur.id, cur.superseded_by;
  END IF;
  IF succ.decision_seq <= cur.decision_seq THEN
    RAISE EXCEPTION 'approval_evidence %: successor % does not follow it in sequence',
                    cur.id, cur.superseded_by;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER approval_evidence_supersession_complete
  AFTER UPDATE ON approval_evidence
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION approval_evidence_supersession_complete();
```

Two events now both re-read the same final row and reach the same verdict, which is the property
a commit-time check needs: **idempotent in the number of times it fires.** Ordering is compared
on `decision_seq` (§8.2) rather than `recorded_at`, because a clock reading is not an order.

Deferred is the whole point: the three-step sequence is *legitimately* incomplete between steps 1
and 3, so the check has to run at `COMMIT` and not before. A transaction that performs step 1
alone now fails at commit rather than silently leaving the subject undecided. The test for this
is therefore two-sided — the correct three-step sequence **commits**, and step 1 alone **raises**
— because a one-sided test would have passed against the broken version above.

**`TRUNCATE` is not `DELETE`, and the runtime role can issue it — sixth review round.** Row-level
`BEFORE DELETE` triggers **do not fire for `TRUNCATE`**, and Creator OS runs migrations and
application queries under the same database identity, so the runtime role owns these tables and
holds truncate rights on them by default. One statement could therefore erase the evidence,
transition and key tables together — taking the audit history with it and freeing every `key_id`
for reuse — past every append-only trigger above. Statement-level guards, on all three tables:

```sql
CREATE FUNCTION governance_table_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: TRUNCATE is not permitted', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER approval_evidence_no_truncate    BEFORE TRUNCATE ON approval_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION governance_table_no_truncate();
CREATE TRIGGER workflow_transitions_no_truncate BEFORE TRUNCATE ON workflow_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION governance_table_no_truncate();
CREATE TRIGGER signing_keys_no_truncate         BEFORE TRUNCATE ON signing_keys
  FOR EACH STATEMENT EXECUTE FUNCTION governance_table_no_truncate();
```

Separating table ownership and revoking the runtime role's truncate privilege is the stronger
control and is worth doing when the deployment gains a migration-only role; the triggers are what
holds today, under the identity model that actually exists.

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

**And the capability vocabulary blocks it one level lower — sixth review round.**
`production_job_capability` is an enum of `aroll | broll | lipsync | audio | thumbnail | poster`,
and `enqueueJob` requires one of them. Even with a `work_item_id` column and a relaxed parent
CHECK, **there is no value an Accord job could legally carry**: it either masquerades as a video
capability — the fabrication §3.4 rejects, relocated from the parent row to the capability
column — or it fails validation before it reaches the new parent at all. The Phase B exit
condition "an Accord article moves through the queue" is unsatisfiable until this is fixed.

```sql
ALTER TYPE production_job_capability ADD VALUE 'accord_article';
```

with dispatch defined rather than left implicit: the worker's capability switch gains an
`accord_article` branch, and until B2 gives it a real handler it **fails the job explicitly**
(`failed`, with a reason) rather than falling through a `default` that silently marks work done.
A capability the dispatcher does not recognise must be an error, never a no-op — a governed job
that completes without doing anything is worse than one that fails. The enum addition carries
the same commit-boundary constraint as `awaiting_approval` (§4.1) and travels in the same
enum-only migration.

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

> **Pinning the row does not pin the bytes.** `GET /videos/:id/raw` (`server.ts:1439-1455`)
> serves `drive.download(row.driveFileId)` — the file's **current** contents. Replace the Drive
> file behind an approved row and the digest still matches while Postiz fetches a different cut.
> Selection races and content mutation are two different holes; pinning closes only the first.
> The approval projection therefore carries a **content checksum or immutable object version**
> for the pinned asset.

> **And the check has to sit at the fetch, not before it — fifth review round.** An earlier
> revision said the checksum is "verified immediately before publication." That verifies the
> wrong moment. Postiz publishes via `upload-from-url`: Creator OS hands it a URL, Postiz
> **later** fetches `/videos/:id/raw`, and the Drive file can be replaced in between. A
> pre-publication check that passes therefore says nothing about the bytes that leave the
> system — it is a time-of-check/time-of-use gap with a network round trip inside it, which is
> the widest kind.
>
> The verification therefore moves **into the read path**, so that no fetch can succeed with
> unapproved bytes:
>
> - the URL Creator OS hands to Postiz carries the approved binding —
>   `/videos/:id/raw?digest=<approved content checksum>` (or the Drive `headRevisionId`), signed
>   or opaque so it cannot be edited by the recipient;
> - the raw handler **computes the checksum of the bytes it is about to stream** (or requests the
>   pinned Drive revision explicitly, `files.get(fileId, revisionId)`), compares it to the value
>   in the URL, and **refuses with `409` rather than serving a mismatch**. A stream already begun
>   is aborted rather than completed;
> - a request to `/videos/:id/raw` **without** a binding parameter keeps today's behaviour for
>   human/browser use, but is never the URL given to a publisher.
>
> Streaming an immutable copy (export the approved bytes once to an append-only object at
> approval time, publish from that) is the stronger form and is the preferred implementation if
> the storage cost is acceptable; the digest-bound read path above is the minimum. Either way the
> property required is the same: **the bytes that reach the platform are the bytes the founder
> approved, proven at the moment they are read.**

> **Nor does naming the platform pin the destination.** `matchIntegration` (`postiz.ts:81-95`)
> returns the *first* enabled integration whose identifier matches, resolved only at publish
> time (`server.ts:2242-2263`). Add, reorder, disable or reconnect an account afterwards and the
> approved package goes to a different page or profile, digest unchanged. The approved package
> records the **resolved integration identity**, and publish sends to that exact destination or
> refuses — it does not re-resolve.

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

**What makes a job gated is a server-owned decision, not a caller's word.** The transition table
said "a gate applies to this job" and left it there — no policy lookup, no required field, no
validated mapping from `gate_origin` to an evidence subject and scope. An enqueue caller could
simply omit the marker and get an ordinary `queued` row that a worker claims and pays for. A gate
whose *applicability* is optional is not a gate.

Gate applicability is therefore derived inside `enqueueJob` from **server-side policy** —
capability, provider, brand, autonomy level — never from an argument the caller supplies and
never overridable by one. When policy says a gate applies, the insert writes a **complete,
validated gate descriptor in the same statement** that creates the row. A partial descriptor is
rejected rather than stored: a job marked gated that names no evidence to wait for can never
legally resume, which is a leak in the other direction.

**"A complete descriptor" needed a storage contract, and did not have one — fifth review
round.** The prose named four things (`gate_origin`, `subject_type`, `subject_id`, `scope`)
while the declared schema change added only two columns, and the repository has **no autonomy-
policy source at all** from which the other three could later be reconstructed. `enqueueJob`,
`POST /queue/:id/retry`, `claimNextJob` and the stale-gate sweep would each have had to *infer*
the evidence tuple, and nothing would have made them infer the same one — four readers, four
opportunities to look up the wrong row, and the disagreement fails open at whichever of them
guesses an approval that exists. Typed columns and a completeness constraint, in migration
`0024`:

```sql
ALTER TABLE production_jobs
  ADD COLUMN gate_origin              text,          -- the policy rule that paused this job
  ADD COLUMN gate_subject_type        text,          -- same vocabulary as approval_evidence.subject_type
  ADD COLUMN gate_subject_id          text,
  ADD COLUMN gate_scope               text,
  ADD COLUMN approved_revision_digest text;

-- all four descriptor fields, or none of them: a half-written gate is not a gate
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_gate_complete
  CHECK (num_nonnulls(gate_origin, gate_subject_type, gate_subject_id, gate_scope) IN (0, 4));

-- and a gated job must actually be gated at rest
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_gate_status
  CHECK (status <> 'awaiting_approval' OR gate_origin IS NOT NULL);
```

**The enum value and its first use cannot share a migration — sixth review round, and this would
have failed on deploy rather than in review.** Drizzle runs each migration inside a transaction,
and Postgres refuses to *use* a value added by `ALTER TYPE … ADD VALUE` until the adding
transaction has committed (the exception being an enum created in that same transaction, which
`production_job_status` was not). The `production_jobs_gate_status` CHECK above compares `status`
against the freshly-added `'awaiting_approval'`, so `0023` as declared would abort partway and
B1 could not deploy at all. `accord_article` (§3.4) has exactly the same problem.

`0023` therefore splits at that commit boundary, and the split is a sequencing requirement rather
than a style preference:

| Migration | Contents |
|---|---|
| **`0023_governance_enums.sql`** | `ALTER TYPE production_job_status ADD VALUE 'awaiting_approval'`; `ALTER TYPE production_job_capability ADD VALUE 'accord_article'`; `CREATE TYPE principal_kind`, `signing_key_status`. **Nothing that references the new values.** |
| **`0024_governance_primitives.sql`** | The four tables, all triggers and indexes, the `production_jobs` parent and gate-descriptor columns, and every CHECK that names `'awaiting_approval'`. |

A migration test that applies both from an empty database — rather than asserting the final
schema — is what would have caught this, and is added to §12.

**Descriptors are immutable once written — sixth review round.** The two CHECKs above constrain
a row's *shape*, not its *history*. `num_nonnulls(...) IN (0, 4)` happily accepts a `4 → 0`
transition, and `production_jobs_gate_status` stops applying the moment the job leaves
`awaiting_approval` — so a buggy or hostile `UPDATE` could clear `gate_origin` on a cancelled job
just before retry, or repoint all four fields at an unrelated already-approved tuple just before
claim. Either erases the server-owned policy decision the descriptor exists to record, using the
descriptor's own storage to do it:

```sql
CREATE FUNCTION production_jobs_gate_descriptor_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.gate_origin IS NOT NULL AND
     (NEW.gate_origin, NEW.gate_subject_type, NEW.gate_subject_id, NEW.gate_scope)
     IS DISTINCT FROM
     (OLD.gate_origin, OLD.gate_subject_type, OLD.gate_subject_id, OLD.gate_scope) THEN
    RAISE EXCEPTION 'production_jobs %: gate descriptor is immutable once set', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER production_jobs_gate_frozen
  BEFORE UPDATE ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION production_jobs_gate_descriptor_frozen();
```

`approved_revision_digest` is deliberately **not** in the frozen set — it is re-stamped at each
legitimate resume, which is what §4.1's claim revalidation compares against. A genuine policy
migration (§4.1, "the descriptor is migrated explicitly") runs as a controlled operation that
drops and recreates this trigger inside its own transaction, which is precisely the visibility
that an ordinary runtime `UPDATE` must not have.

`num_nonnulls(...) IN (0, 4)` is the constraint that matters: it is evaluated on every insert and
update, it cannot be satisfied by a caller who supplies three of four, and — unlike a comment —
it makes the "partial descriptor is rejected" sentence above true in the database rather than in
an intention.

**The authoritative policy source, named rather than assumed.** There is no autonomy-policy
table today, so B1 introduces the smallest thing that can be the single answer to "does a gate
apply, and to what evidence": a **pure, versioned function in one module**,
`resolveGate(input) → GateDescriptor | null`, keyed on `(capability, **provider**, brand,
subject_type, autonomy_level)`, with its defaults declared in code and unit-tested. *`provider`
was named as a policy input two paragraphs above and then omitted from the key — sixth review
round. For a capability that can run through more than one provider those are different cost and
governance boundaries, and a key without it silently reuses one provider's rule for another. It
is taken from the server-side resolution of the job, never from the request.* Not a table, because a
policy row is another thing an operator can edit to open a gate; not an environment variable,
because the mapping is structured. The **default is `gate applies`** for every capability B1
governs — an unrecognised capability resolves to a gate rather than to none, so adding a
capability without adding a policy entry fails safe.

Every one of the four readers calls `resolveGate` — or, once the row exists, reads the stored
descriptor back — and none of them derives the tuple independently:

| Reader | Uses |
|---|---|
| `enqueueJob` | `resolveGate` → writes the descriptor atomically with the row |
| `POST /queue/:id/retry` | the **stored** descriptor on the row |
| `claimNextJob` | the **stored** descriptor, joined to `approval_evidence` in the claim predicate |
| stale-gate sweep | the **stored** descriptor, same join |

Storing the tuple rather than re-resolving it at each read is deliberate: a policy change must
not silently re-point an already-paused job at different evidence. When policy genuinely changes,
the descriptor is migrated explicitly, which is a visible operation.

**A newly enqueued gated job is never `queued`, even briefly.** The original design inserted it
as `queued` and transitioned it afterwards. `claimNextJob` runs `FOR UPDATE SKIP LOCKED` against
exactly that status, so a worker could claim and dispatch **paid work** in the window between the
insert and the pause. Gated jobs are therefore **inserted directly in `awaiting_approval`** — the
gate is evaluated in the same transaction that makes the row visible, so the runnable state never
exists on the enqueue path.

*Scoped precisely — fifth review round.* An earlier revision drew the wrong conclusion from that
and stated flatly that "there is no `queued → awaiting_approval` transition at all", which
contradicts both the table above and the stale-gate sweep introduced two paragraphs down: an
**approved** job is deliberately resumed into `queued`, and if its gate later stops holding the
sweep must be able to pause it again. The invariant is about **insertion**, not about the
transition's existence:

- a *newly inserted* gated job never passes through `queued` — there is no enqueue path that
  creates one;
- `queued → awaiting_approval` **does exist**, for the stale-gate sweep alone, and only when the
  gate is unsatisfied;
- a resumed gated job **is** legitimately observable as `queued`, and is protected there by the
  claim predicate rather than by its status.

Read the other way round — as the earlier wording invited — an implementer would omit the sweep,
or write a regression test asserting "no gated job is ever `queued`" that fails on every
correctly resumed job.

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

#### The gate read is a moment; publication is an interval — sixth review round

Those four checks are a **point-in-time read**, and `POST /productions/:id/publish` performs them
first and *then* awaits an integration lookup and a media upload before Postiz creates anything.
A withdrawal or rejection landing inside that interval commits happily — nothing in §4.2a's
transaction knows a publish is in flight — and the post goes out under evidence that is no longer
live. §3.5's byte binding does not close it either: that proves the *bytes* are the approved ones,
and this is about the *decision* having been revoked while approved bytes were being sent.

A one-time read cannot fix an interval; the two writers have to be serialized. Publication
therefore declares an intent and holds it:

1. **Claim.** In one transaction, re-run the four checks `FOR UPDATE` against the live evidence
   row and insert a `publication_intents` row — `(subject_type, subject_id, scope)` unique while
   open, carrying `evidence_id`, `revision_digest` and a lease deadline in the shape Phase A's
   job lease already uses. A second concurrent publish collides on the index rather than racing.
2. **Supersession waits or loses.** §4.2a's withdrawal transaction takes the same row lock, so it
   either commits **before** the claim (and the claim then fails closed, the publish never
   starting) or **after** it. It never interleaves.
3. **Commit or release.** Postiz's post id is recorded and the intent closed in the same
   transaction; a failure or an expired lease releases it. An intent that expires with no post id
   is surfaced, not swept silently — that is the one state where "did it publish?" is genuinely
   unknown, and it needs a human to look.

**A withdrawal that arrives while an intent is open is recorded, not lost.** It supersedes as
normal and takes effect for every subsequent gate read; what it cannot do is retroactively
un-send a post already handed to Postiz. The honest guarantee is therefore bounded and worth
stating plainly: **no publication begins after a withdrawal commits, and no withdrawal is
silently dropped because a publication was running.** Recalling an already-transmitted post is a
platform operation, not a database one, and B1 does not pretend otherwise.

`publication_intents` is the fifth table B1 adds, and it belongs to the enum-free migration.

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
- **Freshness is recomputed at every approval write from the signed `auth_time`** — never inferred
  from the cookie still being present. Two reasons, and the first is arithmetic: a token whose
  `auth_time` is already 890 seconds old would otherwise mint a cookie living another 900, so an
  approval could land ~30 minutes after the actual login while every individual check passed.
  The second is that `Max-Age` is a *client-side* hint and not a server-verifiable expiry at all.
  The cookie's `maxAge` is set to the **remaining** window (`900 − age`, refused if ≤ 0), and the
  write path re-derives the age regardless.
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

```
{ subject: { subject_type, subject_id, scope },
  revision_digest, decision, notes, decision_seq,
  principal_id, asserted_role, issued_at, key_id, nonce }
```

**Both of the structural fields here were added on the sixth review round, and both were
authorization holes rather than tidiness.**

- **`scope` is inside the signed `subject`.** `scope` is the brand slug that selects which live
  evidence row a brand-scoped approval satisfies. The earlier list wrote `subject` as an
  unspecified single value, so an implementation could plausibly have taken scope from outside
  the signature — at which point **the authenticated machine carrier can retarget a genuine
  founder approval from one brand to another**, signature and digest both still verifying. The
  subject is a triple, and the triple is signed as one object; a scope supplied anywhere else in
  the request is ignored, not merged.
- **`decision_seq` is in the primary list, not only in the prose below.** The ordering rule added
  in round five is worth nothing if the ordinal is transport-controlled: a carrier could raise a
  stale approval's ordinal above the live rejection and defeat the very comparison the rule
  introduces. A field that decides which decision wins must be signed by whoever decided.

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

**Freshness is not ordering — fifth review round.** The nonce index refuses a *duplicate*
assertion and the age window (below) refuses a *late* one. Neither refuses an assertion delivered
**out of order**. Two assertions minted inside the same five-minute window — say an approval,
then the founder changes their mind and a rejection — are both individually valid; if transport
delivers the rejection first and the approval second, the older approval arrives last, supersedes
the newer rejection, and **the gate reopens against the founder's actual latest decision.** No
attacker is required; a retried HTTP POST is enough.

Ordering therefore has to be carried in the signed payload rather than inferred from arrival:

- the domain maintains a **monotonic decision sequence per `(subject_type, subject_id, scope)`**
  — a counter it increments for every decision it mints, persisted alongside the decision so it
  survives a restart — and signs it as `decision_seq`;
- `decision_seq` is part of the signed payload above, not an envelope field. Unsigned it would
  be a hint a transporter could rewrite;
- Creator OS stores it as `approval_evidence.decision_seq bigint` and **refuses any assertion
  whose `decision_seq` is less than or equal to the live row's** for that subject and scope. The
  refusal is a `409`, not a silent drop: an out-of-order delivery is a fact worth surfacing;
- the comparison is made **inside the supersession transaction**, against the row it is about to
  supersede, so two concurrent deliveries cannot both read the same predecessor — the partial
  unique index already serialises them, and the loser retries and is then correctly refused;
- `issued_at` is **not** used for ordering. It is a clock reading from another machine, subject
  to skew, and skew is exactly the condition under which two decisions land close together.

For the interim direct-call transport (§8.3) and for B1's local founder path, where no domain
sequence exists, the same property is obtained locally: the sequence is the count of prior
evidence rows for the subject and scope, assigned inside the same transaction that inserts the
row. `decision_seq` is `NOT NULL` for that reason — there is no evidence-writing path that
legitimately lacks an ordinal.

Sequence and nonce solve different problems and both are required: the nonce stops the *same*
decision being applied twice, the sequence stops a *superseded* decision being reapplied at all.

**Assertions expire, and the window is a number rather than an adjective.** The nonce index stops
a *second* use; it does nothing about a *first* use that arrives late. Without a stated lifetime,
a stolen assertion could be presented months on — after a newer rejection or withdrawal — and
supersede the live decision, and the "expired assertion" test would have had no expected value
to assert against. So: `issued_at` must be within **`ASSERTION_MAX_AGE_SECONDS` (default 300)**
of receipt, with **60 seconds** of tolerated clock skew into the future and none beyond it.
Outside that window the assertion is refused before any evidence is written.

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
| **Minting** an assertion (the founder decides) | a **human who holds the founder grant** | Google SSO + step-up (§7.1) **and** the founder authorization of §7.2 |
| **Transporting** an already-minted assertion | a **machine** | the fleet's constant-time key pattern |

A machine may carry. Only a human may mint. The signing key sits behind the human path.

**"A human" is not the rule — that was the same error again, one layer out.** Requiring SSO plus
step-up proves *identity and presence*, which §7.2 already establishes is not *authority*. On a
surface that holds the signing key, an allowlisted colleague satisfying those two checks could
obtain a domain signature over `principal_id = rahm@business, asserted_role = founder`, and the
resulting assertion would verify perfectly downstream. The founder grant is required **before the
signing key is reachable**, and the domain **derives `principal_id` and `asserted_role` from the
authenticated caller** — it never signs values the request supplied. Only the subject, decision,
digest and notes come from the request. A repository that is pages today
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

**Two migrations, and the split is mandatory** (§4.1): `0023_governance_enums.sql` adds enum
values and types only; `0024_governance_primitives.sql` does everything that references them.
Postgres refuses to use an `ALTER TYPE … ADD VALUE` result inside the adding transaction, and
Drizzle wraps each migration in one. Declaring a single `0023` — as an earlier revision did —
would have aborted on deploy, not in review.

- **Five** new tables — `approval_evidence`, `workflow_transitions`, `work_items`,
  `signing_keys`, `publication_intents` — all in `0024`, and nothing existing reads them. (An
  earlier revision said three while §3 assigned four, which would have let `signing_keys` and
  its enum be omitted from deployment or stranded on rollback; `publication_intents` is the
  fifth, added in the sixth review round with §4.3's serialization.) `signing_keys` is created
  in B1 with the rest even though only B2 writes it: a gate predicate that joins a table which
  may or may not exist is not a predicate.
- **Two** new enum values, both in `0023_governance_enums.sql` — `production_job_status.awaiting_approval`
  (invisible to Phase A's claim and recovery queries, §4.1) and
  `production_job_capability.accord_article` (§3.4, without which no Accord job can be enqueued
  at all).
- **`productions.final_video_row_id uuid REFERENCES videos(id)`** — §3.6(b)'s pin, in `0024`.
  It was named as a prerequisite and then never assigned to a migration, which would have left
  publish re-deriving a winner by `updatedAt` — exactly the mutable selection the digest exists
  to eliminate. Nullable on add; **backfilled** for existing productions by resolving each
  `finalVideoId` (a Drive file id) against `videos.driveFileId`, and left null where no match
  exists rather than guessed. Both producers — the upload path (`routes/delivery.ts`) and the
  assembly path (`server.ts:1816-1834`) — populate it going forward, and publish reads it.
  A production with a null pin cannot be approved; that refusal is the point.
- `production_jobs.work_item_id` nullable; `production_id` relaxed to nullable with a `CHECK`
  every existing row already satisfies.
- `production_jobs` gate descriptor: `gate_origin`, `gate_subject_type`, `gate_subject_id`,
  `gate_scope`, `approved_revision_digest`, plus `production_jobs_gate_complete` and
  `production_jobs_gate_status` (§4.1). All nullable and all `0` on every existing row, so the
  completeness CHECK admits the whole existing table unchanged. Rollback drops the five columns
  together — dropping `gate_origin` alone would leave orphaned descriptor fields that the retry
  refusal no longer reads.
- **Existing governed jobs are backfilled, not left null — sixth review round.** `0024` adds the
  descriptor columns as null on every existing row, and the new claim and retry predicates read
  a null `gate_origin` as *ungated*. A `queued` job that predates the deploy would therefore
  dispatch with no approval, and a pre-deploy `cancelled` job could be retried through the same
  hole — the migration would open the exact gap it exists to close, for precisely the jobs
  already in flight. The deploy sequence is therefore ordered rather than incidental:

  1. `0024` runs, adding the columns.
  2. A backfill step resolves `resolveGate` for **every** non-terminal job and, where a gate
     applies, writes the complete descriptor and moves a `queued` job to `awaiting_approval`.
     It runs **before** the gate-aware worker image is deployed, so nothing can claim a job
     mid-backfill.
  3. Only then does the gate-aware gateway roll out.

  And the predicate itself fails closed regardless: a job whose capability `resolveGate` says is
  governed is **not claimable with a null descriptor**. Missing is treated as *unresolved*, not
  as *ungated* — so a job the backfill somehow missed stalls visibly instead of dispatching.
- `productions.deliveryApprovals` is **not dropped.** B1 dual-writes: evidence becomes the source
  of truth for the gate, the map stays as a projection for the existing UI. It is removed in a
  later, separate change once nothing reads it.
- Backfill: existing `approved` entries become evidence rows with
  `principal_kind = 'processor'`, `asserted_role = 'legacy-unattributed'`, and a
  `revision_digest` of `'legacy:unbound'`. **Legacy rows deliberately fail the digest check**, so
  a pre-Phase-B approval cannot silently satisfy a post-Phase-B gate. They are history, not
  authority. Re-approval under the new model is a founder action, and that is the correct cost.
- Rollback: **not simply "drop the tables and columns."** Once `awaiting_approval` has been
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
| 11 | Stolen/forged 30-day session → forged founder approval | **Closed by ratified decision 2:** approval writes additionally require a `rmg_stepup` credential whose **`auth_time`** is ≤15 minutes old — refused outright when that claim is absent or in the future — signed with an independent key, and re-aged at every write (§7.1). *An earlier revision of this row said "verified against Google's `iat`", which §7.1 had already stopped trusting; a checklist that contradicts the normative section is how the vulnerability gets reintroduced by someone following the checklist.* |
| 13 | A rejection resumes gated work | Resume requires `decision ∈ {approved, approved_with_note}`, not merely live evidence (§4.1) |
| 14 | A worker claims a gated job before it is paused | Gated jobs are inserted directly as `awaiting_approval`; the runnable state never exists (§4.1) |
| 15 | Content changes between resume and claim | `approved_revision_digest` on the job, re-compared at dispatch (§4.1) |
| 16 | Timed-out gated work released via `POST /queue/:id/retry` | `gate_origin` survives cancellation; retry refuses without live approving evidence (§4.1) |
| 17 | Any allowlisted user records founder approval | Founder-set check at the write boundary, separate from `AUTH_ALLOWED_EMAILS`, empty by default (§7.2) |
| 18 | A machine credential mints a founder assertion at HVN Global | Minting authenticates a human; machine auth only transports (§8.4) |
| 19 | Evidence edited or deleted in place | Append-only trigger permitting only the two supersession columns (§3.2) |
| 20 | Assertion replayed | Unique index on `(signing_key_id, assertion_id)` (§8.2) |
| 21 | Evidence forged before a key was revoked stays authoritative | `signing_key_id` recorded; gate reads join key status (§8.2) |
| 22 | Approval survives the asset changing under it | Digest binds the video publish actually selects, resolved through the new `productions.final_video_row_id` pin (§3.6(b)) — **not** `finalVideoId`, which holds a Drive file id for one producer and nothing for the other — together with the content checksum enforced in the raw read path (§3.5) |
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
| 44 | An allowlisted non-founder mints a founder assertion at HVN Global | Founder grant required before the signing key is reachable; the domain derives `principal_id` and `asserted_role` from the caller and never signs request-supplied values (§8.4) |
| 45 | Approved package published to a different channel | Resolved integration identity is captured at approval; publish sends there or refuses, never re-resolving (§3.5) |
| 46 | Drive file replaced behind an approved video row | Content checksum / immutable object version in the approval projection, verified before publication (§3.5) |
| 47 | A stolen assertion is presented for the first time months later | `issued_at` within `ASSERTION_MAX_AGE_SECONDS` (300), 60s skew forward, none beyond (§8.2) |
| 48 | Replay slips past the nonce index via a NULL `signing_key_id` | Paired CHECK — both fields set or both NULL (§3.2) |
| 49 | Step-up window silently doubles | Age recomputed from the signed `auth_time` at every write; cookie `maxAge` is the remaining window, never a fresh 900 (§7.1) |
| 50 | An enqueue caller omits the gate marker | Gate applicability derived from server-side policy inside `enqueueJob`; a partial descriptor is rejected, not stored (§4.1) |
| 51 | Two in-window assertions delivered out of order; the older approval supersedes the newer rejection | Signed monotonic `decision_seq`; an assertion at or below the live row's ordinal is refused `409` inside the supersession transaction (§8.2) |
| 52 | Postiz fetches replaced bytes after a passing pre-publication check | Verification moves into `/videos/:id/raw`: the publisher URL carries the approved digest and the handler refuses a mismatch while reading (§3.5) |
| 53 | A revoked signing key is deleted and its `key_id` re-inserted as active | `signing_keys` append-only including delete refusal; `key_id` never reused; FK from `approval_evidence.signing_key_id` (§3.2) |
| 54 | A transaction sets `superseded_at` alone, leaving the subject with no live decision | Deferred `CONSTRAINT TRIGGER` at commit: both fields present, successor matches subject/scope and does not predate (§3.2) |
| 55 | Four readers each infer the gate's evidence tuple differently | Typed descriptor columns written atomically at enqueue, a `num_nonnulls(...) IN (0,4)` completeness CHECK, and one `resolveGate` policy function that defaults to *gated* (§4.1) |
| 56 | The deferred supersession check rejects every valid supersession | It re-reads the row by `NEW.id` at commit instead of judging the frozen `NEW` tuple of an intermediate statement; the test asserts both that the valid sequence commits and that step 1 alone raises (§3.2) |
| 57 | `TRUNCATE` erases the audit tables past every row-level trigger | Statement-level `BEFORE TRUNCATE` triggers on all three governance tables (§3.2) |
| 58 | A gate descriptor is cleared or retargeted after it is written | `production_jobs_gate_frozen` trigger; only `approved_revision_digest` is re-stampable (§4.1) |
| 59 | `0023` aborts on deploy because an enum value is used in the transaction that adds it | Split into `0023` (enums only) and `0024` (everything referencing them), with an apply-from-empty migration test (§4.1, §10) |
| 60 | Pre-deploy jobs dispatch ungated because their descriptor is null | Ordered deploy: migrate, backfill and pause before the gate-aware worker ships; and a governed capability with no descriptor is unclaimable, not ungated (§10) |
| 61 | Withdrawal commits while a publish is mid-flight | `publication_intents` serializes the two writers on the same evidence row; no publication begins after a withdrawal commits (§4.3) |
| 62 | A carrier retargets a founder approval to another brand scope | `scope` is inside the signed `subject` triple; a scope supplied outside the signature is ignored (§8.2) |
| 63 | A carrier rewrites `decision_seq` to revive a stale approval | `decision_seq` is in the primary signed payload, not the envelope (§8.2) |
| 64 | An Accord job can only be enqueued by masquerading as a video capability | `accord_article` added to `production_job_capability`; an unhandled capability fails the job explicitly rather than completing it (§3.4) |
| 65 | Provider change silently reuses another provider's gate rule | `provider` is part of the `resolveGate` key, resolved server-side (§4.1) |
| 66 | Publish re-derives the winning video by `updatedAt` | `productions.final_video_row_id` added and backfilled in `0024`; a null pin blocks approval (§10) |
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
test on Phase A's live queries**); the `one_parent` CHECK; **both migrations applied in order from an empty database**, which is
the test that would have caught the `ALTER TYPE`/first-use collision (asserting the final schema
would not have); the pair applied twice against a clean
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
does **not** resume a job; a *newly enqueued* gated job is never observable as `queued`
(insert and pause in one transaction, asserted by a concurrent claim finding nothing) — paired
with its complement, that a **resumed** gated job is legitimately `queued` and is held back by
the claim predicate rather than by its status, so the first test cannot be written in a form that
fails on correct resumption; a mutation between resume and claim
sends the job back to `awaiting_approval` instead of dispatching; `retry` refuses a `gate_origin`
job without approving evidence; an allowlisted non-founder is refused at the write boundary; the
supersession sequence commits (and the naive orders provably do not); the append-only trigger
rejects an edit and a delete; a replayed assertion violates the unique index; a `withdrawn` row
closes the publish gate the map's `pending` implies.

**Fifth round adds five more**, each written against the specific reordering or lifecycle path
that produced it: two in-window assertions delivered newest-first, asserting the older one is
refused `409` and the live decision is unchanged; a Drive file replaced *after* the publish call
and *before* the raw fetch, asserting the raw handler refuses rather than streaming; a revoked
key deleted and re-inserted with the same `key_id`, asserting both statements fail; a transaction
that sets `superseded_at` and commits without a successor, asserting the commit itself raises;
and an `enqueueJob` call for a gated capability with three of the four descriptor fields,
asserting the insert is rejected rather than stored — plus its complement, an unrecognised
capability, asserting it resolves to *gated* rather than to none.

**The sixth round adds eleven more**, and two of them are the kind that only a *positive* test
finds — the deferred supersession trigger and the migration split were both broken in the
direction of rejecting valid work, which every negative test in the suite would have passed:

- the correct three-step supersession **commits** (the test that fails against the round-five
  trigger), and step 1 alone **raises at commit**;
- `0023` then `0024` applied in order from an **empty** database succeeds — asserting the final
  schema instead would not have caught the `ALTER TYPE`/first-use collision;
- `TRUNCATE` on each of the three governance tables raises;
- a gate descriptor cleared, and one retargeted, both raise; `approved_revision_digest` re-stamps
  successfully;
- a `queued` job created **before** the backfill is not claimable afterwards, and the backfill
  moves it to `awaiting_approval`; a governed job with a null descriptor is unclaimable;
- a withdrawal committed during an open publication intent neither interleaves nor is lost: the
  publish either completed before it or never began;
- an assertion whose `scope` is altered outside the signed subject fails verification;
- an assertion whose `decision_seq` is raised in the envelope fails verification;
- an `accord_article` job enqueues without a `productions` row, and an unhandled capability
  **fails** the job rather than marking it done;
- two providers for one capability resolve to different gate rules;
- publish reads `final_video_row_id`, and a production with a null pin cannot be approved.

**Deliberate negative tests.** Every clause of contract 36 that says *never* gets a test proving
the never. A control with no test proving it fails is not a control. **And at least one positive
test per control** — round six's two rejects-everything defects are the argument: a control
tested only by what it forbids can be a control that forbids everything.

---

## 13. Implementation sequence

**B1 — unblocked**

1. `0023` + `0024` migrations + schema (nothing reads it yet).
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
