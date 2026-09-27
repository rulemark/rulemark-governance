import { randomUUID } from 'node:crypto';
import type {
  AuthorizationType,
  ChangeType,
  EventEnvelope,
  EventType,
  Ref,
  ReviewChangeType,
  ReviewItem,
  RevisionEntityType,
} from '@rulemark/ropa-schemas';

import { eventOutbox } from '../db/schema/history.js';
import type { Transaction } from './transaction.js';

/**
 * The envelope every consumer receives (`ropa-api.md` §6), a contract in the
 * package (step 4, Phase 5 question 3). Events are written to `event_outbox`
 * in the same transaction as the change they describe, so if the change
 * commits the event exists, and if it rolls back the event never existed.
 */
export type { EventEnvelope };

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

/** What a subprocessor list says about one party (API §5.2). */
export interface ListedSubprocessor {
  readonly services: readonly string[];
  readonly processingCountries: readonly string[];
  readonly transfers: readonly {
    readonly destinationCountry: string;
    readonly mechanism: string;
    readonly onwardVia: string | null;
  }[];
}

interface SubprocessorEntry {
  readonly party: Ref;
  /** The opt-in activity it is listed under, on an offering's list; else null. */
  readonly module: Ref | null;
  /** The first day the list shows this change (Phase 4, question 1). */
  readonly effectiveFrom: string;
}

/**
 * A save changed an offering's or a client's subprocessor list, compared as
 * planned (API §6; step 4, open question 5). For the Monitor, which sends the
 * notices Art. 28(2) requires before a change takes effect, so it carries the
 * terms the list is under: whether a client is told or asked.
 */
export interface SubprocessorsChangedData extends Record<string, unknown> {
  readonly offering: Ref;
  /** Null for the offering's own list, the one prospects read. */
  readonly client: Ref | null;
  readonly terms: Ref & {
    readonly authorizationType: AuthorizationType;
    readonly noticeDays: number;
  };
  /** The save that changed it. */
  readonly cause: {
    readonly activity: Ref;
    readonly version: number;
    readonly changeType: ChangeType;
    readonly actor: string;
    readonly changeNote: string | null;
  };
  readonly added: (SubprocessorEntry & ListedSubprocessor)[];
  readonly removed: (SubprocessorEntry & ListedSubprocessor)[];
  /** Still listed, but its countries or transfers are not what they were. */
  readonly changed: (SubprocessorEntry & {
    readonly before: ListedSubprocessor;
    readonly after: ListedSubprocessor;
  })[];
}

/**
 * Who hears what: routing, in code (step 4, open question 1). An outbox row
 * is written for every consumer that should hear an event, whether or not it
 * is running yet; where each consumer lives is configuration, for the
 * dispatcher.
 */
export const EVENT_ROUTES: Readonly<Record<EventType, readonly string[]>> = {
  'record.changed': ['audit-log'],
  'review_item.changed': ['audit-log'],
  'subprocessors.changed': ['monitor'],
};

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

export function subprocessorsChangedEvent(
  data: SubprocessorsChangedData,
  occurredAt: string,
): EventEnvelope {
  return {
    id: randomUUID(),
    type: 'subprocessors.changed',
    source: 'ropa',
    // When the save took effect, like the record.changed it follows.
    occurredAt,
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
  const destinations = options.destinations ?? EVENT_ROUTES[envelope.type];
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
