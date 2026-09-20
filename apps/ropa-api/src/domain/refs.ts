import type { Ref } from '@rulemark/ropa-schemas';
import { inArray } from 'drizzle-orm';

import type { RootTable } from './aggregate.js';
import type { Transaction } from './transaction.js';

/**
 * Every reference in a response is a small `Ref` object rather than a raw id
 * (`ropa-api.md` §1.2), which means a list of N records needs the referenced
 * records too. Loading them per row would be N+1 queries; these load one table
 * at a time, for every id on the page at once.
 */
export interface RefSource<TRow = never> {
  readonly table: RootTable;
  readonly toRef: (row: TRow) => Ref;
}

export async function loadRefs<TRow extends { id: string }>(
  tx: Transaction,
  source: RefSource<TRow>,
  ids: readonly string[],
): Promise<Map<string, Ref>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (await (tx.select() as any)
    .from(source.table)
    .where(inArray(source.table.id, wanted))) as TRow[];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return new Map(rows.map((row) => [row.id, source.toRef(row)]));
}

/**
 * A reference that is required by the schema but missing from the database
 * means a foreign key was not enforced, or a row vanished mid-request. Failing
 * loudly beats returning a half-built record.
 */
export function requireRef(refs: Map<string, Ref>, id: string, field: string): Ref {
  const ref = refs.get(id);
  if (ref === undefined) {
    throw new Error(`Dangling reference: ${field} points at ${id}, which does not exist`);
  }
  return ref;
}
