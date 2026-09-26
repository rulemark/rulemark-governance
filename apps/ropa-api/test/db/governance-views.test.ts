import { ImpactResponse } from '@rulemark/ropa-schemas';
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
 * Build step 3's views over the seeded record, asked as the services that need
 * them would ask (`ropa-api.md` §5.3–§5.5, story Ch5–Ch7). The story is
 * replayed once for the file; like `seed.test.ts`, it resets the test database
 * before and after, because the story brings a self party.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([
    { sub: 'svc:monitor', name: 'Subprocessor Monitor', roles: ['service:monitor'] },
    { sub: 'svc:dsar', name: 'DSAR tracker', roles: ['service:dsar'] },
  ]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
const tokens = { monitor: '', dsar: '' };

async function mint(subject: string): Promise<string> {
  const response = await request(server)
    .post('/v1/tokens')
    .send({ subject, secret: ENV.TOKEN_MINT_SECRET });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

const as = (who: keyof typeof tokens, path: string) =>
  request(server).get(path).set('Authorization', `Bearer ${tokens[who]}`);

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  await resetDatabase(db);
  await replayStory(db);
  tokens.monitor = await mint('svc:monitor');
  tokens.dsar = await mint('svc:dsar');
});

afterAll(async () => {
  await resetDatabase(db);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe('GET /parties/mailcrest/impact: what the Monitor sees in Chapter 6', () => {
  let impact: ImpactResponse;

  beforeAll(async () => {
    const response = await as('monitor', '/v1/parties/mailcrest/impact');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    impact = ImpactResponse.parse(response.body);
  });

  const rows = () =>
    impact.engagements.map(
      (entry) => `${entry.activity.code} ${entry.engagement.serviceDescription}`,
    );

  it('lists every Mailcrest engagement, P1 twice (§5.3)', () => {
    expect(impact.party.slug).toBe('mailcrest');
    expect(rows()).toHaveLength(4);
    expect(rows().filter((row) => row.startsWith('P1 '))).toEqual([
      'P1 Candidate notifications (US region)',
      'P1 Candidate notifications (EU region)',
    ]);
    expect(impact.engagements.map((entry) => entry.activity.code)).toEqual([
      'C2',
      'C3',
      'P1',
      'P1',
    ]);
  });

  it('marks C2 and C3 as Hireloop’s own decision, with no clients to tell', () => {
    for (const entry of impact.engagements.slice(0, 2)) {
      expect(entry).toMatchObject({ activityRole: 'controller', engagementRole: 'processor' });
      expect(entry.clientGroups).toEqual([]);
    }
  });

  it('groups the US region’s clients under the Standard DPA: a notice is enough, in time', () => {
    const us = impact.engagements[2]!;
    expect(us).toMatchObject({ activityRole: 'processor', engagementRole: 'subprocessor' });
    expect(us.processingCountries).toEqual(['US']);
    expect(us.clientGroups).toHaveLength(1);
    expect(us.clientGroups[0]).toMatchObject({
      terms: { slug: 'standard-dpa-v3' },
      authorizationType: 'general',
      noticeDays: 30,
      clientCount: 2,
      requiresApproval: false,
      noticeConflict: false,
    });
    expect(us.clientGroups[0]!.clients?.map((client) => client.slug).sort()).toEqual([
      'fjord',
      'northwind',
    ]);
    expect(us.clientGroups[0]).not.toHaveProperty('allowedRegions');
  });

  it('puts Aurelia alone on the EU region: approval required, notice too short, EEA only', () => {
    const eu = impact.engagements[3]!;
    expect(eu.processingCountries).toEqual(['IE']);
    expect(eu.clientGroups).toEqual([
      {
        terms: expect.objectContaining({ slug: 'aurelia-dpa' }),
        authorizationType: 'specific',
        noticeDays: 60,
        allowedRegions: ['EEA'],
        clientCount: 1,
        clients: [expect.objectContaining({ slug: 'aurelia' })],
        requiresApproval: true,
        noticeConflict: true,
      },
    ]);
  });

  it('names Mailcrest’s own DPA, whose 30 days are what collide with Aurelia’s 60', () => {
    expect(impact.vendorTerms).toEqual([
      expect.objectContaining({
        slug: 'mailcrest-dpa',
        authorizationType: 'general',
        noticeDays: 30,
      }),
    ]);
  });

  it('says who the data is about and what Mailcrest receives', () => {
    const [c2, , p1] = impact.engagements;
    expect(c2!.subjectCategories.map((ref) => ref.slug)).toEqual(['client-users']);
    expect(p1!.subjectCategories.map((ref) => ref.slug)).toEqual(['candidates']);
    expect(p1!.dataCategories.map((ref) => ref.slug)).toEqual(['identity']);
    expect(p1!.specialCategories).toBe(false);
  });

  it('sums it up', () => {
    expect(impact.summary).toEqual({
      engagements: 4,
      activities: 3,
      processorActivities: 1,
      affectedClients: 3,
      clientsRequiringApproval: 1,
      noticeConflicts: 1,
    });
  });
});

describe('asking for an impact', () => {
  it('is open to anyone who may read views, the Monitor included (§1.9)', async () => {
    expect((await request(server).get('/v1/parties/mailcrest/impact')).status).toBe(200);
  });

  it('is refused to a token without view:impact', async () => {
    const response = await as('dsar', '/v1/parties/mailcrest/impact');
    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('view:impact');
  });

  it('answers 404 for a party that does not exist', async () => {
    expect((await as('monitor', '/v1/parties/nobody/impact')).status).toBe(404);
  });

  it('answers a party nothing depends on with an empty list, not an error', async () => {
    const response = await as('monitor', '/v1/parties/northwind/impact');
    expect(response.status).toBe(200);
    expect(response.body.engagements).toEqual([]);
    expect(response.body.vendorTerms).toEqual([]);
  });

  it('lists every client with expandClients=true, and refuses a value that is not a boolean', async () => {
    const expanded = await as('monitor', '/v1/parties/mailcrest/impact?expandClients=true');
    expect(expanded.status).toBe(200);
    expect((await as('monitor', '/v1/parties/mailcrest/impact?expandClients=yes')).status).toBe(
      422,
    );
  });

  it('says asOf is not supported yet, rather than quietly answering for today', async () => {
    const response = await as('monitor', '/v1/parties/mailcrest/impact?asOf=2026-06-03');
    expect(response.status).toBe(422);
    expect(response.body.errors[0].code).toBe('not_yet_supported');
  });
});
