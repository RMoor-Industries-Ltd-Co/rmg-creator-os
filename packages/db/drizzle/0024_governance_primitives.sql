-- Phase B1 — governance primitives, part 2 of 2: tables, constraints, triggers, indexes.
--
-- Requires 0023 to have COMMITTED (see its header). Everything here may reference the enum
-- values 0023 added.
--
-- Additive only. Nothing existing reads any of it, so this is safe to apply ahead of the
-- code that uses it.
--
-- Design: docs/atelier/phase-b-governance-primitives-design.md §3, §4, §10.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------------------
-- signing_keys — the fact revocation needs.
-- Created in B1 with the rest even though only B2 writes it: a gate predicate that joins a
-- table which may or may not exist is not a predicate.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signing_keys (
  key_id       text PRIMARY KEY,
  domain       text NOT NULL,
  public_key   text NOT NULL,
  status       signing_key_status NOT NULL DEFAULT 'active',
  activated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  CONSTRAINT revoked_has_timestamp
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- Revocation is one-way in STATUS and in EXISTENCE. One-way status alone is not enough: a
-- lifecycle path could DELETE a revoked row and re-INSERT the same key_id as active, and
-- because gate reads consult the current status row rather than re-verifying the original
-- assertion, every piece of evidence under that id would become authoritative again.
-- The lifecycle timestamps are frozen for the same reason the status is: they are the audit
-- record of when a key became trusted and when its evidence stopped being authoritative.
CREATE OR REPLACE FUNCTION signing_keys_append_only() RETURNS trigger AS $$
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
  IF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'signing_keys: activated_at is immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'signing_keys: revoked_at is immutable once set';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS signing_keys_no_delete ON signing_keys;
CREATE TRIGGER signing_keys_no_delete
  BEFORE UPDATE OR DELETE ON signing_keys
  FOR EACH ROW EXECUTE FUNCTION signing_keys_append_only();

-- ---------------------------------------------------------------------------------------
-- approval_evidence — append-only record of WHO decided WHAT about WHICH revision.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS approval_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  subject_type      text NOT NULL,
  subject_id        text NOT NULL,
  scope             text NOT NULL,
  revision_digest   text NOT NULL,

  -- 'withdrawn' is a first-class decision, not a UI state: every `pending` toggle inserts
  -- one. Omitting it here would produce a validator that rejects every withdrawal.
  decision          text NOT NULL,
  notes             text,

  principal_id      text NOT NULL,
  principal_kind    principal_kind NOT NULL,
  asserted_role     text NOT NULL,
  source_system     text NOT NULL,
  authorization_ref text,

  approved_package  jsonb,

  signing_key_id    text REFERENCES signing_keys(key_id),
  assertion_id      text,
  -- Monotonic per (subject, scope). Freshness is not ordering: two assertions minted inside
  -- the same age window can be delivered out of order, and without an ordinal the older
  -- approval would supersede the newer rejection.
  decision_seq      bigint NOT NULL,

  -- When the DECISION was made, as distinct from when Creator OS recorded it. NULLABLE
  -- deliberately: legacy backfilled rows have no knowable decision time, and NOT NULL would
  -- force the migration to write its own timestamp and present it as the founder's.
  decided_at        timestamptz,

  provenance        jsonb NOT NULL DEFAULT '{}',
  superseded_at     timestamptz,
  superseded_by     uuid REFERENCES approval_evidence(id),
  recorded_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT decision_vocabulary
    CHECK (decision IN ('approved','approved_with_note','rejected','revision_required','withdrawn')),

  -- Both halves are load-bearing. btrim() strips spaces only, so a lone tab passed the first
  -- version; but `notes ~ ...` is NULL when notes is NULL and PostgreSQL ACCEPTS a CHECK
  -- evaluating to NULL, so the regex alone reopened the missing-note hole it replaced.
  CONSTRAINT note_required_for_noted_approval
    CHECK (decision <> 'approved_with_note'
           OR (notes IS NOT NULL AND notes ~ '[^[:space:]]')),

  -- Defense in depth, NOT authorization. A caller can label itself 'human' and satisfy this;
  -- authorization lives upstream in the fabric/domain boundary (ratified decision 7). This
  -- only prevents an obviously incoherent row.
  CONSTRAINT founder_is_human
    CHECK (asserted_role <> 'founder' OR principal_kind = 'human'),

  -- NULLs are distinct in a unique index, so a row carrying assertion_id without
  -- signing_key_id would satisfy the replay index on EVERY replay. Both, or neither.
  CONSTRAINT assertion_fields_paired
    CHECK ((signing_key_id IS NULL) = (assertion_id IS NULL)),

  CONSTRAINT decided_at_required_unless_legacy
    CHECK (decided_at IS NOT NULL OR asserted_role = 'legacy-unattributed')
);

