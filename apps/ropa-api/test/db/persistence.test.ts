import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { actorFor } from '../../src/api/middleware/authenticate.js';
import { requires } from '../../src/api/middleware/authorize.js';
import { loadConfig } from '../../src/shared/config.js';

import { codeCounter, eventOutbox, party, revision } from '../../src/db/schema/index.js';
import {
  createAggregate,
  deleteAggregate,
  updateAggregate,
  type SaveContext,
} from '../../src/domain/aggregate.js';
import {
  agreementTermsAggregate,
  offeringAggregate,
  partyAggregate,
} from '../../src/domain/aggregates.js';
import { allocateCode } from '../../src/domain/codes.js';
import { findByIdentifier, identifierKind } from '../../src/domain/identifiers.js';
import { PartySnapshot, SNAPSHOT_SCHEMA_VERSION } from '../../src/domain/snapshots.js';
import { Problem } from '../../src/shared/problems.js';
import { TEST_DATABASE_URL, useDatabase, withRealTransaction } from './harness.js';

/**
 * The persistence machinery against real Postgres.
 *
 * Slugs here are prefixed `pm-` and no test creates a `self` party: Vitest runs
 * test files in parallel, and a unique constraint blocks across uncommitted
 * transactions, so two files competing for the same slug would serialise.
 */
const db = useDatabase();

const PRIYA: SaveContext = { actor: 'priya.raman' };

function aVendor(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'pm-mailcrest',
    kind: 'vendor' as const,
    legalName: 'Mailcrest Inc.',
    country: 'US',
    ...overrides,
  };
}

async function catchProblem(run: () => Promise<unknown>): Promise<Problem> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Problem) return error;
    throw error;
  }
  throw new Error('expected a Problem to be thrown');
}

describe('creating a record', () => {
  it('writes the row, a revision and an outbox row in one go', async () => {
    const { db: tx } = db();
    const row = await createAggregate(tx, partyAggregate, aVendor(), {
      ...PRIYA,
      changeNote: 'Added Mailcrest',
    });

    expect(row.version).toBe(1);

    const revisions = await tx.select().from(revision).where(eq(revision.entityId, row.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      entityType: 'party',
      version: 1,
      changeType: 'created',
      actor: 'priya.raman',
      changeNote: 'Added Mailcrest',
    });

    const events = await tx
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.revisionId, revisions[0]!.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.destination).toBe('audit-log');
  });

  it('stamps the snapshot and stores ids, not names (§6.2)', async () => {
    const { db: tx } = db();
    const terms = await createAggregate(
      tx,
      agreementTermsAggregate,
      {
        slug: 'pm-standard-dpa',
        name: 'Standard DPA v3',
        direction: 'outbound',
        authorizationType: 'general',
        noticeDays: 30,
      },
      PRIYA,
    );
    const created = await createAggregate(
      tx,
      offeringAggregate,
      { slug: 'pm-ats', name: 'Hireloop ATS', defaultTermsId: terms.id },
      PRIYA,
    );

    const [stored] = await tx.select().from(revision).where(eq(revision.entityId, created.id));
    const snapshot = stored!.snapshot as Record<string, unknown>;

    expect(snapshot['schemaVersion']).toBe(SNAPSHOT_SCHEMA_VERSION);
    // A Ref here would freeze the terms' name into the offering's history.
    expect(snapshot['defaultTermsId']).toBe(terms.id);
    expect(snapshot).not.toHaveProperty('defaultTerms');
  });

  it('writes a snapshot that parses back with its own schema', async () => {
    const { db: tx } = db();
    const row = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);

    const [stored] = await tx.select().from(revision).where(eq(revision.entityId, row.id));
    expect(() => PartySnapshot.parse(stored!.snapshot)).not.toThrow();
  });

  it('records the event envelope a consumer will receive (§6)', async () => {
    const { db: tx } = db();
    const row = await createAggregate(tx, partyAggregate, aVendor(), {
      ...PRIYA,
      changeNote: 'Added Mailcrest',
    });

    const [stored] = await tx.select().from(revision).where(eq(revision.entityId, row.id));
    const [event] = await tx
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.revisionId, stored!.id));
    const payload = event!.payload as Record<string, unknown>;

    expect(payload).toMatchObject({ type: 'record.changed', source: 'ropa' });
    expect(payload['data']).toMatchObject({
      entityType: 'party',
      entity: { id: row.id, slug: 'pm-mailcrest', name: 'Mailcrest Inc.' },
      version: 1,
      changeType: 'created',
      actor: 'priya.raman',
      changeNote: 'Added Mailcrest',
    });
    expect(event!.eventId).toBe(payload['id']);
  });
});

