import { CoverageResponse, DataMapResponse, ImpactResponse } from '@rulemark/ropa-schemas';
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
    { sub: 'svc:snapshot', name: 'Architecture Snapshot', roles: ['service:snapshot'] },
  ]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
const tokens = { monitor: '', dsar: '', snapshot: '' };

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
  tokens.snapshot = await mint('svc:snapshot');
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

describe('GET /data-map: the DSAR tracker’s two requests in Chapter 7', () => {
  async function ask(query: string): Promise<DataMapResponse> {
    const response = await as('dsar', `/v1/data-map?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return DataMapResponse.parse(response.body);
  }

  const entry = (map: DataMapResponse, code: string) =>
    map.entries.find((candidate) => candidate.activity.code === code)!;
  const slugs = (refs: readonly { slug?: string | undefined }[]) => refs.map((ref) => ref.slug);

  describe('Lena: a candidate who applied to Northwind', () => {
    let lena: DataMapResponse;
    beforeAll(async () => {
      lena = await ask('subjectCategory=candidates&client=northwind');
    });

    it('forwards P1 and P3 to Northwind and acts on C4 itself', () => {
      expect(lena.subjectCategory.slug).toBe('candidates');
      expect(lena.client?.slug).toBe('northwind');
      expect(lena.entries.map((row) => `${row.activity.code} ${row.action}`)).toEqual([
        'C4 act',
        'P1 forward',
        'P3 forward',
      ]);
    });

    it('gives C4 its retention, and P1 and P3 none: that is Northwind’s decision', () => {
      expect(entry(lena, 'C4').retention).toEqual([
        expect.objectContaining({ dataCategory: null, retentionPeriod: 'P90D' }),
      ]);
      expect(entry(lena, 'P1').retention).toBeNull();
      expect(entry(lena, 'P3').retention).toBeNull();
    });

    it('points at where her data is: the systems, and the vendors used for Northwind', () => {
      expect(slugs(entry(lena, 'P1').systems)).toContain('hireloop-db');
      expect(slugs(entry(lena, 'P1').vendors.map((vendor) => vendor.party))).toEqual([
        'render',
        'mailcrest',
        'glitchlog',
      ]);
      expect(slugs(entry(lena, 'P3').vendors.map((vendor) => vendor.party))).toEqual([
        'render',
        'scribe-ai',
      ]);
    });

    it('lists what Glitchlog receives for C4 as recorded, telemetry included (Q6)', () => {
      const glitchlog = entry(lena, 'C4').vendors.find(
        (vendor) => vendor.party.slug === 'glitchlog',
      );
      expect(slugs(glitchlog!.dataCategories).sort()).toEqual(['identity', 'telemetry']);
    });

    it('leaves out P2, a module Northwind never enabled', () => {
      expect(lena.entries.map((row) => row.activity.code)).not.toContain('P2');
    });
  });

  describe('Kees: a former Hireloop employee', () => {
    let kees: DataMapResponse;
    beforeAll(async () => {
      kees = await ask('subjectCategory=employees');
    });

    it('finds only C1, where Hireloop decides, in Peoplehub and on no Render system', () => {
      expect(kees.client).toBeNull();
      expect(kees.entries.map((row) => `${row.activity.code} ${row.action}`)).toEqual(['C1 act']);
      expect(slugs(kees.entries[0]!.vendors.map((vendor) => vendor.party))).toEqual(['peoplehub']);
    });

    it('gives the rules that decide it: sick leave after 2 years, payroll after 7', () => {
      const rules = kees.entries[0]!.retention!.map(
        (rule) => `${rule.dataCategory?.slug ?? 'default'} ${rule.retentionPeriod}`,
      );
      expect(rules).toEqual(expect.arrayContaining(['health P2Y', 'payroll P7Y']));
      const payroll = kees.entries[0]!.retention!.find(
        (rule) => rule.dataCategory?.slug === 'payroll',
      );
      expect(payroll?.legalRef).toBe('Dutch tax law');
    });
  });
});

describe('asking for a data map', () => {
  it('needs a subject category, and names one that does not exist', async () => {
    const missing = await as('dsar', '/v1/data-map');
    expect(missing.status).toBe(422);
    expect(missing.body.errors[0].path).toBe('/subjectCategory');

    const unknown = await as('dsar', '/v1/data-map?subjectCategory=martians');
    expect(unknown.status).toBe(422);
    expect(unknown.body.errors[0]).toMatchObject({
      path: '/subjectCategory',
      code: 'unknown_reference',
    });
  });

  it('names a client that does not exist', async () => {
    const response = await as('dsar', '/v1/data-map?subjectCategory=candidates&client=nobody');
    expect(response.status).toBe(422);
    expect(response.body.errors[0]).toMatchObject({ path: '/client', code: 'unknown_reference' });
  });

  it('answers for a party with no agreement with Hireloop’s own activities only', async () => {
    const response = await as('dsar', '/v1/data-map?subjectCategory=candidates&client=mailcrest');
    expect(response.status).toBe(200);
    expect(response.body.entries.map((row: { action: string }) => row.action)).toEqual(['act']);
  });

  it('is refused to a token without view:datamap', async () => {
    const response = await as('monitor', '/v1/data-map?subjectCategory=candidates');
    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('view:datamap');
  });

  it('says asOf is not supported yet', async () => {
    const response = await as('dsar', '/v1/data-map?subjectCategory=candidates&asOf=2026-07-01');
    expect(response.status).toBe(422);
    expect(response.body.errors[0].code).toBe('not_yet_supported');
  });
});

describe('GET /coverage: what the Snapshot sees after Chapter 6', () => {
  let report: CoverageResponse;
  beforeAll(async () => {
    const response = await as('snapshot', '/v1/coverage');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    report = CoverageResponse.parse(response.body);
  });

  it('finds one thing: Aurelia’s EU-only clause, broken by Helpdesk Partners in India', () => {
    expect(report.findings).toHaveLength(1);
    const [finding] = report.findings;
    expect(finding).toMatchObject({
      type: 'region_violation',
      severity: 'high',
      targetType: 'activity',
      target: { code: 'P1' },
      details: {
        engagement: { serviceDescription: 'Candidate notifications (EU region)' },
        party: { slug: 'mailcrest' },
        client: { slug: 'aurelia' },
        terms: { slug: 'aurelia-dpa' },
        allowedRegions: ['EEA'],
        country: 'IN',
        via: 'transfer',
        onwardVia: 'Helpdesk Partners Pvt Ltd',
      },
    });
  });

  it('flags nothing the story calls legitimate: C1 has no Render system, and that is fine', () => {
    const aboutC1 = report.findings.filter((finding) => finding.target.code === 'C1');
    expect(aboutC1).toEqual([]);
    expect(report.findings.map((finding) => finding.type)).not.toContain('unmapped_system');
    expect(report.findings.map((finding) => finding.type)).not.toContain('transfer_missing');
  });

  it('gives the finding the same key on every run (Q4)', async () => {
    const again = CoverageResponse.parse((await as('snapshot', '/v1/coverage')).body);
    expect(again.findings.map((finding) => finding.key)).toEqual(
      report.findings.map((finding) => finding.key),
    );
  });

  it('can be carried to a person: the Snapshot opens a review item with the key (Ch5)', async () => {
    const [finding] = report.findings;
    const opened = await request(server)
      .post('/v1/review-items')
      .set('Authorization', `Bearer ${tokens.snapshot}`)
      .send({
        targetType: finding!.targetType,
        target: finding!.target.id,
        source: 'snapshot',
        reason: finding!.type,
        details: { key: finding!.key, ...finding!.details },
      });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    expect(opened.body).toMatchObject({
      target: { code: 'P1' },
      reason: 'region_violation',
      details: { key: finding!.key },
    });
  });
});

describe('asking for coverage', () => {
  it('refuses a date: coverage is a question about today', async () => {
    const response = await as('snapshot', '/v1/coverage?asOf=2026-06-01');
    expect(response.status).toBe(422);
    expect(response.body.errors[0]).toMatchObject({ path: '/asOf', code: 'not_supported' });
  });

  it('is refused to a token without view:coverage', async () => {
    const response = await as('dsar', '/v1/coverage');
    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('view:coverage');
  });
});
