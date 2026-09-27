import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { createDb, createPool } from '../src/db/client.js';
import { eventOutbox } from '../src/db/schema/index.js';
import { TEST_DATABASE_URL } from './db/harness.js';
import { startReceiver } from './scripted-receiver.js';
import {
  SOURCE_ARGS,
  exitOf,
  freePort,
  startService,
  waitForHealth,
  type RunningService,
} from './service-harness.js';

let running: RunningService | undefined;

afterEach(() => {
  running?.child.kill('SIGKILL');
  running = undefined;
});

describe('service bootstrap', () => {
  it('listens, serves the health check, and exits cleanly on SIGTERM', async () => {
    const port = await freePort();
    const service = startService(SOURCE_ARGS, { PORT: String(port) });
    running = service;

    await waitForHealth(port, service);

    const exited = exitOf(service);
    service.child.kill('SIGTERM');
    expect(await exited).toBe(0);
  }, 20_000);

  it('refuses to start on invalid configuration, naming the variable', async () => {
    const service = startService(SOURCE_ARGS, { PORT: 'abc' });
    running = service;

    expect(await exitOf(service)).toBe(1);
    expect(service.stderr()).toMatch(/PORT/);
  }, 20_000);
});

/**
 * The dispatcher runs inside the service (step 4, open question 2) once a
 * destination is configured, and a deploy's SIGTERM still ends it cleanly.
 */
describe('event delivery in the service', () => {
  it('delivers pending events to a configured destination, and still exits on SIGTERM', async () => {
    const receiver = await startReceiver();
    const pool = createPool(TEST_DATABASE_URL, 1);
    const eventId = randomUUID();
    try {
      await createDb(pool)
        .insert(eventOutbox)
        .values({
          eventId,
          eventType: 'review_item.changed',
          destination: 'audit-log',
          payload: {
            id: eventId,
            type: 'review_item.changed',
            source: 'ropa',
            occurredAt: new Date().toISOString(),
            data: {},
          },
        });

      const port = await freePort();
      const service = startService(SOURCE_ARGS, {
        PORT: String(port),
        EVENT_DESTINATION_AUDIT_LOG: receiver.url,
      });
      running = service;
      await waitForHealth(port, service);

      // Other files' committed events may go first; this one arrives in time.
      const deadline = Date.now() + 10_000;
      while (!receiver.received.some((request) => request.body.id === eventId)) {
        expect(Date.now(), service.stderr()).toBeLessThan(deadline);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const exited = exitOf(service);
      service.child.kill('SIGTERM');
      expect(await exited).toBe(0);
    } finally {
      await receiver.close();
      await pool.end();
    }
  }, 20_000);
});
