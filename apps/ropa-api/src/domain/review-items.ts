import {
  ReviewItem,
  type ReviewItemInput,
  type ReviewTargetType,
  type Ref,
} from '@rulemark/ropa-schemas';
import { and, eq, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { reviewItem, reviewItemEvent } from '../db/schema/workflow.js';
import { conflict, notFound, validationFailed } from '../shared/problems.js';
import { activityAggregate } from './activity/load.js';
import { partyAggregate, systemAggregate } from './aggregates.js';
import { allocateCode } from './codes.js';
import { enqueueEvent, reviewItemChangedEvent, type ReviewItemChangedData } from './events.js';
import { findByIdentifier, type Identifiable } from './identifiers.js';
import { loadRefs, requireRef, type RefSource } from './refs.js';
import type { Transaction } from './transaction.js';

/**
 * Review items (DM §3.11, API §2 workflow). Not an aggregate: no version, no
 * revisions. Opening allocates an `RI-n` code; closing is a one-way status
 * change guarded in the `UPDATE` itself (§1.8). Each writes a history row in
 * `review_item_event` and a `review_item.changed` event, in the same
 * transaction as the change (step 3, open question 1; step 4, open question 3).
 */

export type ReviewItemRow = typeof reviewItem.$inferSelect;

export const reviewItemIdentity: Identifiable = {
  table: reviewItem,
  codeColumn: reviewItem.code,
};

/** Who the change is by, and where its event goes. */
export interface ReviewContext {
  readonly actor: string;
  readonly destinations?: readonly string[] | undefined;
}

/** How each target type is found, named, and stored. */
const TARGETS: Record<
  ReviewTargetType,
  {
    readonly spec: Identifiable & RefSource<never>;
    readonly column: PgColumn;
    readonly idOf: (row: ReviewItemRow) => string | null;
  }
> = {
  activity: {
    spec: activityAggregate as never,
    column: reviewItem.targetActivityId,
    idOf: (row) => row.targetActivityId,
  },
  party: {
    spec: partyAggregate as never,
    column: reviewItem.targetPartyId,
    idOf: (row) => row.targetPartyId,
  },
  system: {
    spec: systemAggregate as never,
    column: reviewItem.targetSystemId,
    idOf: (row) => row.targetSystemId,
  },
};

const TARGET_TYPES = Object.keys(TARGETS) as ReviewTargetType[];

/** The column a target type is stored in, for filtering by it. */
export function targetColumn(targetType: ReviewTargetType): PgColumn {
  return TARGETS[targetType].column;
}

/**
 * Resolves `target` as the type says, so `P3` is only ever an activity and a
 * slug is looked up in one table, never guessed across three. Undefined when
 * there is no such record.
 */
export async function findTarget(
  tx: Transaction,
  targetType: ReviewTargetType,
  target: string,
): Promise<string | undefined> {
  const row = await findByIdentifier<{ id: string }>(tx, TARGETS[targetType].spec, target);
  return row?.id;
}

function targetTypeOf(row: ReviewItemRow): ReviewTargetType {
  const type = TARGET_TYPES.find((candidate) => TARGETS[candidate].idOf(row) !== null);
  // review_item_one_target guarantees exactly one.
  if (type === undefined) throw new Error(`Review item ${row.code} has no target`);
  return type;
}

/** Rows to API shape, loading each target type's Refs once for the whole page. */
export async function toReviewItemOutputs(
  tx: Transaction,
  rows: readonly ReviewItemRow[],
): Promise<ReviewItem[]> {
  const refs = new Map<ReviewTargetType, Map<string, Ref>>();
  for (const type of TARGET_TYPES) {
    const ids = rows.flatMap((row) => TARGETS[type].idOf(row) ?? []);
    refs.set(type, await loadRefs(tx, TARGETS[type].spec, ids));
  }

  return rows.map((row) => {
    const targetType = targetTypeOf(row);
    // Parsed on the way out, because the same object becomes the event
    // payload: the audit log should never receive a shape the API doesn't.
    return ReviewItem.parse({
      id: row.id,
      code: row.code,
      targetType,
      target: requireRef(refs.get(targetType)!, TARGETS[targetType].idOf(row)!, 'target'),
      source: row.source,
      reason: row.reason,
      details: row.details ?? null,
      deadlines: row.deadlines ?? null,
      dueAt: row.dueAt,
      status: row.status,
      resolutionNote: row.resolutionNote,
      openedBy: row.openedBy,
      closedBy: row.closedBy,
      closedAt: row.closedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  });
}

/**
 * The change's history row and its outbox rows, sharing one event id. History
 * is written whatever the destinations: the outbox is only how it is delivered.
 */
async function recordChange(
  tx: Transaction,
  data: ReviewItemChangedData,
  context: ReviewContext,
): Promise<void> {
  const envelope = reviewItemChangedEvent(data);
  await tx.insert(reviewItemEvent).values({
    eventId: envelope.id,
    reviewItemId: data.reviewItem.id,
    changeType: data.changeType,
    occurredAt: new Date(envelope.occurredAt),
    actor: data.actor,
    reviewItem: data.reviewItem,
  });
  await enqueueEvent(tx, envelope, { destinations: context.destinations });
}

async function single(tx: Transaction, row: ReviewItemRow): Promise<ReviewItem> {
  const [output] = await toReviewItemOutputs(tx, [row]);
  return output!;
}

export async function openReviewItem(
  tx: Transaction,
  input: ReviewItemInput,
  context: ReviewContext,
): Promise<ReviewItem> {
  const targetId = await findTarget(tx, input.targetType, input.target);
  if (targetId === undefined) {
    throw validationFailed('This review item refers to something that does not exist', [
      {
        path: '/target',
        code: 'unknown_reference',
        message: `No ${input.targetType} matching "${input.target}"`,
      },
    ]);
  }

  const [row] = await tx
    .insert(reviewItem)
    .values({
      code: await allocateCode(tx, 'RI'),
      targetActivityId: input.targetType === 'activity' ? targetId : null,
      targetPartyId: input.targetType === 'party' ? targetId : null,
      targetSystemId: input.targetType === 'system' ? targetId : null,
      source: input.source,
      reason: input.reason,
      details: input.details ?? null,
      deadlines: input.deadlines ?? null,
      dueAt: input.dueAt ?? null,
      openedBy: context.actor,
    })
    .returning();
  if (row === undefined) throw new Error('review_item insert returned no row');

  const item = await single(tx, row);
  await recordChange(tx, { changeType: 'opened', actor: context.actor, reviewItem: item }, context);
  return item;
}

/**
 * Resolves or dismisses an open item. The status check is part of the `UPDATE`
 * (§1.8), never a read beforehand: of two simultaneous closes, the second finds
 * no open row and answers 409.
 */
export async function closeReviewItem(
  tx: Transaction,
  id: string,
  status: 'resolved' | 'dismissed',
  resolutionNote: string,
  context: ReviewContext,
): Promise<ReviewItem> {
  const [row] = await tx
    .update(reviewItem)
    // The transaction's clock, like created_at, so the two read on one timeline.
    .set({ status, resolutionNote, closedBy: context.actor, closedAt: sql`now()` })
    .where(and(eq(reviewItem.id, id), eq(reviewItem.status, 'open')))
    .returning();

  if (row === undefined) {
    const [current] = await tx
      .select({ code: reviewItem.code, status: reviewItem.status })
      .from(reviewItem)
      .where(eq(reviewItem.id, id));
    if (current === undefined) throw notFound(`No review item with id ${id}`);
    throw conflict(
      `${current.code} is already ${current.status}; only an open item can be closed`,
      {
        currentStatus: current.status,
      },
    );
  }

  const item = await single(tx, row);
  await recordChange(tx, { changeType: status, actor: context.actor, reviewItem: item }, context);
  return item;
}
