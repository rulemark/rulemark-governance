import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CHANGE_TYPES, EVENT_TYPES, REVISION_ENTITY_TYPES } from '@rulemark/ropa-schemas/enums';

import { inList } from './checks.js';
import { createdAt, id, updatedAt } from './columns.js';

/** DM §3.12, DDL §4.5. Append-only history: one full snapshot per save. */
export const revision = pgTable(
  'revision',
  {
    id: id(),
    entityType: text({ enum: REVISION_ENTITY_TYPES }).notNull(),
    /**
     * Deliberately no foreign key: history outlives the records it describes,
     * including drafts that were deleted (§4.5).
     */
    entityId: uuid().notNull(),
    version: integer().notNull(),
    changeType: text({ enum: CHANGE_TYPES }).notNull(),
    /**
     * When this version took effect, which the seed backdates to replay the
     * story's timeline. `createdAt` records when the row was really inserted,
     * so the backdating stays visible.
     */
    validFrom: timestamp({ withTimezone: true }).notNull().defaultNow(),
    snapshot: jsonb().notNull(),
    actor: text().notNull(),
    changeNote: text(),
    // No updatedAt: rows are never updated (`revision_append_only`, §4.6).
    createdAt: createdAt(),
  },
  (t) => [
    check('revision_entity_type', inList(t.entityType, REVISION_ENTITY_TYPES)),
    check('revision_change_type', inList(t.changeType, CHANGE_TYPES)),
    check('revision_version', sql`${t.version} >= 1`),
    unique('revision_version_once').on(t.entityType, t.entityId, t.version),
    index('revision_as_of').on(t.entityType, t.entityId, t.validFrom.desc()),
    index('revision_changes').on(t.validFrom),
  ],
);

/**
 * DM §3.13, DDL §4.5. Events written in the same transaction as the revision
 * they describe, then delivered by a dispatcher (built in step 2).
 */
export const eventOutbox = pgTable(
  'event_outbox',
  {
    id: id(),
    /** The event's id in the envelope; consumers use it to ignore duplicates. */
    eventId: uuid().notNull(),
    eventType: text({ enum: EVENT_TYPES }).notNull(),
    /** Consumer name from configuration: `audit-log`, `monitor`. */
    destination: text().notNull(),
    payload: jsonb().notNull(),
    revisionId: uuid().references(() => revision.id, { onDelete: 'restrict' }),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    /** Set on a 2xx. Empty means still pending. */
    deliveredAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('event_outbox_event_type', inList(t.eventType, EVENT_TYPES)),
    check('event_outbox_attempts', sql`${t.attempts} >= 0`),
    // One row per event per destination, so a slow consumer cannot hold up the
    // others and a retry cannot duplicate a delivery.
    unique('event_outbox_once').on(t.eventId, t.destination),
    index('event_outbox_pending')
      .on(t.destination, t.nextAttemptAt)
      .where(sql`${t.deliveredAt} IS NULL`),
  ],
);

/** The code prefixes: C/P/J for activities, RI for review items (DM §3.0). */
export const CODE_PREFIXES = ['C', 'P', 'J', 'RI'] as const;

/**
 * DDL §4.5, allocation §5. Codes are handed out by incrementing a row inside
 * the creating transaction, which locks that prefix until commit. A sequence
 * would avoid the lock but is not transactional, so every failed create would
 * burn a number and codes would not be gapless.
 */
export const codeCounter = pgTable(
  'code_counter',
  {
    prefix: text({ enum: CODE_PREFIXES }).primaryKey(),
    lastValue: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('code_counter_prefix', inList(t.prefix, CODE_PREFIXES)),
    check('code_counter_last_value', sql`${t.lastValue} >= 0`),
  ],
);
