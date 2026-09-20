import { eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import type { RootTable } from './aggregate.js';
import type { Transaction } from './transaction.js';

/**
 * A path parameter or a body reference may be an `id`, a `code` or a `slug`
 * (`ropa-api.md` §1.2, DM §3.0). The three are distinguishable without asking
 * the database: a slug may never be UUID-shaped and is always lowercase, and a
 * code is uppercase letters followed by a number.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z]+-?\d+$/;

export type IdentifierKind = 'id' | 'code' | 'slug';

export function identifierKind(value: string): IdentifierKind {
  if (UUID.test(value)) return 'id';
  if (CODE.test(value)) return 'code';
  return 'slug';
}

export interface Identifiable {
  readonly table: RootTable;
  /** The natural identifier this record type carries, if any. */
  readonly slugColumn?: PgColumn | undefined;
  readonly codeColumn?: PgColumn | undefined;
}

/**
 * Finds a record by whichever identifier was given. Returns undefined rather
 * than throwing, so callers can choose between a 404 and a field-level error
 * on a body reference.
 */
export async function findByIdentifier<TRow>(
  tx: Transaction,
  spec: Identifiable,
  identifier: string,
): Promise<TRow | undefined> {
  const kind = identifierKind(identifier);
  const column =
    kind === 'id' ? spec.table.id : kind === 'code' ? spec.codeColumn : spec.slugColumn;

  // A code against a record type that has none can only be a miss.
  if (column === undefined) return undefined;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (await (tx.select() as any)
    .from(spec.table)
    .where(eq(column, identifier))
    .limit(1)) as TRow[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return rows[0];
}
