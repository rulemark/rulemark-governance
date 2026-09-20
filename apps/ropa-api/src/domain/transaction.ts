import type { Database } from '../db/client.js';

/** The handle Drizzle hands to the callback of `db.transaction(...)`. */
type DrizzleTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Something that can run queries as part of the caller's transaction.
 *
 * Every step of a save takes one of these rather than the pool, so the version
 * check, the revision and the outbox rows either all commit or none do
 * (`ropa-database.md` §6.1).
 *
 * A plain `Database` is included because a connection can already be inside a
 * transaction without Drizzle having opened it — which is exactly how the test
 * harness isolates each test, and how a caller holding a checked-out client
 * would work. What matters is that the caller controls the boundary.
 */
export type Transaction = Database | DrizzleTransaction;
