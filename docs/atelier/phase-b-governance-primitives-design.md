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

Three new tables and two additive column changes. Migration **`0023_governance_primitives.sql`**
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

  -- lineage
  provenance        jsonb NOT NULL DEFAULT '{}',
  superseded_by     uuid REFERENCES approval_evidence(id),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

-- exactly one live decision per (subject, scope)
CREATE UNIQUE INDEX approval_evidence_live
  ON approval_evidence (subject_type, subject_id, scope)
  WHERE superseded_by IS NULL;

CREATE INDEX approval_evidence_subject
  ON approval_evidence (subject_type, subject_id);
```

**Rows are never updated except to set `superseded_by`.** A new decision inserts a new row and
points the old one at it, in one transaction. Nothing is destroyed — which is the property
§2.2's map lacks.

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
  authorized_by_evidence uuid REFERENCES approval_evidence(id),
  reason                 text,
  occurred_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_transitions_subject ON workflow_transitions (subject_type, subject_id, occurred_at);
```

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

### 3.5 `revision_digest` — what exactly is hashed

A digest over the **approval-relevant projection** of the subject, not the whole row — otherwise
`updated_at` invalidates approvals.

- `production`: `brand`, `finalVideoId`, `thumbnailDriveId`, `adIndexCode`, `taggedScript`,
  the resolved final asset ids.
- `accord_package`: the package manifest digest supplied by the domain (contract 31 already
  requires a content-addressed revision, so Creator OS should *carry* that digest, not compute
  a second one).

The projection is defined in one pure function per subject type, unit-tested, and versioned —
`digest_v1:<sha256>` — so a later change to what counts as approval-relevant is visible rather
than silently re-validating old evidence.

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
| `queued → awaiting_approval` | gate evaluation only | a gate applies to this job |
| `running → awaiting_approval` | **nobody** | a running job holds a lease and may have paid work in flight; pause it and the external side effect still lands with nothing tracking it |
| `awaiting_approval → queued` | evidence presentation | live `approval_evidence` for the subject **whose `revision_digest` matches the current digest** |
| `awaiting_approval → cancelled` | authorized principal | recorded as an attributed transition |
| `awaiting_approval → failed` | **never automatically** | — |
| `awaiting_approval → done` | **nobody** | a gate must never be able to complete work |

**Who may request approval:** any principal, human or machine. Requesting is not deciding
(clause 7). **What is required to resume:** live, digest-matching evidence — nothing else, and
notably not "an operator clicked resume".

**Timeout and escalation.** A timeout may *notify* and may *expire to `cancelled`*. It may
**never** transition to `queued`. Contract 36 clause 7 forbids manufacturing an approval, and a
timeout that releases work is a machine manufacturing one by waiting — the most easily-overlooked
version of the failure this whole initiative exists to prevent.

### 4.2 `approved_with_note` operationally

Contract 31 defines it as approval that advances on the approved path, with a mandatory note that
blocks `PUBLICATION_READY` until discharged. In Creator OS terms:

- it satisfies the resume condition in §4.1 (work proceeds);
- it does **not** satisfy the publish gate until every note is discharged;
- discharge is itself `approval_evidence` — `decision = 'approved'` superseding the noted row, or
  an explicit founder-attributed waiver. Never a flag someone clears.

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

- `POST /auth/google/step-up` accepts a Google ID token, verifies it exactly as `/auth/google`
  does (audience, `email_verified`, allowlist) **and additionally rejects it unless its `iat` is
  within `STEP_UP_MAX_AGE_SECONDS` (default 900) of now.** Google's `tokeninfo` returns `iat`
  and `exp`, so this is a real check against the issuer's claim, not a local timer we set
  ourselves.
- On success it issues `rmg_stepup` — signed, `httpOnly`, `secure`, `sameSite: 'lax'`,
  `maxAge` 900 — carrying a step-up id and the authentication instant.
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

