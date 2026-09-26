import { Activity } from '@rulemark/ropa-schemas';
import { eq, inArray, like } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import {
  agreement,
  agreementTerms,
  dataCategory,
  offering,
  party,
  processingActivity,
  subjectCategory,
  system,
} from '../../src/db/schema/index.js';
import { ActivitySnapshot } from '../../src/domain/snapshots.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * The activity endpoints and lifecycle (`ropa-api.md` §2, §3), over HTTP
 * against a real database. The router opens its own transaction per write, so
 * these commit: every record this file creates is prefixed `ae-` and removed
 * afterwards. Revisions stay behind, as append-only history should.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([
    { sub: 'tomas.herrera', name: 'Tomás Herrera', roles: ['editor'] },
    { sub: 'priya.raman', name: 'Priya Raman', roles: ['approver'] },
    { sub: 'root', name: 'Administrator', roles: ['admin'] },
  ]),
};

const PREFIX = 'ae-';

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
const tokens: Record<'editor' | 'approver' | 'admin', string> = {
  editor: '',
  approver: '',
  admin: '',
};

async function mint(subject: string): Promise<string> {
  const response = await request(server)
    .post('/v1/tokens')
    .send({ subject, secret: ENV.TOKEN_MINT_SECRET });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

type Who = keyof typeof tokens;

function call(who: Who, method: 'get' | 'post' | 'put' | 'delete', path: string, version?: number) {
  const pending = request(server)[method](path).set('Authorization', `Bearer ${tokens[who]}`);
  return version === undefined ? pending : pending.set('If-Match', `"${version}"`);
}

async function cleanup(): Promise<void> {
  const ours = like(processingActivity.name, `${PREFIX}%`);
  // A superseding activity RESTRICTs the one it supersedes, so unlink first.
  await db.update(processingActivity).set({ supersedesId: null }).where(ours);
  await db.delete(processingActivity).where(ours);

  const ourParties = db
    .select({ id: party.id })
    .from(party)
    .where(like(party.slug, `${PREFIX}%`));
  await db.delete(agreement).where(inArray(agreement.partyId, ourParties));
  await db.delete(system).where(like(system.slug, `${PREFIX}%`));
  await db.delete(offering).where(like(offering.slug, `${PREFIX}%`));
  await db.delete(agreementTerms).where(like(agreementTerms.slug, `${PREFIX}%`));
  await db.delete(party).where(like(party.slug, `${PREFIX}%`));
  await db.delete(subjectCategory).where(like(subjectCategory.slug, `${PREFIX}%`));
  await db.delete(dataCategory).where(like(dataCategory.slug, `${PREFIX}%`));
}

/** The records activities point at, written directly: they are not under test here. */
async function seedWorld(): Promise<void> {
  const [terms] = await db
    .insert(agreementTerms)
    .values({
      slug: `${PREFIX}standard-dpa`,
      name: 'Standard DPA',
      direction: 'outbound',
      authorizationType: 'general',
      noticeDays: 30,
    })
    .returning();
  const [ats] = await db
    .insert(offering)
    .values({ slug: `${PREFIX}ats`, name: 'Applicant tracking', defaultTermsId: terms!.id })
    .returning();
  const parties = await db
    .insert(party)
    .values([
      { slug: `${PREFIX}render`, kind: 'vendor', legalName: 'Render Inc.', country: 'US' },
      { slug: `${PREFIX}mailcrest`, kind: 'vendor', legalName: 'Mailcrest Inc.', country: 'US' },
      { slug: `${PREFIX}aurelia`, kind: 'client', legalName: 'Aurelia Health N.V.', country: 'NL' },
    ])
    .returning();
  const render = parties.find((row) => row.slug === `${PREFIX}render`)!;
  const aurelia = parties.find((row) => row.slug === `${PREFIX}aurelia`)!;
  await db.insert(agreement).values({
    partyId: aurelia.id,
    termsId: terms!.id,
    offeringId: ats!.id,
    signedAt: '2026-04-14',
  });
  await db.insert(system).values({
    slug: `${PREFIX}hireloop-app`,
    name: 'Recruiter app',
    kind: 'render_web_service',
    region: 'frankfurt',
    hostingPartyId: render.id,
  });
  await db.insert(subjectCategory).values({ slug: `${PREFIX}candidates`, name: 'Candidates' });
  await db.insert(dataCategory).values([
    { slug: `${PREFIX}identity`, name: 'Identity & contact' },
    { slug: `${PREFIX}billing`, name: 'Billing data' },
    { slug: `${PREFIX}health`, name: 'Health data', special: 'art9' },
  ]);
}

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  await cleanup();
  await seedWorld();
  tokens.editor = await mint('tomas.herrera');
  tokens.approver = await mint('priya.raman');
  tokens.admin = await mint('root');
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

const ref = (slug: string) => `${PREFIX}${slug}`;

/** A processor draft missing what activation needs. */
function incompleteProcessor(name: string) {
  return {
    role: 'processor',
    name: `${PREFIX}${name}`,
    owner: 'Priya Raman',
    subjectCategories: [ref('candidates')],
    dataCategories: [ref('identity')],
    systems: [ref('hireloop-app')],
    engagements: [
      {
        party: ref('mailcrest'),
        role: 'subprocessor',
        serviceDescription: 'Candidate notifications',
        processingCountries: ['US'],
        dataCategories: [ref('identity')],
        transfers: [{ destinationCountry: 'US', mechanism: 'dpf' }],
      },
    ],
  };
}

function completeProcessor(name: string) {
  return {
    ...incompleteProcessor(name),
    offering: ref('ats'),
    clientCoverage: 'all_enrolled',
    processingCategories: ['hosting', 'notifications'],
  };
}

function completeController(name: string, extra: Record<string, unknown> = {}) {
  return {
    role: 'controller',
    name: `${PREFIX}${name}`,
    owner: 'Priya Raman',
    purposes: ['Invoice and collect payment'],
    lawfulBases: ['6(1)(b)'],
    dataCategories: [ref('billing')],
    retentionRules: [{ retentionPeriod: 'P7Y', triggerEvent: 'after invoice date' }],
    ...extra,
  };
}

async function create(who: Who, body: Record<string, unknown>) {
  const response = await call(who, 'post', '/v1/activities').send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: string; code: string; version: number };
}

