import { Pool } from 'pg';

/**
 * Provision a dedicated, empty database for one test suite.
 *
 * Vitest runs test files in parallel, and database suites are not read-only: this file's
 * first version had every suite share `TEST_DATABASE_URL`, and the governance suite (which
 * drops and recreates `public` to prove the migrations apply from scratch) raced the queue
 * suite (which creates its own types) — a `duplicate key ... pg_type_typname_nsp_index`
 * failure that looked like a migration bug and was actually two suites in one schema.
 *
 * One database per suite removes the shared state rather than serialising around it, so the
 * suites stay parallel and neither has to know the other exists.
 *
 * Returns null when TEST_DATABASE_URL is unset, so suites skip cleanly without a database.
 */
export async function provisionDatabase(suite: string): Promise<string | null> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return null;

  const url = new URL(base);
  // Postgres identifiers: keep it simple and predictable rather than escaping.
  const name = `rmgtest_${suite.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;

  // CREATE DATABASE cannot run inside a transaction and cannot target the database you are
  // connected to, so connect to the maintenance database to issue it.
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const pool = new Pool({ connectionString: admin.toString() });
  try {
    // Dropped first: a suite that asserts "applies from an empty database" must actually
    // start empty, including after a previous run left rows behind.
    await pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await pool.query(`CREATE DATABASE ${name}`);
  } finally {
    await pool.end();
  }

  url.pathname = `/${name}`;
  return url.toString();
}
