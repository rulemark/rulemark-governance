import { and, count, eq } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { processingActivity, revision } from '../../src/db/schema/index.js';
import { loadActivity } from '../../src/domain/activity/load.js';
import type { ActivitySnapshot } from '../../src/domain/snapshots.js';
import { replayStory, resetDatabase } from '../../src/demo/replay-story.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * `db:seed` (`ropa-database.md` §9): the Hireloop story replayed through the
 * domain layer, February to September 2026. It resets the test database
 * first, because the story needs C1 to be C1, and resets it again at the end,
 * because it leaves a self party that other files would collide with.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([{ sub: 'priya.raman', name: 'Priya Raman', roles: ['admin'] }]),
};

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
let firstRun: Awaited<ReturnType<typeof replayStory>>;

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  await resetDatabase(db);
  firstRun = await replayStory(db);
});

afterAll(async () => {
  await resetDatabase(db);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function activity(code: string): Promise<ActivitySnapshot> {
  const [row] = await db
    .select({ id: processingActivity.id })
    .from(processingActivity)
    .where(eq(processingActivity.code, code));
  if (row === undefined) throw new Error(`${code} was not seeded`);
  return (await loadActivity(db, row.id))!;
}

async function slugOf(table: 'party' | 'data_category', id: string): Promise<string> {
  const { rows } = await pool.query<{ slug: string }>(`SELECT slug FROM ${table} WHERE id = $1`, [
    id,
  ]);
  return rows[0]!.slug;
}

describe('the story, replayed (the Phase 7 done-when)', () => {
  it('produces C1–C4 and P1–P3, all live, and nothing else', async () => {
    const rows = await db
      .select({
        code: processingActivity.code,
        name: processingActivity.name,
        status: processingActivity.status,
      })
      .from(processingActivity)
      .orderBy(processingActivity.code);
    expect(rows).toEqual([
      { code: 'C1', name: 'Hireloop staff administration', status: 'active' },
      { code: 'C2', name: 'Customer accounts & billing', status: 'active' },
      { code: 'C3', name: 'Hireloop sales & marketing (prospective customers)', status: 'active' },
      { code: 'C4', name: 'Service reliability monitoring', status: 'active' },
      { code: 'P1', name: 'Candidate application management', status: 'active' },
      { code: 'P2', name: 'Diversity & accommodations module', status: 'active' },
      { code: 'P3', name: 'CV parsing', status: 'active' },
    ]);
  });

  it('gives P1 Mailcrest twice after Aurelia signs, one region each, and no Glitchlog for her (Ch4)', async () => {
    const p1 = await activity('P1');
    const aurelia = p1.engagements.find((row) => row.clientScope.length > 0)?.clientScope[0]
      ?.clientPartyId;
    expect(await slugOf('party', aurelia!)).toBe('aurelia');

    const summary = await Promise.all(
      p1.engagements.map(async (row) => ({
        party: await slugOf('party', row.partyId),
        service: row.serviceDescription,
        countries: row.processingCountries,
        scope: row.clientScope.map((entry) => entry.mode),
        transfers: row.transfers.map(
          (transfer) =>
            `${transfer.destinationCountry} ${transfer.mechanism}${transfer.onwardVia === null ? '' : ` via ${transfer.onwardVia}`}`,
        ),
      })),
    );
    expect(summary).toEqual([
      { party: 'render', service: 'Hosting', countries: ['DE'], scope: [], transfers: [] },
      {
        party: 'mailcrest',
        service: 'Candidate notifications (US region)',
        countries: ['US'],
        scope: ['exclude'],
        transfers: ['US dpf', 'IN sccs via Helpdesk Partners Pvt Ltd'],
      },
      {
        party: 'glitchlog',
        service: 'Error tracking',
        countries: ['US'],
        scope: ['exclude'],
        transfers: ['US sccs'],
      },
      {
        party: 'mailcrest',
        service: 'Candidate notifications (EU region)',
        countries: ['IE'],
        scope: ['include'],
        transfers: ['IN sccs via Helpdesk Partners Pvt Ltd'],
      },
    ]);
  });

  it('makes P2 an opt-in module Aurelia enabled, and P3 on for everyone but her (Ch4, Ch5)', async () => {
    const p2 = await activity('P2');
    expect(p2.clientCoverage).toBe('opt_in');
    expect(p2.clientScope.map((entry) => [entry.mode, entry.startedAt])).toEqual([
      ['include', '2026-03-16'],
    ]);

    const p3 = await activity('P3');
    expect(p3.clientScope.map((entry) => [entry.mode, entry.startedAt])).toEqual([
      ['exclude', '2026-04-14'],
    ]);
    expect(p3.dpiaSupportRef).toMatch(/2026-04-02/);
    expect(await slugOf('party', p3.engagements[1]!.partyId)).toBe('scribe-ai');
  });

  it('records the controller side of Chapter 2: Ledgerpay a recipient, retention per category, C1’s Art. 9 condition', async () => {
    const c2 = await activity('C2');
    expect(c2.engagements.map((row) => row.role)).toEqual(['processor', 'processor', 'recipient']);
    expect(c2.retentionRules.map((rule) => rule.retentionPeriod)).toEqual(['P90D', 'P7Y']);
    expect((await activity('C1')).specialConditions).toEqual(['9(2)(b)']);
    expect((await activity('C4')).roleRationale).toMatch(/controller/);
  });

  it('dates the history as the story does, so asOf will have something to show (§9)', async () => {
    const p1 = await activity('P1');
    const history = await db
      .select({ changeType: revision.changeType, validFrom: revision.validFrom })
      .from(revision)
      .where(and(eq(revision.entityType, 'activity'), eq(revision.entityId, p1.id)))
      .orderBy(revision.version);
    expect(
      history.map((row) => [row.changeType, row.validFrom.toISOString().slice(0, 10)]),
    ).toEqual([
      ['created', '2026-02-12'],
      ['activated', '2026-02-12'],
      ['updated', '2026-03-16'],
      ['updated', '2026-07-03'],
    ]);
    expect(p1.startedAt).toBe('2026-02-12');
  });

  it('dates the foundation records too: Aurelia enters the record when she signs', async () => {
    const { rows } = await pool.query<{ valid_from: Date }>(
      `SELECT r.valid_from FROM revision r JOIN party p ON p.id = r.entity_id WHERE p.slug = 'aurelia'`,
    );
    expect(rows.map((row) => row.valid_from.toISOString().slice(0, 10))).toEqual(['2026-03-16']);
  });
});

describe('the views over the seeded record', () => {
  const parties = async (query: string) =>
    (
      (await request(server).get(`/v1/subprocessors?${query}`)).body as {
        subprocessors: { party: { slug: string }; processingCountries: string[] }[];
      }
    ).subprocessors.map((entry) => `${entry.party.slug} ${entry.processingCountries.join('+')}`);

  it('answer Chapter 4 as the story does', async () => {
    expect(await parties('client=aurelia')).toEqual(['render DE', 'mailcrest IE']);
    expect(await parties('client=northwind')).toEqual([
      'render DE',
      'mailcrest US',
      'glitchlog US',
      'scribe-ai US',
    ]);
  });

  it('render the Art. 30 record for the ATS with P1 to P3', async () => {
    const markdown = (await request(server).get('/v1/report?offering=ats&format=markdown')).text;
    for (const code of ['p1', 'p2', 'p3']) expect(markdown).toContain(`<a id="${code}"></a>`);
    expect(markdown).toContain('**Hireloop B.V.** (NL)');
  });
});

describe('running it again', () => {
  it('changes nothing: every step is already done', async () => {
    const before = await db.select({ n: count() }).from(revision);
    const again = await replayStory(db);

    expect(again.applied).toEqual([]);
    expect(again.skipped.length).toBe(firstRun.applied.length);
    expect(await db.select({ n: count() }).from(revision)).toEqual(before);
  });
});

describe('resetDatabase', () => {
  it('empties the record and restarts the codes, and keeps the migrations', async () => {
    const migrationsBefore = await pool.query(`SELECT count(*) FROM drizzle.__drizzle_migrations`);
    await resetDatabase(db);

    expect(await db.select({ n: count() }).from(processingActivity)).toEqual([{ n: 0 }]);
    expect(await db.select({ n: count() }).from(revision)).toEqual([{ n: 0 }]);
    const { rows } = await pool.query<{ prefix: string; last_value: number }>(
      `SELECT prefix, last_value FROM code_counter ORDER BY prefix`,
    );
    expect(rows).toEqual([
      { prefix: 'C', last_value: 0 },
      { prefix: 'J', last_value: 0 },
      { prefix: 'P', last_value: 0 },
      { prefix: 'RI', last_value: 0 },
    ]);
    expect((await pool.query(`SELECT count(*) FROM drizzle.__drizzle_migrations`)).rows).toEqual(
      migrationsBefore.rows,
    );

    // And the story replays onto it cleanly, codes from 1 again.
    await replayStory(db);
    expect((await activity('C1')).name).toBe('Hireloop staff administration');
  });

  it('stops rather than seed onto a record whose codes mean something else', async () => {
    await resetDatabase(db);
    await pool.query(`UPDATE code_counter SET last_value = 1 WHERE prefix = 'C'`);
    await expect(replayStory(db)).rejects.toThrow(/C1.*--reset/s);
  });
});
