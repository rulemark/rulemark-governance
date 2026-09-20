import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * The shared check patterns from `ropa-database.md` §4.1, written once so every
 * table spells them the same way and a reviewer can read the generated SQL
 * without checking each table's punctuation.
 */

/**
 * Values are inlined as SQL literals, not bound as parameters. A CHECK
 * constraint is DDL: `sql`${value}`` would emit `IN ($1, $2)`, which is not a
 * constraint anyone can apply. Everything passed here is a compile-time
 * constant from the shared enum lists, and quotes are escaped regardless.
 */
function literals(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '));
}

/**
 * Enum values are `text` plus a CHECK, never a Postgres enum type: values in an
 * enum type cannot be removed or renamed, while a check constraint is replaced
 * in one migration (§3).
 */
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${literals(values)})`;
}

/**
 * Lowercase words separated by single hyphens, and never UUID-shaped, so a path
 * segment can always be told apart from an id without a lookup (DM §3.0).
 */
export function slugCheck(column: AnyPgColumn): SQL {
  return sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND ${column} !~ '^[0-9a-f]{8}-[0-9a-f]{4}-'`;
}

/** ISO 3166-1 alpha-2. */
export function countryCheck(column: AnyPgColumn): SQL {
  return sql`${column} ~ '^[A-Z]{2}$'`;
}

/** Every element of a text[] is an allowed value (§4.1). */
export function arrayInList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} <@ ARRAY[${literals(values)}]::text[]`;
}
