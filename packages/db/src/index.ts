export { createDb, schema } from './client.js';
export type { Database } from './client.js';
export { runMigrations } from './migrate.js';
export * as tables from './schema.js';
// Re-export common query helpers so services don't depend on drizzle-orm directly.
export { and, asc, desc, eq, or, sql } from 'drizzle-orm';
