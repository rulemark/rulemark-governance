import { Activity, Engagement } from '@rulemark/ropa-schemas';
import { sql } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { replayStory, resetDatabase } from '../../src/demo/replay-story.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';
import { listenOnLoopback } from '../listen.js';

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
    { sub: 'priya.raman', name: 'Priya Raman', roles: ['editor'] },
    { sub: 'jonas', name: 'Jonas', roles: ['viewer'] },
    { sub: 'svc:monitor', name: 'Subprocessor Monitor', roles: ['service:monitor'] },
  ]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
const tokens = { priya: '', jonas: '', monitor: '' };

async function mint(subject: string): Promise<string> {
  const response = await request(server)
    .post('/v1/tokens')
    .send({ subject, secret: ENV.TOKEN_MINT_SECRET });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = await listenOnLoopback(
    createApp({ config: loadConfig(ENV), router: recordsRouter(db) }),
  );
  await resetDatabase(db);
  await replayStory(db);
  tokens.priya = await mint('priya.raman');
  tokens.jonas = await mint('jonas');
  tokens.monitor = await mint('svc:monitor');
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
    const monitor = tokens.monitor;
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

// --- writing (Phase 3) -------------------------------------------------------

type Method = 'post' | 'put' | 'delete';

/** Synchronous, so the request is sent once, by whoever awaits it. */
function write(method: Method, path: string, etag: string | null, body?: object) {
  let pending = request(server)[method](path).set('Authorization', `Bearer ${tokens.priya}`);
  if (etag !== null) pending = pending.set('If-Match', etag);
  return body === undefined ? pending : pending.send(body);
}

/** P1's revisions, newest first. */
async function latestRevision(activityId: string) {
  const { rows } = await db.execute<{
    id: string;
    version: number;
    change_type: string;
    actor: string;
    change_note: string | null;
  }>(
    sql`SELECT id, version, change_type, actor, change_note FROM revision
        WHERE entity_type = 'activity' AND entity_id = ${activityId}
        ORDER BY version DESC LIMIT 1`,
  );
  return rows[0]!;
}

/** The events a revision caused: one line each, type and list. */
async function eventsOf(revisionId: string): Promise<string[]> {
  const { rows } = await db.execute<{
    event_type: string;
    destination: string;
    payload: { data: { client?: { slug?: string } | null } };
  }>(
    sql`SELECT event_type, destination, payload FROM event_outbox
        WHERE revision_id = ${revisionId} ORDER BY created_at, id`,
  );
  return rows.map((row) =>
    row.event_type === 'subprocessors.changed'
      ? `${row.event_type} → ${row.destination}: ${row.payload.data.client?.slug ?? 'offering'}`
      : `${row.event_type} → ${row.destination}`,
  );
}

const BACKUPS = {
  party: 'peoplehub',
  role: 'subprocessor',
  serviceDescription: 'Backups',
  processingCountries: ['DE'],
  dataCategories: ['identity'],
};

const errorsOf = (body: { errors?: { path: string; code: string }[] }) =>
  (body.errors ?? []).map((error) => [error.path, error.code]);

describe('POST /activities/{ref}/engagements', () => {
  let added: Engagement;

  it('adds an engagement: one activity revision, its events, answered with the engagement', async () => {
    const before = await activity('P1');
    const response = await write('post', '/v1/activities/P1/engagements', before.etag, {
      ...BACKUPS,
      changeNote: 'Nightly backups to Peoplehub',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    added = Engagement.parse(response.body);
    expect(added).toMatchObject({
      party: { slug: 'peoplehub' },
      serviceDescription: 'Backups',
      transfers: [],
      clientScope: null,
    });
    expect(response.headers['location']).toBe(`/v1/activities/P1/engagements/${added.id}`);
    expect(response.headers['etag']).toBe(`"${before.body.version + 1}"`);

    const after = await activity('P1');
    expect(after.etag).toBe(response.headers['etag']);
    expect(after.body.engagements).toEqual([...before.body.engagements, added]);

    const revision = await latestRevision(before.body.id);
    expect(revision).toMatchObject({
      version: before.body.version + 1,
      change_type: 'updated',
      actor: 'priya.raman',
      change_note: 'Nightly backups to Peoplehub',
    });
    expect(await eventsOf(revision.id)).toEqual(
      expect.arrayContaining([
        'record.changed → audit-log',
        'subprocessors.changed → monitor: offering',
        'subprocessors.changed → monitor: northwind',
      ]),
    );
  });

  it('needs If-Match, and refuses a stale one', async () => {
    const missing = await write('post', '/v1/activities/P1/engagements', null, BACKUPS);
    expect(missing.status).toBe(428);
    const stale = await write('post', '/v1/activities/P1/engagements', '"1"', BACKUPS);
    expect(stale.status, JSON.stringify(stale.body)).toBe(412);
    // Stale first: a caller holding an old version hears so before anything
    // about a state of the activity it never saw.
    const staleAndWrong = await write('post', '/v1/activities/P1/engagements', '"1"', {
      ...BACKUPS,
      role: 'recipient',
    });
    expect(staleAndWrong.status).toBe(412);
  });

  it('refuses an id: a new engagement gets its id from the server', async () => {
    const { etag } = await activity('P1');
    const response = await write('post', '/v1/activities/P1/engagements', etag, {
      ...BACKUPS,
      id: added.id,
    });
    expect(response.status).toBe(422);
    expect(errorsOf(response.body)).toEqual([['/id', 'not_allowed']]);
  });

  it('checks the shape the activity’s role allows, reporting at the body’s own paths', async () => {
    const { etag } = await activity('P1');
    const response = await write('post', '/v1/activities/P1/engagements', etag, {
      ...BACKUPS,
      role: 'recipient',
    });
    expect(response.status).toBe(422);
    expect(errorsOf(response.body)).toEqual([['/role', 'role_not_allowed']]);
  });

  it('applies the cross-entity rules, reporting at the body’s own paths', async () => {
    const { etag } = await activity('P1');
    const response = await write('post', '/v1/activities/P1/engagements', etag, {
      ...BACKUPS,
      party: 'aurelia',
      dataCategories: ['billing'],
    });
    expect(response.status).toBe(422);
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        ['/party', 'wrong_party_kind'],
        ['/dataCategories/0', 'not_in_activity'],
      ]),
    );
  });

  it('refuses a body that is not an engagement at all', async () => {
    const { etag } = await activity('P1');
    const response = await write('post', '/v1/activities/P1/engagements', etag, [BACKUPS]);
    expect(response.status).toBe(422);
    expect(errorsOf(response.body)).toEqual([['', 'invalid_type']]);
  });

  it('needs record:write: a viewer may read engagements, not change them', async () => {
    const p1 = await activity('P1');
    const id = p1.body.engagements[0]!.id;
    for (const [method, path] of [
      ['post', '/v1/activities/P1/engagements'],
      ['put', `/v1/activities/P1/engagements/${id}`],
      ['delete', `/v1/activities/P1/engagements/${id}`],
    ] as const) {
      const response = await request(server)
        [method](path)
        .set('Authorization', `Bearer ${tokens.jonas}`)
        .set('If-Match', p1.etag)
        .send(BACKUPS);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    expect((await activity('P1')).etag).toBe(p1.etag);
  });

  it('answers 404 for an activity that does not exist', async () => {
    const response = await write('post', '/v1/activities/P99/engagements', '"1"', BACKUPS);
    expect(response.status).toBe(404);
    expect(response.body.detail).toBe('No activity matching "P99"');
  });
});

describe('PUT /activities/{ref}/engagements/{id}', () => {
  const backups = async () => {
    const p1 = await activity('P1');
    const row = p1.body.engagements.find((engagement) => engagement.party.slug === 'peoplehub')!;
    return { ...p1, row };
  };

  it('replaces one engagement, keeping its id, and leaves the others as they were', async () => {
    const before = await backups();
    const response = await write(
      'put',
      `/v1/activities/P1/engagements/${before.row.id}`,
      before.etag,
      { ...BACKUPS, serviceDescription: 'Backups (EU)', processingCountries: ['DE', 'AT'] },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      id: before.row.id,
      serviceDescription: 'Backups (EU)',
      processingCountries: ['DE', 'AT'],
    });
    expect(response.headers['etag']).toBe(`"${before.body.version + 1}"`);

    const after = await activity('P1');
    expect(after.body.engagements).toEqual(
      before.body.engagements.map((engagement) =>
        engagement.id === before.row.id ? response.body : engagement,
      ),
    );
  });

  it('accepts the engagement’s own id in the body, and refuses another', async () => {
    const { row, etag } = await backups();
    const other = (await activity('P1')).body.engagements[0]!.id;
    const response = await write('put', `/v1/activities/P1/engagements/${row.id}`, etag, {
      ...BACKUPS,
      id: other,
    });
    expect(response.status).toBe(422);
    expect(errorsOf(response.body)).toEqual([['/id', 'id_mismatch']]);

    const same = await write('put', `/v1/activities/P1/engagements/${row.id}`, etag, {
      ...BACKUPS,
      id: row.id,
    });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
  });

  it('answers 404 for an engagement another activity holds', async () => {
    const scribe = (await activity('P3')).body.engagements[0]!;
    const { etag } = await activity('P1');
    const response = await write(
      'put',
      `/v1/activities/P1/engagements/${scribe.id}`,
      etag,
      BACKUPS,
    );
    expect(response.status).toBe(404);
    expect(response.body.detail).toBe(`Activity P1 holds no engagement ${scribe.id}`);
  });

  it('refuses a stale If-Match with 412', async () => {
    const { row } = await backups();
    const response = await write('put', `/v1/activities/P1/engagements/${row.id}`, '"1"', BACKUPS);
    expect(response.status).toBe(412);
  });

  it('reports what is wrong elsewhere in the activity under /activity', async () => {
    // Aurelia's DPA ends: P1's Aurelia scopes on its Mailcrest and Glitchlog
    // engagements no longer hold, so no save of P1 can pass until they change.
    await db.execute(
      sql`UPDATE agreement SET ended_at = '2026-06-01'
          WHERE party_id = (SELECT id FROM party WHERE slug = 'aurelia')`,
    );
    try {
      const { row, etag } = await backups();
      const response = await write('put', `/v1/activities/P1/engagements/${row.id}`, etag, BACKUPS);
      expect(response.status).toBe(422);
      const paths = errorsOf(response.body);
      expect(paths.length).toBeGreaterThan(0);
      for (const [path, code] of paths) {
        expect(path).toMatch(/^\/activity\/engagements\/\d+\/clientScope\/clients\/0\/client$/);
        expect(code).toBe('no_active_agreement');
      }
    } finally {
      await db.execute(
        sql`UPDATE agreement SET ended_at = NULL
            WHERE party_id = (SELECT id FROM party WHERE slug = 'aurelia')`,
      );
    }
  });
});

