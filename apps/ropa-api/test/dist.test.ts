import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DIST_ARGS,
  DIST_ENTRY,
  exitOf,
  freePort,
  startService,
  waitForHealth,
  type RunningService,
} from './service-harness.js';

/**
 * The artifact Render actually runs, started the way Render actually starts it.
 *
 * Every other test runs the TypeScript sources through tsx, which resolves
 * workspace packages to *their* sources. That hides a whole class of failure:
 * `@rulemark/ropa-schemas` once pointed its entry at `src/index.ts`, and since
 * Node refuses to strip types inside `node_modules`, `node dist/index.js` could
 * not start — while the entire test suite stayed green. These tests exist so
 * that gap is closed at build time instead of at deploy time.
 *
 * Needs a build first: run `npm run test:dist` from the repository root.
 */

let running: RunningService | undefined;

afterEach(() => {
  running?.child.kill('SIGKILL');
  running = undefined;
});

describe('the built service', () => {
  it('has been built', () => {
    expect(
      existsSync(DIST_ENTRY),
      `${DIST_ENTRY} is missing. Run "npm run build" first, or "npm run test:dist" from the root.`,
    ).toBe(true);
  });

  it('starts from dist and serves the health check', async () => {
    const port = await freePort();
    const service = startService(DIST_ARGS, { PORT: String(port), NODE_ENV: 'production' });
    running = service;

    await waitForHealth(port, service);

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  }, 20_000);

  it('loads its workspace packages from their built output', async () => {
    const port = await freePort();
    const service = startService(DIST_ARGS, { PORT: String(port), NODE_ENV: 'production' });
    running = service;

    await waitForHealth(port, service);

    // The problem type URI is built from PROBLEM_TYPE_BASE, which comes from
    // @rulemark/ropa-schemas. Getting it back proves the package resolved from
    // dist at runtime and not merely at type-check time.
    const response = await fetch(`http://127.0.0.1:${port}/v1/nothing-here`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(await response.json()).toMatchObject({
      type: 'https://ropa.example/problems/not-found',
      status: 404,
    });
  }, 20_000);

  it('shuts down cleanly on SIGTERM, as Render expects', async () => {
    const port = await freePort();
    const service = startService(DIST_ARGS, { PORT: String(port), NODE_ENV: 'production' });
    running = service;

    await waitForHealth(port, service);

    const exited = exitOf(service);
    service.child.kill('SIGTERM');
    expect(await exited).toBe(0);
  }, 20_000);
});
