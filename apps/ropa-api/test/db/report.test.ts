import {
  ControllerActivityInput,
  ProcessorActivityInput,
  ReportResponse,
} from '@rulemark/ropa-schemas';
import { inArray, like } from 'drizzle-orm';
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
} from '../../src/db/schema/index.js';
import type { SaveContext } from '../../src/domain/aggregate.js';
import { activateActivity } from '../../src/domain/activity/lifecycle.js';
import { createActivity, replaceActivity } from '../../src/domain/activity/save.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * `GET /v1/report` (`ropa-api.md` §5.1) over the Chapter 2–5 record, in JSON
 * and Markdown, asked anonymously. Written through the domain layer and
 * committed; everything is prefixed `rp-` and removed afterwards.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([{ sub: 'priya.raman', name: 'Priya Raman', roles: ['admin'] }]),
};

const PREFIX = 'rp-';
const PRIYA: SaveContext = { actor: 'priya.raman' };
const ref = (slug: string) => `${PREFIX}${slug}`;

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
const ids: Record<string, string> = {};
const codes: Record<string, string> = {};

async function cleanup(): Promise<void> {
  await db.delete(processingActivity).where(like(processingActivity.name, `${PREFIX}%`));
  const ours = db
    .select({ id: party.id })
    .from(party)
    .where(like(party.slug, `${PREFIX}%`));
  await db.delete(agreement).where(inArray(agreement.partyId, ours));
  await db.delete(offering).where(like(offering.slug, `${PREFIX}%`));
  await db.delete(agreementTerms).where(like(agreementTerms.slug, `${PREFIX}%`));
  await db.delete(party).where(like(party.slug, `${PREFIX}%`));
  await db.delete(dataCategory).where(like(dataCategory.slug, `${PREFIX}%`));
  await db.delete(subjectCategory).where(like(subjectCategory.slug, `${PREFIX}%`));
}

function p3Input(name: string) {
  return ProcessorActivityInput.parse({
    role: 'processor',
    name: `${PREFIX}${name}`,
    owner: 'Priya Raman',
    offering: ref('ats'),
    clientCoverage: 'all_enrolled',
    processingCategories: ['cv parsing'],
    subjectCategories: [ref('candidates')],
    dataCategories: [ref('cv')],
    clientScope: {
      mode: 'exclude',
      clients: [{ client: ref('aurelia'), reason: 'Client objected', startedAt: '2026-04-14' }],
    },
    engagements: [
      {
        party: ref('scribe'),
        role: 'subprocessor',
        serviceDescription: 'CV parsing',
        processingCountries: ['US'],
        dataCategories: [ref('cv')],
        transfers: [{ destinationCountry: 'US', mechanism: 'sccs' }],
      },
    ],
  });
}

