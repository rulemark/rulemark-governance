import { ActivityInput } from '@rulemark/ropa-schemas';
import { TransactionRollbackError, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, createPool, type Database } from '../../src/db/client.js';
import { offering, processingActivity, revision } from '../../src/db/schema/index.js';
import { replayStory, resetDatabase } from '../../src/demo/replay-story.js';
import { inputFromSnapshot } from '../../src/domain/activity/input.js';
import { retireActivity } from '../../src/domain/activity/lifecycle.js';
import { activityAggregate, loadActivitySnapshot } from '../../src/domain/activity/load.js';
import type { ActivitySaveInput } from '../../src/domain/activity/resolve.js';
import { replaceActivity } from '../../src/domain/activity/save.js';
import { createAggregate, deleteAggregate, type SaveContext } from '../../src/domain/aggregate.js';
import { agreementAggregate, partyAggregate } from '../../src/domain/aggregates.js';
import type { SubprocessorsChangedData } from '../../src/domain/events.js';
import type { Transaction } from '../../src/domain/transaction.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * `subprocessors.changed` (`ropa-api.md` §6): what the Monitor hears when a
 * save changes a subprocessor list. The story's own saves are the acceptance
 * scenario: replaying it must write exactly the events Chapters 3–6 call for,
 * in the same transactions as the saves. Replayed once for the file; the
 * database is reset before and after.
 */

let pool: ReturnType<typeof createPool>;
let db: Database;

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 2);
  db = createDb(pool);
  await resetDatabase(db);
  await replayStory(db);
});

afterAll(async () => {
  await resetDatabase(db);
  await pool.end();
});

interface Row {
  destination: string;
  revision_id: string | null;
  payload: { id: string; occurredAt: string; data: SubprocessorsChangedData };
}

/** Every `subprocessors.changed` outbox row, in the order they were written. */
async function eventsIn(run: { query: Transaction | Database }): Promise<Row[]> {
  const { rows } = await run.query.execute<Row & Record<string, unknown>>(
    sql`SELECT destination, revision_id, payload FROM event_outbox
        WHERE event_type = 'subprocessors.changed' ORDER BY created_at, id`,
  );
  return rows;
}

const slugs = (entries: readonly { party: { slug?: string | undefined } }[]) =>
  entries.map((entry) => entry.party.slug).join(',');

/** One line per event: which save, which list, what moved. */
function summary(row: Row): string {
  const { cause, client, added, removed, changed } = row.payload.data;
  const parts = [
    added.length > 0 ? `+${slugs(added)}` : '',
    removed.length > 0 ? `-${slugs(removed)}` : '',
    changed.length > 0 ? `~${slugs(changed)}` : '',
  ].filter((part) => part !== '');
  return `${cause.activity.code} ${cause.changeType} ${client?.slug ?? 'offering'}: ${parts.join(' ')}`;
}

