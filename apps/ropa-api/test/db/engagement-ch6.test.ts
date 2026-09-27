import { Activity } from '@rulemark/ropa-schemas';
import { sql } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { resetDatabase, storyTimeline } from '../../src/demo/replay-story.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';
import { listenOnLoopback } from '../listen.js';

/**
 * Chapter 6 through the engagement sub-resource (`ropa-api.md` §3.5, the
 * Phase 3 done-when): Mailcrest's onward transfer to India, added to P1's US
 * engagement on its own, writes the same revision and the same events as the
 * whole-activity `PUT` making the same change. The story is replayed without
 * P1's own Chapter 6 edit, so P1 stands where Priya found it.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([{ sub: 'priya.raman', name: 'Priya Raman', roles: ['editor'] }]),
};

const CH6 = 'Mailcrest added Helpdesk Partners (India) in every region (Ch6)';
const INDIA = {
  destinationCountry: 'IN',
  mechanism: 'sccs',
  onwardVia: 'Helpdesk Partners Pvt Ltd',
  documentRef: 'Mailcrest DPA',
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
let token = '';

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = await listenOnLoopback(
    createApp({ config: loadConfig(ENV), router: recordsRouter(db) }),
  );
  await resetDatabase(db);
  for (const step of storyTimeline().filter((step) => step.label !== `P1 ${CH6}`)) {
    await db.transaction((tx) => step.run(tx));
  }
  const minted = await request(server)
    .post('/v1/tokens')
    .send({ subject: 'priya.raman', secret: ENV.TOKEN_MINT_SECRET });
  token = minted.body.token as string;
});

afterAll(async () => {
  await resetDatabase(db);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

const authorized = (pending: request.Test, etag: string) =>
  pending.set('Authorization', `Bearer ${token}`).set('If-Match', etag);

async function p1() {
  const response = await request(server).get('/v1/activities/P1');
  expect(response.status).toBe(200);
  const body = Activity.parse(response.body);
  const us = body.engagements.find(
    (engagement) => engagement.serviceDescription === 'Candidate notifications (US region)',
  )!;
  return { body, etag: response.headers['etag'] as string, us };
}

/** The US engagement as a body, the way a caller holding its JSON would send it. */
function engagementBody(engagement: Activity['engagements'][number], transfers: object[]) {
  const scope = 'clientScope' in engagement ? engagement.clientScope : null;
  return {
    party: engagement.party.id,
    role: engagement.role,
    serviceDescription: engagement.serviceDescription,
    processingCountries: engagement.processingCountries,
    dataCategories: engagement.dataCategories.map((category) => category.id),
    transfers,
    clientScope:
      scope === null
        ? null
        : {
            mode: scope.mode,
            clients: scope.clients.map((entry) => ({
              id: entry.id,
              client: entry.client.id,
              reason: entry.reason,
              ...(entry.agreement === null ? {} : { agreement: entry.agreement.id }),
            })),
          },
  };
}

const keptTransfers = (engagement: Activity['engagements'][number]) =>
  engagement.transfers.map(({ id, destinationCountry, mechanism, onwardVia, documentRef }) => ({
    id,
    destinationCountry,
    mechanism,
    ...(onwardVia === null ? {} : { onwardVia }),
    ...(documentRef === null ? {} : { documentRef }),
  }));

/** The newest revision of P1, and every event it caused. */
async function lastSave(activityId: string) {
  const { rows: revisions } = await db.execute<{
    id: string;
    version: number;
    change_type: string;
    actor: string;
    change_note: string | null;
    snapshot: Record<string, unknown>;
  }>(
    sql`SELECT id, version, change_type, actor, change_note, snapshot FROM revision
        WHERE entity_type = 'activity' AND entity_id = ${activityId}
        ORDER BY version DESC LIMIT 1`,
  );
  const revision = revisions[0]!;
  const { rows: events } = await db.execute<{
    event_type: string;
    destination: string;
    payload: Record<string, unknown>;
  }>(
    sql`SELECT event_type, destination, payload FROM event_outbox
        WHERE revision_id = ${revision.id} ORDER BY created_at, id`,
  );
  return { revision, events };
}

