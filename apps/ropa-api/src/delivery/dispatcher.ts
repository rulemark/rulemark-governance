import { sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import type { Logger } from '../shared/logger.js';
import { MINUTE, retryDelayMs } from './backoff.js';

/**
 * The outbox dispatcher (DB §7, API §6): delivers pending events to each
 * consumer by `POST`, at least once, one record's events in version order.
 *
 * A batch is claimed with a lease in a short transaction, then sent with no
 * transaction open, each result written as it lands (step 4, Phase 5
 * question 1). Holding a transaction across the sends would keep a connection
 * and row locks through network I/O, and a crash would resend the whole batch;
 * here it resends the one event in flight, once its lease runs out.
 */

export interface DispatchOptions {
  /** Destination name → URL; only these are served (step 4, open question 1). */
  readonly destinations: Readonly<Record<string, string>>;
  readonly logger: Logger;
  /** The clock, a parameter so the retry schedule can be tested (open question 7). */
  readonly now?: () => Date;
  readonly batchSize?: number;
  /** How long a claim holds its rows. Must outlast the batch's sends. */
  readonly leaseMs?: number;
  /** How long one consumer may take to answer. */
  readonly timeoutMs?: number;
}

export interface DispatchResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
}

/** Sent one at a time: 10 × 5 s is 50 s at worst, well inside the lease. */
const DEFAULTS = { batchSize: 10, leaseMs: 2 * MINUTE, timeoutMs: 5_000 } as const;

/** About a day of hourly retries: past this, a failure is an error, not a blip. */
const LOUD_AFTER_ATTEMPTS = 24;

const DAY = 24 * 60 * MINUTE;
/** DB §7: the outbox is a delivery queue; `revision` and `review_item_event` are the history. */
const RETENTION_MS = 30 * DAY;

export interface ClaimedEvent {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly destination: string;
  readonly payload: unknown;
  /** Including this one. */
  readonly attempts: number;
  /** "party 0199… v3", or "review item 0199…", for the logs. */
  readonly record: string | null;
}

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  event_id: string;
  event_type: string;
  destination: string;
  payload: unknown;
  attempts: number;
  due_at: string | Date;
  entity_type: string | null;
  entity_id: string | null;
  version: number | null;
  review_item_id: string | null;
}

/**
 * Claims up to `batchSize` due events for the given destinations, oldest
 * first, and leases them: `next_attempt_at` moves to the end of the lease and
 * `attempts` goes up by one, in one short transaction.
 *
 * - `SKIP LOCKED`: two dispatchers claiming at once take different rows.
 * - A leased row is still undelivered, so no one claims it again before the
 *   lease ends, and it still holds its record's later events back.
 * - A record's event waits while an earlier one for the same destination is
 *   undelivered: an earlier version for revisions, an earlier `occurred_at`
 *   for review items, which have no versions (`review_item_event`).
 */
export async function claimBatch(
  db: Database,
  options: {
    readonly destinations: readonly string[];
    readonly now: Date;
    readonly batchSize: number;
    readonly leaseMs: number;
  },
): Promise<ClaimedEvent[]> {
  if (options.destinations.length === 0) return [];
  const names = sql.join(
    options.destinations.map((name) => sql`${name}`),
    sql`, `,
  );
  const leaseEnds = new Date(options.now.getTime() + options.leaseMs);

  const { rows } = await db.transaction((tx) =>
    tx.execute<ClaimedRow>(sql`
      WITH claimable AS (
        SELECT o.id, o.next_attempt_at AS due_at,
               r.entity_type, r.entity_id, r.version, e.review_item_id
        FROM event_outbox o
        LEFT JOIN revision r ON r.id = o.revision_id
        LEFT JOIN review_item_event e ON o.revision_id IS NULL AND e.event_id = o.event_id
        WHERE o.delivered_at IS NULL
          AND o.destination IN (${names})
          AND o.next_attempt_at <= ${options.now}
          AND NOT EXISTS (
            SELECT 1 FROM event_outbox o2
            JOIN revision r2 ON r2.id = o2.revision_id
            WHERE o2.destination = o.destination AND o2.delivered_at IS NULL
              AND r2.entity_type = r.entity_type AND r2.entity_id = r.entity_id
              AND r2.version < r.version)
          AND NOT EXISTS (
            SELECT 1 FROM event_outbox o2
            JOIN review_item_event e2 ON e2.event_id = o2.event_id
            WHERE o2.revision_id IS NULL
              AND o2.destination = o.destination AND o2.delivered_at IS NULL
              AND e2.review_item_id = e.review_item_id
              AND (e2.occurred_at, e2.id) < (e.occurred_at, e.id))
        ORDER BY o.next_attempt_at, o.id
        LIMIT ${options.batchSize}
        FOR UPDATE OF o SKIP LOCKED
      )
      UPDATE event_outbox o
      SET attempts = o.attempts + 1, next_attempt_at = ${leaseEnds}
      FROM claimable c
      WHERE o.id = c.id
      RETURNING o.id, o.event_id, o.event_type, o.destination, o.payload, o.attempts,
                c.due_at, c.entity_type, c.entity_id, c.version, c.review_item_id
    `),
  );

  // RETURNING has no order of its own; the claim's was oldest first.
  const due = (row: ClaimedRow) => new Date(row.due_at).getTime();
  return [...rows]
    .sort((a, b) => due(a) - due(b) || (a.id < b.id ? -1 : 1))
    .map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventType: row.event_type,
      destination: row.destination,
      payload: row.payload,
      attempts: row.attempts,
      record:
        row.entity_type !== null
          ? `${row.entity_type} ${row.entity_id} v${row.version}`
          : row.review_item_id !== null
            ? `review item ${row.review_item_id}`
            : null,
    }));
}

type SendResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** One `POST`. Any `2xx` is delivered; anything else, a `4xx` included, is retried. */
async function send(url: string, payload: unknown, timeoutMs: number): Promise<SendResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (response.ok) return { ok: true };
    return { ok: false, error: `HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}` };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, error: `timed out after ${timeoutMs} ms` };
    }
    // fetch reports a refused connection as "fetch failed", the reason on the cause.
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message;
    return {
      ok: false,
      error: `${(error as Error).message}${detail ? `: ${detail}` : ''}`,
    };
  }
}

/**
 * One pass: claim a batch, send each event in order, record each result.
 * Returns what it did, so a runner knows whether to go again at once.
 */
export async function dispatchOnce(
  db: Database,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const clock = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? DEFAULTS.batchSize;
  const leaseMs = options.leaseMs ?? DEFAULTS.leaseMs;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  // A lease that ends mid-batch lets a second dispatcher send what this one
  // has yet to: the one way this design could send an event twice at once.
  if (batchSize * timeoutMs >= leaseMs) {
    throw new RangeError(
      `A ${leaseMs} ms lease is too short for ${batchSize} sends of up to ${timeoutMs} ms`,
    );
  }

  const claimed = await claimBatch(db, {
    destinations: Object.keys(options.destinations),
    now: clock(),
    batchSize,
    leaseMs,
  });

  let delivered = 0;
  let failed = 0;
  for (const event of claimed) {
    const result = await send(options.destinations[event.destination]!, event.payload, timeoutMs);
    const now = clock();

    if (result.ok) {
      delivered += 1;
      await db.execute(sql`
        UPDATE event_outbox SET delivered_at = ${now}
        WHERE id = ${event.id} AND delivered_at IS NULL`);
      options.logger.debug(
        { destination: event.destination, eventId: event.eventId, record: event.record },
        'event delivered',
      );
      continue;
    }

    failed += 1;
    const retryAt = new Date(now.getTime() + retryDelayMs(event.attempts));
    // Only if the claim is still ours: a later claim after our lease ran out
    // has counted another attempt, and its outcome is the one to keep.
    await db.execute(sql`
      UPDATE event_outbox SET last_error = ${result.error}, next_attempt_at = ${retryAt}
      WHERE id = ${event.id} AND delivered_at IS NULL AND attempts = ${event.attempts}`);
    const level = event.attempts >= LOUD_AFTER_ATTEMPTS ? 'error' : 'warn';
    options.logger[level](
      {
        destination: event.destination,
        eventId: event.eventId,
        eventType: event.eventType,
        record: event.record,
        attempts: event.attempts,
        error: result.error,
        retryAt: retryAt.toISOString(),
      },
      'event delivery failed',
    );
  }

  if (claimed.length > 0) {
    options.logger.info({ claimed: claimed.length, delivered, failed }, 'outbox batch sent');
  }
  return { claimed: claimed.length, delivered, failed };
}

/** DB §7: delivered rows older than 30 days go. Returns how many. */
export async function cleanupDelivered(
  db: Database,
  options: { readonly now: Date; readonly retentionMs?: number },
): Promise<number> {
  const before = new Date(options.now.getTime() - (options.retentionMs ?? RETENTION_MS));
  const { rowCount } = await db.execute(
    sql`DELETE FROM event_outbox WHERE delivered_at < ${before}`,
  );
  return rowCount ?? 0;
}
