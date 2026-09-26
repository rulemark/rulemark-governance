import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  REVIEW_CHANGE_TYPES,
  REVIEW_REASONS,
  REVIEW_SOURCES,
  REVIEW_STATUSES,
} from '@rulemark/ropa-schemas/enums';

import { processingActivity } from './activity.js';
import { inList } from './checks.js';
import { createdAt, id, updatedAt } from './columns.js';
import { party } from './party.js';
import { system } from './system.js';

/**
 * DM §3.11, DDL §4.5. A finding carried to a person. Not versioned: its only
 * change is a one-way close, guarded by status (API §1.8), and its history is
 * `review_item_event`, so there is no `version` column.
 */
export const reviewItem = pgTable(
  'review_item',
  {
    id: id(),
    /** `RI-42`, allocated from `code_counter` and immutable (DM §3.0). */
    code: text().notNull().unique('review_item_code_unique'),
    // Three foreign keys, exactly one set, rather than a type and an unchecked
    // id: the database can then refuse a dangling target (DB §3).
    targetActivityId: uuid().references(() => processingActivity.id, { onDelete: 'restrict' }),
    targetPartyId: uuid().references(() => party.id, { onDelete: 'restrict' }),
    targetSystemId: uuid().references(() => system.id, { onDelete: 'restrict' }),
    source: text({ enum: REVIEW_SOURCES }).notNull(),
    reason: text({ enum: REVIEW_REASONS }).notNull(),
    details: jsonb(),
    deadlines: jsonb(),
    /** The earliest deadline. */
    dueAt: date(),
    status: text({ enum: REVIEW_STATUSES }).notNull().default('open'),
    resolutionNote: text(),
    /**
     * From the token, like `revision.actor` (API §1.6). Not in DM §3.11 as
     * first drafted: without them, "who dismissed RI-7" could only be answered
     * from the audit log (step 3, Phase 1).
     */
    openedBy: text().notNull(),
    closedBy: text(),
    closedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('review_item_code', sql`${t.code} ~ '^RI-[1-9][0-9]*$'`),
    check(
      'review_item_one_target',
      sql`num_nonnulls(${t.targetActivityId}, ${t.targetPartyId}, ${t.targetSystemId}) = 1`,
    ),
    check('review_item_source', inList(t.source, REVIEW_SOURCES)),
    check('review_item_reason', inList(t.reason, REVIEW_REASONS)),
    check('review_item_status', inList(t.status, REVIEW_STATUSES)),
    // Closing says why.
    check('review_item_resolution', sql`${t.status} = 'open' OR ${t.resolutionNote} IS NOT NULL`),
    // ...and who, and when; an open item has neither.
    check(
      'review_item_closed',
      sql`(${t.status} = 'open') = (${t.closedBy} IS NULL) AND (${t.closedBy} IS NULL) = (${t.closedAt} IS NULL)`,
    ),
    // What a person's queue reads: open items, soonest first.
    index('review_item_open_due')
      .on(t.dueAt)
      .where(sql`${t.status} = 'open'`),
    index('review_item_target_activity').on(t.targetActivityId),
    index('review_item_target_party').on(t.targetPartyId),
    index('review_item_target_system').on(t.targetSystemId),
  ],
);

/**
 * DM §3.11, DDL §4.5. The history of review items, which have no revisions:
 * one row per open, resolve or dismiss, written in the same transaction as the
 * change and its `review_item.changed` outbox rows (step 4, open question 3).
 * The outbox is a delivery queue, purged once delivered; this is what
 * `/changes` reads. Append-only under `revision_append_only`.
 */
export const reviewItemEvent = pgTable(
  'review_item_event',
  {
    id: id(),
    /** The event's id in the envelope, shared with its outbox rows. */
    eventId: uuid().notNull(),
    /**
     * Deliberately no foreign key, like `revision.entity_id`: history
     * describes the item, it does not depend on it.
     */
    reviewItemId: uuid().notNull(),
    changeType: text({ enum: REVIEW_CHANGE_TYPES }).notNull(),
    /** When the item was opened or closed: the envelope's `occurredAt`. */
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    actor: text().notNull(),
    /** The whole item after the change, as `GET /review-items/{ref}` returned it. */
    reviewItem: jsonb().notNull(),
    // No updatedAt: rows are never updated.
    createdAt: createdAt(),
  },
  (t) => [
    check('review_item_event_change_type', inList(t.changeType, REVIEW_CHANGE_TYPES)),
    unique('review_item_event_once').on(t.eventId),
    index('review_item_event_changes').on(t.occurredAt),
    index('review_item_event_item').on(t.reviewItemId, t.occurredAt),
  ],
);