-- Exactly one live decision per (subject, scope). Concurrent decisions collide at the
-- database rather than interleaving.
CREATE UNIQUE INDEX IF NOT EXISTS approval_evidence_live
  ON approval_evidence (subject_type, subject_id, scope)
  WHERE superseded_at IS NULL;

-- Replay refused by the database, not by a read-then-write existence check.
CREATE UNIQUE INDEX IF NOT EXISTS approval_evidence_assertion
  ON approval_evidence (signing_key_id, assertion_id)
  WHERE assertion_id IS NOT NULL;

-- An ordinal is never reoccupied, so an out-of-order redelivery cannot claim a decided slot.
CREATE UNIQUE INDEX IF NOT EXISTS approval_evidence_seq
  ON approval_evidence (subject_type, subject_id, scope, decision_seq);

CREATE INDEX IF NOT EXISTS approval_evidence_subject
  ON approval_evidence (subject_type, subject_id);

-- Append-only, enforced rather than asserted. A trigger rather than role permissions because
-- the gateway legitimately needs UPDATE for the two supersession columns.
CREATE OR REPLACE FUNCTION approval_evidence_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval_evidence is append-only';
  END IF;
  IF (to_jsonb(NEW) - 'superseded_at' - 'superseded_by')
     IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by') THEN
    RAISE EXCEPTION 'approval_evidence: only supersession fields may change';
  END IF;
  -- Monotonic, not merely one-time. Checking only "were both already set?" permitted a second
  -- update to CLEAR superseded_at while setting superseded_by — reviving a superseded row.
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

DROP TRIGGER IF EXISTS approval_evidence_append_only ON approval_evidence;
CREATE TRIGGER approval_evidence_append_only
  BEFORE UPDATE OR DELETE ON approval_evidence
  FOR EACH ROW EXECUTE FUNCTION approval_evidence_immutable();

-- Supersession completeness, checked at COMMIT.
--
-- It MUST re-read the current row rather than judge NEW. PostgreSQL queues a separate
-- deferred event per row-update, each with its own frozen NEW snapshot; the legitimate
-- sequence updates the row twice, so step 1's event would still see superseded_by IS NULL
-- and would reject every correct supersession. Re-reading makes the check idempotent in the
-- number of times it fires.
CREATE OR REPLACE FUNCTION approval_evidence_supersession_complete() RETURNS trigger AS $$
DECLARE cur approval_evidence%ROWTYPE;
        succ approval_evidence%ROWTYPE;
BEGIN
  SELECT * INTO cur FROM approval_evidence WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
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
  -- Ordering compares decision_seq, not recorded_at: a clock reading is not an order.
  IF succ.decision_seq <= cur.decision_seq THEN
    RAISE EXCEPTION 'approval_evidence %: successor % does not follow it in sequence',
                    cur.id, cur.superseded_by;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS approval_evidence_supersession_complete ON approval_evidence;
CREATE CONSTRAINT TRIGGER approval_evidence_supersession_complete
  AFTER UPDATE ON approval_evidence
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION approval_evidence_supersession_complete();

-- ---------------------------------------------------------------------------------------
-- workflow_transitions — attributed state changes, written with the change they record.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type   text NOT NULL,
  subject_id     text NOT NULL,
  from_state     text,
  to_state       text NOT NULL,
  reason         text,
  evidence_id    uuid REFERENCES approval_evidence(id),
  -- Authority context lives on every transition, including those with no linked evidence:
  -- otherwise an unlinked transition carries no answer to "under what authority".
  principal_id   text NOT NULL,
  principal_kind principal_kind NOT NULL,
  asserted_role  text NOT NULL,
  source_system  text NOT NULL,
  auth_context   jsonb NOT NULL DEFAULT '{}',
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_transitions_subject
  ON workflow_transitions (subject_type, subject_id, occurred_at);

-- Nothing about a recorded transition ever legitimately changes.
CREATE OR REPLACE FUNCTION workflow_transitions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'workflow_transitions is append-only';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workflow_transitions_append_only ON workflow_transitions;
CREATE TRIGGER workflow_transitions_append_only
  BEFORE UPDATE OR DELETE ON workflow_transitions
  FOR EACH ROW EXECUTE FUNCTION workflow_transitions_immutable();

