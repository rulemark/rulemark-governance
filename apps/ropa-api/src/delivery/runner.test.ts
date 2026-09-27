import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../shared/logger.js';
import type { DispatchResult } from './dispatcher.js';
import { startRunner, type RunnerOptions } from './runner.js';

/**
 * The loop around `dispatchOnce()` (step 4, open question 2), tested without a
 * database: what it runs is passed in, so these tests script it.
 */

const done = (claimed: number): DispatchResult => ({ claimed, delivered: claimed, failed: 0 });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function capture() {
  const lines: { level: number; msg: string; [key: string]: unknown }[] = [];
  const logger = createLogger(
    { logLevel: 'debug', nodeEnv: 'test' },
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(JSON.parse(chunk.toString('utf8')) as (typeof lines)[number]);
        callback();
      },
    }),
  );
  return { logger, lines };
}

function options(overrides: Partial<RunnerOptions>): RunnerOptions {
  return {
    dispatch: () => Promise.resolve(done(0)),
    cleanup: () => Promise.resolve(0),
    logger: capture().logger,
    idleMs: 20,
    cleanupEveryMs: 60_000,
    ...overrides,
  };
}

describe('startRunner', () => {
  it('goes again at once while there is work, and waits when there is none', async () => {
    const script = [3, 1, 0];
    let calls = 0;
    const runner = startRunner(
      options({
        dispatch: () => Promise.resolve(done(script[calls++] ?? 0)),
        idleMs: 10_000,
      }),
    );
    await pause(100);
    await runner.stop();

    // Two batches with work, one empty, then a sleep far longer than the test.
    expect(calls).toBe(3);
  });

  it('keeps polling while idle', async () => {
    let calls = 0;
    const runner = startRunner(
      options({
        dispatch: () => {
          calls += 1;
          return Promise.resolve(done(0));
        },
        idleMs: 20,
      }),
    );
    await pause(150);
    await runner.stop();
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('stops at once while idle', async () => {
    let calls = 0;
    const runner = startRunner(
      options({
        dispatch: () => {
          calls += 1;
          return Promise.resolve(done(0));
        },
        idleMs: 10_000,
      }),
    );
    await pause(20);

    const started = Date.now();
    await runner.stop();
    expect(Date.now() - started).toBeLessThan(500);
    expect(calls).toBe(1);
  });

  it('on stop, lets the batch in flight finish, and claims no other', async () => {
    const inFlight = deferred();
    let calls = 0;
    let finished = false;
    const runner = startRunner(
      options({
        dispatch: async () => {
          calls += 1;
          await inFlight.promise;
          finished = true;
          // There is more: without the stop, it would go again at once.
          return done(10);
        },
      }),
    );
    await pause(20);

    const stopped = runner.stop();
    const first = await Promise.race([
      stopped.then(() => 'stopped'),
      pause(50).then(() => 'still waiting'),
    ]);
    expect(first).toBe('still waiting');
    expect(finished).toBe(false);

    inFlight.resolve();
    await stopped;
    expect(finished).toBe(true);
    expect(calls).toBe(1);
  });

  it('survives a pass that throws, logging it, and tries again after a pause', async () => {
    const { logger, lines } = capture();
    let calls = 0;
    const runner = startRunner(
      options({
        logger,
        dispatch: () => {
          calls += 1;
          return calls === 1
            ? Promise.reject(new Error('connection terminated'))
            : Promise.resolve(done(0));
        },
        idleMs: 20,
      }),
    );
    await pause(100);
    await runner.stop();

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(lines.find((line) => line.msg === 'outbox dispatch failed')).toMatchObject({
      level: 50,
      err: { message: 'connection terminated' },
    });
  });

  it('cleans up delivered rows when it starts, and then every so often', async () => {
    const { logger, lines } = capture();
    let cleanups = 0;
    const runner = startRunner(
      options({
        logger,
        cleanup: () => {
          cleanups += 1;
          return cleanups === 2 ? Promise.reject(new Error('lock timeout')) : Promise.resolve(3);
        },
        idleMs: 10,
        cleanupEveryMs: 60,
      }),
    );
    await pause(20);
    expect(cleanups).toBe(1);

    await pause(200);
    await runner.stop();
    expect(cleanups).toBeGreaterThanOrEqual(3);
    expect(lines.find((line) => line.msg === 'outbox cleanup failed')).toMatchObject({ level: 50 });
    expect(lines.find((line) => line.msg === 'delivered events cleaned up')).toMatchObject({
      deleted: 3,
    });
  });

  it('can be stopped twice', async () => {
    const runner = startRunner(options({}));
    await Promise.all([runner.stop(), runner.stop()]);
    await runner.stop();
  });
});