describe('updating a record', () => {
  it('saving twice produces two revisions and bumps the version', async () => {
    const { db: tx } = db();
    const created = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);

    const updated = await updateAggregate(
      tx,
      partyAggregate,
      created.id,
      created.version,
      { legalName: 'Mailcrest Limited' },
      { ...PRIYA, changeNote: 'Renamed after acquisition' },
    );

    expect(updated.version).toBe(2);
    expect(updated.legalName).toBe('Mailcrest Limited');

    const revisions = await tx
      .select()
      .from(revision)
      .where(eq(revision.entityId, created.id))
      .orderBy(revision.version);
    expect(revisions.map((row) => row.version)).toEqual([1, 2]);
    expect(revisions.map((row) => row.changeType)).toEqual(['created', 'updated']);
    expect(revisions[1]?.changeNote).toBe('Renamed after acquisition');
  });

  it('each revision keeps the record as it stood, not as it ended up', async () => {
    const { db: tx } = db();
    const created = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);
    await updateAggregate(
      tx,
      partyAggregate,
      created.id,
      1,
      { legalName: 'Mailcrest Limited' },
      PRIYA,
    );

    const revisions = await tx
      .select()
      .from(revision)
      .where(eq(revision.entityId, created.id))
      .orderBy(revision.version);

    expect(PartySnapshot.parse(revisions[0]!.snapshot).legalName).toBe('Mailcrest Inc.');
    expect(PartySnapshot.parse(revisions[1]!.snapshot).legalName).toBe('Mailcrest Limited');
  });

  it('a stale If-Match version answers 412 and names the current version (§1.8)', async () => {
    const { db: tx } = db();
    const created = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);
    await updateAggregate(tx, partyAggregate, created.id, 1, { legalName: 'Second' }, PRIYA);

    // Someone who read version 1 and writes now must be refused.
    const problem = await catchProblem(() =>
      updateAggregate(tx, partyAggregate, created.id, 1, { legalName: 'Third' }, PRIYA),
    );

    expect(problem.status).toBe(412);
    expect(problem.extensions['currentVersion']).toBe(2);
  });

  it('a stale write leaves no revision behind', async () => {
    const { db: tx } = db();
    const created = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);
    await catchProblem(() =>
      updateAggregate(tx, partyAggregate, created.id, 99, { legalName: 'Nope' }, PRIYA),
    );

    const revisions = await tx.select().from(revision).where(eq(revision.entityId, created.id));
    expect(revisions).toHaveLength(1);
  });

  it('answers 404 rather than 412 when the record never existed', async () => {
    const problem = await catchProblem(() =>
      updateAggregate(
        db().db,
        partyAggregate,
        '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
        1,
        { legalName: 'Nobody' },
        PRIYA,
      ),
    );
    expect(problem.status).toBe(404);
  });
});

describe('deleting a record', () => {
  it('leaves the history behind, because history outlives the record', async () => {
    const { db: tx } = db();
    const created = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);
    await deleteAggregate(tx, partyAggregate, created.id, 1, PRIYA);

    const rows = await tx.select().from(party).where(eq(party.id, created.id));
    expect(rows).toHaveLength(0);

    const revisions = await tx
      .select()
      .from(revision)
      .where(eq(revision.entityId, created.id))
      .orderBy(revision.version);
    expect(revisions.map((row) => row.changeType)).toEqual(['created', 'deleted']);
  });

  it('gives the deletion its own version, rather than reusing the last one', async () => {
    const { db: tx } = db();
    const created = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);
    await updateAggregate(tx, partyAggregate, created.id, 1, { legalName: 'Second' }, PRIYA);
    await deleteAggregate(tx, partyAggregate, created.id, 2, PRIYA);

    const revisions = await tx
      .select()
      .from(revision)
      .where(eq(revision.entityId, created.id))
      .orderBy(revision.version);

    expect(revisions.map((row) => row.version)).toEqual([1, 2, 3]);
    // asOf reads trust snapshot.version and revision.version to agree.
    expect(PartySnapshot.parse(revisions[2]!.snapshot).version).toBe(3);
  });

  it('refuses a stale delete with 412', async () => {
    const { db: tx } = db();
    const created = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);
    const problem = await catchProblem(() =>
      deleteAggregate(tx, partyAggregate, created.id, 99, PRIYA),
    );
    expect(problem.status).toBe(412);
  });
});

