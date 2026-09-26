import { TransactionRollbackError, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, createPool, type Database } from '../../src/db/client.js';
import { agreement, party, processingActivity, revision } from '../../src/db/schema/index.js';
import { replayStory, resetDatabase } from '../../src/demo/replay-story.js';
import { retireActivity } from '../../src/domain/activity/lifecycle.js';
import { createAggregate, deleteAggregate, updateAggregate } from '../../src/domain/aggregate.js';
import { agreementAggregate, partyAggregate } from '../../src/domain/aggregates.js';
import { isoDate } from '../../src/domain/agreements.js';
import { recordAsOf, resolveAsOf } from '../../src/domain/record/as-of.js';
import { liveRecord } from '../../src/domain/record/live.js';
import {
  RECORD_KINDS,
  refsOf,
  type RecordReader,
  type SnapshotsByKind,
} from '../../src/domain/record/reader.js';
import type { Transaction } from '../../src/domain/transaction.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * The record as it stood on a date (`ropa-database.md` §6.3), read from the
 * revisions the seed backdated to their moment in the story. Chapter 8 is the
 * acceptance scenario: on 1 March, C1–C4 and P1 as they were, no P3, no
 * Scribe AI, and Aurelia not yet a client.
 *
 * The story is replayed once for the file and the database reset before and
 * after, like `governance-views.test.ts`. Tests that need more history write
 * it in a transaction they roll back.
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

const NOW = new Date();

function read<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction((tx) => work(tx), { isolationLevel: 'repeatable read' });
}

