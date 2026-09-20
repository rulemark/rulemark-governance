import { runMigrations } from '../../src/db/migrate.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * Migrations run once per test run, which also tests the migrations themselves
 * (`ropa-database.md` §10).
 */
export async function setup(): Promise<void> {
  await runMigrations(TEST_DATABASE_URL);
}
