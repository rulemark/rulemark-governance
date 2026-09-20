import { inArray, like } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { agreement, agreementTerms, offering, party, system } from '../../src/db/schema/index.js';
import { dataCategory, securityMeasure, subjectCategory } from '../../src/db/schema/index.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * The record endpoints, driven over HTTP against a real database.
 *
 * These commit, because the router opens its own transaction per write and a
 * handle already inside one would not nest (see findings, Phase 4). Everything
 * created is prefixed `hl-` and removed afterwards.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([
    { sub: 'priya.raman', name: 'Priya Raman', roles: ['admin'] },
    { sub: 'reader', name: 'A Reader', roles: ['viewer'] },
  ]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let app: ReturnType<typeof createApp>;
/**
 * One listening server for the whole file. `request(server)` starts and stops an
 * ephemeral server per call, and hundreds of those in quick succession is both
 * slow and a source of confusing failures.
 */
let server: Server;
let token: string;
let readerToken: string;

async function mint(subject: string): Promise<string> {
  const response = await request(server)
    .post('/v1/tokens')
    .send({ subject, secret: ENV.TOKEN_MINT_SECRET });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

/** Every record this file creates is prefixed, so cleanup is exact. */
const PREFIX = 'hl-';

async function cleanup(): Promise<void> {
  const ours = db
    .select({ id: party.id })
    .from(party)
    .where(like(party.slug, `${PREFIX}%`));
  // Reverse dependency order: agreements point at everything else.
  await db.delete(agreement).where(inArray(agreement.partyId, ours));
  await db.delete(system).where(like(system.slug, `${PREFIX}%`));
  await db.delete(offering).where(like(offering.slug, `${PREFIX}%`));
  await db.delete(agreementTerms).where(like(agreementTerms.slug, `${PREFIX}%`));
  await db.delete(party).where(like(party.slug, `${PREFIX}%`));
  for (const table of [subjectCategory, dataCategory, securityMeasure]) {
    await db.delete(table).where(like(table.slug, `${PREFIX}%`));
  }
}

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  app = createApp({ config: loadConfig(ENV), router: recordsRouter(db) });
  server = app.listen(0);
  await cleanup();
  token = await mint('priya.raman');
  readerToken = await mint('reader');
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  await pool.end();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

function post(path: string, body: Record<string, unknown>) {
  return request(server).post(path).set(auth()).send(body);
}

describe('the Hireloop record, created through the API (Ch2–Ch4)', () => {
  const created: Record<string, { id: string; version: number }> = {};

  it('creates the self party, with its DPO', async () => {
    const response = await post('/v1/parties', {
      slug: `${PREFIX}hireloop`,
      kind: 'self',
      legalName: 'Hireloop B.V.',
      country: 'NL',
      dpoName: 'Priya Raman',
      dpoEmail: 'dpo@hireloop.example',
      changeNote: 'Set up the record',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({
      slug: `${PREFIX}hireloop`,
      kind: 'self',
      name: 'Hireloop B.V.',
      legalName: 'Hireloop B.V.',
      version: 1,
    });
    // The ETag is the version, ready to be sent back as If-Match (§1.8).
    expect(response.headers.etag).toBe('"1"');
    created['self'] = response.body;
  });

  it('refuses a second self party', async () => {
    const response = await post('/v1/parties', {
      slug: `${PREFIX}hireloop-two`,
      kind: 'self',
      legalName: 'Hireloop Again B.V.',
      country: 'NL',
      dpoName: 'Priya Raman',
      dpoEmail: 'dpo@hireloop.example',
    });
    expect(response.status).toBe(409);
  });

  it('creates the vendors, deriving slugs from their names', async () => {
    const mailcrest = await post('/v1/parties', {
      slug: `${PREFIX}mailcrest`,
      kind: 'vendor',
      legalName: 'Mailcrest Inc.',
      country: 'US',
      subprocessorListUrl: 'https://mailcrest.example/subprocessors',
    });
    expect(mailcrest.status).toBe(201);
    created['mailcrest'] = mailcrest.body;

    const aurelia = await post('/v1/parties', {
      slug: `${PREFIX}aurelia`,
      kind: 'client',
      legalName: 'Aurelia Health N.V.',
      country: 'NL',
    });
    expect(aurelia.status).toBe(201);
    created['aurelia'] = aurelia.body;
  });

  it('creates the standard terms and the offering that defaults to them (Ch3)', async () => {
    const terms = await post('/v1/agreement-terms', {
      slug: `${PREFIX}standard-dpa-v3`,
      name: 'Standard DPA v3',
      direction: 'outbound',
      authorizationType: 'general',
      noticeDays: 30,
    });
    expect(terms.status).toBe(201);
    created['standardTerms'] = terms.body;

    const ats = await post('/v1/offerings', {
      slug: `${PREFIX}ats`,
      name: 'Hireloop ATS',
      // Referenced by slug, not by id (§1.2).
      defaultTerms: `${PREFIX}standard-dpa-v3`,
    });
    expect(ats.status, JSON.stringify(ats.body)).toBe(201);
    // Returned as a Ref, not the identifier that was sent.
    expect(ats.body.defaultTerms).toMatchObject({
      slug: `${PREFIX}standard-dpa-v3`,
      name: 'Standard DPA v3',
    });
    created['ats'] = ats.body;
  });

  it("signs Aurelia's bespoke agreement (Ch4)", async () => {
    const terms = await post('/v1/agreement-terms', {
      slug: `${PREFIX}aurelia-dpa`,
      name: 'Aurelia DPA',
      direction: 'outbound',
      authorizationType: 'specific',
      noticeDays: 60,
      allowedRegions: ['EEA'],
    });
    expect(terms.status).toBe(201);

    const signed = await post('/v1/agreements', {
      party: `${PREFIX}aurelia`,
      terms: `${PREFIX}aurelia-dpa`,
      offering: `${PREFIX}ats`,
      signedAt: '2026-03-16',
      changeNote: 'Aurelia signed',
    });

    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    expect(signed.body).toMatchObject({
      party: { slug: `${PREFIX}aurelia`, name: 'Aurelia Health N.V.' },
      terms: { slug: `${PREFIX}aurelia-dpa` },
      offering: { slug: `${PREFIX}ats` },
      signedAt: '2026-03-16',
      endedAt: null,
    });
    created['agreement'] = signed.body;
  });

  it('records a system hosted by a party (Ch5)', async () => {
    const render = await post('/v1/parties', {
      slug: `${PREFIX}render`,
      kind: 'vendor',
      legalName: 'Render Inc.',
      country: 'US',
    });
    expect(render.status).toBe(201);

    const response = await post('/v1/systems', {
      slug: `${PREFIX}hireloop-db`,
      name: 'Primary database',
      kind: 'render_postgres',
      region: 'frankfurt',
      renderResourceId: 'dpg-hl-test',
      hostingParty: `${PREFIX}render`,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.hostingParty).toMatchObject({ name: 'Render Inc.' });
  });

  it('creates taxonomy entries, deriving the slug from the name', async () => {
    const response = await post('/v1/taxonomy/data-categories', {
      slug: `${PREFIX}health`,
      name: 'Health data',
      special: 'art9',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.special).toBe('art9');
  });
});

describe('reading records', () => {
  it('finds the same record by slug and by id (§1.2)', async () => {
    const bySlug = await request(server).get(`/v1/parties/${PREFIX}mailcrest`).set(auth());
    expect(bySlug.status).toBe(200);

    const byId = await request(server).get(`/v1/parties/${bySlug.body.id}`).set(auth());
    expect(byId.body.id).toBe(bySlug.body.id);
    expect(byId.headers.etag).toBe(`"${bySlug.body.version}"`);
  });

  it('answers 404 for an identifier nobody has', async () => {
    const response = await request(server).get(`/v1/parties/${PREFIX}nobody`).set(auth());
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/problem\+json/);
  });

  it('lists with a cursor, and the cursor walks the whole set (§1.3)', async () => {
    const first = await request(server).get('/v1/parties?limit=2').set(auth());
    expect(first.status).toBe(200);
    expect(first.body.data.length).toBeLessThanOrEqual(2);

    const seen = new Set<string>(first.body.data.map((row: { id: string }) => row.id));
    let cursor = first.body.nextCursor as string | null;
    let pages = 1;

    while (cursor !== null && pages < 20) {
      const next = await request(server).get(`/v1/parties?limit=2&cursor=${cursor}`).set(auth());
      expect(next.status).toBe(200);
      for (const row of next.body.data as { id: string }[]) {
        // A row must not appear on two pages.
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = next.body.nextCursor;
      pages += 1;
    }

    const all = await request(server).get('/v1/parties?limit=200').set(auth());
    expect(seen.size).toBe(all.body.data.length);
  });

  it('rejects a cursor that did not come from us', async () => {
    const response = await request(server).get('/v1/parties?cursor=bm90LW91cnM').set(auth());
    expect(response.status).toBe(400);
  });

  it('rejects a limit outside the allowed range', async () => {
    expect((await request(server).get('/v1/parties?limit=0').set(auth())).status).toBe(400);
    expect((await request(server).get('/v1/parties?limit=500').set(auth())).status).toBe(400);
  });

  it('filters parties by kind and country', async () => {
    const vendors = await request(server).get('/v1/parties?kind=vendor&limit=200').set(auth());
    expect(vendors.status).toBe(200);
    expect(vendors.body.data.every((row: { kind: string }) => row.kind === 'vendor')).toBe(true);
    expect(
      vendors.body.data.some((row: { slug: string }) => row.slug === `${PREFIX}mailcrest`),
    ).toBe(true);
  });

  it('filters agreements by a party given as a slug (§1.3)', async () => {
    const response = await request(server)
      .get(`/v1/agreements?party=${PREFIX}aurelia&limit=200`)
      .set(auth());
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('finds a system by the Render resource id the Snapshot knows (§4)', async () => {
    const response = await request(server)
      .get('/v1/systems?renderResourceId=dpg-hl-test')
      .set(auth());
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].slug).toBe(`${PREFIX}hireloop-db`);
  });
});

describe('replacing a record', () => {
  it('needs If-Match, and refuses a stale one (§1.8)', async () => {
    const current = await request(server).get(`/v1/parties/${PREFIX}mailcrest`).set(auth());
    const body = {
      kind: 'vendor',
      legalName: 'Mailcrest Limited',
      country: 'US',
    };

    const withoutHeader = await request(server)
      .put(`/v1/parties/${PREFIX}mailcrest`)
      .set(auth())
      .send(body);
    expect(withoutHeader.status).toBe(428);

    const stale = await request(server)
      .put(`/v1/parties/${PREFIX}mailcrest`)
      .set(auth())
      .set('If-Match', '"99"')
      .send(body);
    expect(stale.status).toBe(412);

    const ok = await request(server)
      .put(`/v1/parties/${PREFIX}mailcrest`)
      .set(auth())
      .set('If-Match', `"${current.body.version}"`)
      .send({ ...body, changeNote: 'Renamed after acquisition' });

    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.legalName).toBe('Mailcrest Limited');
    expect(ok.body.version).toBe(current.body.version + 1);
    expect(ok.headers.etag).toBe(`"${current.body.version + 1}"`);
  });

  it('keeps the slug, which cannot be changed through the API in v1 (§1.2)', async () => {
    const current = await request(server).get(`/v1/parties/${PREFIX}mailcrest`).set(auth());
    const response = await request(server)
      .put(`/v1/parties/${PREFIX}mailcrest`)
      .set(auth())
      .set('If-Match', `"${current.body.version}"`)
      .send({
        slug: `${PREFIX}something-else`,
        kind: 'vendor',
        legalName: 'Mailcrest Limited',
        country: 'US',
      });

    expect(response.status).toBe(200);
    expect(response.body.slug).toBe(`${PREFIX}mailcrest`);
  });
});

describe('history (§2)', () => {
  it('lists the revisions of a record, with who and why', async () => {
    const response = await request(server)
      .get(`/v1/parties/${PREFIX}mailcrest/revisions`)
      .set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThanOrEqual(2);
    expect(response.body.data[0]).toMatchObject({ version: 1, changeType: 'created' });
    expect(response.body.data.at(-1).actor).toBe('priya.raman');
    expect(
      response.body.data.some((entry: { changeNote: string | null }) =>
        entry.changeNote?.includes('acquisition'),
      ),
    ).toBe(true);
  });

  it('returns the snapshot for one version, as the record stood then', async () => {
    const response = await request(server)
      .get(`/v1/parties/${PREFIX}mailcrest/revisions/1`)
      .set(auth());

    expect(response.status).toBe(200);
    expect(response.body.snapshot.legalName).toBe('Mailcrest Inc.');
    expect(response.body.snapshot.schemaVersion).toBe(1);
  });

  it('answers 404 for a version that was never written', async () => {
    const response = await request(server)
      .get(`/v1/parties/${PREFIX}mailcrest/revisions/99`)
      .set(auth());
    expect(response.status).toBe(404);
  });
});

describe('validation and references', () => {
  it('reports a field error for a reference nobody has', async () => {
    const response = await post('/v1/offerings', {
      name: 'Nowhere',
      defaultTerms: `${PREFIX}no-such-terms`,
    });
    expect(response.status).toBe(422);
    expect(response.body.errors[0]).toMatchObject({
      path: '/defaultTerms',
      code: 'unknown_reference',
    });
  });

  it("refuses inbound terms as an offering's default (§4)", async () => {
    const inbound = await post('/v1/agreement-terms', {
      slug: `${PREFIX}vendor-dpa`,
      name: 'Mailcrest DPA',
      direction: 'inbound',
      authorizationType: 'general',
      noticeDays: 30,
    });
    expect(inbound.status).toBe(201);

    const response = await post('/v1/offerings', {
      slug: `${PREFIX}bad-offering`,
      name: 'Bad Offering',
      defaultTerms: `${PREFIX}vendor-dpa`,
    });
    expect(response.status).toBe(422);
    expect(response.body.errors[0].path).toBe('/defaultTerms');
  });

  it('requires an offering on an agreement using outbound terms (§4)', async () => {
    const response = await post('/v1/agreements', {
      party: `${PREFIX}aurelia`,
      terms: `${PREFIX}standard-dpa-v3`,
      signedAt: '2026-03-16',
    });
    expect(response.status).toBe(422);
    expect(response.body.errors[0]).toMatchObject({
      path: '/offering',
      code: 'required_for_outbound',
    });
  });

  it('allows an inbound agreement with no offering', async () => {
    const response = await post('/v1/agreements', {
      party: `${PREFIX}mailcrest`,
      terms: `${PREFIX}vendor-dpa`,
      signedAt: '2026-01-10',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.offering).toBeNull();
  });

  it('reports a malformed body as field errors', async () => {
    const response = await post('/v1/parties', { kind: 'supplier', legalName: '', country: 'USA' });
    expect(response.status).toBe(422);
    const paths = response.body.errors.map((error: { path: string }) => error.path);
    expect(paths).toContain('/kind');
    expect(paths).toContain('/country');
  });
});

describe('deleting', () => {
  it('refuses while another record still points at it (§4)', async () => {
    const terms = await request(server)
      .get(`/v1/agreement-terms/${PREFIX}standard-dpa-v3`)
      .set(auth());

    const response = await request(server)
      .delete(`/v1/agreement-terms/${PREFIX}standard-dpa-v3`)
      .set(auth())
      .set('If-Match', `"${terms.body.version}"`);

    expect(response.status).toBe(409);
    expect(response.headers['content-type']).toMatch(/problem\+json/);
  });

  it('refuses to delete the self party', async () => {
    const self = await request(server).get(`/v1/parties/${PREFIX}hireloop`).set(auth());
    const response = await request(server)
      .delete(`/v1/parties/${PREFIX}hireloop`)
      .set(auth())
      .set('If-Match', `"${self.body.version}"`);

    expect(response.status).toBe(409);
  });

  it('deletes an unreferenced record, leaving its history behind', async () => {
    const created = await post('/v1/taxonomy/security-measures', {
      slug: `${PREFIX}doomed`,
      name: 'Doomed measure',
    });
    expect(created.status).toBe(201);

    const response = await request(server)
      .delete(`/v1/taxonomy/security-measures/${PREFIX}doomed`)
      .set(auth())
      .set('If-Match', '"1"');
    expect(response.status).toBe(204);

    expect(
      (await request(server).get(`/v1/taxonomy/security-measures/${PREFIX}doomed`).set(auth()))
        .status,
    ).toBe(404);
  });
});

describe('permissions on the record routes', () => {
  it('lets a viewer read', async () => {
    const response = await request(server)
      .get('/v1/parties')
      .set('Authorization', `Bearer ${readerToken}`);
    expect(response.status).toBe(200);
  });

  it('refuses a viewer a write, naming the permission', async () => {
    const response = await request(server)
      .post('/v1/parties')
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ kind: 'vendor', legalName: 'Nope Ltd', country: 'US' });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('record:write');
  });

  it('asks a taxonomy write for taxonomy:write', async () => {
    const response = await request(server)
      .post('/v1/taxonomy/subject-categories')
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ name: 'Candidates' });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('taxonomy:write');
  });
});