/** Runs `work` in a transaction that never commits, so history written there vanishes. */
async function rolledBack<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await db.transaction(async (tx) => {
      result = await work(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  return result as T;
}

const asOf = (tx: Transaction, asked: string) => recordAsOf(tx, resolveAsOf(asked, NOW));
const codes = async (reader: RecordReader) =>
  (await reader.activities()).map((activity) => activity.code);

async function idOf(reader: RecordReader, kind: keyof SnapshotsByKind, slug: string) {
  const found = await reader.find(kind, slug);
  if (found === undefined) throw new Error(`No ${kind} "${slug}" in this reading`);
  return found.id;
}

describe('the record as of 2026-03-01: what the regulator asks for (Ch8)', () => {
  it('holds C1–C4 and P1, and nothing started later', async () => {
    await read(async (tx) => {
      const reader = await asOf(tx, '2026-03-01');
      expect(reader.day).toBe('2026-03-01');
      expect(await codes(reader)).toEqual(['C1', 'C2', 'C3', 'C4', 'P1']);
    });
  });

  it('holds P1 as it stood then: before Aurelia, one Mailcrest engagement, no client scopes', async () => {
    await read(async (tx) => {
      const [p1] = await (await asOf(tx, '2026-03-01')).activities({ role: 'processor' });
      expect(p1).toMatchObject({ code: 'P1', status: 'active', version: 2 });
      expect(p1!.engagements.map((row) => row.serviceDescription)).toEqual([
        'Hosting',
        'Candidate notifications',
        'Error tracking',
      ]);
      expect(p1!.engagements.flatMap((row) => row.clientScope)).toEqual([]);
    });
  });

  it('has no Aurelia: not a client, not even a party yet', async () => {
    await read(async (tx) => {
      const reader = await asOf(tx, '2026-03-01');
      expect(await reader.find('party', 'aurelia')).toBeUndefined();
      expect(await reader.find('agreement_terms', 'aurelia-dpa')).toBeUndefined();

      const ats = await idOf(reader, 'offering', 'ats');
      const clients = await reader.agreementsInForce({
        direction: 'outbound',
        offeringIds: [ats],
      });
      const parties = await reader.get(
        'party',
        clients.map((row) => row.partyId),
      );
      expect([...parties.values()].map((party) => party.slug).sort()).toEqual([
        'fjord',
        'northwind',
      ]);
    });
  });

  it('has no Scribe AI, and not the CV parsing worker either', async () => {
    await read(async (tx) => {
      const reader = await asOf(tx, '2026-03-01');
      expect(await reader.find('party', 'scribe-ai')).toBeUndefined();
      expect((await reader.all('system')).map((row) => row.slug)).not.toContain('cv-parser');
      expect(await reader.agreementsInForce({ direction: 'inbound' })).toHaveLength(4);
    });
  });

  it('knows who keeps the record', async () => {
    await read(async (tx) => {
      expect(await (await asOf(tx, '2026-03-01')).self()).toMatchObject({
        slug: 'hireloop',
        legalName: 'Hireloop B.V.',
      });
    });
  });

  it('while today’s record has P2 and P3', async () => {
    await read(async (tx) => {
      expect(await codes(liveRecord(tx, NOW))).toEqual(['C1', 'C2', 'C3', 'C4', 'P1', 'P2', 'P3']);
    });
  });
});

describe('a date is the end of that day, UTC; a timestamp is taken as given', () => {
  it('reads 16 March as its evening: Aurelia signed, P1 edited, P2 active', async () => {
    await read(async (tx) => {
      const reader = await asOf(tx, '2026-03-16');
      expect(await codes(reader)).toEqual(['C1', 'C2', 'C3', 'C4', 'P1', 'P2']);
      const aurelia = await idOf(reader, 'party', 'aurelia');
      expect(
        await reader.agreementsInForce({ direction: 'outbound', partyId: aurelia }),
      ).toHaveLength(1);
      const [p1] = await reader.activities({ role: 'processor' });
      expect(p1!.engagements.map((row) => row.serviceDescription)).toContain(
        'Candidate notifications (EU region)',
      );
    });
  });

  it('reads 16 March at noon as noon: P2 still a draft, so not in the record', async () => {
    await read(async (tx) => {
      const reader = await asOf(tx, '2026-03-16T12:00:00Z');
      expect(reader.day).toBe('2026-03-16');
      expect(await codes(reader)).toEqual(['C1', 'C2', 'C3', 'C4', 'P1']);
      expect(await reader.find('party', 'aurelia')).toBeDefined();
    });
  });

  it('includes a revision at exactly the timestamp asked for', async () => {
    await read(async (tx) => {
      // P2 was activated at 15:00:00 sharp.
      expect(await codes(await asOf(tx, '2026-03-16T15:00:00Z'))).toContain('P2');
      expect(await codes(await asOf(tx, '2026-03-16T14:59:59.999Z'))).not.toContain('P2');
    });
  });

  it('counts the last instant of the day, and not the next midnight', async () => {
    await rolledBack(async (tx) => {
      const createParty = (slug: string, validFrom: string) =>
        createAggregate(
          tx,
          partyAggregate,
          { slug, kind: 'client', legalName: slug, country: 'NL' },
          { actor: 'test', validFrom: new Date(validFrom) },
        );
      await createParty('late-evening', '2026-03-01T23:59:59.999Z');
      await createParty('next-midnight', '2026-03-02T00:00:00Z');

      const first = await asOf(tx, '2026-03-01');
      expect(await first.find('party', 'late-evening')).toBeDefined();
      expect(await first.find('party', 'next-midnight')).toBeUndefined();
      expect(await (await asOf(tx, '2026-03-02')).find('party', 'next-midnight')).toBeDefined();
    });
  });
});

describe('agreements in force on the day asked about', () => {
  it('holds an agreement from the day it is signed until the day it ends', async () => {
    await rolledBack(async (tx) => {
      const today = liveRecord(tx, NOW);
      const ats = await idOf(today, 'offering', 'ats');
      const ledgerpay = await idOf(today, 'party', 'ledgerpay');
      const northwind = await idOf(today, 'party', 'northwind');

      // Recorded on 1 March, signed on the 5th.
      await createAggregate(
        tx,
        agreementAggregate,
        {
          partyId: ledgerpay,
          termsId: await idOf(today, 'agreement_terms', 'standard-dpa-v3'),
          offeringId: ats,
          signedAt: '2026-03-05',
        },
        { actor: 'test', validFrom: new Date('2026-03-01T09:00:00Z') },
      );
      // Northwind gives notice on 20 February, ending on 1 March.
      const [ended] = await tx.select().from(agreement).where(eq(agreement.partyId, northwind));
      await updateAggregate(
        tx,
        agreementAggregate,
        ended!.id,
        ended!.version,
        { endedAt: '2026-03-01' },
        { actor: 'test', validFrom: new Date('2026-02-20T09:00:00Z') },
      );

      const clients = async (asked: string) => {
        const reader = await asOf(tx, asked);
        const rows = await reader.agreementsInForce({ direction: 'outbound', offeringIds: [ats] });
        const parties = await reader.get(
          'party',
          rows.map((row) => row.partyId),
        );
        return rows.map((row) => parties.get(row.partyId)!.slug).sort();
      };
      expect(await clients('2026-02-28')).toEqual(['fjord', 'northwind']);
      expect(await clients('2026-03-01')).toEqual(['fjord']);
      expect(await clients('2026-03-04')).toEqual(['fjord']);
      expect(await clients('2026-03-05')).toEqual(['fjord', 'ledgerpay']);
    });
  });
});

describe('each record reads as its own revision at the time', () => {
  it('names a renamed party by its old name, in the snapshot and in Refs (DB §6.2)', async () => {
    await rolledBack(async (tx) => {
      const [northwind] = await tx.select().from(party).where(eq(party.slug, 'northwind'));
      await updateAggregate(
        tx,
        partyAggregate,
        northwind!.id,
        northwind!.version,
        { legalName: 'Northwind Group B.V.' },
        { actor: 'test' },
      );

      const then = await asOf(tx, '2026-03-01');
      const now = liveRecord(tx, NOW);
      expect((await then.find('party', 'northwind'))!.legalName).toBe('Northwind Logistics B.V.');
      expect((await refsOf(then, 'party', [northwind!.id])).get(northwind!.id)!.name).toBe(
        'Northwind Logistics B.V.',
      );
      expect((await refsOf(now, 'party', [northwind!.id])).get(northwind!.id)!.name).toBe(
        'Northwind Group B.V.',
      );
    });
  });

  it('reads a retired activity as active until its retirement, and gone after it', async () => {
    await rolledBack(async (tx) => {
      const [c3] = await tx
        .select()
        .from(processingActivity)
        .where(eq(processingActivity.code, 'C3'));
      await retireActivity(
        tx,
        c3!.id,
        c3!.version,
        { endedAt: '2026-05-01' },
        { actor: 'test', validFrom: new Date('2026-05-01T09:00:00Z') },
      );

      expect(await codes(await asOf(tx, '2026-04-30'))).toContain('C3');
      expect(await codes(await asOf(tx, '2026-05-01'))).not.toContain('C3');
      expect(await codes(liveRecord(tx, NOW))).not.toContain('C3');
    });
  });

  it('drops a record once its latest revision is its deletion', async () => {
    await rolledBack(async (tx) => {
      const created = await createAggregate(
        tx,
        partyAggregate,
        { slug: 'short-lived', kind: 'other', legalName: 'Short-lived Ltd', country: 'IE' },
        { actor: 'test', validFrom: new Date('2026-02-20T09:00:00Z') },
      );
      await deleteAggregate(tx, partyAggregate, created.id, created.version, {
        actor: 'test',
        validFrom: new Date('2026-02-25T09:00:00Z'),
      });

      expect(await (await asOf(tx, '2026-02-22')).find('party', 'short-lived')).toBeDefined();
      const after = await asOf(tx, '2026-03-01');
      expect(await after.find('party', created.id)).toBeUndefined();
      expect((await after.all('party')).map((row) => row.slug)).not.toContain('short-lived');
    });
  });

  it('reads every snapshot through the upgrade path, so an old one without an upgrader fails', async () => {
    await rolledBack(async (tx) => {
      const [stored] = await tx
        .select()
        .from(revision)
        .where(eq(revision.entityType, 'party'))
        .limit(1);
      await tx.insert(revision).values({
        entityType: 'party',
        entityId: stored!.entityId,
        version: 99,
        changeType: 'updated',
        validFrom: new Date('2026-02-28T09:00:00Z'),
        snapshot: { ...(stored!.snapshot as object), schemaVersion: 0 },
        actor: 'test',
      });
      await expect(asOf(tx, '2026-03-01')).rejects.toThrow(
        'No upgrader for party snapshots from schemaVersion 0',
      );
    });
  });
});

describe('as of today, the record reads exactly as it does live', () => {
  async function both<T>(ask: (reader: RecordReader) => Promise<T>): Promise<[T, T]> {
    return read(async (tx) => {
      const live = liveRecord(tx, NOW);
      const today = await asOf(tx, isoDate(NOW));
      return [await ask(live), await ask(today)];
    });
  }

  it('judges business dates on the same day', async () => {
    const [live, today] = await both(async (reader) => reader.day);
    expect(today).toBe(live);
  });

  it.each(RECORD_KINDS)('lists every %s the same', async (kind) => {
    const [live, today] = await both((reader) => reader.all(kind));
    expect(live.length).toBeGreaterThan(0);
    expect(today).toEqual(live);
  });

  it('finds and gets the same records, by slug and by id', async () => {
    const [live, today] = await both(async (reader) => {
      const byId = await reader.find('party', await idOf(reader, 'party', 'aurelia'));
      const all = await reader.all('data_category');
      return {
        bySlug: await reader.find('agreement_terms', 'aurelia-dpa'),
        byId,
        missing: await reader.find('party', 'nobody'),
        got: [
          ...(
            await reader.get('data_category', [
              ...all.map((row) => row.id),
              '0199a000-0000-7000-8000-00000000dead',
            ])
          ).entries(),
        ],
        self: await reader.self(),
      };
    });
    expect(live.bySlug).toBeDefined();
    expect(today).toEqual(live);
  });

  it('reads the same activities, whichever way they are filtered', async () => {
    const [live, today] = await both(async (reader) => {
      const ats = await idOf(reader, 'offering', 'ats');
      return {
        all: await reader.activities(),
        controllers: await reader.activities({ role: 'controller' }),
        ats: await reader.activities({ role: 'processor', offeringId: ats }),
        mailcrest: await reader.activities({
          engaging: await idOf(reader, 'party', 'mailcrest'),
        }),
        candidates: await reader.activities({
          about: await idOf(reader, 'subject_category', 'candidates'),
        }),
      };
    });
    expect(live.all).toHaveLength(7);
    expect(live.mailcrest.map((activity) => activity.code)).toEqual(['C2', 'C3', 'P1']);
    expect(live.candidates.length).toBeGreaterThan(0);
    expect(today).toEqual(live);
  });

  it('holds the same agreements in force', async () => {
    const [live, today] = await both(async (reader) => ({
      outbound: await reader.agreementsInForce({ direction: 'outbound' }),
      inbound: await reader.agreementsInForce({ direction: 'inbound' }),
      aurelia: await reader.agreementsInForce({
        direction: 'outbound',
        partyId: await idOf(reader, 'party', 'aurelia'),
      }),
      ats: await reader.agreementsInForce({
        direction: 'outbound',
        offeringIds: [await idOf(reader, 'offering', 'ats')],
      }),
      mailcrest: await reader.agreementsInForce({
        direction: 'inbound',
        partyId: await idOf(reader, 'party', 'mailcrest'),
      }),
    }));
    expect(live.outbound).toHaveLength(3);
    expect(live.inbound).toHaveLength(5);
    expect(live.mailcrest).toHaveLength(1);
    expect(today).toEqual(live);
  });
});
