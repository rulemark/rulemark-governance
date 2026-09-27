import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { createDb, createPool } from '../src/db/client.js';
import { eventOutbox } from '../src/db/schema/index.js';
import { TEST_DATABASE_URL } from './db/harness.js';
import { startReceiver } from './scripted-receiver.js';
import {
  APP_ROOT,
  JOB_SOURCE_ARGS,
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

/**
 * The coverage cron job's process (step 4, Phase 6): what Render runs each
 * night, and the exit code it judges the run by.
 */
describe('the coverage job', () => {
  const SECRET = 'the-mint-secret-nobody-should-guess';

  function runJob(env: Record<string, string>): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        JOB_SOURCE_ARGS,
        { cwd: APP_ROOT, env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'info', ...env } },
        (error, stdout, stderr) => {
          resolve({ code: error ? Number(error.code ?? 1) : 0, output: stdout + stderr });
        },
      );
    });
  }

  async function serviceKnowing(subjects: object[]): Promise<number> {
    const port = await freePort();
    const service = startService(SOURCE_ARGS, {
      PORT: String(port),
      PRINCIPALS: JSON.stringify(subjects),
    });
    running = service;
    await waitForHealth(port, service);
    return port;
  }

  it('runs once against the service and exits 0', async () => {
    const port = await serviceKnowing([
      { sub: 'svc:schedule', name: 'Coverage job', roles: ['service:schedule'] },
    ]);
    const { code, output } = await runJob({
      TOKEN_MINT_SECRET: SECRET,
      ROPA_API_URL: `127.0.0.1:${port}`,
    });
    expect(code, output).toBe(0);
    expect(output).toContain('"msg":"coverage job finished"');
  }, 30_000);

  it('exits 1 naming PRINCIPALS when its subject is unknown', async () => {
    const port = await serviceKnowing([
      { sub: 'priya.raman', name: 'Priya Raman', roles: ['editor'] },
    ]);
    const { code, output } = await runJob({
      TOKEN_MINT_SECRET: SECRET,
      ROPA_API_URL: `127.0.0.1:${port}`,
    });
    expect(code).toBe(1);
    expect(output).toMatch(/svc:schedule.*PRINCIPALS/);
  }, 30_000);

  it('refuses to start on invalid configuration, naming the variable', async () => {
    const { code, output } = await runJob({ TOKEN_MINT_SECRET: 'short' });
    expect(code).toBe(1);
    expect(output).toMatch(/TOKEN_MINT_SECRET/);
  }, 30_000);
});