describe('code allocation', () => {
  /** The committed counters are shared state, so assertions here are relative. */
  const numberOf = (code: string) => Number(code.replace(/^[A-Z]+-?/, ''));

  it('formats a code per prefix (DM §3.0)', async () => {
    const { db: tx } = db();
    expect(await allocateCode(tx, 'P')).toMatch(/^P\d+$/);
    expect(await allocateCode(tx, 'C')).toMatch(/^C\d+$/);
    // Review items read RI-42, activities read P3.
    expect(await allocateCode(tx, 'RI')).toMatch(/^RI-\d+$/);
  });

  it('hands out consecutive numbers', async () => {
    const { db: tx } = db();
    const first = numberOf(await allocateCode(tx, 'P'));
    expect(numberOf(await allocateCode(tx, 'P'))).toBe(first + 1);
    expect(numberOf(await allocateCode(tx, 'P'))).toBe(first + 2);
  });

  it('counts per prefix, so controllers and processors do not share a sequence', async () => {
    const { db: tx } = db();
    const controller = numberOf(await allocateCode(tx, 'C'));
    await allocateCode(tx, 'P');
    await allocateCode(tx, 'P');
    expect(numberOf(await allocateCode(tx, 'C'))).toBe(controller + 1);
  });
});

describe('identifier resolution (§1.2)', () => {
  it('tells the three kinds apart without asking the database', () => {
    expect(identifierKind('0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e')).toBe('id');
    expect(identifierKind('P3')).toBe('code');
    expect(identifierKind('RI-42')).toBe('code');
    expect(identifierKind('mailcrest')).toBe('slug');
    expect(identifierKind('standard-dpa-v3')).toBe('slug');
  });

  it('finds the same record by id and by slug', async () => {
    const { db: tx } = db();
    const created = await createAggregate(tx, partyAggregate, aVendor(), PRIYA);

    const byId = await findByIdentifier<{ id: string }>(tx, partyAggregate, created.id);
    const bySlug = await findByIdentifier<{ id: string }>(tx, partyAggregate, 'pm-mailcrest');

    expect(byId?.id).toBe(created.id);
    expect(bySlug?.id).toBe(created.id);
  });

  it('returns nothing for an unknown identifier', async () => {
    expect(await findByIdentifier(db().db, partyAggregate, 'pm-nobody')).toBeUndefined();
  });

  it('returns nothing for a code against a record type that has none', async () => {
    // Parties are identified by slug; a code can only be a miss.
    expect(await findByIdentifier(db().db, partyAggregate, 'P3')).toBeUndefined();
  });
});

/**
 * A real transaction on its own connection, committing and rolling back for
 * real. This is the one property that cannot be tested inside the harness's
 * transaction, because what is under test *is* the transaction.
 */
describe('one transaction (§6.1)', () => {
  // Unique per run: this test commits for real, so a row left behind by an
  // interrupted run must not be able to collide with the next one.
  const ATOMIC_SLUG = `pm-atomic-${randomUUID().slice(0, 8)}`;

  it('writes the record, its history and its events together, or not at all', async () => {
    await withRealTransaction(async (database) => {
      await expect(
        database.transaction(async (tx) => {
          await createAggregate(tx, partyAggregate, aVendor({ slug: ATOMIC_SLUG }), {
            ...PRIYA,
            // A marker, so the assertions below can look for this save alone.
            changeNote: ATOMIC_SLUG,
          });
          // Anything at all can fail after the revision is written: a
          // constraint, a cross-table rule, a lost connection.
          throw new Error('something failed after the revision was written');
        }),
      ).rejects.toThrow(/something failed/);

      // Nothing committed: no row, no history, no event waiting to be sent.
      // Nothing committed: no row, no history, no event waiting to be sent.
      expect(await database.select().from(party).where(eq(party.slug, ATOMIC_SLUG))).toHaveLength(
        0,
      );
      expect(
        await database.select().from(revision).where(eq(revision.changeNote, ATOMIC_SLUG)),
      ).toHaveLength(0);
    });
  });

  it('rolls the allocated code back with it, so codes stay gapless (§5)', async () => {
    await withRealTransaction(async (database) => {
      const [before] = await database.select().from(codeCounter).where(eq(codeCounter.prefix, 'P'));

      await expect(
        database.transaction(async (tx) => {
          await allocateCode(tx, 'P');
          throw new Error('create failed');
        }),
      ).rejects.toThrow();

      const [after] = await database.select().from(codeCounter).where(eq(codeCounter.prefix, 'P'));
      // The number was never spent, so the next create gets it. This is why a
      // sequence will not do: it would have burned one.
      expect(after?.lastValue).toBe(before?.lastValue);
    });
  });

  it('commits the record, its history and its events together when it succeeds', async () => {
    await withRealTransaction(async (database) => {
      const created = await database.transaction((tx) =>
        createAggregate(tx, partyAggregate, aVendor({ slug: ATOMIC_SLUG }), PRIYA),
      );

      try {
        const revisions = await database
          .select()
          .from(revision)
          .where(eq(revision.entityId, created.id));
        expect(revisions).toHaveLength(1);
        expect(
          await database
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.revisionId, revisions[0]!.id)),
        ).toHaveLength(1);
      } finally {
        // Only the record is removed. Its history stays, because that is what
        // append-only means: `revision_append_only` would refuse the delete,
        // and a test should not be the one thing allowed to rewrite history.
        await database.delete(party).where(eq(party.id, created.id));
      }
    });
  });
});

