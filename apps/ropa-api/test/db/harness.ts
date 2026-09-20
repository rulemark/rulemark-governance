import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import type { Pool, PoolClient } from 'pg';

import { createDb, createPool, type Database } from '../../src/db/client.js';

/**
 * Tests run against a real Postgres, never a mock: constraints, triggers and
 * defaults are the behaviour under test (`ropa-database.md` §10). Migrations
 * are applied once per run by `test/db/global-setup.ts`.
 *
 * Each test runs inside a transaction that is rolled back, so tests see a clean
 * database without truncating between them.
 */
/**
 * Tests get their own database, beside the development one.
 *
 * They share a server but never a database: some tests commit, and constraints
 * like `party_one_self` are global, so a single `self` party loaded by
 * `demo:data` would make every test that needs one fail — including tests that
 * roll back, because a unique index sees committed rows regardless. Created by
 * `global-setup.ts` if it does not exist.
 */
const DEVELOPMENT_URL = process.env['DATABASE_URL'] ?? 'postgres://ropa:ropa@localhost:5432/ropa';

function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

export const TEST_DATABASE_NAME = `${new URL(DEVELOPMENT_URL).pathname.replace(/^\//, '')}_test`;
export const TEST_DATABASE_URL = withDatabaseName(DEVELOPMENT_URL, TEST_DATABASE_NAME);
/** The maintenance database, the only place `CREATE DATABASE` can run from. */
export const MAINTENANCE_URL = withDatabaseName(DEVELOPMENT_URL, 'postgres');

export interface DbContext {
  /**
   * Drizzle, bound to this test's transaction.
   *
   * Do **not** call `.transaction()` on it. The handle is already inside a
   * transaction this harness opened with a plain `BEGIN`, and Drizzle's
   * `transaction()` on a database handle issues its own `BEGIN`/`ROLLBACK`
   * rather than a savepoint — which would end the harness's transaction and
   * leave the rest of the test autocommitting. Use `savepoint()` below, or
   * `withRealTransaction()` when the transaction itself is what you are
   * testing.
   */
  readonly db: Database;
  /** The same transaction, for SQL that TypeScript would refuse to write. */
  readonly sql: PoolClient;
}

/**
 * Runs `work` inside a savepoint and rolls it back, whatever the outcome. This
 * is the nesting that `db.transaction()` cannot give us here.
 */
export async function savepoint<T>(
  client: PoolClient,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  await client.query(`SAVEPOINT ${name}`);
  try {
    return await work();
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }
}

/**
 * Gives a database handle on its own connection, outside the per-test
 * transaction, so a test can open a real transaction and watch it commit or
 * roll back. Anything it commits is real, so callers clean up after themselves.
 */
export async function withRealTransaction<T>(work: (database: Database) => Promise<T>): Promise<T> {
  const pool = createPool(TEST_DATABASE_URL, 1);
  try {
    return await work(createDb(pool));
  } finally {
    await pool.end();
  }
}

/**
 * Installs the per-test transaction and returns a getter, because the context
 * only exists once `beforeEach` has run.
 */
export function useDatabase(): () => DbContext {
  let pool: Pool;
  let client: PoolClient;
  let context: DbContext;

  beforeAll(async () => {
    pool = createPool(TEST_DATABASE_URL, 1);
    try {
      await pool.query('select 1');
    } catch (error) {
      throw new Error(
        `Cannot reach Postgres at ${TEST_DATABASE_URL}.\n` +
          `Start it with: docker compose up -d db`,
        { cause: error },
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    context = { db: createDb(client), sql: client };
    currentClient = client;
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
    currentClient = undefined;
  });

  return () => context;
}

/**
 * The transaction the expectation helpers below act on. Safe as module state
 * because `useDatabase` is called once per file and Vitest runs the tests in a
 * file one at a time.
 */
let currentClient: PoolClient | undefined;

interface PostgresError extends Error {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** Drizzle wraps driver errors, so the constraint name sits on the cause. */
function constraintOf(error: PostgresError | undefined): string | undefined {
  if (error?.constraint !== undefined) return error.constraint;
  const cause = error?.cause as PostgresError | undefined;
  return cause?.constraint;
}

/**
 * Runs something that is expected to fail, inside a savepoint.
 *
 * Postgres aborts the whole transaction when a statement fails, and every later
 * statement is refused with 25P02 until it is rolled back. Without the
 * savepoint, one expected failure would poison the rest of the test.
 */
async function runExpectingFailure(
  run: () => Promise<unknown>,
): Promise<PostgresError | undefined> {
  const client = currentClient;
  if (client === undefined) throw new Error('useDatabase() must be called in this file first');

  await client.query('SAVEPOINT expected_failure');
  try {
    await run();
    await client.query('RELEASE SAVEPOINT expected_failure');
    return undefined;
  } catch (caught) {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    return caught as PostgresError;
  }
}

/**
 * Asserts that a statement is rejected by a *named* constraint. Naming it
 * matters: a test that only checks "this threw" passes just as happily when the
 * row is rejected for an unrelated reason, such as a typo in the fixture.
 */
export async function expectViolation(
  constraint: string,
  run: () => Promise<unknown>,
): Promise<void> {
  const error = await runExpectingFailure(run);

  expect(error, `expected ${constraint} to reject this, but it was accepted`).toBeDefined();
  expect(
    constraintOf(error),
    `rejected by ${constraintOf(error) ?? 'something unnamed'} instead: ${error?.message}`,
  ).toBe(constraint);
}

/** Asserts a trigger raised, identified by its message rather than a constraint. */
export async function expectRaise(pattern: RegExp, run: () => Promise<unknown>): Promise<void> {
  const error = await runExpectingFailure(run);

  expect(error, 'expected this to be rejected, but it was accepted').toBeDefined();
  // Drizzle's wrapper keeps the driver message on the cause.
  const message = `${error?.message ?? ''} ${(error?.cause as Error | undefined)?.message ?? ''}`;
  expect(message).toMatch(pattern);
}
