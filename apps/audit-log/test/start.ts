import { afterEach, expect, it } from 'vitest';

import { exitOf, freePort, start, waitForHealth, type Running } from './process.js';

/**
 * The same checks against the sources and against the build: the receiver
 * listens on `PORT`, logs what it receives, refuses bad configuration, and
 * exits cleanly on the SIGTERM every deploy sends.
 */
export function startupTests(args: string[]): void {
  let running: Running | undefined;
  afterEach(() => {
    running?.child.kill('SIGKILL');
    running = undefined;
  });

  it('listens on PORT, logs an event as JSON, and exits cleanly on SIGTERM', async () => {
    const port = await freePort();
    running = start(args, { PORT: String(port) });
    await waitForHealth(port, running);

    const response = await fetch(`http://127.0.0.1:${port}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
        type: 'review_item.changed',
        source: 'ropa',
        occurredAt: '2026-07-10T09:00:00.000Z',
        data: { changeType: 'resolved', actor: 'priya.raman', reviewItem: { code: 'RI-2' } },
      }),
    });
    expect(response.status).toBe(204);

    const exited = exitOf(running);
    running.child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(running.output()).toContain('"msg":"review_item.changed RI-2 resolved by priya.raman"');
  }, 20_000);

  it('refuses to start on invalid configuration, naming the variable', async () => {
    running = start(args, { PORT: 'abc' });
    expect(await exitOf(running)).toBe(1);
    expect(running.output()).toMatch(/PORT/);
  }, 20_000);
}