/** Straight to active, for tests that start from a live activity. */
async function activeProcessor(name: string) {
  const created = await create('editor', completeProcessor(name));
  const activated = await call('approver', 'post', `/v1/activities/${created.code}/activate`, 1);
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  return activated.body as { id: string; code: string; version: number; startedAt: string };
}

describe('drafting and approving (§3.4, the Phase 4 done-when)', () => {
  let code = '';

  it('lets an editor draft an incomplete activity, with a code and a Location', async () => {
    const response = await call('editor', 'post', '/v1/activities').send(
      incompleteProcessor('ats-draft'),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ role: 'processor', status: 'draft', version: 1 });
    expect(response.body.code).toMatch(/^P\d+$/);
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['location']).toBe(`/v1/activities/${response.body.code}`);
    code = response.body.code;
  });

  it('does not let the editor activate it, and names the permission', async () => {
    const response = await call('editor', 'post', `/v1/activities/${code}/activate`, 1);
    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('activity:approve');
  });

  it('asks the approver for the version they reviewed', async () => {
    const response = await call('approver', 'post', `/v1/activities/${code}/activate`);
    expect(response.status).toBe(428);
  });

  it('refuses to activate an incomplete activity, naming each missing field', async () => {
    const response = await call('approver', 'post', `/v1/activities/${code}/activate`, 1);
    expect(response.status).toBe(422);
    expect(
      (response.body.errors as { path: string; code: string }[]).map((error) => [
        error.path,
        error.code,
      ]),
    ).toEqual([
      ['/offering', 'required_for_role'],
      ['/clientCoverage', 'required_for_role'],
      ['/processingCategories', 'required_for_role'],
    ]);
  });

  it('refuses an approver who activates a version they did not review', async () => {
    const completed = await call('editor', 'put', `/v1/activities/${code}`, 1).send(
      completeProcessor('ats-draft'),
    );
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.headers['etag']).toBe('"2"');

    const stale = await call('approver', 'post', `/v1/activities/${code}/activate`, 1);
    expect(stale.status).toBe(412);
  });

  it('activates the version the approver reviewed, and starts it today', async () => {
    const response = await call('approver', 'post', `/v1/activities/${code}/activate`, 2).send({
      changeNote: 'Reviewed with Tomás',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'active', version: 3 });
    expect(response.body.startedAt).toBe(new Date().toISOString().slice(0, 10));
    expect(response.headers['etag']).toBe('"3"');
  });

  it('records each step as its own revision, with who and why', async () => {
    const response = await call('approver', 'get', `/v1/activities/${code}/revisions`);
    expect(response.status).toBe(200);
    expect(
      (
        response.body.data as { changeType: string; actor: string; changeNote: string | null }[]
      ).map((entry) => [entry.changeType, entry.actor, entry.changeNote]),
    ).toEqual([
      ['created', 'tomas.herrera', null],
      ['updated', 'tomas.herrera', null],
      ['activated', 'priya.raman', 'Reviewed with Tomás'],
    ]);
  });

  it('refuses to activate an activity that is already active', async () => {
    const response = await call('approver', 'post', `/v1/activities/${code}/activate`, 3);
    expect(response.status).toBe(409);
  });
});