describe('the story, replayed', () => {
  let rows: Row[];

  beforeAll(async () => {
    rows = await eventsIn({ query: db });
  });

  it('writes the events Chapters 3–6 call for, and no others', () => {
    expect(rows.map(summary)).toEqual([
      'P1 activated offering: +render,mailcrest,glitchlog',
      'P1 activated northwind: +render,mailcrest,glitchlog',
      'P1 activated fjord: +render,mailcrest,glitchlog',
      // Ch4: Aurelia signs, and P1 gives her the EU region and no Glitchlog.
      'P1 updated aurelia: -glitchlog ~mailcrest',
      // P2 is opt-in: the offering lists it as a module; Aurelia had Render already.
      'P2 activated offering: +render',
      // Ch5: Scribe AI, for everyone but Aurelia, who objected.
      'P3 activated offering: +scribe-ai',
      'P3 activated northwind: +scribe-ai',
      'P3 activated fjord: +scribe-ai',
      // Ch6: Mailcrest stays, with an onward transfer to India, in every region.
      'P1 updated offering: ~mailcrest',
      'P1 updated northwind: ~mailcrest',
      'P1 updated fjord: ~mailcrest',
      'P1 updated aurelia: ~mailcrest',
    ]);
  });

  it('sends them to the Monitor, tied to the revision that caused them', async () => {
    expect(new Set(rows.map((row) => row.destination))).toEqual(new Set(['monitor']));
    const p3 = rows.find((row) => summary(row).startsWith('P3 activated offering'))!;
    const [caused] = await db.select().from(revision).where(eq(revision.id, p3.revision_id!));
    expect(caused).toMatchObject({ entityType: 'activity', version: 2, changeType: 'activated' });
    expect(p3.payload.occurredAt).toBe('2026-04-14T15:00:00.000Z');
  });

  it('says who changed what, and why', () => {
    const ch6 = rows.find((row) => summary(row) === 'P1 updated offering: ~mailcrest')!;
    expect(ch6.payload.data.cause).toEqual({
      activity: { id: expect.any(String), code: 'P1', name: 'Candidate application management' },
      version: expect.any(Number),
      changeType: 'updated',
      actor: 'priya.raman',
      changeNote: 'Mailcrest added Helpdesk Partners (India) in every region (Ch6)',
    });
  });

  it('carries the terms each list is under, so the Monitor knows notice from approval', () => {
    const ch6 = rows.filter((row) => summary(row).startsWith('P1 updated'));
    const terms = (slug: string) =>
      ch6.find((row) => (row.payload.data.client?.slug ?? 'offering') === slug)!.payload.data.terms;
    expect(terms('offering')).toMatchObject({
      slug: 'standard-dpa-v3',
      authorizationType: 'general',
      noticeDays: 30,
    });
    expect(terms('northwind')).toMatchObject({ slug: 'standard-dpa-v3' });
    expect(terms('aurelia')).toMatchObject({
      slug: 'aurelia-dpa',
      authorizationType: 'specific',
      noticeDays: 60,
    });
  });

  it('describes Ch6 as Mailcrest still listed, reaching India through Helpdesk Partners', () => {
    const aurelia = rows.find((row) => summary(row) === 'P1 updated aurelia: ~mailcrest')!;
    expect(aurelia.payload.data.changed).toEqual([
      {
        party: { id: expect.any(String), slug: 'mailcrest', name: 'Mailcrest Inc.' },
        module: null,
        before: {
          services: ['Candidate notifications (EU region)'],
          processingCountries: ['IE'],
          transfers: [],
        },
        after: {
          services: ['Candidate notifications (EU region)'],
          processingCountries: ['IE'],
          transfers: [
            { destinationCountry: 'IN', mechanism: 'sccs', onwardVia: 'Helpdesk Partners Pvt Ltd' },
          ],
        },
        effectiveFrom: '2026-07-03',
      },
    ]);
  });

  it('marks a module’s subprocessor with its module on the offering’s list', () => {
    const p2 = rows.find((row) => summary(row) === 'P2 activated offering: +render')!;
    expect(p2.payload.data.added).toEqual([
      expect.objectContaining({
        party: expect.objectContaining({ slug: 'render' }),
        module: { id: expect.any(String), code: 'P2', name: 'Diversity & accommodations module' },
        effectiveFrom: '2026-03-16',
      }),
    ]);
  });
});

/** Runs `work` in a transaction that never commits. */
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

async function editActivity(
  tx: Transaction,
  code: string,
  edit: (body: Record<string, unknown>) => Record<string, unknown>,
  context: SaveContext = { actor: 'priya.raman' },
) {
  const [row] = await tx.select().from(processingActivity).where(eq(processingActivity.code, code));
  const body = edit(inputFromSnapshot(await loadActivitySnapshot(tx, row!)));
  await replaceActivity(
    tx,
    row!.id,
    row!.version,
    ActivityInput.parse(body) as ActivitySaveInput,
    context,
  );
}

