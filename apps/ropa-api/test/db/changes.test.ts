import { ChangesResponse, type Change } from '@rulemark/ropa-schemas';
import { eq } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { party } from '../../src/db/schema/index.js';
import { replayStory, resetDatabase } from '../../src/demo/replay-story.js';
import { updateAggregate } from '../../src/domain/aggregate.js';
import { partyAggregate } from '../../src/domain/aggregates.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * `GET /changes` (`ropa-api.md` §2): "what changed since March" (Ch8), over
 * the seeded story, with a review item opened and resolved on top. Replayed
 * once for the file; the database is reset before and after.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([
    { sub: 'priya.raman', name: 'Priya Raman', roles: ['editor'] },
    { sub: 'svc:snapshot', name: 'Architecture Snapshot', roles: ['service:snapshot'] },
    { sub: 'svc:dsar', name: 'DSAR tracker', roles: ['service:dsar'] },
  ]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
const tokens = { priya: '', snapshot: '', dsar: '' };

async function mint(subject: string): Promise<string> {
  const response = await request(server)
    .post('/v1/tokens')
    .send({ subject, secret: ENV.TOKEN_MINT_SECRET });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

const as = (who: keyof typeof tokens, method: 'get' | 'post', path: string) =>
  request(server)[method](path).set('Authorization', `Bearer ${tokens[who]}`);

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  await resetDatabase(db);
  await replayStory(db);
  tokens.priya = await mint('priya.raman');
  tokens.snapshot = await mint('svc:snapshot');
  tokens.dsar = await mint('svc:dsar');

  // The Snapshot opens the region violation it found (Ch6); Priya resolves it.
  const opened = await as('snapshot', 'post', '/v1/review-items').send({
    targetType: 'activity',
    target: 'P1',
    source: 'snapshot',
    reason: 'region_violation',
  });
  expect(opened.status, JSON.stringify(opened.body)).toBe(201);
  const resolved = await as('priya', 'post', `/v1/review-items/${opened.body.code}/resolve`).send({
    resolutionNote: 'Aurelia told; Helpdesk Partners kept out of her EU region',
  });
  expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
});

