import { ReviewItem } from '@rulemark/ropa-schemas';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { replayStory, resetDatabase } from '../../src/demo/replay-story.js';
import { runCoverageJob, type CoverageJobResult } from '../../src/jobs/coverage-job.js';
import { loadConfig } from '../../src/shared/config.js';
import { createLogger } from '../../src/shared/logger.js';
import { TEST_DATABASE_URL } from './harness.js';
import { listenOnLoopback } from '../listen.js';

/**
 * The coverage cron job (step 4, Phase 6), against the API on the replayed
 * story, over real HTTP as it runs on Render. After Chapter 6 coverage finds
 * one thing, Aurelia's region violation on P1; the job carries it to a person
 * once, and never decides anything itself. Runs in order: each test picks up
 * where the last one left the item.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([
    { sub: 'svc:schedule', name: 'Coverage job', roles: ['service:schedule'] },
    { sub: 'priya.raman', name: 'Priya Raman', roles: ['editor'] },
    { sub: 'vera', name: 'Vera, a viewer', roles: ['viewer'] },
    { sub: 'svc:dsar', name: 'DSAR tracker', roles: ['service:dsar'] },
  ]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
let baseUrl: string;
let regionViolationKey: string;

const logger = createLogger({ logLevel: 'silent', nodeEnv: 'test' });

const run = (subject = 'svc:schedule', secret = ENV.TOKEN_MINT_SECRET) =>
  runCoverageJob({ baseUrl, subject, tokenMintSecret: secret, logger });

let priyaToken: string;

/** Not async: a supertest request is thenable, and awaiting it would send it bare. */
const asPriya = (method: 'get' | 'post', path: string) =>
  request(server)[method](path).set('Authorization', `Bearer ${priyaToken}`);

async function itemsWithKey(key: string): Promise<ReviewItem[]> {
  const response = await asPriya('get', `/v1/review-items?key=${encodeURIComponent(key)}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data as ReviewItem[];
}

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = await listenOnLoopback(
    createApp({ config: loadConfig(ENV), router: recordsRouter(db) }),
  );
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await resetDatabase(db);
  await replayStory(db);
  const minted = await request(server)
    .post('/v1/tokens')
    .send({ subject: 'priya.raman', secret: ENV.TOKEN_MINT_SECRET });
  priyaToken = minted.body.token as string;

  // Someone else's open item, about something else: it must not stand in for
  // the finding's own.
  const unrelated = await asPriya('post', '/v1/review-items').send({
    targetType: 'activity',
    target: 'P2',
    source: 'manual',
    reason: 'review_overdue',
    details: { key: 'review_overdue:someone-else' },
  });
  expect(unrelated.status, JSON.stringify(unrelated.body)).toBe(201);
});

afterAll(async () => {
  await resetDatabase(db);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe('runCoverageJob', () => {
  let first: CoverageJobResult;

  it('opens one review item for Aurelia’s region violation, as the schedule', async () => {
    first = await run();

    expect(first.findings).toBe(1);
    expect(first.failed).toEqual([]);
    expect(first.opened).toHaveLength(1);
    regionViolationKey = first.opened[0]!.key;
    expect(regionViolationKey).toMatch(/^region_violation:/);

    const [item] = await itemsWithKey(regionViolationKey);
    expect(item).toMatchObject({
      code: first.opened[0]!.code,
      targetType: 'activity',
      target: { code: 'P1' },
      source: 'schedule',
      reason: 'region_violation',
      status: 'open',
      openedBy: 'svc:schedule',
      dueAt: null,
      details: {
        key: regionViolationKey,
        severity: 'high',
        client: { slug: 'aurelia' },
        country: 'IN',
      },
    });
  });

  it('opens nothing on a second run: the finding is already with a person', async () => {
    const second = await run();
    expect(second).toMatchObject({ findings: 1, opened: [], failed: [] });
    expect(second.skipped).toEqual([
      { key: regionViolationKey, code: first.opened[0]!.code, status: 'open' },
    ]);
    expect(await itemsWithKey(regionViolationKey)).toHaveLength(1);
  });

  it('opens it again once resolved, because a finding that recurs means the fix did not hold', async () => {
    const resolved = await asPriya(
      'post',
      `/v1/review-items/${first.opened[0]!.code}/resolve`,
    ).send({ resolutionNote: 'Helpdesk Partners told to stay out of Aurelia’s data' });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);

    const third = await run();
    expect(third.opened).toHaveLength(1);
    expect(third.opened[0]!.key).toBe(regionViolationKey);
    expect(third.opened[0]!.code).not.toBe(first.opened[0]!.code);
  });

  it('stands by a dismissal: a person decided, and the job does not overrule them', async () => {
    const [open] = (await itemsWithKey(regionViolationKey)).filter(
      (item) => item.status === 'open',
    );
    const dismissed = await asPriya('post', `/v1/review-items/${open!.code}/dismiss`).send({
      resolutionNote: 'Aurelia accepted the India transfer in writing',
    });
    expect(dismissed.status, JSON.stringify(dismissed.body)).toBe(200);

    const fourth = await run();
    expect(fourth.opened).toEqual([]);
    expect(fourth.skipped).toEqual([
      { key: regionViolationKey, code: open!.code, status: 'dismissed' },
    ]);
  });

  it('never closes an item: every one it opened was closed by Priya', async () => {
    const items = await itemsWithKey(regionViolationKey);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.closedBy)).toEqual(['priya.raman', 'priya.raman']);
  });
});

describe('when the job cannot do its work', () => {
  it('says so when its subject is not in PRINCIPALS', async () => {
    await expect(run('svc:nobody')).rejects.toThrow(
      /"svc:nobody" isn’t in PRINCIPALS.*service:schedule/,
    );
  });

  it('says so when the mint secret is wrong', async () => {
    await expect(run('svc:schedule', 'not-the-secret-at-all')).rejects.toThrow(/401/);
  });

  it('fails when it cannot read coverage', async () => {
    await expect(run('svc:dsar')).rejects.toThrow(/coverage.*403/);
  });

  it('reports a finding it could not open, and carries on', async () => {
    // A viewer can read coverage and review items, but not open one.
    const reset = await pool.query(`DELETE FROM review_item WHERE details->>'key' = $1`, [
      regionViolationKey,
    ]);
    expect(reset.rowCount).toBe(2);

    const result = await run('vera');
    expect(result.opened).toEqual([]);
    expect(result.failed).toEqual([
      { key: regionViolationKey, error: expect.stringMatching(/403/) },
    ]);
  });
});