describe('backdating (seed only, §9)', () => {
  it('honours an explicit validFrom so the story timeline can be replayed', async () => {
    const { db: tx } = db();
    const backdated = new Date('2026-02-10T09:00:00Z');

    const created = await createAggregate(tx, partyAggregate, aVendor(), {
      ...PRIYA,
      validFrom: backdated,
    });

    const [stored] = await tx.select().from(revision).where(eq(revision.entityId, created.id));
    expect(stored!.validFrom.toISOString()).toBe(backdated.toISOString());
    // created_at keeps the backdating visible rather than hiding it (§4.5).
    expect(stored!.createdAt.getTime()).toBeGreaterThan(backdated.getTime());
  });
});

describe('the actor on a revision (§1.6)', () => {
  const AUTH_ENV = {
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
    TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
    PRINCIPALS: JSON.stringify([
      { sub: 'tomas.herrera', name: 'Tomás Herrera', roles: ['editor'] },
    ]),
  };

  /**
   * A stand-in for the party endpoint Phase 6 builds, wired to this test's
   * transaction, so the whole path is exercised: token → caller → actor →
   * revision.
   */
  function appSaving(overrides: Record<string, string> = {}) {
    const config = loadConfig({ ...AUTH_ENV, ...overrides });
    const router = Router();
    router.post('/v1/parties', requires('record:write'), (req, res, next) => {
      void (async () => {
        try {
          const row = await createAggregate(
            db().db,
            partyAggregate,
            aVendor({ slug: req.body.slug }),
            {
              actor: actorFor(req),
            },
          );
          res.status(201).json({ id: row.id });
        } catch (error) {
          next(error);
        }
      })();
    });
    return createApp({ config, router });
  }

  async function mint(app: ReturnType<typeof appSaving>): Promise<string> {
    const response = await request(app)
      .post('/v1/tokens')
      .send({ subject: 'tomas.herrera', secret: AUTH_ENV.TOKEN_MINT_SECRET });
    return response.body.token as string;
  }

  it("records the token's subject, not anything the caller asked for", async () => {
    const app = appSaving();
    const token = await mint(app);

    const created = await request(app)
      .post('/v1/parties')
      .set('Authorization', `Bearer ${token}`)
      // Offered, and ignored: an actor callers could choose would undermine
      // the point of the history.
      .set('X-Actor', 'priya.raman')
      .send({ slug: 'pm-actor-vendor' });

    expect(created.status).toBe(201);

    const [stored] = await db()
      .db.select()
      .from(revision)
      .where(eq(revision.entityId, created.body.id as string));
    expect(stored?.actor).toBe('tomas.herrera');
  });

  it('honours X-Actor only when auth is switched off for development', async () => {
    const app = appSaving({ AUTH_DISABLED: 'true' });

    const created = await request(app)
      .post('/v1/parties')
      .set('X-Actor', 'priya.raman')
      .send({ slug: 'pm-actor-dev' });

    expect(created.status).toBe(201);

    const [stored] = await db()
      .db.select()
      .from(revision)
      .where(eq(revision.entityId, created.body.id as string));
    expect(stored?.actor).toBe('priya.raman');
  });

  it('refuses an anonymous write, so no revision can be actorless', async () => {
    const response = await request(appSaving()).post('/v1/parties').send({ slug: 'pm-nobody' });
    expect(response.status).toBe(401);
    expect(await db().db.select().from(party).where(eq(party.slug, 'pm-nobody'))).toHaveLength(0);
  });
});
