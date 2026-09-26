import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { expectRaise, expectViolation, useDatabase } from './harness.js';

/**
 * `review_item_event` (`ropa-database.md` §4.5, §4.6): the history of review
 * items, which have no revisions (step 4, open question 3). Append-only like
 * `revision`, and backfilled by its migration from the outbox, which held that
 * history until now. Raw SQL, because the rows worth rejecting are ones
 * TypeScript would never let us write.
 */
const db = useDatabase();

const item = (id: string) => ({
  id,
  code: 'RI-901',
  targetType: 'activity',
  target: { id: randomUUID(), code: 'P1', name: 'Candidate application management' },
  source: 'snapshot',
  reason: 'region_violation',
  details: null,
  deadlines: null,
  dueAt: null,
  status: 'open',
  resolutionNote: null,
  openedBy: 'svc:snapshot',
  closedBy: null,
  closedAt: null,
  createdAt: '2026-07-04T02:00:00.000Z',
  updatedAt: '2026-07-04T02:00:00.000Z',
});

async function insertEvent(values: Partial<Record<string, unknown>> = {}): Promise<string> {
  const reviewItemId = randomUUID();
  const row = {
    event_id: randomUUID(),
    review_item_id: reviewItemId,
    change_type: 'opened',
    occurred_at: '2026-07-04T02:00:00Z',
    actor: 'svc:snapshot',
    review_item: JSON.stringify(item(reviewItemId)),
    ...values,
  };
  const columns = Object.keys(row);
  const { rows } = await db().sql.query<{ event_id: string }>(
    `INSERT INTO review_item_event (${columns.join(', ')})
     VALUES (${columns.map((_column, index) => `$${index + 1}`).join(', ')}) RETURNING event_id`,
    Object.values(row),
  );
  return rows[0]!.event_id;
}

describe('review_item_event', () => {
  it('accepts an event', async () => {
    await expect(insertEvent()).resolves.toBeDefined();
  });

  it('review_item_event_change_type accepts only opened, resolved and dismissed', async () => {
    await expectViolation('review_item_event_change_type', () =>
      insertEvent({ change_type: 'reopened' }),
    );
  });

  it('review_item_event_once keeps one row per event, so a replay cannot double it', async () => {
    const eventId = await insertEvent();
    await expectViolation('review_item_event_once', () => insertEvent({ event_id: eventId }));
  });

  // Scoped to the row just written, as the revision tests are.
  it('is append-only: an update is refused, even from a SQL console', async () => {
    const eventId = await insertEvent();
    await expectRaise(/review_item_event is append-only: UPDATE/, () =>
      db().sql.query(`UPDATE review_item_event SET actor = 'someone.else' WHERE event_id = $1`, [
        eventId,
      ]),
    );
  });

  it('is append-only: a delete is refused', async () => {
    const eventId = await insertEvent();
    await expectRaise(/review_item_event is append-only: DELETE/, () =>
      db().sql.query(`DELETE FROM review_item_event WHERE event_id = $1`, [eventId]),
    );
  });

  it('shares the trigger with revision, which still names itself', async () => {
    const { rows } = await db().sql.query<{ id: string }>(
      `INSERT INTO revision (entity_type, entity_id, version, change_type, snapshot, actor)
       VALUES ('party', $1, 1, 'created', '{}', 'test') RETURNING id`,
      [randomUUID()],
    );
    await expectRaise(/revision is append-only: DELETE/, () =>
      db().sql.query(`DELETE FROM revision WHERE id = $1`, [rows[0]!.id]),
    );
  });
});

describe('the migration’s backfill from the outbox', () => {
  /** The backfill statement exactly as the migration runs it. */
  const backfill = readFileSync(
    new URL('../../drizzle/0009_review_item_event_history.sql', import.meta.url),
    'utf8',
  )
    .split('--> statement-breakpoint')
    .find((statement) => statement.includes('INSERT INTO review_item_event'));

  async function enqueue(
    eventId: string,
    changeType: string,
    reviewItem: object,
    occurredAt: string,
    destination = 'audit-log',
  ) {
    const envelope = {
      id: eventId,
      type: 'review_item.changed',
      source: 'ropa',
      occurredAt,
      data: { changeType, actor: 'priya.raman', reviewItem },
    };
    await db().sql.query(
      `INSERT INTO event_outbox (event_id, event_type, destination, payload)
       VALUES ($1, 'review_item.changed', $2, $3)`,
      [eventId, destination, JSON.stringify(envelope)],
    );
  }

  it('is in the migration', () => {
    expect(backfill).toBeDefined();
  });

  it('writes one history row per review-item event, whatever its destinations', async () => {
    const itemId = randomUUID();
    const opened = randomUUID();
    const resolved = randomUUID();
    const open = item(itemId);
    const closed = {
      ...open,
      status: 'resolved',
      resolutionNote: 'Moved to the EU region',
      closedBy: 'priya.raman',
      closedAt: '2026-07-10T09:00:00.000Z',
    };
    await enqueue(opened, 'opened', open, open.createdAt);
    await enqueue(opened, 'opened', open, open.createdAt, 'monitor');
    await enqueue(resolved, 'resolved', closed, closed.closedAt);
    // Not a review item's: left alone.
    await db().sql.query(
      `INSERT INTO event_outbox (event_id, event_type, destination, payload)
       VALUES ($1, 'record.changed', 'audit-log', '{}')`,
      [randomUUID()],
    );

    await db().sql.query(backfill!);
    // A second run changes nothing: the migration is safe to reason about.
    await db().sql.query(backfill!);

    const { rows } = await db().sql.query(
      `SELECT event_id, review_item_id, change_type, occurred_at, actor, review_item
       FROM review_item_event WHERE review_item_id = $1 ORDER BY occurred_at`,
      [itemId],
    );
    expect(rows).toEqual([
      {
        event_id: opened,
        review_item_id: itemId,
        change_type: 'opened',
        occurred_at: new Date(open.createdAt),
        actor: 'priya.raman',
        review_item: open,
      },
      {
        event_id: resolved,
        review_item_id: itemId,
        change_type: 'resolved',
        occurred_at: new Date(closed.closedAt),
        actor: 'priya.raman',
        review_item: closed,
      },
    ]);
  });
});
