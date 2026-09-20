import { eq, sql } from 'drizzle-orm';

import { codeCounter, type CODE_PREFIXES } from '../db/schema/history.js';
import type { Transaction } from './transaction.js';

/**
 * Codes (`C4`, `P3`, `RI-42`) are allocated from `code_counter` inside the
 * transaction that creates the record (`ropa-database.md` §5).
 *
 * The `UPDATE` locks that prefix's row until the transaction ends, so two
 * concurrent creates cannot take the same number, and a rollback takes the
 * increment with it. Only committed records ever hold a code, which is what
 * makes codes gapless and never reused — the property that lets `P3` appear in
 * a contract annex and mean the same thing forever (DM §3.0).
 *
 * A sequence would avoid the lock but is not transactional: every failed create
 * would burn a number.
 */
export type CodePrefix = (typeof CODE_PREFIXES)[number];

/** Review items read `RI-42`; activities read `P3`. */
function format(prefix: CodePrefix, value: number): string {
  return prefix === 'RI' ? `RI-${value}` : `${prefix}${value}`;
}

export async function allocateCode(tx: Transaction, prefix: CodePrefix): Promise<string> {
  const [row] = await tx
    .update(codeCounter)
    .set({ lastValue: sql`${codeCounter.lastValue} + 1` })
    .where(eq(codeCounter.prefix, prefix))
    .returning({ lastValue: codeCounter.lastValue });

  if (row === undefined) {
    // The counter rows are created by a migration, so this means the database
    // is not migrated rather than that the caller did anything wrong.
    throw new Error(`No code_counter row for prefix "${prefix}". Has db:migrate run?`);
  }

  return format(prefix, row.lastValue);
}
