import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb, createPool } from './client.js';

/**
 * Applies every migration in `drizzle/` (`ropa-database.md` §8.2).
 *
 * On Render this is the pre-deploy command: it runs after the build and before
 * the new version goes live, on its own instance, so a failure fails the deploy
 * and the previous version keeps serving. Locally it runs against Docker.
 */

/**
 * An arbitrary but fixed key. Two instances starting together both try to
 * migrate; the lock makes the second wait and then find nothing to do, rather
 * than both applying the same migration.
 */
const MIGRATION_LOCK_KEY = 4_170_216_301;

/** Resolved from this file, so it works from `src/` and from `dist/` alike. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  // One connection: the advisory lock is held by a session, so the lock and the
  // migrations must run on the same one.
  const pool = createPool(databaseUrl, 1);
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await migrate(createDb(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    // Releasing the session would drop the lock anyway; unlocking explicitly
    // keeps a pooled connection clean.
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
}

/** CLI entry: `npm run db:migrate`. */
async function main(): Promise<void> {
  const { createLogger } = await import('../shared/logger.js');
  const { loadDatabaseConfigOrExit } = await import('../shared/startup.js');

  // DATABASE_URL and the log settings only: a pre-deploy that failed over a
  // missing JWT secret would block a deploy for a reason unrelated to it.
  const config = loadDatabaseConfigOrExit();
  const logger = createLogger(config);

  try {
    await runMigrations(config.databaseUrl);
    logger.info('migrations applied');
  } catch (error) {
    logger.fatal({ err: error }, 'migration failed');
    process.exitCode = 1;
  }
}

// Only when run directly, so importing runMigrations in tests does nothing.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