async function seed(): Promise<void> {
  const [standard, aureliaTerms] = await db
    .insert(agreementTerms)
    .values([
      {
        slug: ref('standard-dpa'),
        name: 'Standard DPA v3',
        direction: 'outbound',
        authorizationType: 'general',
        noticeDays: 30,
      },
      {
        slug: ref('aurelia-dpa'),
        name: 'Aurelia Bank DPA',
        direction: 'outbound',
        authorizationType: 'specific',
        noticeDays: 60,
      },
    ])
    .returning();
  const [ats] = await db
    .insert(offering)
    .values({ slug: ref('ats'), name: 'Hireloop ATS', defaultTermsId: standard!.id })
    .returning();

  const parties = await db
    .insert(party)
    .values([
      {
        slug: ref('hireloop'),
        kind: 'self',
        legalName: 'Hireloop B.V.',
        country: 'NL',
        dpoName: 'Priya Raman',
        dpoEmail: 'dpo@hireloop.example',
      },
      { slug: ref('render'), kind: 'vendor', legalName: 'Render Services, Inc.', country: 'US' },
      { slug: ref('mailcrest'), kind: 'vendor', legalName: 'Mailcrest Inc.', country: 'US' },
      { slug: ref('scribe'), kind: 'vendor', legalName: 'Scribe AI Inc.', country: 'US' },
      { slug: ref('ledgerpay'), kind: 'vendor', legalName: 'Ledgerpay Ltd', country: 'IE' },
      { slug: ref('aurelia'), kind: 'client', legalName: 'Aurelia Bank S.A.', country: 'LU' },
      {
        slug: ref('northwind'),
        kind: 'client',
        legalName: 'Northwind Staffing Ltd',
        country: 'GB',
      },
    ])
    .returning();
  for (const row of parties) ids[row.slug.replace(PREFIX, '')] = row.id;

  await db.insert(agreement).values([
    {
      partyId: ids['northwind']!,
      termsId: standard!.id,
      offeringId: ats!.id,
      signedAt: '2026-02-01',
    },
    {
      partyId: ids['aurelia']!,
      termsId: aureliaTerms!.id,
      offeringId: ats!.id,
      signedAt: '2026-03-16',
    },
  ]);
  await db.insert(subjectCategory).values({ slug: ref('candidates'), name: 'Candidates' });
  await db.insert(dataCategory).values([
    { slug: ref('identity'), name: 'Identity & contact' },
    { slug: ref('cv'), name: 'CV' },
    { slug: ref('billing'), name: 'Billing data' },
    { slug: ref('accommodations'), name: 'Accommodation requests', special: 'art9' },
  ]);

  const live = async (key: string, input: ReturnType<typeof ProcessorActivityInput.parse>) =>
    db.transaction(async (tx) => {
      const row = await createActivity(tx, input, PRIYA);
      await activateActivity(tx, row.id, 1, PRIYA);
      ids[key] = row.id;
      codes[key] = row.code;
    });
  const processor = (name: string, extra: Record<string, unknown>) =>
    ProcessorActivityInput.parse({
      role: 'processor',
      name: `${PREFIX}${name}`,
      owner: 'Priya Raman',
      offering: ref('ats'),
      clientCoverage: 'all_enrolled',
      processingCategories: ['hosting'],
      subjectCategories: [ref('candidates')],
      dataCategories: [ref('identity')],
      ...extra,
    });

  await live(
    'p1',
    processor('Candidate application management', {
      engagements: [
        {
          party: ref('render'),
          role: 'subprocessor',
          serviceDescription: 'Hosting',
          processingCountries: ['DE'],
        },
        {
          party: ref('mailcrest'),
          role: 'subprocessor',
          serviceDescription: 'Candidate notifications (US region)',
          processingCountries: ['US'],
          transfers: [{ destinationCountry: 'US', mechanism: 'dpf' }],
          clientScope: {
            mode: 'exclude',
            clients: [{ client: ref('aurelia'), reason: 'EU only' }],
          },
        },
        {
          party: ref('mailcrest'),
          role: 'subprocessor',
          serviceDescription: 'Candidate notifications (EU region)',
          processingCountries: ['IE'],
          clientScope: {
            mode: 'include',
            clients: [{ client: ref('aurelia'), reason: 'EU region' }],
          },
        },
      ],
    }),
  );
  await live(
    'p2',
    processor('Diversity & accommodations module', {
      clientCoverage: 'opt_in',
      dataCategories: [ref('accommodations')],
      clientScope: {
        mode: 'include',
        clients: [
          { client: ref('aurelia'), reason: 'Client enabled the module', startedAt: '2026-03-16' },
        ],
      },
      engagements: [
        {
          party: ref('render'),
          role: 'subprocessor',
          serviceDescription: 'Hosting',
          processingCountries: ['DE'],
        },
      ],
    }),
  );
  await live('p3', p3Input('CV parsing'));

  await db.transaction(async (tx) => {
    const c2 = await createActivity(
      tx,
      ControllerActivityInput.parse({
        role: 'controller',
        name: `${PREFIX}Customer accounts & billing`,
        owner: 'Priya Raman',
        purposes: ['Invoice and collect payment'],
        lawfulBases: ['6(1)(b)'],
        dataCategories: [ref('billing')],
        retentionRules: [
          {
            dataCategory: ref('billing'),
            retentionPeriod: 'P7Y',
            triggerEvent: 'after invoice date',
            legalRef: 'Dutch tax law',
          },
        ],
        engagements: [
          {
            party: ref('ledgerpay'),
            role: 'recipient',
            serviceDescription: 'Payment processing',
            processingCountries: ['IE'],
            dataCategories: [ref('billing')],
          },
        ],
      }),
      PRIYA,
    );
    await activateActivity(tx, c2.id, 1, PRIYA);
    codes['c2'] = c2.code;
  });

  // A draft is not part of the record yet.
  await db.transaction((tx) => createActivity(tx, processor('Unapproved analytics', {}), PRIYA));
}

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function report(query: string) {
  const response = await request(server).get(`/v1/report?${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return ReportResponse.parse(response.body);
}

const ours = <T extends { name: string }>(activities: readonly T[]) =>
  activities.filter((activity) => activity.name.startsWith(PREFIX));

describe('the whole record (§5.1)', () => {
  it('names the organisation and its DPO (Art. 30(1)(a))', async () => {
    const body = await report('');
    expect(body.organisation).toMatchObject({
      legalName: 'Hireloop B.V.',
      dpoName: 'Priya Raman',
      dpoEmail: 'dpo@hireloop.example',
    });
    expect(body.scope).toEqual({ view: 'all', offering: null, client: null, terms: null });
    expect(body.subprocessors).toBeNull();
  });

  it('lists only active activities, controllers and processors apart', async () => {
    const body = await report('');
    expect(ours(body.controllerActivities).map((activity) => activity.code)).toEqual([codes['c2']]);
    expect(ours(body.processorActivities).map((activity) => activity.code)).toEqual([
      codes['p1'],
      codes['p2'],
      codes['p3'],
    ]);
  });

  it('carries the Art. 30(1) fields of a controller activity', async () => {
    const [c2] = ours((await report('view=controller')).controllerActivities);
    expect(c2).toMatchObject({
      purposes: ['Invoice and collect payment'],
      lawfulBases: ['6(1)(b)'],
      recipients: [
        expect.objectContaining({ party: expect.objectContaining({ name: 'Ledgerpay Ltd' }) }),
      ],
      retentionRules: [
        expect.objectContaining({ retentionPeriod: 'P7Y', legalRef: 'Dutch tax law' }),
      ],
    });
  });

  it('names the clients each processor activity covers today, honouring opt-outs and opt-ins', async () => {
    const byCode = new Map(
      ours((await report('view=processor')).processorActivities).map((activity) => [
        activity.code,
        activity,
      ]),
    );
    const clients = (code: string) => {
      const served = byCode.get(code)!.controllers;
      return served.kind === 'covered' ? served.clients.map((client) => client.name).sort() : [];
    };
    expect(clients(codes['p1']!)).toEqual(['Aurelia Bank S.A.', 'Northwind Staffing Ltd']);
    expect(clients(codes['p2']!)).toEqual(['Aurelia Bank S.A.']);
    expect(clients(codes['p3']!)).toEqual(['Northwind Staffing Ltd']);
  });

  it('marks special categories, so a reader sees them', async () => {
    const p2 = ours((await report('view=processor')).processorActivities).find(
      (activity) => activity.code === codes['p2'],
    );
    expect(p2?.dataCategories).toEqual([expect.objectContaining({ special: 'art9' })]);
    expect(p2?.optionalModule).toBe(true);
  });
});

describe('scoped to the ATS standard terms (Ch4, before signing)', () => {
  it('is a processor report under the offering’s default terms', async () => {
    const body = await report(`offering=${ref('ats')}`);
    expect(body.scope.view).toBe('processor');
    expect(body.scope.terms).toMatchObject({ name: 'Standard DPA v3', noticeDays: 30 });
    expect(body.controllerActivities).toEqual([]);
    expect(body.processorActivities[0]?.controllers).toMatchObject({ kind: 'standard' });
  });

  it('shows the standard engagements only: Mailcrest in the US, not the Aurelia-only EU region', async () => {
    const [p1] = (await report(`offering=${ref('ats')}`)).processorActivities;
    expect(p1?.subprocessors.map((engagement) => engagement.service)).toEqual([
      'Hosting',
      'Candidate notifications (US region)',
    ]);
  });

  it('closes with exactly what GET /subprocessors answers for the same scope', async () => {
    const body = await report(`offering=${ref('ats')}`);
    const list = await request(server).get(`/v1/subprocessors?offering=${ref('ats')}`);
    const { generatedAt: _a, ...fromReport } = body.subprocessors!;
    const { generatedAt: _b, ...fromView } = list.body as Record<string, unknown>;
    expect(fromReport).toEqual(fromView);
  });
});

describe('scoped to Aurelia (Ch4, after signing)', () => {
  it('leaves out P3, which Aurelia opted out of, and uses her own terms', async () => {
    const body = await report(`client=${ref('aurelia')}`);
    expect(body.processorActivities.map((activity) => activity.code)).toEqual([
      codes['p1'],
      codes['p2'],
    ]);
    expect(body.scope.terms).toMatchObject({
      name: 'Aurelia Bank DPA',
      authorizationType: 'specific',
    });
    expect(body.processorActivities[0]?.controllers).toEqual({
      kind: 'client',
      client: expect.objectContaining({ name: 'Aurelia Bank S.A.' }),
    });
  });

  it('shows her effective engagements: Mailcrest in Ireland', async () => {
    const [p1] = (await report(`client=${ref('aurelia')}`)).processorActivities;
    expect(p1?.subprocessors.map((engagement) => engagement.processingCountries)).toEqual([
      ['DE'],
      ['IE'],
    ]);
  });

  it('closes with exactly what GET /subprocessors answers for her', async () => {
    const body = await report(`client=${ref('aurelia')}`);
    const list = await request(server).get(`/v1/subprocessors?client=${ref('aurelia')}`);
    const { generatedAt: _a, ...fromReport } = body.subprocessors!;
    const { generatedAt: _b, ...fromView } = list.body as Record<string, unknown>;
    expect(fromReport).toEqual(fromView);
  });
});

describe('Markdown (§5.1, the Phase 6 done-when)', () => {
  async function markdown(query: string) {
    const response = await request(server).get(`/v1/report?format=markdown&${query}`);
    expect(response.status, response.text).toBe(200);
    expect(response.headers['content-type']).toBe('text/markdown; charset=utf-8');
    return response.text;
  }

  it('reads as an Art. 30 record for the ATS offering', async () => {
    const text = await markdown(`offering=${ref('ats')}`);
    const p1 = codes['p1']!;
    expect(text).toMatch(/^# Record of processing activities\n\n\*\*Hireloop B\.V\.\*\* \(NL\)/);
    expect(text).toContain(
      'Scope: processor activities of Hireloop ATS under its standard terms (Standard DPA v3).',
    );
    expect(text).toContain('## Processor activities (Art. 30(2))');
    expect(text).toContain(
      `<a id="${p1.toLowerCase()}"></a>\n### ${p1} · ${PREFIX}Candidate application management`,
    );
    expect(text).toContain('- **Controllers:** all clients of Hireloop ATS on Standard DPA v3');
    expect(text).toContain('## Subprocessors');
    expect(text).not.toContain('## Controller activities');
    expect(text).not.toContain('Unapproved analytics');
  });

  it('keeps …#p3 working after P3 is renamed', async () => {
    const p3 = codes['p3']!;
    const anchor = `<a id="${p3.toLowerCase()}"></a>`;
    expect(await markdown(`offering=${ref('ats')}`)).toContain(
      `${anchor}\n### ${p3} · ${PREFIX}CV parsing`,
    );

    // Created at version 1, activated at 2.
    await db.transaction((tx) =>
      replaceActivity(tx, ids['p3']!, 2, p3Input('Résumé parsing'), PRIYA),
    );

    const text = await markdown(`offering=${ref('ats')}`);
    expect(text).toContain(`${anchor}\n### ${p3} · ${PREFIX}Résumé parsing`);
    expect(text).toContain(`[${p3}](#${p3.toLowerCase()})`);
  });
});

describe('asking properly', () => {
  const refused = async (query: string) => {
    const response = await request(server).get(`/v1/report?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    return (response.body.errors as { path: string; code: string }[]).map((error) => [
      error.path,
      error.code,
    ]);
  };

  it('scopes by offering or by client, not both', async () => {
    expect(await refused(`offering=${ref('ats')}&client=${ref('aurelia')}`)).toEqual([
      ['', 'offering_or_client'],
    ]);
  });

  it('keeps Hireloop’s own controller records out of a client’s extract', async () => {
    expect(await refused(`client=${ref('aurelia')}&view=all`)).toEqual([
      ['/view', 'scope_needs_processor_view'],
    ]);
  });

  it('says CSV and asOf are not supported yet', async () => {
    expect(await refused('format=csv')).toEqual([['/format', 'not_yet_supported']]);
    expect(await refused('asOf=2026-05-01')).toEqual([['/asOf', 'not_yet_supported']]);
  });

  it('names an unknown client', async () => {
    expect(await refused('client=nobody')).toEqual([['/client', 'unknown_reference']]);
  });
});
