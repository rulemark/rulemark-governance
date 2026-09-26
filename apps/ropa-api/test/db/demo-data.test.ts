import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { loadDemoData, mintToken, type Outcome } from '../../src/demo/load-over-http.js';
import { resetDatabase } from '../../src/demo/replay-story.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * `demo:data` (the carried-over item): the story loaded over HTTP, as any
 * client would, activities included. Against a real listening server, so the
 * requests are the ones a deployed service would receive. The database is
 * reset before and after, because the story brings its own self party.
 */
const SECRET = 'the-mint-secret-nobody-should-guess';
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: SECRET,
  PRINCIPALS: JSON.stringify([{ sub: 'svc:seed', name: 'Demo loader', roles: ['admin'] }]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
let baseUrl: string;
let first: Outcome[];

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  await resetDatabase(db);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = await mintToken(baseUrl, 'svc:seed', SECRET);
  first = await loadDemoData(baseUrl, token);
}, 60_000);

afterAll(async () => {
  await resetDatabase(db);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

const get = async (path: string) => (await fetch(`${baseUrl}/v1/${path}`)).json();
const failures = (outcomes: Outcome[]) => outcomes.filter((outcome) => outcome.status === 'failed');

describe('demo:data over HTTP', () => {
  it('loads everything without a failure', () => {
    expect(failures(first)).toEqual([]);
    expect(first.filter((outcome) => outcome.status === 'created').length).toBeGreaterThan(50);
  });

  it('creates and approves the story’s seven activities', async () => {
    const { data } = (await get('activities?limit=50')) as {
      data: { code: string; name: string; status: string }[];
    };
    expect(data.map((activity) => [activity.name, activity.status]).sort()).toEqual(
      [
        ['CV parsing', 'active'],
        ['Candidate application management', 'active'],
        ['Customer accounts & billing', 'active'],
        ['Diversity & accommodations module', 'active'],
        ['Hireloop sales & marketing (prospective customers)', 'active'],
        ['Hireloop staff administration', 'active'],
        ['Service reliability monitoring', 'active'],
      ].sort(),
    );
  });

  it('makes the Ch4 and Ch6 edits through GET-then-PUT, as a client would', async () => {
    const aurelia = (await get('subprocessors?client=aurelia')) as {
      subprocessors: {
        party: { slug: string };
        processingCountries: string[];
        transfers: { onwardVia: string | null }[];
      }[];
    };
    expect(
      aurelia.subprocessors.map(
        (entry) => `${entry.party.slug} ${entry.processingCountries.join('+')}`,
      ),
    ).toEqual(['render DE', 'mailcrest IE']);
    expect(aurelia.subprocessors[1]?.transfers.map((transfer) => transfer.onwardVia)).toEqual([
      'Helpdesk Partners Pvt Ltd',
    ]);
  });

  it('changes nothing the second time', async () => {
    const token = await mintToken(baseUrl, 'svc:seed', SECRET);
    const again = await loadDemoData(baseUrl, token);
    expect(failures(again)).toEqual([]);
    expect(again.filter((outcome) => outcome.status === 'created')).toEqual([]);
    expect(again.length).toBe(first.length);
  });
});