The domain signs `{subject, revision_digest, decision, principal_id, asserted_role, issued_at, nonce}`.
Creator OS verifies against the domain's published key, then writes evidence with
`source_system = 'hvnglobalco-com'`, `authorization_ref = <assertion id>`, and the transmitting
principal in `provenance`.

Assertions are single-use (`nonce` recorded, replay rejected) and short-lived. Verification
failure is not an error to log and continue past — it is a refusal.

### 8.3 Why this survives contract 26's write block

The assertion is a **signed artifact**, not a transport. Creator OS can accept it over the fabric
when fabric writes open, or over a direct authenticated call in the meantime, without the security
property changing. Designing the artifact rather than the pipe is what makes that true — and
avoids Phase B blocking on a contract-26 decision that is not ours to make.

### 8.4 The prerequisite

**B2 cannot begin until `hvnglobalco-com` has an authenticated server surface with a signing key.**

**Authorized on founder review (ratified decision 4), and deliberately narrow:** HVN Global gains
the *minimum* authenticated surface required for the governed approval/evidence path — a founder
approval route, a signing key in Doppler, and the constant-time auth pattern already used across
the fleet. **It does not become a general API platform.** A repository that is pages today
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
- Rollback: drop three tables and two columns. The enum value persists (Postgres cannot remove
  one) but is unreachable — acceptable and inert.

---

## 11. Security failure modes

| # | Failure | Mitigation |
|---|---|---|
| 1 | A machine principal writes founder approval | `CHECK (asserted_role <> 'founder' OR principal_kind = 'human')` — refused by the database, not by a code path |
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

**Step-up (§7.1)** — pure: token `iat` older than the window is rejected; `iat` in the future is
rejected; email mismatch between step-up and session is rejected; missing or expired credential
is rejected; `STEP_UP_MAX_AGE_SECONDS` unset falls back to 900 and never to unlimited. Integration:
an approval write without a valid step-up is refused with `step_up_required`, and a successful
one records `auth_age_seconds` in provenance.

**A test for what the `CHECK` does *not* do.** One test writes a row with
`principal_kind = 'human'` from a caller that is not a human and shows the constraint **accepts**
it — proving the check is a coherence guard, not authorization, and that the real gate is
enforced upstream. A test that only demonstrates the happy path would let a later reader repeat
this document's original error.

**Deliberate negative tests.** Every clause of contract 36 that says *never* gets a test proving
the never. A control with no test proving it fails is not a control.

---

## 13. Implementation sequence

**B1 — unblocked**

1. `0023` migration + schema (nothing reads it yet).
2. Digest projection functions + tests.
3. Step-up credential (§7.1): `POST /auth/google/step-up`, the `rmg_stepup` cookie, and the
   `step_up_required` refusal. Landed **before** the write path that depends on it, so the
   evidence path is never briefly writable without it.
4. `approval_evidence` write path behind `PATCH /productions/:id/approvals`, requiring a valid
   step-up and recording the session email as a `human` principal, with `auth_age_seconds` in
   provenance; dual-write the legacy map.
5. Widen `checkDeliveryApproval`; publish gate reads evidence.
6. `workflow_transitions` on the transitions that already exist.
7. Backfill legacy approvals as unbound history.

**B1.5 — small, sequencing-critical**

8. `awaiting_approval` enum value + transition rules + the Phase A invisibility regression tests.
   Nothing uses it yet; landing it before any gate needs it keeps that PR small.

**B2 — blocked on `hvnglobalco-com`**

9. Registry `PrincipalKind` change (governed, `rmg-piaar-system` first, mirror second).
10. HVN Global's first authenticated route + signing key — scoped per §8.4.
11. `packages/identity` / `authz` human principal support.
12. Assertion verification and ingest in Creator OS.
13. `work_items` + article-shaped production.

Steps 1–8 are safe to build and merge without any of 9–13. That is the point of the split, and
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
| Work-item parent | |
| Dual-write compatibility with the legacy approvals map | |
| Step-up authentication (§7.1) | |
