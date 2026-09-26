import { createDb, createPool } from '../db/client.js';
import { databaseUrlOrExit } from '../shared/startup.js';
import { replayStory, resetDatabase } from './replay-story.js';

/**
 * `npm run db:seed [-- --reset]` (`ropa-database.md` §9): replays the Hireloop
 * story into the database, backdated, through the domain layer. Idempotent;
 * `--reset` empties the record first so the story's codes start at C1 and P1.
 *
 * `--reset` truncates everything, history included, so it refuses to run in
 * production unless ALLOW_SEED_RESET=true says that is really meant.
 */

const reset = process.argv.includes('--reset');

async function main(): Promise<void> {
  const databaseUrl = databaseUrlOrExit();

  if (
    reset &&
    process.env['NODE_ENV'] === 'production' &&
    process.env['ALLOW_SEED_RESET'] !== 'true'
  ) {
    throw new Error(
      '--reset would empty a production database. Set ALLOW_SEED_RESET=true if that is really what you want.',
    );
  }

  const pool = createPool(databaseUrl, 1);
  const db = createDb(pool);
  try {
    if (reset) {
      await resetDatabase(db);
      process.stdout.write('Emptied the record and restarted the codes.\n\n');
    }
    process.stdout.write('Replaying the Hireloop story, February to September 2026:\n\n');
    const outcome = await replayStory(db, (line) => process.stdout.write(`${line}\n`));
    process.stdout.write(
      `\n  ${outcome.applied.length} applied, ${outcome.skipped.length} already there\n`,
    );
  } finally {
    await pool.end();
  }
}

await main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