describe('reading an activity (§3.3)', () => {
  it('returns every reference as a Ref, by code or by id', async () => {
    const created = await create('editor', completeProcessor('readable'));

    const byCode = await call('editor', 'get', `/v1/activities/${created.code}`);
    const byId = await call('editor', 'get', `/v1/activities/${created.id}`);
    expect(byCode.status).toBe(200);
    expect(byId.body).toEqual(byCode.body);
    expect(byCode.headers['etag']).toBe('"1"');
    expect(() => Activity.parse(byCode.body)).not.toThrow();

    expect(byCode.body.offering).toMatchObject({ slug: ref('ats'), name: 'Applicant tracking' });
    expect(byCode.body.engagements[0].party).toMatchObject({
      slug: ref('mailcrest'),
      name: 'Mailcrest Inc.',
    });
    expect(byCode.body.engagements[0].dataCategories[0]).toMatchObject({ slug: ref('identity') });
    expect(byCode.body.engagements[0].clientScope).toBeNull();
    expect(byCode.body.clientScope).toBeNull();
  });

  it('returns a client scope in the shape it was sent (§3.2)', async () => {
    const created = await create('editor', {
      ...completeProcessor('scoped'),
      clientScope: {
        mode: 'exclude',
        clients: [{ client: ref('aurelia'), reason: 'Client objected', startedAt: '2026-04-14' }],
      },
    });
    const response = await call('editor', 'get', `/v1/activities/${created.code}`);
    expect(response.body.clientScope).toMatchObject({
      mode: 'exclude',
      clients: [{ client: { slug: ref('aurelia') }, reason: 'Client objected', agreement: null }],
    });
  });

  it('shows a controller its own fields and nothing of a processor’s', async () => {
    const created = await create('editor', completeController('billing'));
    const response = await call('editor', 'get', `/v1/activities/${created.code}`);
    expect(response.body).toMatchObject({ role: 'controller', dpiaRequired: false });
    expect(response.body.retentionRules[0]).toMatchObject({
      retentionPeriod: 'P7Y',
      dataCategory: null,
    });
    expect(response.body).not.toHaveProperty('offering');
    expect(response.body).not.toHaveProperty('processingCategories');
  });
});

