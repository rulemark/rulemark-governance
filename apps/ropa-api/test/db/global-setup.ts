import { Client } from 'pg';

import { runMigrations } from '../../src/db/migrate.js';
import { MAINTENANCE_URL, TEST_DATABASE_NAME, TEST_DATABASE_URL } from './harness.js';

/**
 * Creates the test database if it is missing, then applies the migrations once
 * for the whole run — which also tests the migrations (`ropa-database.md` §10).
 */
async function createTestDatabaseIfMissing(): Promise<void> {
  const client = new Client({ connectionString: MAINTENANCE_URL });
  await client.connect();

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE_NAME,
    ]);
    if (rowCount === 0) {
      // The name comes from DATABASE_URL, not from a request, and CREATE
      // DATABASE takes no parameters, so it is interpolated with quoting.
      await client.query(`CREATE DATABASE "${TEST_DATABASE_NAME.replaceAll('"', '""')}"`);
    }
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<void> {
  await createTestDatabaseIfMissing();
  await runMigrations(TEST_DATABASE_URL);
}
