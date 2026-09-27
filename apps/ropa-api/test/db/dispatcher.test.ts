import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, createPool, type Database } from '../../src/db/client.js';
import { eventOutbox, reviewItemEvent, revision } from '../../src/db/schema/index.js';
import { MINUTE } from '../../src/delivery/backoff.js';
import {
  claimBatch,
  cleanupDelivered,
  dispatchOnce,
  type DispatchOptions,
} from '../../src/delivery/dispatcher.js';
import { resetDatabase } from '../../src/demo/replay-story.js';
import { createLogger } from '../../src/shared/logger.js';
import {
  fail,
  hang,
  hold,
  ok,
  startReceiver,
  type ScriptedReceiver,
} from '../scripted-receiver.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * The outbox dispatcher (DB §7, API §6), against real Postgres and real HTTP
 * (step 4, open question 7). Its transactions are the behaviour under test,
 * so everything here commits. Each test delivers to a destination of its own,
 * `test-<random>`, and the dispatcher serves only the destinations it is
 * given, so no test sees another's rows, or the rows other files committed.
 * Time is a parameter: the retry schedule is tested by moving the clock.
 */

const T0 = new Date('2026-09-27T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SECOND = 1_000;
const HOUR = 60 * MINUTE;

let pool: ReturnType<typeof createPool>;
let db: Database;
let receiver: ScriptedReceiver;
let destination: string;
let logLines: { level: number; msg: string; [key: string]: unknown }[];

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
});

afterAll(async () => {
  // Fixture revisions have no records behind them; nothing else should read them.
  await resetDatabase(db);
  await pool.end();
});

beforeEach(async () => {
  receiver = await startReceiver();
  destination = `test-${randomUUID().slice(0, 8)}`;
  logLines = [];
});

afterEach(async () => {
  await receiver.close();
});

const logger = () =>
  createLogger(
    { logLevel: 'debug', nodeEnv: 'test' },
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        logLines.push(JSON.parse(chunk.toString('utf8')) as (typeof logLines)[number]);
        done();
      },
    }),
  );

/** Options for one dispatcher run at `now`, delivering this test's destination. */
function options(now: Date, overrides: Partial<DispatchOptions> = {}): DispatchOptions {
  return {
    destinations: { [destination]: receiver.url },
    logger: logger(),
    now: () => now,
    timeoutMs: 500,
    ...overrides,
  };
}

// --- fixtures -------------------------------------------------------------

let sequence = 0;

/** A record's revision: the outbox row's version order comes from here. */
async function revisionOf(record: string, version: number): Promise<string> {
  const [row] = await db
    .insert(revision)
    .values({
      entityType: 'party',
      entityId: record,
      version,
      changeType: version === 1 ? 'created' : 'updated',
      validFrom: T0,
      snapshot: {},
      actor: 'test',
    })
    .returning({ id: revision.id });
  return row!.id;
}

/** A review item's history row; its outbox rows share the event id. */
async function reviewItemEventOf(
  item: string,
  changeType: 'opened' | 'resolved',
  occurredAt: Date,
): Promise<string> {
  const eventId = randomUUID();
  await db.insert(reviewItemEvent).values({
    eventId,
    reviewItemId: item,
    changeType,
    occurredAt,
    actor: 'test',
    reviewItem: {},
  });
  return eventId;
}

/**
 * An outbox row. Rows come due in the order they are written, a second apart
 * and before T0, unless told otherwise.
 */
async function enqueue(
  options: {
    readonly revisionId?: string;
    readonly eventId?: string;
    readonly to?: string;
    readonly nextAttemptAt?: Date;
  } = {},
): Promise<string> {
  const eventId = options.eventId ?? randomUUID();
  sequence += 1;
  await db.insert(eventOutbox).values({
    eventId,
    eventType: options.revisionId === undefined ? 'review_item.changed' : 'record.changed',
    destination: options.to ?? destination,
    payload: {
      id: eventId,
      type: options.revisionId === undefined ? 'review_item.changed' : 'record.changed',
      source: 'ropa',
      occurredAt: T0.toISOString(),
      data: { sequence },
    },
    revisionId: options.revisionId ?? null,
    nextAttemptAt: options.nextAttemptAt ?? at(-HOUR + sequence * SECOND),
  });
  return eventId;
}

