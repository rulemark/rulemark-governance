import {
  ActivityInput,
  DataMapResponse,
  ImpactResponse,
  ReportResponse,
  SubprocessorsResponse,
} from '@rulemark/ropa-schemas';
import { TransactionRollbackError, eq } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { buildDataMap } from '../../src/api/views/data-map.js';
import { buildImpact } from '../../src/api/views/impact.js';
import { buildReport } from '../../src/api/views/report.js';
import { resolveViewScope, type ViewRead } from '../../src/api/views/scope.js';
import { buildSubprocessors } from '../../src/api/views/subprocessors.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { offering, processingActivity } from '../../src/db/schema/index.js';
import { replayStory, resetDatabase } from '../../src/demo/replay-story.js';
import { inputFromSnapshot } from '../../src/domain/activity/input.js';
import { loadActivitySnapshot } from '../../src/domain/activity/load.js';
import type { ActivitySaveInput } from '../../src/domain/activity/resolve.js';
import { replaceActivity } from '../../src/domain/activity/save.js';
import { createAggregate } from '../../src/domain/aggregate.js';
import { agreementAggregate, partyAggregate } from '../../src/domain/aggregates.js';
import { recordAsOf, resolveAsOf } from '../../src/domain/record/as-of.js';
import { liveRecord } from '../../src/domain/record/live.js';
import { refOf } from '../../src/domain/record/reader.js';
import type { Transaction } from '../../src/domain/transaction.js';
import { Problem } from '../../src/shared/problems.js';
import { loadConfig } from '../../src/shared/config.js';
import { csvLines, csvRows, reportLines } from '../fixtures/csv.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * The views as they stood on a date (`ropa-api.md` §5, DB §6.3), over the
 * seeded story. Chapter 8 is the acceptance scenario: the regulator asks for
 * the record as it stood on 1 March 2026 and for today's, and §5.2's example
 * asks for Aurelia's list on 1 May. Like `governance-views.test.ts`, the story
 * is replayed once and the database reset before and after.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([{ sub: 'priya.raman', name: 'Priya Raman', roles: ['viewer'] }]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
let token = '';

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  await resetDatabase(db);
  await replayStory(db);
  const minted = await request(server)
    .post('/v1/tokens')
    .send({ subject: 'priya.raman', secret: ENV.TOKEN_MINT_SECRET });
  expect(minted.status, JSON.stringify(minted.body)).toBe(200);
  token = minted.body.token as string;
});

