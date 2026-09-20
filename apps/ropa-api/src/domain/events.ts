import { randomUUID } from 'node:crypto';
import type { ChangeType, EventType, Ref, RevisionEntityType } from '@rulemark/ropa-schemas';

/**
 * The event envelope every consumer receives (`ropa-api.md` §6). Events are
 * written to `event_outbox` in the same transaction as the revision they
 * describe, so if the save commits the event exists, and if it rolls back the
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
 * Where `record.changed` goes. The audit log is the permanent history of who
 * changed what, so it is the one destination that exists from the start;
 * configuration arrives with the dispatcher in step 2.
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