-- ---------------------------------------------------------------------------------------
-- work_items — a sibling parent for non-video work (Accord articles).
-- Rejected alternatives: generalising `productions` (≈20 video-only columns would be NULL,
-- and every video path would start asking "is this actually a video?"); a shell production
-- per article (fabricating a fake video is a shortcut that is never removed); a parent above
-- `productions` (a join on the hot claim path Phase A just made atomic).
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS work_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  brand        text NOT NULL,
  title        text,
  state        text NOT NULL DEFAULT 'active',
  external_ref text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------
-- publication_intents — serializes withdrawal against an in-flight publish.
-- A gate read is a moment; publication is an interval. Without this, a withdrawal committing
-- between the gate check and the outbound request lets the post go out anyway.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS publication_intents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type     text NOT NULL,
  subject_id       text NOT NULL,
  scope            text NOT NULL,
  evidence_id      uuid NOT NULL REFERENCES approval_evidence(id),
  revision_digest  text NOT NULL,
  phase            publication_intent_phase NOT NULL DEFAULT 'claimed',
  lease_expires_at timestamptz NOT NULL,
  remote_post_id   text,
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  CONSTRAINT published_has_remote_id
    CHECK (phase <> 'published' OR remote_post_id IS NOT NULL)
);

-- One open intent per (subject, scope): a second concurrent publish collides on the index
-- rather than racing. 'unknown' counts as OPEN and deliberately keeps the slot held — an
-- unknown remote outcome must block a retry until an operator establishes what happened,
-- because releasing it could let a withdrawal commit and a duplicate post follow.
CREATE UNIQUE INDEX IF NOT EXISTS publication_intents_open
  ON publication_intents (subject_type, subject_id, scope)
  WHERE phase IN ('claimed','transmitting','unknown');

CREATE INDEX IF NOT EXISTS publication_intents_evidence
  ON publication_intents (evidence_id);

-- ---------------------------------------------------------------------------------------
-- TRUNCATE guards.
-- Row-level DELETE triggers DO NOT FIRE for TRUNCATE, and Creator OS runs migrations and
-- application queries under the same identity, so the runtime role owns these tables and
-- holds truncate rights by default. One statement could otherwise erase the whole audit
-- history and free every key_id for reuse, past every append-only trigger above.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION governance_table_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: TRUNCATE is not permitted', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS approval_evidence_no_truncate ON approval_evidence;
CREATE TRIGGER approval_evidence_no_truncate BEFORE TRUNCATE ON approval_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION governance_table_no_truncate();

DROP TRIGGER IF EXISTS workflow_transitions_no_truncate ON workflow_transitions;
CREATE TRIGGER workflow_transitions_no_truncate BEFORE TRUNCATE ON workflow_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION governance_table_no_truncate();

DROP TRIGGER IF EXISTS signing_keys_no_truncate ON signing_keys;
CREATE TRIGGER signing_keys_no_truncate BEFORE TRUNCATE ON signing_keys
  FOR EACH STATEMENT EXECUTE FUNCTION governance_table_no_truncate();

