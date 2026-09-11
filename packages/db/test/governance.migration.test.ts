import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from './support/database.js';

// Phase B1 governance primitives — asserted against REAL PostgreSQL, by applying the REAL
// migration files in order to an EMPTY database.
//
// Why not a hand-written schema, as queue.integration.test.ts uses? Because that approach is
// structurally incapable of catching the defects that matter most here. Two examples, both
// real and both found by this file rather than by review:
//
//   * `productions.final_video_row_id uuid REFERENCES videos(id)` cannot be created at all —
//     `videos.id` is `text`. A hand-written CREATE TABLE would have used whatever type the
//     test author chose and passed.
//   * Splitting `ALTER TYPE ... ADD VALUE` into its own migration file does NOT create a
//     commit boundary under Drizzle's migrator, which runs every pending migration in ONE
//     transaction — so a CHECK or index naming the new value still fails with 55P04. Only
//     running the actual migrator against an actual database shows this.
//
// Skipped when TEST_DATABASE_URL is unset so a bare `pnpm test` stays green; CI sets it
// against a postgres:16 service, so these DO run on every pull request.
const DB_URL = process.env.TEST_DATABASE_URL;
const d = DB_URL ? describe : describe.skip;

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Assert a statement is refused, and refused for the RIGHT reason.
 *
 * Drizzle wraps driver errors, so `error.message` is only "Failed query: ..." and the
 * PostgreSQL message (the trigger's RAISE text, the constraint name) is on `.cause`. A bare
 * `.rejects.toThrow()` would pass for any failure at all — including a typo in the SQL —
 * which is exactly the false confidence these tests exist to avoid.
 */
async function refused(run: () => Promise<unknown>, match: RegExp): Promise<void> {
  let err: unknown;
  try { await run(); } catch (e) { err = e; }
  expect(err, 'expected the statement to be refused, but it succeeded').toBeDefined();
  const cause = (err as { cause?: { message?: string } })?.cause;
  const text = `${(err as Error).message} ${cause?.message ?? ''}`;
  expect(text).toMatch(match);
}

d('Phase B1 governance primitives — real migrations, real Postgres', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    // A dedicated, freshly created database — not a cleaned one. "Applies from empty" is
    // the assertion this whole file rests on, so the starting state cannot be something a
    // previous run or a parallel suite also touched.
    const url = await provisionDatabase('governance');
    pool = new Pool({ connectionString: url! });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS });
  }, 120_000);

  afterAll(async () => { await pool?.end(); });

  // ── the migration chain itself ──────────────────────────────────────────────────────
  it('applies every migration from an empty database', async () => {
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    expect(Number((r.rows[0] as { n: number }).n)).toBeGreaterThanOrEqual(25);
  });

  it('is idempotent — re-running the migrator changes nothing', async () => {
    await expect(migrate(db, { migrationsFolder: MIGRATIONS })).resolves.toBeUndefined();
  });

  it('created the final-video pin with a type compatible with videos.id', async () => {
    const r = await db.execute(sql`
      SELECT data_type FROM information_schema.columns
       WHERE table_name = 'productions' AND column_name = 'final_video_row_id'`);
    expect((r.rows[0] as { data_type: string })?.data_type).toBe('text');
  });

  // ── signing_keys: revocation is one-way in status AND existence ─────────────────────
  describe('signing_keys', () => {
    beforeAll(async () => {
      await db.execute(sql`INSERT INTO signing_keys(key_id,domain,public_key) VALUES ('k-live','d','pk')
                           ON CONFLICT DO NOTHING`);
    });

    it('refuses DELETE, so a revoked key id can never be freed for reuse', async () => {
      await refused(() => db.execute(sql`DELETE FROM signing_keys WHERE key_id='k-live'`), /append-only/);
    });

    it('refuses TRUNCATE, which row-level DELETE triggers do not cover', async () => {
      // CASCADE for the same reason as the approval_evidence case below: without it the
      // foreign key from approval_evidence.signing_key_id refuses first and the trigger is
      // never reached, so the test would pass without exercising the guard at all.
      await refused(() => db.execute(sql`TRUNCATE signing_keys CASCADE`), /TRUNCATE is not permitted/);
    });

    it('refuses un-revoking a revoked key', async () => {
      await db.execute(sql`INSERT INTO signing_keys(key_id,domain,public_key,status,revoked_at)
                           VALUES ('k-rev','d','pk','revoked',now()) ON CONFLICT DO NOTHING`);
      await refused(
        () => db.execute(sql`UPDATE signing_keys SET status='active', revoked_at=NULL WHERE key_id='k-rev'`),
        /one-way/);
    });

    it('refuses a revocation timestamp earlier than activation', async () => {
      // Pairing without ordering admits an impossible trust interval, and the lifecycle
      // trigger then freezes both timestamps — so the nonsense would be permanent.
      await refused(() => db.execute(sql`
        INSERT INTO signing_keys(key_id,domain,public_key,status,activated_at,revoked_at)
        VALUES ('k-backwards','d','pk','revoked', now(), now() - interval '1 day')`),
        /revoked_after_activated/);
    });

    it('freezes the lifecycle timestamps that record the trust window', async () => {
      await refused(
        () => db.execute(sql`UPDATE signing_keys SET activated_at=now() WHERE key_id='k-live'`),
        /activated_at is immutable/);
    });
  });

  // ── approval_evidence ───────────────────────────────────────────────────────────────
  describe('approval_evidence', () => {
    // A positive decision must carry the package it authorizes, so the default here does —
    // otherwise every helper call would be exercising the legacy exemption by accident.
    const PKG = { platforms: ['x'], caption: 'c', type: 'post', date: '2026-01-01' };

    const ins = (over: Record<string, unknown> = {}) => {
      const v = {
        subject_type: 'production', subject_id: 'p-' + Math.random().toString(36).slice(2),
        scope: 'vlog', revision_digest: 'd1', decision: 'approved', notes: null,
        principal_id: 'rahm@business', principal_kind: 'human', asserted_role: 'founder',
        source_system: 'rmg-creator-os', decision_seq: 1, decided_at: new Date(),
        approved_package: PKG, ...over
      } as Record<string, unknown>;
      return db.execute(sql`
        INSERT INTO approval_evidence
          (subject_type,subject_id,scope,revision_digest,decision,notes,principal_id,
           principal_kind,asserted_role,source_system,decision_seq,decided_at,approved_package)
        VALUES (${v.subject_type},${v.subject_id},${v.scope},${v.revision_digest},${v.decision},
                ${v.notes},${v.principal_id},${sql.raw(`'${v.principal_kind}'::principal_kind`)},
                ${v.asserted_role},${v.source_system},${v.decision_seq},${v.decided_at},
                ${v.approved_package === null ? null : JSON.stringify(v.approved_package)})
        RETURNING id`);
    };

    it('accepts withdrawn as a decision — every pending toggle inserts one', async () => {
      await expect(ins({ decision: 'withdrawn' })).resolves.toBeTruthy();
    });

    it('rejects a noted approval whose note is NULL', async () => {
      // A CHECK evaluating to NULL is ACCEPTED by Postgres, so the regex alone was not a
      // constraint. This proves the explicit NOT NULL half is doing work.
      await expect(ins({ decision: 'approved_with_note', notes: null })).rejects.toThrow();
    });

    it('rejects a noted approval whose note is only whitespace', async () => {
      await expect(ins({ decision: 'approved_with_note', notes: '\t\n ' })).rejects.toThrow();
    });

    it('rejects an incoherent founder row (asserted founder, non-human kind)', async () => {
      await expect(ins({ principal_kind: 'agent' })).rejects.toThrow();
    });

    // Ratified decision 7, stated as a NEGATIVE on purpose.
    it('ACCEPTS a falsified principal_kind — the constraint is not authorization', async () => {
      await expect(ins({ principal_id: 'a-lying-bot', principal_kind: 'human' })).resolves.toBeTruthy();
    });

    it('requires an approved package for a live positive decision', async () => {
      // Without this, an 'approved' row satisfies decision, liveness, digest and key
      // predicates while authorizing no particular outbound package at all.
      await expect(ins({ approved_package: null })).rejects.toThrow();
      await expect(ins({ decision: 'approved_with_note', notes: 'n', approved_package: null }))
        .rejects.toThrow();
      // Non-approving decisions have nothing to authorize, so they are exempt.
      await expect(ins({ decision: 'rejected', approved_package: null })).resolves.toBeTruthy();
      // Legacy history is exempt too — it deliberately fails the digest check anyway.
      await expect(ins({
        approved_package: null, asserted_role: 'legacy-unattributed',
        principal_kind: 'processor', decided_at: null, revision_digest: 'legacy:unbound'
      })).resolves.toBeTruthy();
    });

    it('ties the legacy package exemption to the unbound digest', async () => {
      // Keyed on asserted_role alone, the exemption trusted a caller-supplied label: a row
      // could claim to be legacy, omit the package, carry the subject's CURRENT digest, stay
      // live, and satisfy every gate predicate.
      await expect(ins({
        approved_package: null, asserted_role: 'legacy-unattributed',
        principal_kind: 'processor', decided_at: null, revision_digest: 'a-real-digest'
      })).rejects.toThrow();
      await expect(ins({
        approved_package: null, asserted_role: 'legacy-unattributed',
        principal_kind: 'processor', decided_at: null, revision_digest: 'legacy:unbound'
      })).resolves.toBeTruthy();
    });

    it('refuses a LIVE row that already names a successor', async () => {
      // The deferred check returned early whenever superseded_at was null, skipping this —
      // and the append-only trigger would then have made the bad pointer unrepairable.
      const a = await ins({ subject_id: 'p-livesucc' });
      const aid = (a.rows[0] as { id: string }).id;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO approval_evidence (subject_type,subject_id,scope,revision_digest,decision,
             principal_id,principal_kind,asserted_role,source_system,decision_seq,decided_at,
             approved_package,superseded_by)
           VALUES ('production','p-livesucc2','vlog','d1','approved','rahm','human','founder',
                   'rmg-creator-os',1,now(),'{}'::jsonb,$1)`, [aid]);
        await refused(() => client.query('COMMIT'), /live row may not name a successor/);
      } finally { client.release(); }
    });

    it('bounds decision_seq to the exact-integer range the model reads it with', async () => {
      // The Drizzle model uses mode:'number'; beyond 2^53-1 adjacent ordinals collapse on
      // read and the monotonic-ordering rule silently stops holding.
      await expect(ins({ decision_seq: 9007199254740992 })).rejects.toThrow();
      await expect(ins({ decision_seq: -1 })).rejects.toThrow();
      await expect(ins({ decision_seq: 9007199254740991 })).resolves.toBeTruthy();
    });

    it('validates supersession coherence on INSERT, not only on UPDATE', async () => {
      // The append-only trigger fires on UPDATE/DELETE only, so an INSERT was the one moment
      // a malformed lineage could be written — and immutability then makes it permanent.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO approval_evidence (subject_type,subject_id,scope,revision_digest,decision,
             principal_id,principal_kind,asserted_role,source_system,decision_seq,decided_at,
             approved_package,superseded_at)
           VALUES ('production','p-badinsert','vlog','d1','approved','rahm','human','founder',
                   'rmg-creator-os',1,now(),'{}'::jsonb,now())`);
        await expect(client.query('COMMIT')).rejects.toThrow(/no successor/);
      } finally { client.release(); }
    });

    it('requires decided_at except for legacy-unattributed backfill rows', async () => {
      await expect(ins({ decided_at: null })).rejects.toThrow();
      await expect(
        ins({ decided_at: null, asserted_role: 'legacy-unattributed', principal_kind: 'processor',
              revision_digest: 'legacy:unbound' })
      ).resolves.toBeTruthy();
    });

    it('permits only one live decision per (subject, scope)', async () => {
      const id = 'p-uniq';
      await ins({ subject_id: id });
      await expect(ins({ subject_id: id, decision_seq: 2 })).rejects.toThrow();
    });

    it('refuses DELETE and refuses TRUNCATE', async () => {
      await refused(() => db.execute(sql`DELETE FROM approval_evidence WHERE subject_id='p-uniq'`),
        /append-only/);
      // CASCADE deliberately. A bare `TRUNCATE approval_evidence` is refused by the foreign
      // keys from workflow_transitions and publication_intents, NOT by the trigger — so the
      // bare form would pass this test while proving nothing about the guard. CASCADE clears
      // the FK objection and leaves the trigger as the only thing that can refuse.
      await refused(() => db.execute(sql`TRUNCATE approval_evidence CASCADE`),
        /TRUNCATE is not permitted/);
    });

    it('refuses to revive a superseded row by clearing superseded_at', async () => {
      const a = await ins({ subject_id: 'p-revive' });
      const aid = (a.rows[0] as { id: string }).id;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE approval_evidence SET superseded_at=now() WHERE id=$1`, [aid]);
        const b = await client.query(
          `INSERT INTO approval_evidence (subject_type,subject_id,scope,revision_digest,decision,
             principal_id,principal_kind,asserted_role,source_system,decision_seq,decided_at)
           VALUES ('production','p-revive','vlog','d2','rejected','rahm','human','founder',
                   'rmg-creator-os',2,now()) RETURNING id`);
        await client.query(`UPDATE approval_evidence SET superseded_by=$2 WHERE id=$1`, [aid, b.rows[0].id]);
        await client.query('COMMIT');
      } finally { client.release(); }
      await refused(
        () => db.execute(sql`UPDATE approval_evidence SET superseded_at=NULL, superseded_by=NULL WHERE id=${aid}`),
        /immutable once set/);
    });

    // The two-sided pair. The round-5 version of this trigger PASSED every negative test in
    // this file and rejected every valid supersession — only the positive case catches that.
    it('COMMITS the correct three-step supersession sequence', async () => {
      const a = await ins({ subject_id: 'p-seq' });
      const aid = (a.rows[0] as { id: string }).id;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE approval_evidence SET superseded_at=now() WHERE id=$1`, [aid]);
        const b = await client.query(
          `INSERT INTO approval_evidence (subject_type,subject_id,scope,revision_digest,decision,
             principal_id,principal_kind,asserted_role,source_system,decision_seq,decided_at)
           VALUES ('production','p-seq','vlog','d2','rejected','rahm','human','founder',
                   'rmg-creator-os',2,now()) RETURNING id`);
        await client.query(`UPDATE approval_evidence SET superseded_by=$2 WHERE id=$1`, [aid, b.rows[0].id]);
        await expect(client.query('COMMIT')).resolves.toBeTruthy();
      } finally { client.release(); }
    });

    it('RAISES AT COMMIT when step 1 runs alone, leaving the subject undecided', async () => {
      const a = await ins({ subject_id: 'p-halfway' });
      const aid = (a.rows[0] as { id: string }).id;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE approval_evidence SET superseded_at=now() WHERE id=$1`, [aid]);
        // The check is DEFERRED, so it fires here and not on the UPDATE above.
        await refused(() => client.query('COMMIT'), /no successor/);
      } finally { client.release(); }
    });
  });

  // ── production_jobs gate descriptor ─────────────────────────────────────────────────
  describe('production_jobs gate descriptor', () => {
    beforeAll(async () => {
      await db.execute(sql`INSERT INTO productions (id,brand,topic) VALUES ('pj-prod','vlog','t')
                           ON CONFLICT DO NOTHING`);
    });

    const job = (cols: string, vals: string) => db.execute(sql.raw(`
      INSERT INTO production_jobs (production_id,capability,provider${cols})
      VALUES ('pj-prod','aroll','heygen'${vals}) RETURNING id`));

    it('rejects a partial gate descriptor — three of four fields', async () => {
      await expect(job(`,gate_origin,gate_subject_type,gate_subject_id`, `,'r','production','s'`))
        .rejects.toThrow();
    });

    it('accepts a complete descriptor, and none at all', async () => {
      await expect(job(`,gate_origin,gate_subject_type,gate_subject_id,gate_scope,gate_resolution`,
                       `,'r','production','s','vlog','gated'`)).resolves.toBeTruthy();
      await expect(job(``, ``)).resolves.toBeTruthy();
    });

    it('rejects gate_resolution values outside the vocabulary', async () => {
      await expect(job(`,gate_resolution`, `,'maybe'`)).rejects.toThrow();
    });

    it("rejects 'gated' with no descriptor and 'ungated' with one", async () => {
      await expect(job(`,gate_resolution`, `,'gated'`)).rejects.toThrow();
      await expect(job(`,gate_origin,gate_subject_type,gate_subject_id,gate_scope,gate_resolution`,
                       `,'r','production','s','vlog','ungated'`)).rejects.toThrow();
    });

    it('freezes the descriptor once written, but lets the digest be re-stamped', async () => {
      const r = await job(`,gate_origin,gate_subject_type,gate_subject_id,gate_scope,gate_resolution`,
                          `,'r','production','s2','vlog','gated'`);
      const id = (r.rows[0] as { id: string }).id;
      await refused(() => db.execute(sql`UPDATE production_jobs SET gate_origin=NULL, gate_subject_type=NULL,
                                  gate_subject_id=NULL, gate_scope=NULL WHERE id=${id}`),
        /immutable once set/);
      await expect(db.execute(sql`UPDATE production_jobs SET approved_revision_digest='d9' WHERE id=${id}`))
        .resolves.toBeTruthy();
    });

    it('requires a complete gated descriptor for a job at rest in awaiting_approval', async () => {
      const r = await job(``, ``);
      const id = (r.rows[0] as { id: string }).id;
      await expect(db.execute(sql`UPDATE production_jobs SET status='awaiting_approval' WHERE id=${id}`))
        .rejects.toThrow();
      // A descriptor alone is not enough: gate_resolution NULL means UNRESOLVED, and an
      // unresolved job is unclaimable — so a paused job in that state would be stranded
      // while also being represented as gated. Both must agree.
      const r2 = await job(`,gate_origin,gate_subject_type,gate_subject_id,gate_scope`,
                           `,'r','production','s3','vlog'`);
      const id2 = (r2.rows[0] as { id: string }).id;
      await expect(db.execute(sql`UPDATE production_jobs SET status='awaiting_approval' WHERE id=${id2}`))
        .rejects.toThrow();
      const r3 = await job(`,gate_origin,gate_subject_type,gate_subject_id,gate_scope,gate_resolution`,
                           `,'r','production','s4','vlog','gated'`);
      const id3 = (r3.rows[0] as { id: string }).id;
      await expect(db.execute(sql`UPDATE production_jobs SET status='awaiting_approval' WHERE id=${id3}`))
        .resolves.toBeTruthy();
    });

    it('indexes work_item_id, so cascade deletes and filters are not full scans', async () => {
      const r = await db.execute(sql`
        SELECT indexdef FROM pg_indexes
         WHERE tablename = 'production_jobs' AND indexname = 'production_jobs_work_item'`);
      expect(r.rows.length).toBe(1);
    });

    it('requires exactly one parent — never both, never neither', async () => {
      await expect(db.execute(sql`INSERT INTO production_jobs (capability,provider)
                                  VALUES ('aroll','heygen')`)).rejects.toThrow();
    });

    it('accepts a work-item-parented accord_article job with no production', async () => {
      const w = await db.execute(sql`INSERT INTO work_items (kind,brand) VALUES ('accord_article','hvn')
                                     RETURNING id`);
      const wid = (w.rows[0] as { id: string }).id;
      await expect(db.execute(sql`INSERT INTO production_jobs (work_item_id,capability,provider)
                                  VALUES (${wid},'accord_article','internal')`)).resolves.toBeTruthy();
    });
  });

  // ── productions.final_video_row_id ──────────────────────────────────────────────────
  describe('the final-video pin', () => {
    it('refuses a video belonging to another production, or to none', async () => {
      // videos.production_id is nullable (ad-hoc Studio renders), and the FK proves only
      // that the row exists — so without this, production A could pin B's video and publish
      // would later resolve the wrong content through it.
      await db.execute(sql`INSERT INTO productions (id,brand,topic) VALUES ('pin-a','vlog','t'),
                           ('pin-b','vlog','t') ON CONFLICT DO NOTHING`);
      await db.execute(sql`
        INSERT INTO videos (id,production_id,heygen_video_id,avatar_id) VALUES
          ('vid-of-b','pin-b','hg1','av1'), ('vid-orphan',NULL,'hg2','av2')
        ON CONFLICT DO NOTHING`);
      await refused(() => db.execute(sql`UPDATE productions SET final_video_row_id='vid-of-b'
                                         WHERE id='pin-a'`), /belongs to pin-b/);
      await refused(() => db.execute(sql`UPDATE productions SET final_video_row_id='vid-orphan'
                                         WHERE id='pin-a'`), /no production/);
      await db.execute(sql`INSERT INTO videos (id,production_id,heygen_video_id,avatar_id)
                           VALUES ('vid-of-a','pin-a','hg3','av3') ON CONFLICT DO NOTHING`);
      await expect(db.execute(sql`UPDATE productions SET final_video_row_id='vid-of-a'
                                  WHERE id='pin-a'`)).resolves.toBeTruthy();
    });
  });

  // ── workflow_transitions ────────────────────────────────────────────────────────────
  describe('workflow_transitions', () => {
    it('refuses a founder-attributed transition naming a machine actor', async () => {
      // These rows are immutable the instant they are written, so an incoherent one can
      // never be corrected — the same constraint matters more here than on evidence.
      await refused(() => db.execute(sql`
        INSERT INTO workflow_transitions (subject_type,subject_id,to_state,principal_id,
          principal_kind,asserted_role,source_system)
        VALUES ('production','p1','queued','bot','agent'::principal_kind,'founder','rmg-creator-os')`),
        /transition_founder_is_human/);
    });
  });

  // ── publication_intents ─────────────────────────────────────────────────────────────
  describe('publication_intents', () => {
    let evidenceId: string;
    beforeAll(async () => {
      const r = await db.execute(sql`
        INSERT INTO approval_evidence (subject_type,subject_id,scope,revision_digest,decision,
          principal_id,principal_kind,asserted_role,source_system,decision_seq,decided_at,
          approved_package)
        VALUES ('production','p-pub','vlog','d1','approved','rahm','human','founder',
                'rmg-creator-os',1,now(),'{}'::jsonb) RETURNING id`);
      evidenceId = (r.rows[0] as { id: string }).id;
    });

    const intent = (phase: string, post: string | null = null) => db.execute(sql`
      INSERT INTO publication_intents (subject_type,subject_id,scope,evidence_id,revision_digest,
        phase,lease_expires_at,remote_post_id)
      VALUES ('production','p-pub','vlog',${evidenceId},'d1',
              ${sql.raw(`'${phase}'::publication_intent_phase`)}, now() + interval '60 s', ${post})
      RETURNING id`);

    it('permits only one open intent per (subject, scope)', async () => {
      await intent('claimed');
      await expect(intent('claimed')).rejects.toThrow();
    });

    it("keeps the slot held while an outcome is 'unknown', so no duplicate can be claimed", async () => {
      await db.execute(sql`UPDATE publication_intents SET phase='unknown' WHERE subject_id='p-pub'`);
      await expect(intent('claimed')).rejects.toThrow();
    });

    it('frees the slot once the intent reaches a closed phase', async () => {
      await db.execute(sql`UPDATE publication_intents SET phase='failed', closed_at=now()
                           WHERE subject_id='p-pub'`);
      await expect(intent('claimed')).resolves.toBeTruthy();
    });

    it('refuses evidence belonging to a different subject or scope', async () => {
      // The foreign key proves only that the row exists. Without this, an intent for subject
      // B could reference subject A's live evidence and copy A's digest — uniqueness and
      // withdrawal coordination on B, while the fence validates A.
      await db.execute(sql`UPDATE publication_intents SET phase='failed', closed_at=now()
                           WHERE subject_id='p-pub'`);
      await refused(() => db.execute(sql`
        INSERT INTO publication_intents (subject_type,subject_id,scope,evidence_id,
          revision_digest,phase,lease_expires_at)
        VALUES ('production','a-different-production','vlog',${evidenceId},'d1',
                'claimed'::publication_intent_phase, now() + interval '60 s')`),
        /is for production\/p-pub/);
    });

    it('refuses a digest that disagrees with the evidence it names', async () => {
      await refused(() => db.execute(sql`
        INSERT INTO publication_intents (subject_type,subject_id,scope,evidence_id,
          revision_digest,phase,lease_expires_at)
        VALUES ('production','p-pub','vlog',${evidenceId},'a-different-digest',
                'claimed'::publication_intent_phase, now() + interval '60 s')`),
        /digest does not match/);
    });

    it('refuses to delete an OPEN intent, so the slot is never released silently', async () => {
      const r = await intent('claimed');
      const id = (r.rows[0] as { id: string }).id;
      await refused(() => db.execute(sql`DELETE FROM publication_intents WHERE id=${id}`),
        /may not be deleted/);
      // 'unknown' holds the slot hardest: the remote outcome is unresolved, so admitting a
      // second claim could duplicate a post that in fact went out.
      await db.execute(sql`UPDATE publication_intents SET phase='unknown' WHERE id=${id}`);
      await refused(() => db.execute(sql`DELETE FROM publication_intents WHERE id=${id}`),
        /may not be deleted/);
      await refused(() => db.execute(sql`TRUNCATE publication_intents CASCADE`),
        /TRUNCATE is not permitted/);
      // A closed intent is ordinary data again.
      await db.execute(sql`UPDATE publication_intents SET phase='failed', closed_at=now()
                           WHERE id=${id}`);
      await expect(db.execute(sql`DELETE FROM publication_intents WHERE id=${id}`))
        .resolves.toBeTruthy();
    });

    it('refuses a published intent with no remote post id', async () => {
      await db.execute(sql`UPDATE publication_intents SET phase='failed', closed_at=now()
                           WHERE subject_id='p-pub'`);
      await expect(intent('published', null)).rejects.toThrow();
    });
  });
});