describe('DELETE /activities/{ref}/engagements/{id}', () => {
  it('removes one engagement, with a change note in an optional body', async () => {
    const before = await activity('P1');
    const row = before.body.engagements.find(
      (engagement) => engagement.party.slug === 'peoplehub',
    )!;
    const response = await write('delete', `/v1/activities/P1/engagements/${row.id}`, before.etag, {
      changeNote: 'Backups back in-house',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(response.headers['etag']).toBe(`"${before.body.version + 1}"`);

    const after = await activity('P1');
    expect(after.body.engagements).toEqual(
      before.body.engagements.filter((engagement) => engagement.id !== row.id),
    );
    expect(await latestRevision(before.body.id)).toMatchObject({
      change_note: 'Backups back in-house',
    });
    const gone = await request(server).get(`/v1/activities/P1/engagements/${row.id}`);
    expect(gone.status).toBe(404);
  });

  it('needs no body at all', async () => {
    const { etag } = await activity('P1');
    const added = await write('post', '/v1/activities/P1/engagements', etag, BACKUPS);
    expect(added.status, JSON.stringify(added.body)).toBe(201);

    const response = await write(
      'delete',
      `/v1/activities/P1/engagements/${added.body.id}`,
      added.headers['etag'] as string,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    const revision = await latestRevision((await activity('P1')).body.id);
    expect(revision.change_note).toBeNull();
  });

  it('refuses a body that is not a change note', async () => {
    const p1 = await activity('P1');
    const response = await write(
      'delete',
      `/v1/activities/P1/engagements/${p1.body.engagements[0]!.id}`,
      p1.etag,
      { changeNote: '' },
    );
    expect(response.status).toBe(422);
    expect(errorsOf(response.body).map(([path]) => path)).toEqual(['/changeNote']);
  });

  it('answers 404 for an engagement the activity does not hold', async () => {
    const { etag } = await activity('P1');
    const response = await write(
      'delete',
      '/v1/activities/P1/engagements/0199c3a1-8f2e-7c4d-b8e1-000000000000',
      etag,
    );
    expect(response.status).toBe(404);
    expect(response.body.detail).toBe(
      'Activity P1 holds no engagement 0199c3a1-8f2e-7c4d-b8e1-000000000000',
    );
  });
});
