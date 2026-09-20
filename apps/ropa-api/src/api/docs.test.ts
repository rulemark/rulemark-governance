import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb, createPool } from '../db/client.js';
import { TEST_DATABASE_URL } from '../../test/db/harness.js';
import { loadConfig } from '../shared/config.js';
import { createApp } from './app.js';
import { buildOpenApiDocument } from './openapi/document.js';
import { recordsRouter } from './resources/index.js';

const config = loadConfig({
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([{ sub: 'reader', name: 'A Reader', roles: ['viewer'] }]),
});

/**
 * A real database handle. A public read (`GET /v1/parties`) reaches its
 * handler, so handing the router `undefined` would turn a routing check into a
 * crash and make the result meaningless.
 */
const pool = createPool(config.databaseUrl, 2);
const app = createApp({ config, router: recordsRouter(createDb(pool)) });

/** One server for the file; see the note in test/db/endpoints.test.ts. */
const server = app.listen(0);

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  await pool.end();
});

const document = buildOpenApiDocument() as {
  paths: Record<string, Record<string, unknown>>;
};

describe('GET /openapi.json', () => {
  it('serves the document without a token', async () => {
    const response = await request(server).get('/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.openapi).toBe('3.1.0');
  });

  it('is the same document the generator builds', async () => {
    const response = await request(server).get('/openapi.json');
    expect(response.body).toEqual(JSON.parse(JSON.stringify(document)));
  });
});

describe('GET /api-docs', () => {
  it('serves Swagger UI without a token', async () => {
    const response = await request(server).get('/api-docs/').redirects(1);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('swagger-ui');
  });
});

describe('every documented route exists', () => {
  /**
   * The document is generated from the same definitions as the router, so this
   * guards what that shares nothing with: the hand-written paths, and any typo
   * in a path template. A route the app does not have answers with the 404 from
   * `notFoundHandler`, whose detail begins "No route for" — a record that does
   * not exist says something else entirely.
   */
  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => ({ method, path })),
  );

  it('covers a meaningful number of operations', () => {
    expect(operations.length).toBeGreaterThan(50);
  });

  it.each(operations)('$method $path is routable', async ({ method, path }) => {
    // Placeholders only need to be syntactically acceptable: these requests are
    // unauthenticated, so a write stops at 401 long before touching a database.
    const url = path.replaceAll('{ref}', 'some-ref').replaceAll('{version}', '1');

    const response = await (request(server) as unknown as Record<string, (u: string) => never>)[
      method
    ]!(url);

    const body = (response as unknown as { body?: { detail?: string } }).body;
    expect(body?.detail ?? '', `${method} ${url}`).not.toMatch(/^No route for/);
  });
});