/** A record's event for this test's destination, at `version`. */
async function recordEvent(record: string, version: number, to?: string): Promise<string> {
  return enqueue({ revisionId: await revisionOf(record, version), ...(to ? { to } : {}) });
}

async function rowOf(eventId: string, to = destination) {
  const [row] = await db
    .select()
    .from(eventOutbox)
    .where(and(eq(eventOutbox.eventId, eventId), eq(eventOutbox.destination, to)));
  return row!;
}

const receivedIds = () => receiver.received.map((request) => request.body.id);

// --- delivery -------------------------------------------------------------

describe('dispatchOnce: delivery', () => {
  it('posts each pending event, as it was written, and marks it delivered', async () => {
    const eventId = await recordEvent(randomUUID(), 1);
    const { payload } = await rowOf(eventId);

    const result = await dispatchOnce(db, options(T0));

    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(receiver.received).toEqual([
      { path: '/events', contentType: 'application/json', body: payload },
    ]);
    const row = await rowOf(eventId);
    expect(row.deliveredAt).toEqual(T0);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBeNull();
  });

  it('never sends a delivered event again', async () => {
    await recordEvent(randomUUID(), 1);
    await dispatchOnce(db, options(T0));

    expect(await dispatchOnce(db, options(at(30 * 24 * HOUR)))).toEqual({
      claimed: 0,
      delivered: 0,
      failed: 0,
    });
    expect(receiver.received).toHaveLength(1);
  });

  it('leaves a destination it was not given alone: its events wait, untouched', async () => {
    const unconfigured = `test-${randomUUID().slice(0, 8)}`;
    const waiting = await recordEvent(randomUUID(), 1, unconfigured);
    const sent = await recordEvent(randomUUID(), 1);

    await dispatchOnce(db, options(T0));

    expect(receivedIds()).toEqual([sent]);
    const row = await rowOf(waiting, unconfigured);
    expect(row).toMatchObject({ attempts: 0, deliveredAt: null, lastError: null });
  });

  it('sends the oldest first, and waits for what is not due', async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const second = await enqueue({
      revisionId: await revisionOf(a, 1),
      nextAttemptAt: at(-2 * SECOND),
    });
    const first = await enqueue({
      revisionId: await revisionOf(b, 1),
      nextAttemptAt: at(-3 * SECOND),
    });
    const later = await enqueue({ revisionId: await revisionOf(c, 1), nextAttemptAt: at(SECOND) });

    await dispatchOnce(db, options(T0));
    expect(receivedIds()).toEqual([first, second]);

    await dispatchOnce(db, options(at(SECOND)));
    expect(receivedIds()).toEqual([first, second, later]);
  });

  it('takes at most a batch', async () => {
    for (let i = 0; i < 4; i += 1) await recordEvent(randomUUID(), 1);

    expect(await dispatchOnce(db, options(T0, { batchSize: 3 }))).toMatchObject({ claimed: 3 });
    expect(await dispatchOnce(db, options(T0, { batchSize: 3 }))).toMatchObject({ claimed: 1 });
  });
});

// --- failure and retry ----------------------------------------------------