/**
 * What two saves making the same change must share: everything but the new
 * transfer's id, the version, and when it happened.
 */
function comparable(save: Awaited<ReturnType<typeof lastSave>>, indiaId: string) {
  const text = JSON.stringify({
    changeType: save.revision.change_type,
    actor: save.revision.actor,
    changeNote: save.revision.change_note,
    snapshot: save.revision.snapshot,
    events: save.events.map((event) => ({
      type: event.event_type,
      destination: event.destination,
      data: event.payload['data'],
    })),
  }).replaceAll(indiaId, '<the India transfer>');
  return JSON.parse(text, (key, value: unknown) =>
    ['version', 'validFrom', 'updatedAt', 'createdAt', 'effectiveFrom'].includes(key)
      ? '<varies>'
      : value,
  ) as unknown;
}

describe('Chapter 6 through the sub-resource', () => {
  it('writes the same revision and events as the whole-activity PUT', async () => {
    // P1 as Priya found it: Mailcrest's US region, DPF to the US and no more.
    const start = await p1();
    expect(start.us.transfers.map((transfer) => transfer.destinationCountry)).toEqual(['US']);

    // The sub-resource: the one engagement, with India added.
    const viaEngagement = await authorized(
      request(server).put(`/v1/activities/P1/engagements/${start.us.id}`),
      start.etag,
    ).send({ ...engagementBody(start.us, [...keptTransfers(start.us), INDIA]), changeNote: CH6 });
    expect(viaEngagement.status, JSON.stringify(viaEngagement.body)).toBe(200);
    expect(viaEngagement.headers['etag']).toBe(`"${start.body.version + 1}"`);
    const afterEngagement = await p1();
    const indiaByEngagement = afterEngagement.us.transfers.find(
      (transfer) => transfer.destinationCountry === 'IN',
    )!;
    const byEngagement = await lastSave(start.body.id);
    expect(byEngagement.revision.version).toBe(start.body.version + 1);

    // Back to where it stood, through the whole activity…
    const undo = await authorized(
      request(server).put('/v1/activities/P1'),
      afterEngagement.etag,
    ).send(wholeBody(afterEngagement.body, afterEngagement.us.id, keptTransfers(start.us)));
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);

    // …and the same change through the whole activity.
    const beforeWhole = await p1();
    const whole = await authorized(request(server).put('/v1/activities/P1'), beforeWhole.etag).send(
      {
        ...wholeBody(beforeWhole.body, beforeWhole.us.id, [...keptTransfers(start.us), INDIA]),
        changeNote: CH6,
      },
    );
    expect(whole.status, JSON.stringify(whole.body)).toBe(200);
    const indiaByWhole = (await p1()).us.transfers.find(
      (transfer) => transfer.destinationCountry === 'IN',
    )!;
    const byWhole = await lastSave(start.body.id);

    expect(byEngagement.events.map((event) => event.event_type)).toEqual([
      'record.changed',
      'subprocessors.changed',
      'subprocessors.changed',
      'subprocessors.changed',
    ]);
    expect(comparable(byEngagement, indiaByEngagement.id)).toEqual(
      comparable(byWhole, indiaByWhole.id),
    );
  });
});

/** The whole activity as a `PUT` body, with the US engagement's transfers set. */
function wholeBody(activity: Activity, usId: string, usTransfers: object[]) {
  if (activity.role !== 'processor') throw new Error('P1 is a processor activity');
  const ids = (refs: readonly { id: string }[]) => refs.map((ref) => ref.id);
  return {
    role: activity.role,
    name: activity.name,
    owner: activity.owner,
    offering: activity.offering!.id,
    clientCoverage: activity.clientCoverage!,
    processingCategories: activity.processingCategories,
    subjectCategories: ids(activity.subjectCategories),
    dataCategories: ids(activity.dataCategories),
    systems: ids(activity.systems),
    securityMeasures: ids(activity.securityMeasures),
    ...(activity.startedAt === null ? {} : { startedAt: activity.startedAt }),
    engagements: activity.engagements.map((engagement) => ({
      id: engagement.id,
      ...engagementBody(
        engagement,
        engagement.id === usId ? usTransfers : keptTransfers(engagement),
      ),
    })),
  };
}