describe('editing an active activity (§1.5)', () => {
  it('holds every save of an active activity to the role rules', async () => {
    const active = await activeProcessor('live');
    const response = await call(
      'editor',
      'put',
      `/v1/activities/${active.code}`,
      active.version,
    ).send({ ...completeProcessor('live'), processingCategories: [] });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ path: '/processingCategories', code: 'required_for_role' }),
    ]);
  });

  it('keeps the start date when a save leaves it out', async () => {
    const active = await activeProcessor('keeps-start');
    const response = await call(
      'editor',
      'put',
      `/v1/activities/${active.code}`,
      active.version,
    ).send({ ...completeProcessor('keeps-start'), description: 'Now with a description' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.startedAt).toBe(active.startedAt);
    expect(response.body.status).toBe('active');
  });

  it('asks a controller for Art. 9 conditions once it processes a special category', async () => {
    const created = await create(
      'editor',
      completeController('health', { dataCategories: [ref('billing'), ref('health')] }),
    );
    const refused = await call('approver', 'post', `/v1/activities/${created.code}/activate`, 1);
    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([
      expect.objectContaining({ path: '/specialConditions', code: 'required_for_role' }),
    ]);

    const fixed = await call('editor', 'put', `/v1/activities/${created.code}`, 1).send(
      completeController('health', {
        dataCategories: [ref('billing'), ref('health')],
        specialConditions: ['9(2)(b)'],
      }),
    );
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    const activated = await call('approver', 'post', `/v1/activities/${created.code}/activate`, 2);
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  });
});

describe('retiring (§3.4)', () => {
  it('is an approver’s action, needs If-Match, and records the end date', async () => {
    const active = await activeProcessor('retiring');
    const path = `/v1/activities/${active.code}/retire`;

    expect((await call('editor', 'post', path, active.version).send({})).status).toBe(403);
    expect((await call('approver', 'post', path).send({})).status).toBe(428);

    const response = await call('approver', 'post', path, active.version).send({
      endedAt: '2026-09-30',
      changeNote: 'Module discontinued',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'retired', endedAt: '2026-09-30' });
  });

  it('freezes a retired activity: no edits, no reactivation', async () => {
    const active = await activeProcessor('frozen');
    const retired = await call(
      'approver',
      'post',
      `/v1/activities/${active.code}/retire`,
      active.version,
    ).send({});
    expect(retired.status).toBe(200);
    const version = retired.body.version as number;

    expect(
      (
        await call('editor', 'put', `/v1/activities/${active.code}`, version).send(
          completeProcessor('frozen'),
        )
      ).status,
    ).toBe(409);
    expect(
      (await call('approver', 'post', `/v1/activities/${active.code}/activate`, version)).status,
    ).toBe(409);
  });

  it('only retires a live activity: a draft is deleted instead', async () => {
    const draft = await create('editor', incompleteProcessor('never-live'));
    const response = await call('approver', 'post', `/v1/activities/${draft.code}/retire`, 1).send(
      {},
    );
    expect(response.status).toBe(409);
  });

  it('refuses an end date before the start date', async () => {
    const active = await activeProcessor('backwards');
    const response = await call(
      'approver',
      'post',
      `/v1/activities/${active.code}/retire`,
      active.version,
    ).send({
      endedAt: '2000-01-01',
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([expect.objectContaining({ path: '/endedAt' })]);
  });

  it('lets a new activity supersede the retired one, after a role change (DM §3.0)', async () => {
    const active = await activeProcessor('role-change');
    await call('approver', 'post', `/v1/activities/${active.code}/retire`, active.version).send({});
    const successor = await create(
      'editor',
      completeController('role-change-c', { supersedes: active.code }),
    );
    const response = await call('editor', 'get', `/v1/activities/${successor.code}`);
    expect(response.body.supersedes).toMatchObject({ code: active.code });
  });
});

describe('deleting (§3.4)', () => {
  it('deletes a draft, and its last revision still shows the whole aggregate', async () => {
    const draft = await create('editor', incompleteProcessor('short-lived'));
    const response = await call('admin', 'delete', `/v1/activities/${draft.code}`, 1);
    expect(response.status).toBe(204);

    const revisions = await call('admin', 'get', `/v1/activities/${draft.id}/revisions`);
    // The record is gone, so its history is reached through the revision table.
    expect(revisions.status).toBe(404);
    const { rows } = await pool.query<{ change_type: string; snapshot: unknown }>(
      `SELECT change_type, snapshot FROM revision WHERE entity_id = $1 ORDER BY version`,
      [draft.id],
    );
    expect(rows.map((row) => row.change_type)).toEqual(['created', 'deleted']);
    const last = ActivitySnapshot.parse(rows[1]!.snapshot);
    expect(last.version).toBe(2);
    expect(last.engagements).toHaveLength(1);
  });

  it('refuses to delete an activity that has been live: retire it instead', async () => {
    const active = await activeProcessor('keep-me');
    const response = await call('admin', 'delete', `/v1/activities/${active.code}`, active.version);
    expect(response.status).toBe(409);
    expect(
      await db.select().from(processingActivity).where(eq(processingActivity.id, active.id)),
    ).toHaveLength(1);
  });
});

describe('validation over HTTP', () => {
  it('rejects joint_controller as not yet supported (§1.5)', async () => {
    const response = await call('editor', 'post', '/v1/activities').send({
      role: 'joint_controller',
      name: `${PREFIX}joint`,
      owner: 'Priya Raman',
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ path: '/role', code: 'not_yet_supported' }),
    ]);
  });

  it('reports forbidden and structural errors together, with their codes (§1.7)', async () => {
    const response = await call('editor', 'post', '/v1/activities').send({
      ...incompleteProcessor('both'),
      name: '',
      purposes: ['Recruitment'],
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/name' }),
        expect.objectContaining({ path: '/purposes', code: 'forbidden_for_role' }),
      ]),
    );
  });

  it('answers a client listed twice with a field error, not a database conflict', async () => {
    const entry = { client: ref('aurelia'), reason: 'Client objected', startedAt: '2026-04-14' };
    const response = await call('editor', 'post', '/v1/activities').send({
      ...completeProcessor('twice'),
      clientScope: { mode: 'exclude', clients: [entry, entry] },
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ path: '/clientScope/clients/1/client', code: 'duplicate' }),
    ]);
  });

  it('answers two default retention rules the same way', async () => {
    const rule = { retentionPeriod: 'P1Y', triggerEvent: 'after contract end' };
    const response = await call('editor', 'post', '/v1/activities').send(
      completeController('two-defaults', { retentionRules: [rule, rule] }),
    );
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ path: '/retentionRules/1/dataCategory', code: 'duplicate' }),
    ]);
  });
});

