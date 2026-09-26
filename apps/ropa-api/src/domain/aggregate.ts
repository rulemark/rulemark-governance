import type { ChangeType, Ref, RevisionEntityType } from '@rulemark/ropa-schemas';
import { and, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import { eventOutbox, revision } from '../db/schema/history.js';
import { notFound, preconditionFailed } from '../shared/problems.js';
import { DEFAULT_EVENT_DESTINATIONS, recordChangedEvent } from './events.js';
import { toSnapshotTimestamps } from './snapshots.js';
import type { Transaction } from './transaction.js';

/**
 * The save algorithm from `ropa-database.md` §6.1, in one transaction:
 * version check and lock → validate → nested rows → snapshot → events → commit.
 *
 * Foundation records have no nested rows (DM §4), so step 3 is a no-op for
 * them. The activity aggregate supplies it through `afterWrite`, which runs
 * after the root row is written and locked and before the snapshot is taken.
 *
 * Everything takes a `Transaction` rather than the pool, so the record, its
 * history and its events become visible together or not at all.
 */

/** The shape every aggregate root table has in common. */
export interface RootTable extends PgTable {
  id: PgColumn;
  version: PgColumn;
}

export interface AggregateSpec<TRow, TSnapshot> {
  readonly entityType: RevisionEntityType;
  readonly table: RootTable;
  readonly snapshotSchema: z.ZodType<TSnapshot>;
  /**
   * Row → canonical snapshot: ids, not Refs, and ISO timestamps (§6.2). An
   * aggregate with nested rows reads them through `tx`, so the snapshot sees
   * this transaction's writes.
   */
  readonly toSnapshot: (row: TRow, tx: Transaction) => TSnapshot | Promise<TSnapshot>;
  /** How this record is named in an event (§6). */
  readonly toRef: (row: TRow) => Ref;
}

export interface SaveContext {
  /** From the token's `sub`, never from a header (`ropa-api.md` §1.6). */
  readonly actor: string;
  readonly changeNote?: string | undefined;
  /** Seed-only: backdates `valid_from` to replay the story's timeline (§9). */
  readonly validFrom?: Date | undefined;
  readonly destinations?: readonly string[] | undefined;
}

/**
 * Step 3 of the save, for an aggregate with nested rows. It runs inside the
 * transaction after the root row is written — and, on an update, locked by the
 * version check — so no other writer can change the aggregate underneath it.
 */
export interface SaveHooks<TRow> {
  readonly afterWrite?: (row: TRow) => Promise<void>;
}

/**
 * Drizzle's builders are typed per concrete table; these functions are written
 * once for every aggregate. The casts are confined to the four call sites
 * below, and the public functions stay typed through `AggregateSpec`.
 */
type AnyValues = Record<string, unknown>;
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBuilder = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function createAggregate<TRow extends RowShape, TSnapshot>(
  tx: Transaction,
  spec: AggregateSpec<TRow, TSnapshot>,
  values: AnyValues,
  context: SaveContext,
  hooks: SaveHooks<TRow> = {},
): Promise<TRow> {
  const [row] = (await (tx.insert(spec.table) as AnyBuilder).values(values).returning()) as TRow[];

  if (row === undefined) throw new Error('insert returned no row');

  await hooks.afterWrite?.(row);
  await recordRevision(tx, spec, row, 'created', context);
  return row;
}

export async function updateAggregate<TRow extends RowShape, TSnapshot>(
  tx: Transaction,
  spec: AggregateSpec<TRow, TSnapshot>,
  id: string,
  expectedVersion: number,
  values: AnyValues,
  context: SaveContext,
  changeType: ChangeType = 'updated',
  hooks: SaveHooks<TRow> = {},
): Promise<TRow> {
  // The version check happens in the database, in this transaction, never as a
  // separate read beforehand (§1.8): a read-then-write leaves a window in which
  // someone else commits between the two.
  const [row] = (await (tx.update(spec.table) as AnyBuilder)
    .set({ ...values, version: sql`${spec.table.version} + 1` })
    .where(and(eq(spec.table.id, id), eq(spec.table.version, expectedVersion)))
    .returning()) as TRow[];

  if (row === undefined) {
    // No row means either the record is gone or somebody else has saved since
    // this caller read it. Which of the two decides 404 against 412.
    await assertExists(tx, spec, id, expectedVersion);
  }

  await hooks.afterWrite?.(row as TRow);
  await recordRevision(tx, spec, row as TRow, changeType, context);
  return row as TRow;
}

export async function deleteAggregate<TRow extends RowShape, TSnapshot>(
  tx: Transaction,
  spec: AggregateSpec<TRow, TSnapshot>,
  id: string,
  expectedVersion: number,
  context: SaveContext,
): Promise<void> {
  const [row] = (await (tx.delete(spec.table) as AnyBuilder)
    .where(and(eq(spec.table.id, id), eq(spec.table.version, expectedVersion)))
    .returning()) as TRow[];

  if (row === undefined) {
    await assertExists(tx, spec, id, expectedVersion);
  }

  // The deletion is itself a revision: history outlives the record, which is
  // why `revision.entity_id` carries no foreign key (§4.5).
  //
  // It gets the *next* version. The row's own version was already spent on the
  // revision that created that state, and `revision_version_once` rightly
  // refuses a second row for it. Keeping snapshot.version equal to
  // revision.version is what lets an asOf read trust either one.
  const deleted = { ...(row as TRow), version: (row as TRow).version + 1 };
  await recordRevision(tx, spec, deleted, 'deleted', context);
}

/** Distinguishes "never existed" (404) from "someone else saved first" (412). */
async function assertExists<TRow extends RowShape, TSnapshot>(
  tx: Transaction,
  spec: AggregateSpec<TRow, TSnapshot>,
  id: string,
  expectedVersion: number,
): Promise<never> {
  const [current] = (await (tx.select({ version: spec.table.version }) as AnyBuilder)
    .from(spec.table)
    .where(eq(spec.table.id, id))) as { version: number }[];

  if (current === undefined) {
    throw notFound(`No ${spec.entityType} with id ${id}`);
  }

  throw preconditionFailed(
    `This ${spec.entityType} has moved on: you sent version ${expectedVersion}, it is now ${current.version}`,
    { currentVersion: current.version },
  );
}

export interface RowShape {
  id: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Steps 4 and 5 of the save: the snapshot and the events it causes, written
 * before the transaction commits so they can never disagree with the record.
 */
async function recordRevision<TRow extends RowShape, TSnapshot>(
  tx: Transaction,
  spec: AggregateSpec<TRow, TSnapshot>,
  row: TRow,
  changeType: ChangeType,
  context: SaveContext,
): Promise<void> {
  const snapshot = spec.snapshotSchema.parse({
    ...(await spec.toSnapshot(row, tx)),
    ...toSnapshotTimestamps(row),
  });
  const validFrom = context.validFrom ?? new Date();
  const changeNote = context.changeNote ?? null;

  const [written] = await tx
    .insert(revision)
    .values({
      entityType: spec.entityType,
      entityId: row.id,
      version: row.version,
      changeType,
      validFrom,
      snapshot,
      actor: context.actor,
      changeNote,
    })
    .returning({ id: revision.id });

  if (written === undefined) throw new Error('revision insert returned no row');

  const envelope = recordChangedEvent({
    entityType: spec.entityType,
    entity: spec.toRef(row),
    version: row.version,
    changeType,
    actor: context.actor,
    changeNote,
    validFrom: validFrom.toISOString(),
  });

  const destinations = context.destinations ?? DEFAULT_EVENT_DESTINATIONS;
  if (destinations.length === 0) return;

  // One row per destination, so a slow consumer cannot hold up the others.
  await tx.insert(eventOutbox).values(
    destinations.map((destination) => ({
      eventId: envelope.id,
      eventType: envelope.type,
      destination,
      payload: envelope,
      revisionId: written.id,
    })),
  );
}
