import { randomUUID } from 'node:crypto';
import type {
  ChangeType,
  EventType,
  Ref,
  ReviewChangeType,
  ReviewItem,
  RevisionEntityType,
} from '@rulemark/ropa-schemas';

import { eventOutbox } from '../db/schema/history.js';
import type { Transaction } from './transaction.js';

/**
 * The event envelope every consumer receives (`ropa-api.md` §6). Events are
 * written to `event_outbox` in the same transaction as the change they
 * describe, so if the change commits the event exists, and if it rolls back the
 * event never existed.
 */
export interface EventEnvelope {
  readonly id: string;
  readonly type: EventType;
  readonly source: 'ropa';
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

export interface RecordChangedData extends Record<string, unknown> {
  readonly entityType: RevisionEntityType;
  readonly entity: Ref;
  readonly version: number;
  readonly changeType: ChangeType;
  readonly actor: string;
  readonly changeNote: string | null;
  readonly validFrom: string;
}

/**
 * Review items have no revisions (step 3, open question 1). Their history is
 * `review_item_event`, written with this event (step 4, open question 3). It carries the whole item as it stands after the change:
 * with nothing behind it to point at, a bare "RI-7 was resolved" would not say
 * what RI-7 was about.
 */
export interface ReviewItemChangedData extends Record<string, unknown> {
  readonly changeType: ReviewChangeType;
  readonly actor: string;
  readonly reviewItem: ReviewItem;
}

/**
 * Where events go. The audit log is the permanent history of who changed what,
 * so it is the one destination that exists from the start; configuration
 * arrives with the dispatcher in build step 4.
 */
export const DEFAULT_EVENT_DESTINATIONS = ['audit-log'] as const;

export function recordChangedEvent(data: RecordChangedData): EventEnvelope {
  return {
    // The consumer's idempotency key: a retry delivers the same id twice.
    id: randomUUID(),
    type: 'record.changed',
    source: 'ropa',
    occurredAt: data.validFrom,
    data,
  };
}

export function reviewItemChangedEvent(data: ReviewItemChangedData): EventEnvelope {
  const item = data.reviewItem;
  return {
    id: randomUUID(),
    type: 'review_item.changed',
    source: 'ropa',
    // Opening happened when the row was created; closing when it was closed.
    occurredAt: data.changeType === 'opened' ? item.createdAt : (item.closedAt ?? item.updatedAt),
    data,
  };
}

/**
 * Writes one outbox row per destination, so a slow consumer cannot hold up the
 * others. `revisionId` links a `record.changed` to the revision it announces;
 * other events have none.
 */
export async function enqueueEvent(
  tx: Transaction,
  envelope: EventEnvelope,
  options: {
    readonly destinations?: readonly string[] | undefined;
    readonly revisionId?: string | undefined;
  } = {},
): Promise<void> {
  const destinations = options.destinations ?? DEFAULT_EVENT_DESTINATIONS;
  if (destinations.length === 0) return;

  await tx.insert(eventOutbox).values(
    destinations.map((destination) => ({
      eventId: envelope.id,
      eventType: envelope.type,
      destination,
      payload: envelope,
      revisionId: options.revisionId ?? null,
    })),
  );
}