describe('filters (§2)', () => {
  const names = (response: request.Response) =>
    (response.body.data as { name: string }[]).map((activity) => activity.name);

  beforeAll(async () => {
    await create('editor', completeProcessor('filter-processor'));
    await create('editor', completeController('filter-controller'));
    await create(
      'editor',
      completeController('filter-special', {
        dataCategories: [ref('health')],
        specialConditions: ['9(2)(b)'],
      }),
    );
  });

  const list = (query: string) => call('editor', 'get', `/v1/activities?limit=200&${query}`);

  it.each([
    ['role=processor', 'filter-processor', 'filter-controller'],
    ['role=controller', 'filter-controller', 'filter-processor'],
    ['status=draft', 'filter-processor', 'live'],
    [`offering=${ref('ats')}`, 'filter-processor', 'filter-controller'],
    [`party=${ref('mailcrest')}`, 'filter-processor', 'filter-controller'],
    [`system=${ref('hireloop-app')}`, 'filter-processor', 'filter-controller'],
    [`subjectCategory=${ref('candidates')}`, 'filter-processor', 'filter-controller'],
    [`dataCategory=${ref('billing')}`, 'filter-controller', 'filter-processor'],
    ['country=US', 'filter-processor', 'filter-controller'],
    ['special=true', 'filter-special', 'filter-controller'],
  ])('?%s finds %s and not %s', async (query, found, notFound) => {
    const response = await list(query);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(names(response)).toContain(`${PREFIX}${found}`);
    expect(names(response)).not.toContain(`${PREFIX}${notFound}`);
  });

  it('accepts a reference filter by id as well as slug', async () => {
    const [ats] = await db
      .select()
      .from(offering)
      .where(eq(offering.slug, ref('ats')));
    expect(names(await list(`offering=${ats!.id}`))).toContain(`${PREFIX}filter-processor`);
  });

  it('reports an unknown reference or a malformed value as a field error', async () => {
    expect((await list('party=nobody')).status).toBe(422);
    expect((await list('country=usa')).status).toBe(422);
    expect((await list('special=maybe')).status).toBe(422);
  });
});