afterAll(async () => {
  await resetDatabase(db);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function changes(query: string): Promise<ChangesResponse> {
  const response = await as('priya', 'get', `/v1/changes?${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return ChangesResponse.parse(response.body);
}

/** Every page, following the cursor. */
async function allChanges(query: string): Promise<Change[]> {
  const rows: Change[] = [];
  let cursor: string | null = null;
  do {
    const page: ChangesResponse = await changes(
      `${query}${cursor === null ? '' : `&cursor=${cursor}`}`,
    );
    rows.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return rows;
}

const label = (change: Change) =>
  `${change.entityType} ${change.entity.code ?? change.entity.slug ?? change.entity.name} ${change.changeType}`;

const SINCE_MARCH = [
  'party aurelia created',
  'agreement_terms aurelia-dpa created',
  'agreement Agreement signed 2026-03-16 created',
  'activity P1 updated',
  'activity P2 created',
  'activity P2 activated',
  'system cv-parser created',
  'party scribe-ai created',
  'agreement_terms scribe-ai-dpa created',
  'agreement Agreement signed 2026-04-10 created',
  'activity P3 created',
  'activity P3 activated',
  'activity C2 updated',
  'activity C3 updated',
  'activity P1 updated',
  'review_item RI-1 opened',
  'review_item RI-1 resolved',
];

describe('GET /changes?from=2026-03-01: what changed since March (Ch8)', () => {
  let since: Change[];

  beforeAll(async () => {
    since = await allChanges('from=2026-03-01&limit=200');
  });

  it('lists the story’s changes in the order they took effect, review items included', () => {
    expect(since.map(label)).toEqual(SINCE_MARCH);
  });

  it('says who made each change, and why', () => {
    expect(since.find((change) => label(change) === 'activity P3 created')).toEqual({
      id: expect.any(String),
      entityType: 'activity',
      entity: { id: expect.any(String), code: 'P3', name: 'CV parsing' },
      version: 1,
      changeType: 'created',
      occurredAt: '2026-04-14T10:00:00.000Z',
      actor: 'priya.raman',
      changeNote: 'AI CV parsing, with Scribe AI; Aurelia objected, so not for her (Ch5)',
    });
  });

  it('shows review items opened and closed, with who, and the resolution as the note', () => {
    const [opened, resolved] = since.slice(-2);
    expect(opened).toMatchObject({
      entity: { code: 'RI-1', name: 'Region violation on P1' },
      version: null,
      actor: 'svc:snapshot',
      changeNote: null,
    });
    expect(resolved).toMatchObject({
      entity: { code: 'RI-1' },
      version: null,
      actor: 'priya.raman',
      changeNote: 'Aurelia told; Helpdesk Partners kept out of her EU region',
    });
    expect(Date.parse(resolved!.occurredAt)).toBeGreaterThanOrEqual(Date.parse(opened!.occurredAt));
  });

  it('pages without losing or repeating a row, even between changes at the same instant', async () => {
    const onePerPage = await allChanges('from=2026-03-01&limit=1');
    expect(onePerPage.map((change) => change.id)).toEqual(since.map((change) => change.id));
    expect((await changes('from=2026-03-01&limit=5')).nextCursor).not.toBeNull();
    expect((await changes('from=2026-03-01&limit=200')).nextCursor).toBeNull();
  });
});

describe('the range and the filter', () => {
  it('reads a date `to` as the end of that day, and a timestamp as that instant', async () => {
    expect((await allChanges('from=2026-03-01&to=2026-03-16')).map(label)).toEqual(
      SINCE_MARCH.slice(0, 6),
    );
    expect((await allChanges('from=2026-03-01&to=2026-03-16T10:00:00Z')).map(label)).toEqual(
      SINCE_MARCH.slice(0, 4),
    );
  });

  it('reads a date `from` as the start of that day', async () => {
    expect((await allChanges('from=2026-04-14&to=2026-04-14')).map(label)).toEqual(
      SINCE_MARCH.slice(7, 12),
    );
  });

  it('includes a change at exactly the `from` instant, and a range of one instant', async () => {
    expect((await allChanges('from=2026-03-16T08:00:00Z&to=2026-03-16')).map(label)).toEqual(
      SINCE_MARCH.slice(0, 6),
    );
    expect(
      (await allChanges('from=2026-04-14T10:00:00Z&to=2026-04-14T10:00:00Z')).map(label),
    ).toEqual(['activity P3 created']);
  });

  it('starts at the beginning of the record without a `from`', async () => {
    const all = await allChanges('limit=200');
    expect(all[0]!.occurredAt).toBe('2026-02-10T08:00:00.000Z');
    expect(all.slice(-SINCE_MARCH.length).map(label)).toEqual(SINCE_MARCH);
  });

  it('filters by entity type, review items included', async () => {
    expect((await allChanges('from=2026-03-01&entityType=activity')).map(label)).toEqual(
      SINCE_MARCH.filter((entry) => entry.startsWith('activity ')),
    );
    expect((await allChanges('entityType=review_item')).map(label)).toEqual(SINCE_MARCH.slice(-2));
  });

  it('refuses a range that ends before it starts', async () => {
    const response = await as('priya', 'get', '/v1/changes?from=2026-04-01&to=2026-03-01');
    expect(response.status).toBe(422);
    expect(response.body.errors[0]).toMatchObject({ path: '/to', code: 'from_after_to' });
  });

  it('refuses an entity type with no history, and a cursor it did not give', async () => {
    const wrongType = await as('priya', 'get', '/v1/changes?entityType=engagement');
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.errors[0]).toMatchObject({ path: '/entityType' });
    expect((await as('priya', 'get', '/v1/changes?cursor=bm9wZQ')).status).toBe(400);
  });

  it('needs history:read', async () => {
    const response = await as('dsar', 'get', '/v1/changes');
    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('history:read');
  });
});

describe('names of the time', () => {
  it('names each change as the record was named when it was made', async () => {
    const [row] = await db.select().from(party).where(eq(party.slug, 'mailcrest'));
    await db.transaction((tx) =>
      updateAggregate(
        tx,
        partyAggregate,
        row!.id,
        row!.version,
        { legalName: 'Mailcrest Group Inc.' },
        { actor: 'priya.raman', changeNote: 'Renamed after the merger' },
      ),
    );

    const mailcrest = (await allChanges('entityType=party')).filter(
      (change) => change.entity.slug === 'mailcrest',
    );
    expect(mailcrest.map((change) => [change.changeType, change.entity.name])).toEqual([
      ['created', 'Mailcrest Inc.'],
      ['updated', 'Mailcrest Group Inc.'],
    ]);
  });
});

describe('the order changes took effect in, not the order they were recorded', () => {
  it('places a backdated save where it took effect, and pages through it', async () => {
    // Recorded now, effective 20 April: between P3 going live and Ch6.
    const [row] = await db.select().from(party).where(eq(party.slug, 'scribe-ai'));
    await db.transaction((tx) =>
      updateAggregate(
        tx,
        partyAggregate,
        row!.id,
        row!.version,
        { trustUrl: 'https://scribe.example/trust' },
        { actor: 'priya.raman', validFrom: new Date('2026-04-20T12:00:00Z') },
      ),
    );

    const expected = ['activity P3 activated', 'party scribe-ai updated', 'activity C2 updated'];
    expect(
      (await allChanges('from=2026-04-14T15:00:00Z&to=2026-07-03T09:00:00Z&limit=2'))
        .map(label)
        .slice(0, 3),
    ).toEqual(expected);
    expect(
      (await allChanges('from=2026-04-14T15:00:00Z&to=2026-07-03T09:00:00Z&limit=1'))
        .map(label)
        .slice(0, 3),
    ).toEqual(expected);
  });

  it('pages exactly between two changes a microsecond apart', async () => {
    // The app writes whole milliseconds; Postgres keeps microseconds, and a
    // cursor that rounded them would repeat or skip a row.
    const { rows } = await pool.query<{ snapshot: unknown; entity_id: string }>(
      `SELECT snapshot, entity_id FROM revision WHERE entity_type = 'party' LIMIT 1`,
    );
    for (const [version, at] of [
      [90, '2026-05-01T12:00:00.000100Z'],
      [91, '2026-05-01T12:00:00.000200Z'],
    ] as const) {
      await pool.query(
        `INSERT INTO revision (entity_type, entity_id, version, change_type, valid_from, snapshot, actor)
         VALUES ('party', $1, $2, 'updated', $3, $4, 'test')`,
        [
          rows[0]!.entity_id,
          version,
          at,
          JSON.stringify({ ...(rows[0]!.snapshot as object), version }),
        ],
      );
    }

    const onePerPage = await allChanges('from=2026-05-01&to=2026-05-01&limit=1');
    expect(onePerPage.map((change) => change.version)).toEqual([90, 91]);
  });
});
