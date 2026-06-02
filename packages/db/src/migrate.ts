import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';

/**
 * Apply all pending migrations from this package's bundled `drizzle/` folder.
 * Idempotent — safe to run on every service startup.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString);
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