describe('dispatchOnce: failures are retried at 1, 5 and 30 minutes, then hourly', () => {
  it('keeps a failed event pending, with its error, and retries it on schedule', async () => {
    const eventId = await recordEvent(randomUUID(), 1);
    receiver.script(fail(503), fail(500), fail(500), fail(502), ok);

    let now = T0;
    for (const [attempt, wait] of [
      [1, 1 * MINUTE],
      [2, 5 * MINUTE],
      [3, 30 * MINUTE],
      [4, 60 * MINUTE],
    ] as const) {
      expect(await dispatchOnce(db, options(now)), `attempt ${attempt}`).toMatchObject({
        failed: 1,
      });
      const row = await rowOf(eventId);
      expect(row.attempts).toBe(attempt);
      expect(row.deliveredAt).toBeNull();
      expect(row.lastError).toMatch(/HTTP 50\d/);
      expect(row.nextAttemptAt).toEqual(new Date(now.getTime() + wait));

      // Not a moment before it is due.
      expect(await dispatchOnce(db, options(new Date(now.getTime() + wait - 1)))).toMatchObject({
        claimed: 0,
      });
      now = new Date(now.getTime() + wait);
    }

    expect(await dispatchOnce(db, options(now))).toMatchObject({ delivered: 1 });
    expect((await rowOf(eventId)).attempts).toBe(5);
    expect(receiver.received).toHaveLength(5);
  });

  it('says which status came back', async () => {
    const eventId = await recordEvent(randomUUID(), 1);
    receiver.script(fail(503));
    await dispatchOnce(db, options(T0));
    expect((await rowOf(eventId)).lastError).toMatch(/HTTP 503/);
  });

  it('gives up waiting on a consumer that does not answer', async () => {
    const eventId = await recordEvent(randomUUID(), 1);
    receiver.script(hang);

    const started = Date.now();
    expect(await dispatchOnce(db, options(T0, { timeoutMs: 200 }))).toMatchObject({ failed: 1 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect((await rowOf(eventId)).lastError).toMatch(/timed out after 200 ms/);
  });

  it('records a consumer that is not there', async () => {
    const eventId = await recordEvent(randomUUID(), 1);
    const gone = receiver.url;
    await receiver.close();

    await dispatchOnce(db, { ...options(T0), destinations: { [destination]: gone } });
    receiver = await startReceiver();

    const row = await rowOf(eventId);
    expect(row).toMatchObject({ attempts: 1, deliveredAt: null });
    expect(row.lastError).toMatch(/ECONNREFUSED/);
  });

  it('retries a 4xx like any failure: a misconfigured consumer delays events, never loses them', async () => {
    const eventId = await recordEvent(randomUUID(), 1);
    receiver.script(fail(404));

    await dispatchOnce(db, options(T0));
    expect((await rowOf(eventId)).deliveredAt).toBeNull();

    expect(await dispatchOnce(db, options(at(MINUTE)))).toMatchObject({ delivered: 1 });
  });

  it('logs each failure as a warning, and from the 24th attempt as an error', async () => {
    const record = randomUUID();
    const eventId = await recordEvent(record, 1);
    receiver.script(fail(500), fail(500));

    await dispatchOnce(db, options(T0));
    const warning = logLines.find((line) => line.msg === 'event delivery failed');
    expect(warning).toMatchObject({
      level: 40,
      destination,
      eventId,
      eventType: 'record.changed',
      record: `party ${record} v1`,
      attempts: 1,
      retryAt: at(MINUTE).toISOString(),
    });
    expect(warning?.['error']).toMatch(/HTTP 500/);

    // A day of hourly retries later.
    await db
      .update(eventOutbox)
      .set({ attempts: 23 })
      .where(and(eq(eventOutbox.eventId, eventId), eq(eventOutbox.destination, destination)));
    logLines = [];
    await dispatchOnce(db, options(at(MINUTE)));
    expect(logLines.find((line) => line.msg === 'event delivery failed')).toMatchObject({
      level: 50,
      attempts: 24,
    });
  });
});

// --- order ----------------------------------------------------------------

describe('dispatchOnce: one record’s events in version order', () => {
  it('holds v2 until v1 is delivered', async () => {
    const record = randomUUID();
    const v1 = await recordEvent(record, 1);
    const v2 = await recordEvent(record, 2);

    expect(await dispatchOnce(db, options(T0))).toMatchObject({ claimed: 1 });
    expect(receivedIds()).toEqual([v1]);

    await dispatchOnce(db, options(T0));
    expect(receivedIds()).toEqual([v1, v2]);
  });

  it('holds v2 for as long as v1 keeps failing', async () => {
    const record = randomUUID();
    const v1 = await recordEvent(record, 1);
    const v2 = await recordEvent(record, 2);
    receiver.script(fail(), fail());

    await dispatchOnce(db, options(T0));
    await dispatchOnce(db, options(at(30 * SECOND)));
    await dispatchOnce(db, options(at(MINUTE)));
    expect(receivedIds()).toEqual([v1, v1]);
    expect((await rowOf(v2)).attempts).toBe(0);

    await dispatchOnce(db, options(at(6 * MINUTE)));
    await dispatchOnce(db, options(at(6 * MINUTE)));
    expect(receivedIds()).toEqual([v1, v1, v1, v2]);
  });

  it('holds only that record: another record’s events go', async () => {
    const stuck = await recordEvent(randomUUID(), 1);
    const other = await recordEvent(randomUUID(), 1);
    receiver.script(fail());

    await dispatchOnce(db, options(T0));
    expect(receivedIds()).toEqual([stuck, other]);
    expect((await rowOf(other)).deliveredAt).toEqual(T0);
  });

  it('holds only that destination: the same record’s events go elsewhere', async () => {
    const elsewhere = `test-${randomUUID().slice(0, 8)}`;
    const other = await startReceiver();
    try {
      const record = randomUUID();
      const r1 = await revisionOf(record, 1);
      const r2 = await revisionOf(record, 2);
      const v1 = await enqueue({ revisionId: r1 });
      await enqueue({ revisionId: r1, eventId: v1, to: elsewhere });
      const v2 = await enqueue({ revisionId: r2 });
      await enqueue({ revisionId: r2, eventId: v2, to: elsewhere });
      receiver.script(fail(), fail());

      const both = (now: Date) =>
        dispatchOnce(db, {
          ...options(now),
          destinations: { [destination]: receiver.url, [elsewhere]: other.url },
        });
      await both(T0);
      await both(at(10 * SECOND));

      expect(receivedIds()).toEqual([v1]);
      expect(other.received.map((request) => request.body.id)).toEqual([v1, v2]);
    } finally {
      await other.close();
    }
  });

  it('sends a review item’s events in the order they happened', async () => {
    const item = randomUUID();
    // Written out of order, and the resolution due first: occurredAt decides.
    const resolved = await reviewItemEventOf(item, 'resolved', at(-HOUR));
    const opened = await reviewItemEventOf(item, 'opened', at(-2 * HOUR));
    await enqueue({ eventId: resolved, nextAttemptAt: at(-2 * SECOND) });
    await enqueue({ eventId: opened, nextAttemptAt: at(-SECOND) });
    const otherItem = await reviewItemEventOf(randomUUID(), 'opened', at(-HOUR));
    await enqueue({ eventId: otherItem, nextAttemptAt: T0 });

    await dispatchOnce(db, options(T0));
    expect(receivedIds()).toEqual([opened, otherItem]);

    await dispatchOnce(db, options(T0));
    expect(receivedIds()).toEqual([opened, otherItem, resolved]);
  });
});

// --- claims ---------------------------------------------------------------

describe('dispatchOnce: never two sends of one event at once', () => {
  it('skips a row another dispatcher has locked, without waiting for it', async () => {
    const locked = await recordEvent(randomUUID(), 1);
    const free = await recordEvent(randomUUID(), 1);

    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT 1 FROM event_outbox WHERE event_id = $1 FOR UPDATE', [locked]);

      const started = Date.now();
      await dispatchOnce(db, options(T0));
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(receivedIds()).toEqual([free]);
    } finally {
      await other.query('ROLLBACK');
      other.release();
    }
  });

  it('does not claim an event whose send is still in flight, or the record’s next', async () => {
    const record = randomUUID();
    const v1 = await recordEvent(record, 1);
    await recordEvent(record, 2);
    receiver.script(hold);

    const first = dispatchOnce(db, options(T0));
    await receiver.waitFor(1);

    const secondPool = createPool(TEST_DATABASE_URL, 2);
    try {
      expect(await dispatchOnce(createDb(secondPool), options(T0))).toMatchObject({ claimed: 0 });
    } finally {
      await secondPool.end();
    }

    receiver.release();
    expect(await first).toMatchObject({ delivered: 1 });
    expect(receivedIds()).toEqual([v1]);
  });

  it('sends each event once when two dispatchers run at once', async () => {
    const events = [];
    for (let i = 0; i < 6; i += 1) events.push(await recordEvent(randomUUID(), 1));

    const pools = [createPool(TEST_DATABASE_URL, 2), createPool(TEST_DATABASE_URL, 2)];
    try {
      const results = await Promise.all(
        pools.map((p) => dispatchOnce(createDb(p), options(T0, { batchSize: 4 }))),
      );
      const delivered = results.reduce((sum, result) => sum + result.delivered, 0);
      expect(receivedIds()).toHaveLength(delivered);
      expect(new Set(receivedIds()).size).toBe(delivered);

      await dispatchOnce(db, options(T0));
      expect([...receivedIds()].sort()).toEqual([...events].sort());
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });

  it('resends an event whose dispatcher died mid-send, once the lease runs out', async () => {
    const eventId = await recordEvent(randomUUID(), 1);

    // Claimed, and then the process was killed before it could record anything.
    await claimBatch(db, {
      destinations: [destination],
      now: T0,
      batchSize: 10,
      leaseMs: 2 * MINUTE,
    });

    expect(await dispatchOnce(db, options(at(2 * MINUTE - 1)))).toMatchObject({ claimed: 0 });
    expect(await dispatchOnce(db, options(at(2 * MINUTE)))).toMatchObject({ delivered: 1 });
    expect(receivedIds()).toEqual([eventId]);
    expect((await rowOf(eventId)).attempts).toBe(2);
  });

  /**
   * A dispatcher paused past its lease (a stalled process, a stretched clock)
   * finds its rows claimed again by the time its send returns. The outcome
   * recorded is the later claim's.
   */
  describe('a dispatcher whose lease ran out', () => {
    const shortLease = { batchSize: 1, timeoutMs: 400, leaseMs: 500 };

    it('does not overwrite the later claim with its failure', async () => {
      const eventId = await recordEvent(randomUUID(), 1);
      receiver.script(hold);
      const stale = dispatchOnce(db, options(T0, shortLease));
      await receiver.waitFor(1);

      await claimBatch(db, {
        destinations: [destination],
        now: at(SECOND),
        batchSize: 1,
        leaseMs: 2 * MINUTE,
      });
      receiver.release(500);
      await stale;

      expect(await rowOf(eventId)).toMatchObject({
        attempts: 2,
        lastError: null,
        nextAttemptAt: at(SECOND + 2 * MINUTE),
      });
    });

    it('does not move the time an event was delivered', async () => {
      const eventId = await recordEvent(randomUUID(), 1);
      receiver.script(hold);
      const stale = dispatchOnce(db, options(T0, shortLease));
      await receiver.waitFor(1);

      expect(await dispatchOnce(db, options(at(SECOND)))).toMatchObject({ delivered: 1 });
      receiver.release();
      await stale;

      expect((await rowOf(eventId)).deliveredAt).toEqual(at(SECOND));
    });
  });

  it('refuses a lease a batch could outlast', async () => {
    await expect(
      dispatchOnce(db, options(T0, { batchSize: 10, timeoutMs: 5_000, leaseMs: 50_000 })),
    ).rejects.toThrow(RangeError);
  });
});

// --- cleanup --------------------------------------------------------------

describe('cleanupDelivered', () => {
  it('deletes delivered rows older than 30 days, and nothing pending', async () => {
    const old = await recordEvent(randomUUID(), 1);
    const recent = await recordEvent(randomUUID(), 1);
    const pending = await enqueue({
      revisionId: await revisionOf(randomUUID(), 1),
      nextAttemptAt: at(-90 * 24 * HOUR),
    });
    const setDelivered = (eventId: string, deliveredAt: Date) =>
      db
        .update(eventOutbox)
        .set({ deliveredAt })
        .where(and(eq(eventOutbox.eventId, eventId), eq(eventOutbox.destination, destination)));
    await setDelivered(old, at(-31 * 24 * HOUR));
    await setDelivered(recent, at(-29 * 24 * HOUR));

    expect(await cleanupDelivered(db, { now: T0 })).toBeGreaterThanOrEqual(1);

    const left = await db
      .select({ eventId: eventOutbox.eventId })
      .from(eventOutbox)
      .where(eq(eventOutbox.destination, destination));
    expect(left.map((row) => row.eventId).sort()).toEqual([recent, pending].sort());
    // The history is untouched: the outbox is only a delivery queue.
    const [{ count }] = (
      await db.execute<{ count: string }>(
        sql`SELECT count(*) FROM revision r JOIN event_outbox o ON o.revision_id = r.id WHERE o.destination = ${destination}`,
      )
    ).rows as [{ count: string }];
    expect(Number(count)).toBe(2);
  });
});
