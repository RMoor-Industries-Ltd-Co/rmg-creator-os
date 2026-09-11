-- Phase B1 — governance primitives, part 1 of 2: ENUM VALUES AND TYPES ONLY.
--
-- THE SPLIT FROM 0024 IS MANDATORY, NOT STYLISTIC.
--
-- Drizzle wraps each migration file in one transaction, and PostgreSQL refuses to *use* a
-- value added by `ALTER TYPE ... ADD VALUE` until the adding transaction has committed. (The
-- exception is an enum created in that same transaction; `production_job_status` and
-- `production_job_capability` were not.) 0024 declares CHECK constraints that name
-- 'awaiting_approval', so a single combined migration would abort partway through and B1
-- could not deploy at all.
--
-- Therefore: NOTHING in this file may reference the values it adds. Adding such a reference
-- here reintroduces the failure this split exists to prevent.
--
-- Design: docs/atelier/phase-b-governance-primitives-design.md §4.1, §10.

-- Durable pause for gated work. Invisible to Phase A's claim (status = 'queued') and
-- recovery (status = 'running') queries, so existing behaviour is bit-identical.
ALTER TYPE production_job_status ADD VALUE IF NOT EXISTS 'awaiting_approval';

-- Article/editorial work. Without it no Accord job can be enqueued at all: `enqueueJob`
-- requires one of the existing video capabilities, so an article would have to masquerade as
-- a video task. Dispatch for this capability fails the job explicitly until B2 gives it a
-- handler — never a silent no-op that marks unperformed work done.
ALTER TYPE production_job_capability ADD VALUE IF NOT EXISTS 'accord_article';

-- Who acted. The three machine values mirror the PIAAR registry's SystemKind exactly;
-- 'human' is the addition contract 36 clause 3 requires. Creator OS records WHO acted and
-- never resolves or grants on it — authorization lives in the fabric/domain boundary.
DO $$ BEGIN
  CREATE TYPE principal_kind AS ENUM ('human','agent','processor','domain-service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Key lifecycle. An enum rather than text because a misspelled status would fail the
-- `status = 'revoked'` test and silently leave compromised evidence authoritative.
DO $$ BEGIN
  CREATE TYPE signing_key_status AS ENUM ('active','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Publication lifecycle. 'unknown' is a terminal-until-reconciled state, not a failure:
-- when a publisher's response is lost past its lease the remote outcome is genuinely
-- unknown, and releasing the intent would free the uniqueness slot for a duplicate.
DO $$ BEGIN
  CREATE TYPE publication_intent_phase AS ENUM ('claimed','transmitting','published','failed','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