afterAll(async () => {
  await resetDatabase(db);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

const ask = (path: string) => request(server).get(path).set('Authorization', `Bearer ${token}`);

async function ok(path: string) {
  const response = await ask(path);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response;
}

async function refused(path: string) {
  const response = await ask(path);
  expect(response.status, JSON.stringify(response.body)).toBe(422);
  return (response.body.errors as { path: string; code: string; message: string }[]).map(
    (error) => [error.path, error.code, error.message],
  );
}

const report = async (query: string) =>
  ReportResponse.parse((await ok(`/v1/report?${query}`)).body);
const codesOf = (entries: readonly { code: string }[]) => entries.map((entry) => entry.code);
const partiesOf = (entries: readonly { party: { slug?: string | undefined } }[]) =>
  entries.map((entry) => entry.party.slug);

describe('GET /report?view=all&asOf=2026-03-01: the record as it stood (Ch8)', () => {
  let then: ReportResponse;

  beforeAll(async () => {
    then = await report('view=all&asOf=2026-03-01');
  });

  it('echoes the date asked for, and says when it was generated: now', () => {
    expect(then.asOf).toBe('2026-03-01');
    expect(Date.now() - Date.parse(then.generatedAt)).toBeLessThan(60_000);
  });

  it('holds C1–C4 and P1, and no P2 or P3', () => {
    expect(codesOf(then.controllerActivities)).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(codesOf(then.processorActivities)).toEqual(['P1']);
  });

  it('holds P1 as it stood: one Mailcrest engagement, Glitchlog for everyone, no Scribe AI', () => {
    const [p1] = then.processorActivities;
    expect(p1!.subprocessors.map((row) => `${row.party.slug}: ${row.service}`)).toEqual([
      'render: Hosting',
      'mailcrest: Candidate notifications',
      'glitchlog: Error tracking',
    ]);
  });

  it('serves Northwind and Fjord: Aurelia was not yet a client', () => {
    const [p1] = then.processorActivities;
    expect(p1!.controllers.kind).toBe('covered');
    const served = p1!.controllers as { clients: { slug?: string }[] };
    expect(served.clients.map((client) => client.slug).sort()).toEqual(['fjord', 'northwind']);
  });

  it('names Hireloop and every party as the record did then', () => {
    expect(then.organisation?.party.slug).toBe('hireloop');
    expect(JSON.stringify(then)).not.toMatch(/scribe-ai|Scribe AI|aurelia/i);
  });

  it('renders the same record as Markdown, marked with its date', async () => {
    const response = await ok('/v1/report?view=all&asOf=2026-03-01&format=markdown');
    expect(response.text).toContain('As of 2026-03-01.');
    expect(response.text).toContain('<a id="p1"></a>');
    expect(response.text).not.toContain('<a id="p3"></a>');
    expect(response.text).not.toMatch(/Scribe/);
  });

  it('downloads the same record as CSV, dated on every row and in its name', async () => {
    const response = await ok('/v1/report?view=all&asOf=2026-03-01&format=csv');
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="ropa-all-2026-03-01.csv"',
    );
    const rows = csvRows(response.text.replace(/^\uFEFF/, ''));
    expect(csvLines(rows)).toEqual(reportLines(then));
    expect([...new Set(rows.map((row) => row['activityCode']))]).toEqual([
      'C1',
      'C2',
      'C3',
      'C4',
      'P1',
    ]);
    expect(new Set(rows.map((row) => row['asOf']))).toEqual(new Set(['2026-03-01']));
    expect(response.text).not.toMatch(/Scribe/);
  });
});

describe('GET /report?view=all: today’s record, for the regulator’s diff (Ch8)', () => {
  it('has P3 with Scribe AI and its DPIA support pack, and no asOf', async () => {
    const today = await report('view=all');
    expect(today.asOf).toBeNull();
    expect(codesOf(today.processorActivities)).toEqual(['P1', 'P2', 'P3']);
    const p3 = today.processorActivities[2]!;
    expect(partiesOf(p3.subprocessors)).toContain('scribe-ai');
    expect(p3.dpiaSupportRef).toBe('DPIA support pack: CV parsing (2026-04-02)');
  });
});

describe('GET /subprocessors?client=aurelia&asOf=2026-05-01: §5.2’s example', () => {
  it('answers as the document shows', async () => {
    const view = SubprocessorsResponse.parse(
      (await ok('/v1/subprocessors?client=aurelia&asOf=2026-05-01')).body,
    );
    expect(view.asOf).toBe('2026-05-01');
    expect(view.scope).toMatchObject({
      client: { slug: 'aurelia', name: 'Aurelia Bank S.A.' },
      offering: { slug: 'ats', name: 'Hireloop ATS' },
      terms: {
        slug: 'aurelia-dpa',
        name: 'Aurelia Bank DPA',
        authorizationType: 'specific',
        noticeDays: 60,
      },
    });
    expect(
      view.subprocessors.map((entry) => ({
        party: entry.party.slug,
        services: entry.services,
        processingCountries: entry.processingCountries,
        transfers: entry.transfers,
        activities: codesOf(entry.activities),
      })),
    ).toEqual([
      {
        party: 'render',
        services: ['Hosting'],
        processingCountries: ['DE'],
        transfers: [],
        activities: ['P1', 'P2'],
      },
      {
        party: 'mailcrest',
        services: ['Candidate notifications (EU region)'],
        processingCountries: ['IE'],
        transfers: [],
        activities: ['P1'],
      },
    ]);
  });

  it('lists the standard terms of 1 March without Scribe AI', async () => {
    const view = SubprocessorsResponse.parse(
      (await ok('/v1/subprocessors?offering=ats&asOf=2026-03-01')).body,
    );
    expect(partiesOf(view.subprocessors)).toEqual(['render', 'mailcrest', 'glitchlog']);
    expect(view.optionalModules).toEqual([]);
  });

  it('does not know Aurelia on 1 March, and says so for that date', async () => {
    expect(await refused('/v1/subprocessors?client=aurelia&asOf=2026-03-01')).toEqual([
      ['/client', 'unknown_reference', 'No party matching "aurelia" as of 2026-03-01'],
    ]);
  });

  it('knows Aurelia before her agreement was recorded, but has nothing of hers to list', async () => {
    // The party at 08:00 on 16 March, the agreement at 09:00.
    expect(
      (await refused('/v1/subprocessors?client=aurelia&asOf=2026-03-16T08:30:00Z')).map(
        ([path, code]) => [path, code],
      ),
    ).toEqual([['/client', 'no_active_agreement']]);
  });

  it('echoes a timestamp exactly as it was asked for', async () => {
    const view = SubprocessorsResponse.parse(
      (await ok('/v1/subprocessors?client=aurelia&asOf=2026-03-16T15:00:00%2B01:00')).body,
    );
    expect(view.asOf).toBe('2026-03-16T15:00:00+01:00');
  });
});

describe('GET /parties/{ref}/impact?asOf=', () => {
  it('shows what depended on Mailcrest on 1 March: one P1 engagement, two clients', async () => {
    const impact = ImpactResponse.parse(
      (await ok('/v1/parties/mailcrest/impact?asOf=2026-03-01')).body,
    );
    expect(impact.asOf).toBe('2026-03-01');
    expect(
      impact.engagements.map(
        (entry) => `${entry.activity.code} ${entry.engagement.serviceDescription}`,
      ),
    ).toEqual([
      'C2 Transactional email',
      'C3 Newsletter and demo emails',
      'P1 Candidate notifications',
    ]);
    expect(impact.engagements[2]!.clientGroups).toEqual([
      expect.objectContaining({
        terms: expect.objectContaining({ slug: 'standard-dpa-v3' }),
        clientCount: 2,
      }),
    ]);
  });

  it('does not know Scribe AI on 1 March: a 404, saying for which date', async () => {
    const response = await ask('/v1/parties/scribe-ai/impact?asOf=2026-03-01');
    expect(response.status).toBe(404);
    expect(response.body.detail).toBe('No party matching "scribe-ai" as of 2026-03-01');
  });
});

describe('GET /data-map?asOf=', () => {
  it('maps Northwind’s candidates on 1 March without CV parsing', async () => {
    const map = DataMapResponse.parse(
      (await ok('/v1/data-map?subjectCategory=candidates&client=northwind&asOf=2026-03-01')).body,
    );
    expect(map.asOf).toBe('2026-03-01');
    expect(codesOf(map.entries.map((entry) => entry.activity))).toEqual(['C4', 'P1']);
    const today = DataMapResponse.parse(
      (await ok('/v1/data-map?subjectCategory=candidates&client=northwind')).body,
    );
    expect(codesOf(today.entries.map((entry) => entry.activity))).toEqual(['C4', 'P1', 'P3']);
  });

  it('does not know Aurelia on 1 March', async () => {
    expect(
      (await refused('/v1/data-map?subjectCategory=candidates&client=aurelia&asOf=2026-03-01')).map(
        ([path, code]) => [path, code],
      ),
    ).toEqual([['/client', 'unknown_reference']]);
  });
});

describe('GET /coverage', () => {
  it('still refuses asOf: coverage is a question about today', async () => {
    expect(
      (await refused('/v1/coverage?asOf=2026-03-01')).map(([path, code]) => [path, code]),
    ).toEqual([['/asOf', 'not_supported']]);
  });
});

/** Runs `work` in a transaction that never commits, so what it writes vanishes. */
async function rolledBack(work: (tx: Transaction) => Promise<void>): Promise<void> {
  let finished = false;
  try {
    await db.transaction(async (tx) => {
      await work(tx);
      finished = true;
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  expect(finished).toBe(true);
}

async function readAsOf(tx: Transaction, asked: string): Promise<ViewRead> {
  return {
    record: await recordAsOf(tx, resolveAsOf(asked, new Date())),
    generatedAt: new Date(),
    asOf: asked,
  };
}

/**
 * The story records nothing ahead of its date, so these write it, in a
 * transaction that never commits, and ask the builders directly.
 */
describe('business dates are judged on the asOf day, not today', () => {
  it('holds an agreement recorded early from its signing day, not from its recording', async () => {
    await rolledBack(async (tx) => {
      const recorded = { actor: 'test', validFrom: new Date('2026-03-01T09:00:00Z') };
      const client = await createAggregate(
        tx,
        partyAggregate,
        { slug: 'late-signer', kind: 'client', legalName: 'Late Signer B.V.', country: 'NL' },
        recorded,
      );
      const [ats] = await tx.select().from(offering).where(eq(offering.slug, 'ats'));
      await createAggregate(
        tx,
        agreementAggregate,
        {
          partyId: client.id,
          termsId: ats!.defaultTermsId,
          offeringId: ats!.id,
          signedAt: '2026-03-05',
        },
        recorded,
      );

      const servedBy = async (asked: string) => {
        const built = await buildReport(await readAsOf(tx, asked), { view: 'processor' });
        const served = built.processorActivities[0]!.controllers as {
          clients: { slug?: string }[];
        };
        return served.clients.map((entry) => entry.slug);
      };
      expect(await servedBy('2026-03-04')).not.toContain('late-signer');
      expect(await servedBy('2026-03-05')).toContain('late-signer');
      await expect(
        resolveViewScope(await readAsOf(tx, '2026-03-04'), { client: 'late-signer' }),
      ).rejects.toSatisfy(
        (error) => error instanceof Problem && error.errors?.[0]?.code === 'no_active_agreement',
      );
    });
  });

  it('lists an engagement recorded early from the day it starts', async () => {
    await rolledBack(async (tx) => {
      // Recorded on 1 June, starting on the 10th.
      const [p1] = await tx
        .select()
        .from(processingActivity)
        .where(eq(processingActivity.code, 'P1'));
      const body = inputFromSnapshot(await loadActivitySnapshot(tx, p1!));
      body['engagements'] = [
        ...(body['engagements'] as object[]),
        {
          party: 'peoplehub',
          role: 'subprocessor',
          serviceDescription: 'Backups',
          processingCountries: ['DE'],
          dataCategories: ['identity'],
          startedAt: '2026-06-10',
        },
      ];
      await replaceActivity(
        tx,
        p1!.id,
        p1!.version,
        ActivityInput.parse(body) as ActivitySaveInput,
        { actor: 'test', validFrom: new Date('2026-06-01T09:00:00Z') },
      );

      const inReport = async (asked: string) =>
        (
          await buildReport(await readAsOf(tx, asked), { view: 'processor' })
        ).processorActivities[0]!.subprocessors.map((row) => row.service);
      const forNorthwind = async (asked: string) => {
        const read = await readAsOf(tx, asked);
        const view = await buildSubprocessors(
          read,
          await resolveViewScope(read, { client: 'northwind' }),
        );
        return view.subprocessors.flatMap((entry) => entry.services);
      };

      const impactOnPeoplehub = async (asked: string) => {
        const read = await readAsOf(tx, asked);
        const peoplehub = (await read.record.find('party', 'peoplehub'))!;
        const impact = await buildImpact(read, refOf('party', peoplehub), {
          expandClients: false,
        });
        return impact.engagements.map((entry) => entry.engagement.serviceDescription);
      };
      const candidatesVendors = async (asked: string) => {
        const map = await buildDataMap(await readAsOf(tx, asked), {
          subjectCategory: 'candidates',
          client: 'northwind',
        });
        return map.entries
          .find((entry) => entry.activity.code === 'P1')!
          .vendors.map((vendor) => vendor.party.slug);
      };

      expect(await impactOnPeoplehub('2026-06-09')).not.toContain('Backups');
      expect(await impactOnPeoplehub('2026-06-10')).toContain('Backups');
      expect(await candidatesVendors('2026-06-09')).not.toContain('peoplehub');
      expect(await candidatesVendors('2026-06-10')).toContain('peoplehub');
      expect(await inReport('2026-06-09')).not.toContain('Backups');
      expect(await inReport('2026-06-10')).toContain('Backups');
      expect(await forNorthwind('2026-06-09')).not.toContain('Backups');
      expect(await forNorthwind('2026-06-10')).toContain('Backups');
    });
  });
});

describe('a client with two agreements for one offering', () => {
  it('is grouped under the terms it signed most recently (§5.3)', async () => {
    await rolledBack(async (tx) => {
      const live = liveRecord(tx, new Date());
      const find = async (kind: 'party' | 'agreement_terms' | 'offering', slug: string) =>
        (await live.find(kind, slug))!.id;
      await createAggregate(
        tx,
        agreementAggregate,
        {
          partyId: await find('party', 'northwind'),
          termsId: await find('agreement_terms', 'aurelia-dpa'),
          offeringId: await find('offering', 'ats'),
          signedAt: '2026-09-01',
        },
        { actor: 'test' },
      );

      const mailcrest = (await live.find('party', 'mailcrest'))!;
      const impact = await buildImpact(
        { record: live, generatedAt: new Date(), asOf: null },
        refOf('party', mailcrest),
        { expandClients: true },
      );
      const us = impact.engagements.find(
        (entry) => entry.engagement.serviceDescription === 'Candidate notifications (US region)',
      )!;
      expect(
        us.clientGroups
          .map((group) => [group.terms.slug, group.clients?.map((client) => client.slug)])
          .sort(),
      ).toEqual([
        ['aurelia-dpa', ['northwind']],
        ['standard-dpa-v3', ['fjord']],
      ]);
    });
  });
});
