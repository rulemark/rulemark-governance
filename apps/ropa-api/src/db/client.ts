import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';

import * as schema from './schema/index.js';

/**
 * The Postgres connection and the Drizzle instance built on it.
 *
 * `casing: 'snake_case'` is what lets the schema name columns once, in
 * camelCase, and have Drizzle map them to snake_case in SQL (§3). It must match
 * `drizzle.config.ts`, or generated migrations and runtime queries disagree
 * about column names.
 */
const CASING = 'snake_case' as const;

export function createPool(databaseUrl: string, max = 10): Pool {
  return new Pool({ connectionString: databaseUrl, max });
}

export function createDb(connection: Pool | PoolClient) {
  return drizzle(connection, { schema, casing: CASING });
}

export type Database = ReturnType<typeof createDb>;
export { schema };
