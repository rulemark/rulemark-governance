import { Activity, Engagement } from '@rulemark/ropa-schemas';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { replayStory, resetDatabase } from '../../src/demo/replay-story.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * The engagement sub-resource (`ropa-api.md` §3.5): an activity's engagements,
 * read one vendor at a time, over the seeded story. They are the activity's
 * own rows, not a record of their own: the same shape, the activity's ETag,
 * and found by id only (DM §3.0). Like `governance-views.test.ts`, the story
 * is replayed once and the database reset before and after.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([
    { sub: 'svc:monitor', name: 'Subprocessor Monitor', roles: ['service:monitor'] },
  ]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  await resetDatabase(db);
  await replayStory(db);
});

afterAll(async () => {
  await resetDatabase(db);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function ok(path: string) {
  const response = await request(server).get(path);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response;
}

async function activity(ref: string) {
  const response = await ok(`/v1/activities/${ref}`);
  return { body: Activity.parse(response.body), etag: response.headers['etag'] as string };
}

describe('GET /activities/{ref}/engagements', () => {
  it('lists the activity’s engagements as the activity holds them, under its ETag', async () => {
    const p1 = await activity('P1');
    const response = await ok('/v1/activities/P1/engagements');
    expect(response.headers['etag']).toBe(p1.etag);
    expect(response.body).toEqual({ data: p1.body.engagements, nextCursor: null });
    expect(response.body.data.map((row: unknown) => Engagement.parse(row))).toHaveLength(
      p1.body.engagements.length,
    );
  });

  it('holds a controller activity’s recipients too, with no client scope', async () => {
    const c2 = await activity('C2');
    const response = await ok('/v1/activities/C2/engagements');
    expect(response.body.data).toEqual(c2.body.engagements);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data[0]).not.toHaveProperty('clientScope');
  });

  it('finds the activity by id as well as by code', async () => {
    const p1 = await activity('P1');
    const response = await ok(`/v1/activities/${p1.body.id}/engagements`);
    expect(response.body.data).toEqual(p1.body.engagements);
  });

  it('answers 404 for an activity that does not exist', async () => {
    const response = await request(server).get('/v1/activities/P99/engagements');
    expect(response.status).toBe(404);
    expect(response.body.detail).toBe('No activity matching "P99"');
  });
});

describe('GET /activities/{ref}/engagements/{id}', () => {
  it('reads P1’s two Mailcrest engagements one by one (the Phase 2 done-when)', async () => {
    const p1 = await activity('P1');
    const mailcrest = p1.body.engagements.filter(
      (engagement) => engagement.party.slug === 'mailcrest',
    );
    expect(mailcrest.map((engagement) => engagement.serviceDescription)).toEqual([
      'Candidate notifications (US region)',
      'Candidate notifications (EU region)',
    ]);

    for (const engagement of mailcrest) {
      const response = await ok(`/v1/activities/P1/engagements/${engagement.id}`);
      expect(response.headers['etag']).toBe(p1.etag);
      expect(response.body).toEqual(engagement);
    }
  });

  it('answers 404 for an engagement another activity holds', async () => {
    const p3 = await activity('P3');
    const scribe = p3.body.engagements[0]!;
    await ok(`/v1/activities/P3/engagements/${scribe.id}`);

    const response = await request(server).get(`/v1/activities/P1/engagements/${scribe.id}`);
    expect(response.status, JSON.stringify(response.body)).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body.detail).toBe(`Activity P1 holds no engagement ${scribe.id}`);
  });

  it.each([
    ['an id nobody holds', '0199c3a1-8f2e-7c4d-b8e1-000000000000'],
    ['something that is not an id', 'mailcrest'],
  ])('answers 404 for %s: engagements are found by id only', async (_, id) => {
    const response = await request(server).get(`/v1/activities/P1/engagements/${id}`);
    expect(response.status, JSON.stringify(response.body)).toBe(404);
    expect(response.body.detail).toBe(`Activity P1 holds no engagement ${id}`);
  });
});

describe('who may read engagements', () => {
  it('needs what reading the activity needs: record:read', async () => {
    const minted = await request(server)
      .post('/v1/tokens')
      .send({ subject: 'svc:monitor', secret: ENV.TOKEN_MINT_SECRET });
    const monitor = minted.body.token as string;
    const p1 = await activity('P1');

    for (const path of [
      '/v1/activities/P1',
      '/v1/activities/P1/engagements',
      `/v1/activities/P1/engagements/${p1.body.engagements[0]!.id}`,
    ]) {
      const response = await request(server).get(path).set('Authorization', `Bearer ${monitor}`);
      expect(response.status, path).toBe(403);
    }
  });
});
