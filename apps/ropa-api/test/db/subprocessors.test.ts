import { ProcessorActivityInput, SubprocessorsResponse } from '@rulemark/ropa-schemas';
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
} from '../../src/db/schema/index.js';
import type { SaveContext } from '../../src/domain/aggregate.js';
import { activateActivity } from '../../src/domain/activity/lifecycle.js';
import { createActivity } from '../../src/domain/activity/save.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * `GET /v1/subprocessors` (`ropa-api.md` §5.2) against the Chapter 4 and 5
 * record, asked anonymously, as the public subprocessor page would. The record
 * is written through the domain layer and committed; everything is prefixed
 * `sp-` and removed afterwards.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([{ sub: 'priya.raman', name: 'Priya Raman', roles: ['admin'] }]),
};

const PREFIX = 'sp-';
const PRIYA: SaveContext = { actor: 'priya.raman' };
const ref = (slug: string) => `${PREFIX}${slug}`;

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
const codes: Record<'p1' | 'p2' | 'p3', string> = { p1: '', p2: '', p3: '' };

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
}

/** Chapters 3–5: the ATS, its three processor activities, two clients. */
async function seed(): Promise<void> {
  const terms = await db
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
  const standard = terms.find((row) => row.slug === ref('standard-dpa'))!;
  const aureliaTerms = terms.find((row) => row.slug === ref('aurelia-dpa'))!;

  const offerings = await db
    .insert(offering)
    .values([
      { slug: ref('ats'), name: 'Hireloop ATS', defaultTermsId: standard.id },
      { slug: ref('screening'), name: 'Screening', defaultTermsId: standard.id },
    ])
    .returning();
  const ats = offerings.find((row) => row.slug === ref('ats'))!;
  const screening = offerings.find((row) => row.slug === ref('screening'))!;

  const vendor = (slug: string, legalName: string) => ({
    slug: ref(slug),
    kind: 'vendor' as const,
    legalName,
    country: 'US',
  });
  const client = (slug: string, legalName: string) => ({
    slug: ref(slug),
    kind: 'client' as const,
    legalName,
    country: 'NL',
  });
  const parties = await db
    .insert(party)
    .values([
      vendor('render', 'Render Services, Inc.'),
      vendor('mailcrest', 'Mailcrest Inc.'),
      vendor('glitchlog', 'Glitchlog Inc.'),
      vendor('scribe', 'Scribe AI Inc.'),
      client('aurelia', 'Aurelia Bank S.A.'),
      client('northwind', 'Northwind Staffing Ltd'),
      client('fjord', 'Fjord Recruiting AS'),
      client('both', 'Two Offerings Ltd'),
    ])
    .returning();
  const partyId = (slug: string) => parties.find((row) => row.slug === ref(slug))!.id;

  await db.insert(agreement).values([
    {
      partyId: partyId('northwind'),
      termsId: standard.id,
      offeringId: ats.id,
      signedAt: '2026-02-01',
    },
    {
      partyId: partyId('aurelia'),
      termsId: aureliaTerms.id,
      offeringId: ats.id,
      signedAt: '2026-03-16',
    },
    // Fjord has no agreement at all; this one has two, for two offerings.
    { partyId: partyId('both'), termsId: standard.id, offeringId: ats.id, signedAt: '2026-02-01' },
    {
      partyId: partyId('both'),
      termsId: standard.id,
      offeringId: screening.id,
      signedAt: '2026-02-01',
    },
  ]);
  await db.insert(dataCategory).values({ slug: ref('identity'), name: 'Identity & contact' });

  const aureliaScope = (mode: 'include' | 'exclude', reason: string) => ({
    mode,
    clients: [{ client: ref('aurelia'), reason }],
  });
  const processor = (name: string, extra: Record<string, unknown>) =>
    ProcessorActivityInput.parse({
      role: 'processor',
      name: `${PREFIX}${name}`,
      owner: 'Priya Raman',
      offering: ref('ats'),
      clientCoverage: 'all_enrolled',
      processingCategories: ['hosting'],
      dataCategories: [ref('identity')],
      ...extra,
    });
  const live = async (input: ReturnType<typeof processor>) =>
    db.transaction(async (tx) => {
      const row = await createActivity(tx, input, PRIYA);
      await activateActivity(tx, row.id, 1, PRIYA);
      return row.code;
    });

  codes.p1 = await live(
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
          clientScope: aureliaScope('exclude', 'EU-only processing (Aurelia DPA)'),
        },
        {
          party: ref('mailcrest'),
          role: 'subprocessor',
          serviceDescription: 'Candidate notifications (EU region)',
          processingCountries: ['IE'],
          clientScope: aureliaScope('include', 'EU data region (Aurelia DPA)'),
        },
        {
          party: ref('glitchlog'),
          role: 'subprocessor',
          serviceDescription: 'Error tracking',
          processingCountries: ['US'],
          transfers: [{ destinationCountry: 'US', mechanism: 'sccs' }],
          clientScope: aureliaScope('exclude', 'EU-only processing (Aurelia DPA)'),
        },
      ],
    }),
  );
  codes.p2 = await live(
    processor('Diversity & accommodations module', {
      clientCoverage: 'opt_in',
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
  codes.p3 = await live(
    processor('CV parsing', {
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
          transfers: [{ destinationCountry: 'US', mechanism: 'sccs' }],
        },
      ],
    }),
  );
  // A draft never reaches a published list.
  await db.transaction((tx) =>
    createActivity(
      tx,
      processor('Unapproved analytics', {
        engagements: [
          {
            party: ref('glitchlog'),
            role: 'subprocessor',
            serviceDescription: 'Product analytics',
            processingCountries: ['US'],
          },
        ],
      }),
      PRIYA,
    ),
  );
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

/** Anonymous, like the public subprocessor page (Ch4). */
async function subprocessors(query: string) {
  const response = await request(server).get(`/v1/subprocessors?${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return SubprocessorsResponse.parse(response.body);
}

const slugs = (view: SubprocessorsResponse) =>
  view.subprocessors.map((entry) => entry.party.slug?.replace(PREFIX, ''));

describe('GET /v1/subprocessors?client= (post-contract, Ch4)', () => {
  it('shows Aurelia Render and Mailcrest in Ireland: no Glitchlog, no Scribe AI, no US transfer', async () => {
    const view = await subprocessors(`client=${ref('aurelia')}`);
    expect(slugs(view)).toEqual(['render', 'mailcrest']);

    const mailcrest = view.subprocessors[1]!;
    expect(mailcrest.services).toEqual(['Candidate notifications (EU region)']);
    expect(mailcrest.processingCountries).toEqual(['IE']);
    expect(view.subprocessors.flatMap((entry) => entry.transfers)).toEqual([]);
  });

  it('names Aurelia’s own terms, and the module she opted into', async () => {
    const view = await subprocessors(`client=${ref('aurelia')}`);
    expect(view.scope.client?.slug).toBe(ref('aurelia'));
    expect(view.scope.offering.slug).toBe(ref('ats'));
    expect(view.scope.terms).toMatchObject({
      slug: ref('aurelia-dpa'),
      authorizationType: 'specific',
      noticeDays: 60,
    });
    expect(view.subprocessors[0]!.activities.map((activity) => activity.code)).toEqual([
      codes.p1,
      codes.p2,
    ]);
    expect(view.optionalModules).toEqual([]);
  });

  it('shows Northwind Mailcrest in the US under DPF, Glitchlog and Scribe AI, on the standard terms', async () => {
    const view = await subprocessors(`client=${ref('northwind')}`);
    expect(slugs(view)).toEqual(['render', 'mailcrest', 'glitchlog', 'scribe']);
    expect(view.subprocessors[1]).toMatchObject({
      processingCountries: ['US'],
      transfers: [{ destinationCountry: 'US', mechanism: 'dpf', onwardVia: null }],
    });
    expect(view.scope.terms).toMatchObject({ authorizationType: 'general', noticeDays: 30 });
  });

  it('never lists a draft', async () => {
    const view = await subprocessors(`client=${ref('northwind')}`);
    expect(view.subprocessors.flatMap((entry) => entry.services)).not.toContain(
      'Product analytics',
    );
  });
});

describe('GET /v1/subprocessors?offering= (the standard terms, pre-contract)', () => {
  it('lists what any new client on the Standard DPA gets: Mailcrest in the US, not Ireland', async () => {
    const view = await subprocessors(`offering=${ref('ats')}`);
    expect(slugs(view)).toEqual(['render', 'mailcrest', 'glitchlog', 'scribe']);
    expect(view.subprocessors[1]!.processingCountries).toEqual(['US']);
    expect(view.scope.client).toBeNull();
    expect(view.scope.terms).toMatchObject({ slug: ref('standard-dpa'), noticeDays: 30 });
  });

  it('lists the opt-in module separately, with its own subprocessors', async () => {
    const view = await subprocessors(`offering=${ref('ats')}`);
    expect(view.optionalModules).toEqual([
      {
        activity: expect.objectContaining({ code: codes.p2 }),
        subprocessors: [
          expect.objectContaining({ party: expect.objectContaining({ slug: ref('render') }) }),
        ],
      },
    ]);
  });

  it('stamps when it was generated, and has no asOf yet', async () => {
    const view = await subprocessors(`offering=${ref('ats')}`);
    expect(Date.parse(view.generatedAt)).not.toBeNaN();
    expect(view.asOf).toBeNull();
  });
});

describe('asking the question properly', () => {
  const refused = async (query: string) => {
    const response = await request(server).get(`/v1/subprocessors?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    return (response.body.errors as { path: string; code: string }[]).map((error) => [
      error.path,
      error.code,
    ]);
  };

  it('needs exactly one of offering or client', async () => {
    expect(await refused('')).toEqual([['', 'exactly_one_scope']]);
    expect(await refused(`offering=${ref('ats')}&client=${ref('aurelia')}`)).toEqual([
      ['', 'exactly_one_scope'],
    ]);
  });

  it('names an unknown offering or client', async () => {
    expect(await refused('client=nobody')).toEqual([['/client', 'unknown_reference']]);
    expect(await refused('offering=nothing')).toEqual([['/offering', 'unknown_reference']]);
  });

  it('refuses a client with no active agreement: nothing of theirs is processed', async () => {
    expect(await refused(`client=${ref('fjord')}`)).toEqual([['/client', 'no_active_agreement']]);
  });

  it('asks a client on several offerings to be asked about by offering, for now', async () => {
    expect(await refused(`client=${ref('both')}`)).toEqual([['/client', 'several_offerings']]);
  });

  it('says asOf is not supported yet, rather than quietly answering for today', async () => {
    expect(await refused(`client=${ref('aurelia')}&asOf=2026-05-01`)).toEqual([
      ['/asOf', 'not_yet_supported'],
    ]);
  });
});
