import { afterEach, describe, expect, it } from 'vitest';

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