-- ---------------------------------------------------------------------------------------
-- production_jobs — the work-item parent and the gate descriptor.
-- ---------------------------------------------------------------------------------------

ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES work_items(id) ON DELETE CASCADE;
ALTER TABLE production_jobs ALTER COLUMN production_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_one_parent
    CHECK (num_nonnulls(production_id, work_item_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The gate descriptor. Four fields, written atomically by enqueueJob from SERVER-SIDE policy
-- and never from caller input. Stored rather than re-resolved at each read so that four
-- readers (enqueue, retry, claim, sweep) cannot each infer a different evidence tuple.
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS gate_origin              text;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS gate_subject_type        text;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS gate_subject_id          text;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS gate_scope               text;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS approved_revision_digest text;

-- 'gated' | 'ungated'. NULL means UNRESOLVED and nothing else — an unresolved job is not
-- claimable. Without this column a NULL descriptor would have to mean both "policy returned
-- no gate" and "the backfill missed this row", and claim cannot tell them apart by
-- re-resolving because autonomy_level is not persisted on the job.
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS gate_resolution          text;

DO $$ BEGIN
  ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_gate_resolution_vocabulary
    CHECK (gate_resolution IS NULL OR gate_resolution IN ('gated','ungated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A half-written gate is not a gate. Evaluated on every insert and update, so a caller
-- supplying three of four fields is rejected rather than stored.
DO $$ BEGIN
  ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_gate_complete
    CHECK (num_nonnulls(gate_origin, gate_subject_type, gate_subject_id, gate_scope) IN (0, 4));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'gated' requires the whole descriptor; 'ungated' requires none of it.
DO $$ BEGIN
  ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_gate_resolution_coherent
    CHECK (gate_resolution IS NULL
           OR (gate_resolution = 'gated'   AND gate_origin IS NOT NULL)
           OR (gate_resolution = 'ungated' AND gate_origin IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A gated job must actually be gated at rest.
--
-- NOTE THE ::text CAST, AND DO NOT "SIMPLIFY" IT AWAY.
--
-- `status <> 'awaiting_approval'` compares against an enum LITERAL, and PostgreSQL rejects
-- that with 55P04 "unsafe use of new value" whenever the value was added by an
-- `ALTER TYPE ... ADD VALUE` in the same transaction. Splitting the ADD VALUE into its own
-- migration file does NOT help: Drizzle's migrator runs every pending migration inside ONE
-- transaction, so 0023 and 0024 share it on a fresh database. (This was found by running the
-- migrations against real PostgreSQL 16 — the design document's proposed file split alone
-- would have failed on deploy.)
--
-- Casting the column to text compares strings instead of enum literals, which carries no
-- such restriction and is equivalent here.
DO $$ BEGIN
  ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_gate_status
    CHECK (status::text <> 'awaiting_approval' OR gate_origin IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The descriptor is frozen once written. The CHECKs above constrain a row's SHAPE, not its
-- HISTORY: num_nonnulls(...) IN (0,4) happily accepts a 4 -> 0 transition, and the status
-- CHECK stops applying the moment the job leaves awaiting_approval — so an UPDATE could
-- clear gate_origin on a cancelled job just before retry, or repoint all four fields at an
-- unrelated approved tuple just before claim.
--
-- approved_revision_digest is deliberately NOT frozen: it is re-stamped at each legitimate
-- resume, which is what claim-time revalidation compares against.
CREATE OR REPLACE FUNCTION production_jobs_gate_descriptor_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.gate_origin IS NOT NULL AND
     (NEW.gate_origin, NEW.gate_subject_type, NEW.gate_subject_id, NEW.gate_scope)
     IS DISTINCT FROM
     (OLD.gate_origin, OLD.gate_subject_type, OLD.gate_subject_id, OLD.gate_scope) THEN
    RAISE EXCEPTION 'production_jobs %: gate descriptor is immutable once set', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS production_jobs_gate_frozen ON production_jobs;
CREATE TRIGGER production_jobs_gate_frozen
  BEFORE UPDATE ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION production_jobs_gate_descriptor_frozen();

-- Serves the waiting-for-approval surface and the stale-gate sweep.
--
-- DELIBERATELY NOT A PARTIAL INDEX. `WHERE status = 'awaiting_approval'` would be the
-- narrower index, and it hits the same 55P04 restriction as the CHECK above: an index
-- predicate naming an enum value added in the current transaction is rejected. Unlike the
-- CHECK, a `status::text` predicate is not a clean workaround either — enum output is only
-- STABLE, not IMMUTABLE, and an index predicate requires immutability.
--
-- A composite index leading with `status` serves the same queries. The cost is index size on
-- a table whose other statuses are numerous; the benefit is a migration that applies.
CREATE INDEX IF NOT EXISTS production_jobs_status_enqueued
  ON production_jobs (status, enqueued_at);

-- ---------------------------------------------------------------------------------------
-- productions.final_video_row_id — the one pin with one meaning.
--
-- TEXT, not uuid: videos.id is declared text (packages/db/src/schema.ts, migration 0001),
-- and PostgreSQL refuses a foreign key across incompatible types.
--
-- Nullable and unpopulated here. Per ratified decision 10 (D-I) this names the APPROVED
-- CANONICAL render — not the first successful provider output and not the newest row by
-- updated_at — so populating it belongs with the candidate/canonical work that defines what
-- "approved" means for a render. Adding the column now keeps the migration inventory whole;
-- writing it before that model exists would reintroduce the ambiguity D-I removed.
-- ---------------------------------------------------------------------------------------

ALTER TABLE productions ADD COLUMN IF NOT EXISTS final_video_row_id text REFERENCES videos(id);