describe('beyond the story', () => {
  it('writes no event for a save that changes no list', async () => {
    await rolledBack(async (tx) => {
      const before = await eventsIn({ query: tx });
      await editActivity(tx, 'P1', (body) => ({ ...body, description: 'The ATS' }));
      await editActivity(tx, 'C2', (body) => ({ ...body, description: 'Billing' }));
      expect(await eventsIn({ query: tx })).toHaveLength(before.length);
    });
  });

  it('removes Scribe AI for Aurelia alone when she is excluded from P3', async () => {
    await rolledBack(async (tx) => {
      // P3 as if she had not objected yet, then her exclusion.
      await editActivity(tx, 'P3', (body) => ({ ...body, clientScope: undefined }));
      const before = (await eventsIn({ query: tx })).length;
      await editActivity(tx, 'P3', (body) => ({
        ...body,
        clientScope: {
          mode: 'exclude',
          clients: [{ client: 'aurelia', reason: 'Client objected', startedAt: '2026-09-01' }],
        },
      }));
      expect((await eventsIn({ query: tx })).slice(before).map(summary)).toEqual([
        'P3 updated aurelia: -scribe-ai',
      ]);
    });
  });

  it('tells a client whose agreement starts later, and says when an engagement will start', async () => {
    await rolledBack(async (tx) => {
      const client = await createAggregate(
        tx,
        partyAggregate,
        { slug: 'late-client', kind: 'client', legalName: 'Late Client B.V.', country: 'NL' },
        { actor: 'test' },
      );
      const [ats] = await tx.select().from(offering).where(eq(offering.slug, 'ats'));
      await createAggregate(
        tx,
        agreementAggregate,
        {
          partyId: client.id,
          termsId: ats!.defaultTermsId,
          offeringId: ats!.id,
          signedAt: '2099-01-01',
        },
        { actor: 'test' },
      );
      const before = (await eventsIn({ query: tx })).length;

      await editActivity(tx, 'P1', (body) => ({
        ...body,
        engagements: [
          ...(body['engagements'] as object[]),
          {
            party: 'peoplehub',
            role: 'subprocessor',
            serviceDescription: 'Backups',
            processingCountries: ['DE'],
            dataCategories: ['identity'],
            startedAt: '2099-06-01',
          },
        ],
      }));

      const written = (await eventsIn({ query: tx })).slice(before);
      expect(written.map(summary)).toEqual([
        'P1 updated offering: +peoplehub',
        'P1 updated northwind: +peoplehub',
        'P1 updated fjord: +peoplehub',
        // Unscoped, so for Aurelia too.
        'P1 updated aurelia: +peoplehub',
        'P1 updated late-client: +peoplehub',
      ]);
      expect(written.map((row) => row.payload.data.added[0]!.effectiveFrom)).toEqual(
        Array(5).fill('2099-06-01'),
      );
    });
  });

  it('removes P3’s subprocessors when it is retired', async () => {
    await rolledBack(async (tx) => {
      const [p3] = await tx
        .select()
        .from(processingActivity)
        .where(eq(processingActivity.code, 'P3'));
      const before = (await eventsIn({ query: tx })).length;
      await retireActivity(tx, p3!.id, p3!.version, {}, { actor: 'priya.raman' });
      expect((await eventsIn({ query: tx })).slice(before).map(summary)).toEqual([
        'P3 retired offering: -scribe-ai',
        'P3 retired northwind: -scribe-ai',
        'P3 retired fjord: -scribe-ai',
      ]);
    });
  });

  it('takes a deleted activity off every list (the API deletes only drafts, the domain any)', async () => {
    await rolledBack(async (tx) => {
      const [p3] = await tx
        .select()
        .from(processingActivity)
        .where(eq(processingActivity.code, 'P3'));
      const before = (await eventsIn({ query: tx })).length;
      await deleteAggregate(tx, activityAggregate, p3!.id, p3!.version, { actor: 'priya.raman' });
      expect((await eventsIn({ query: tx })).slice(before).map(summary)).toEqual([
        'P3 deleted offering: -scribe-ai',
        'P3 deleted northwind: -scribe-ai',
        'P3 deleted fjord: -scribe-ai',
      ]);
    });
  });

  it('goes where the save says, and nowhere when told so', async () => {
    await rolledBack(async (tx) => {
      const before = (await eventsIn({ query: tx })).length;
      await editActivity(tx, 'P3', (body) => ({ ...body, clientScope: undefined }), {
        actor: 'priya.raman',
        destinations: [],
      });
      expect(await eventsIn({ query: tx })).toHaveLength(before);
    });
  });
});
