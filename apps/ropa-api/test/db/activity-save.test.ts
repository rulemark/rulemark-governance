import {
  ControllerActivityInput,
  ProcessorActivityInput,
  type FieldError,
} from '@rulemark/ropa-schemas';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SaveContext } from '../../src/domain/aggregate.js';
import { createActivity, loadActivity, replaceActivity } from '../../src/domain/activity/save.js';
import { ActivitySnapshot } from '../../src/domain/snapshots.js';
import { Problem } from '../../src/shared/problems.js';
import { savepoint, useDatabase } from './harness.js';

/**
 * Saving the activity aggregate with its children (`ropa-database.md` §6.1),
 * against real Postgres: the nested-row diff (API §1.4), the snapshot of the
 * whole aggregate, and the cross-entity rules of DM §5.
 */
const db = useDatabase();

const PRIYA: SaveContext = { actor: 'priya.raman' };

function toSnakeCase(name: string): string {
  return name.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

async function insert(table: string, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values);
  const { rows } = await db().sql.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.map(toSnakeCase).join(', ')})
     VALUES (${columns.map((_column, index) => `$${index + 1}`).join(', ')}) RETURNING id`,
    Object.values(values),
  );
  return rows[0]!.id;
}

/** The Hireloop records an activity points at (`ropa-story.md`). */
interface World {
  readonly render: string;
  readonly mailcrest: string;
  readonly glitchlog: string;
  readonly aurelia: string;
  readonly northwind: string;
  readonly ats: string;
  readonly screening: string;
  readonly aureliaDpa: string;
  readonly identity: string;
  readonly cv: string;
  readonly billing: string;
}

let world: World;

beforeEach(async () => {
  const party = (slug: string, kind: string, legalName: string, country: string) =>
    insert('party', { slug, kind, legalName, country });
  const terms = (slug: string, direction: string) =>
    insert('agreement_terms', {
      slug,
      name: slug,
      direction,
      authorizationType: 'general',
      noticeDays: 30,
    });

  const standardDpa = await terms('standard-dpa-v3', 'outbound');
  const aureliaTerms = await terms('aurelia-dpa', 'outbound');
  const ats = await insert('offering', {
    slug: 'ats',
    name: 'Applicant tracking',
    defaultTermsId: standardDpa,
  });
  const screening = await insert('offering', {
    slug: 'screening',
    name: 'Screening',
    defaultTermsId: standardDpa,
  });
  const aurelia = await party('aurelia', 'client', 'Aurelia Health N.V.', 'NL');
  const northwind = await party('northwind', 'client', 'Northwind Staffing Ltd', 'GB');

  world = {
    render: await party('render', 'vendor', 'Render Inc.', 'US'),
    mailcrest: await party('mailcrest', 'vendor', 'Mailcrest Inc.', 'US'),
    glitchlog: await party('glitchlog', 'vendor', 'Glitchlog Inc.', 'US'),
    aurelia,
    northwind,
    ats,
    screening,
    aureliaDpa: await insert('agreement', {
      partyId: aurelia,
      termsId: aureliaTerms,
      offeringId: ats,
      signedAt: '2026-04-14',
    }),
    identity: await insert('data_category', { slug: 'identity', name: 'Identity & contact' }),
    cv: await insert('data_category', { slug: 'cv', name: 'CV' }),
    billing: await insert('data_category', { slug: 'billing', name: 'Billing data' }),
  };
});

/** P1 as `ropa-api.md` §3.2 creates it (Ch3), with its three subprocessors. */
function p1(overrides: Record<string, unknown> = {}) {
  return ProcessorActivityInput.parse({
    role: 'processor',
    name: 'Candidate application management',
    owner: 'Priya Raman',
    offering: 'ats',
    clientCoverage: 'all_enrolled',
    processingCategories: ['hosting', 'storage'],
    dataCategories: ['identity', 'cv'],
    engagements: [
      {
        party: 'render',
        role: 'subprocessor',
        serviceDescription: 'Hosting',
        processingCountries: ['DE'],
        dataCategories: ['identity', 'cv'],
      },
      {
        party: 'mailcrest',
        role: 'subprocessor',
        serviceDescription: 'Candidate notifications',
        processingCountries: ['US'],
        dataCategories: ['identity'],
        transfers: [{ destinationCountry: 'US', mechanism: 'dpf' }],
      },
      {
        party: 'glitchlog',
        role: 'subprocessor',
        serviceDescription: 'Error tracking',
        processingCountries: ['US'],
        dataCategories: ['identity'],
        transfers: [{ destinationCountry: 'US', mechanism: 'sccs' }],
      },
    ],
    ...overrides,
  });
}

function c2(overrides: Record<string, unknown> = {}) {
  return ControllerActivityInput.parse({
    role: 'controller',
    name: 'Customer accounts & billing',
    owner: 'Priya Raman',
    purposes: ['Invoice and collect payment'],
    lawfulBases: ['6(1)(b)'],
    dataCategories: ['billing'],
    retentionRules: [
      { dataCategory: 'billing', retentionPeriod: 'P7Y', triggerEvent: 'after invoice date' },
    ],
    ...overrides,
  });
}

/**
 * Runs a save that is expected to fail, inside a savepoint that is always
 * rolled back, so a half-written aggregate can never leak into the assertions
 * that follow. In the service, the request's transaction does this job.
 */
async function rejected(run: () => Promise<unknown>): Promise<Problem> {
  return savepoint(db().sql, 'rejected_save', async () => {
    try {
      await run();
    } catch (error) {
      if (error instanceof Problem) return error;
      throw error;
    }
    throw new Error('expected the save to be refused');
  });
}

function errorsOf(problem: Problem): FieldError[] {
  return [...(problem.errors ?? [])];
}

async function load(id: string) {
  const activity = await loadActivity(db().db, id);
  if (activity === undefined) throw new Error(`activity ${id} not found`);
  return activity;
}

async function revisionsOf(id: string) {
  const { rows } = await db().sql.query<{ version: number; snapshot: unknown }>(
    `SELECT version, snapshot FROM revision WHERE entity_type = 'activity' AND entity_id = $1 ORDER BY version`,
    [id],
  );
  return rows.map((row) => ({
    version: row.version,
    snapshot: ActivitySnapshot.parse(row.snapshot),
  }));
}

describe('creating an activity', () => {
  it('writes the root, its links and every nested row, and allocates a code by role', async () => {
    const created = await createActivity(db().db, p1(), PRIYA);
    const activity = await load(created.id);

    expect(activity.code).toMatch(/^P\d+$/);
    expect(activity.status).toBe('draft');
    expect(activity.version).toBe(1);
    expect(activity.offeringId).toBe(world.ats);
    expect(activity.dataCategoryIds.sort()).toEqual([world.identity, world.cv].sort());
    expect(activity.engagements.map((engagement) => engagement.partyId)).toEqual([
      world.render,
      world.mailcrest,
      world.glitchlog,
    ]);
    expect(activity.engagements[1]?.transfers).toEqual([
      expect.objectContaining({ destinationCountry: 'US', mechanism: 'dpf' }),
    ]);
    expect(activity.engagements[1]?.dataCategoryIds).toEqual([world.identity]);
  });

  it('gives a controller a C code and keeps processor columns empty', async () => {
    const created = await createActivity(db().db, c2(), PRIYA);
    const activity = await load(created.id);
    expect(activity.code).toMatch(/^C\d+$/);
    expect(activity.dpiaRequired).toBe(false);
    expect(activity.offeringId).toBeNull();
    expect(activity.retentionRules).toEqual([
      expect.objectContaining({ dataCategoryId: world.billing, retentionPeriod: 'P7Y' }),
    ]);
  });

  it('writes one revision whose snapshot is the whole aggregate, with ids rather than names', async () => {
    const created = await createActivity(db().db, p1(), PRIYA);
    const [first, ...rest] = await revisionsOf(created.id);

    expect(rest).toEqual([]);
    expect(first?.version).toBe(1);
    expect(first?.snapshot.schemaVersion).toBe(1);
    expect(first?.snapshot.engagements).toHaveLength(3);
    expect(first?.snapshot.engagements[1]?.partyId).toBe(world.mailcrest);
    expect(JSON.stringify(first?.snapshot)).not.toContain('Mailcrest Inc.');
  });

  it('accepts a reference by id as readily as by slug (§1.2)', async () => {
    const created = await createActivity(db().db, p1({ offering: world.ats }), PRIYA);
    expect((await load(created.id)).offeringId).toBe(world.ats);
  });

  it('links a record once, even when two identifiers name it', async () => {
    const created = await createActivity(
      db().db,
      p1({ dataCategories: ['identity', world.identity, 'cv'], engagements: [] }),
      PRIYA,
    );
    expect((await load(created.id)).dataCategoryIds.sort()).toEqual(
      [world.identity, world.cv].sort(),
    );
  });

  it('reports every unknown reference at its own path, in one response', async () => {
    const input = p1({
      offering: 'no-such-offering',
      dataCategories: ['identity', 'no-such-category'],
    });
    const problem = await rejected(() =>
      createActivity(
        db().db,
        {
          ...input,
          engagements: [input.engagements[0]!, { ...input.engagements[1]!, party: 'nobody' }],
        },
        PRIYA,
      ),
    );

    expect(problem.status).toBe(422);
    expect(errorsOf(problem).map((error) => [error.path, error.code])).toEqual([
      ['/offering', 'unknown_reference'],
      ['/dataCategories/1', 'unknown_reference'],
      ['/engagements/1/party', 'unknown_reference'],
    ]);
  });
});

describe('the cross-entity rules (DM §5)', () => {
  it('keeps an engagement’s data categories within the activity’s', async () => {
    const input = p1({ dataCategories: ['identity'] });
    const problem = await rejected(() => createActivity(db().db, input, PRIYA));
    expect(errorsOf(problem)).toContainEqual(
      expect.objectContaining({ path: '/engagements/0/dataCategories/1', code: 'not_in_activity' }),
    );
  });

  describe('a client scope names a client with an active outbound agreement for the offering', () => {
    const optOut = (client: string, extra: Record<string, unknown> = {}) => ({
      clientScope: {
        mode: 'exclude',
        clients: [{ client, reason: 'Client objected', startedAt: '2026-04-14', ...extra }],
      },
    });

    it('accepts Aurelia on the ATS, which she signed for', async () => {
      await expect(createActivity(db().db, p1(optOut('aurelia')), PRIYA)).resolves.toBeDefined();
    });

    it('refuses Northwind, who has no agreement at all', async () => {
      const problem = await rejected(() => createActivity(db().db, p1(optOut('northwind')), PRIYA));
      expect(errorsOf(problem)).toEqual([
        expect.objectContaining({
          path: '/clientScope/clients/0/client',
          code: 'no_active_agreement',
        }),
      ]);
    });

    it('refuses Aurelia on an offering she has not signed for', async () => {
      const problem = await rejected(() =>
        createActivity(db().db, p1({ offering: 'screening', ...optOut('aurelia') }), PRIYA),
      );
      expect(errorsOf(problem)).toEqual([expect.objectContaining({ code: 'no_active_agreement' })]);
    });

    it('refuses an agreement that has ended', async () => {
      await db().sql.query(`UPDATE agreement SET ended_at = '2026-05-01' WHERE id = $1`, [
        world.aureliaDpa,
      ]);
      const problem = await rejected(() => createActivity(db().db, p1(optOut('aurelia')), PRIYA));
      expect(errorsOf(problem)).toEqual([expect.objectContaining({ code: 'no_active_agreement' })]);
    });

    it('judges the agreement as of the save’s own date, so the seed can replay the story (§9)', async () => {
      const beforeSigning = { ...PRIYA, validFrom: new Date('2026-03-01T09:00:00Z') };
      const problem = await rejected(() =>
        createActivity(db().db, p1(optOut('aurelia')), beforeSigning),
      );
      expect(errorsOf(problem)).toEqual([expect.objectContaining({ code: 'no_active_agreement' })]);
    });

    it('applies the same rule to an engagement’s client scope', async () => {
      const input = p1();
      const scoped = {
        ...input,
        engagements: [
          {
            ...input.engagements[0]!,
            clientScope: {
              mode: 'exclude' as const,
              clients: [{ client: 'northwind', reason: 'EU only' }],
            },
          },
        ],
      };
      const problem = await rejected(() => createActivity(db().db, scoped, PRIYA));
      expect(errorsOf(problem)).toEqual([
        expect.objectContaining({
          path: '/engagements/0/clientScope/clients/0/client',
          code: 'no_active_agreement',
        }),
      ]);
    });

    it('refuses an agreement that belongs to someone else', async () => {
      const northwindTerms = await insert('agreement_terms', {
        slug: 'northwind-dpa',
        name: 'Northwind DPA',
        direction: 'outbound',
        authorizationType: 'general',
        noticeDays: 30,
      });
      const northwindDpa = await insert('agreement', {
        partyId: world.northwind,
        termsId: northwindTerms,
        offeringId: world.ats,
        signedAt: '2026-02-01',
      });
      const problem = await rejected(() =>
        createActivity(db().db, p1(optOut('aurelia', { agreement: northwindDpa })), PRIYA),
      );
      expect(errorsOf(problem)).toEqual([
        expect.objectContaining({
          path: '/clientScope/clients/0/agreement',
          code: 'agreement_not_for_client',
        }),
      ]);
    });
  });

  it('lets an activity supersede only a retired one (DM §3.0)', async () => {
    const c4 = await createActivity(db().db, c2({ name: 'Candidate sourcing' }), PRIYA);
    const code = (await load(c4.id)).code;

    const problem = await rejected(() => createActivity(db().db, p1({ supersedes: code }), PRIYA));
    expect(errorsOf(problem)).toEqual([
      expect.objectContaining({ path: '/supersedes', code: 'supersedes_not_retired' }),
    ]);

    await db().sql.query(
      `UPDATE processing_activity SET status = 'retired', started_at = '2026-02-10' WHERE id = $1`,
      [c4.id],
    );
    const p4 = await createActivity(db().db, p1({ supersedes: code }), PRIYA);
    expect((await load(p4.id)).supersedesId).toBe(c4.id);
  });
});

describe('replacing an activity (PUT, API §1.4)', () => {
  /** P1 read back as a caller would send it again: every nested id included. */
  async function p1WithIds(id: string) {
    const stored = await load(id);
    const input = p1();
    return {
      stored,
      input: {
        ...input,
        engagements: input.engagements.map((engagement, index) => ({
          ...engagement,
          id: stored.engagements[index]!.id,
          transfers: engagement.transfers.map((transfer, t) => ({
            ...transfer,
            id: stored.engagements[index]!.transfers[t]!.id,
          })),
        })),
      },
    };
  }

  it('keeps, edits, drops and adds engagements by id — the Ch4 edit', async () => {
    const created = await createActivity(db().db, p1(), PRIYA);
    const { stored, input } = await p1WithIds(created.id);
    const [render, mailcrest] = input.engagements;

    await replaceActivity(
      db().db,
      created.id,
      1,
      {
        ...input,
        engagements: [
          render!,
          { ...mailcrest!, serviceDescription: 'Candidate notifications (US region)' },
          // Glitchlog is left out, so it is deleted.
          {
            party: 'mailcrest',
            role: 'subprocessor',
            serviceDescription: 'Candidate notifications (EU region)',
            processingCountries: ['IE'],
            dataCategories: ['identity'],
            transfers: [],
          },
        ],
      },
      PRIYA,
    );

    const after = await load(created.id);
    expect(after.version).toBe(2);
    expect(after.engagements.map((engagement) => engagement.serviceDescription)).toEqual([
      'Hosting',
      'Candidate notifications (US region)',
      'Candidate notifications (EU region)',
    ]);
    // Render and Mailcrest kept their identity; Glitchlog's is gone, with its transfer.
    expect(after.engagements[0]?.id).toBe(stored.engagements[0]?.id);
    expect(after.engagements[1]?.id).toBe(stored.engagements[1]?.id);
    expect(after.engagements.map((engagement) => engagement.id)).not.toContain(
      stored.engagements[2]?.id,
    );
    const orphans = await db().sql.query(`SELECT 1 FROM transfer WHERE engagement_id = $1`, [
      stored.engagements[2]?.id,
    ]);
    expect(orphans.rows).toEqual([]);
  });

  it('writes a revision whose snapshot shows the new state, and keeps the old one as it was', async () => {
    const created = await createActivity(db().db, p1(), PRIYA);
    const { input } = await p1WithIds(created.id);
    await replaceActivity(
      db().db,
      created.id,
      1,
      { ...input, engagements: input.engagements.slice(0, 2) },
      { ...PRIYA, changeNote: 'Glitchlog removed' },
    );

    const [v1, v2] = await revisionsOf(created.id);
    expect(v1?.snapshot.engagements).toHaveLength(3);
    expect(v2?.version).toBe(2);
    expect(v2?.snapshot.engagements.map((engagement) => engagement.partyId)).toEqual([
      world.render,
      world.mailcrest,
    ]);
  });

  it('keeps nested transfers by id too: sent with an id updates, without inserts, left out deletes', async () => {
    const created = await createActivity(db().db, p1(), PRIYA);
    const { stored, input } = await p1WithIds(created.id);
    const mailcrest = input.engagements[1]!;
    const originalTransfer = stored.engagements[1]!.transfers[0]!;

    await replaceActivity(
      db().db,
      created.id,
      1,
      {
        ...input,
        engagements: [
          input.engagements[0]!,
          {
            ...mailcrest,
            transfers: [
              { ...mailcrest.transfers[0]!, documentRef: 'Mailcrest DPA §9' },
              {
                destinationCountry: 'IN',
                mechanism: 'sccs',
                onwardVia: 'Helpdesk Partners Pvt Ltd',
              },
            ],
          },
          // Glitchlog keeps its engagement but loses its transfer.
          { ...input.engagements[2]!, transfers: [] },
        ],
      },
      PRIYA,
    );

    const after = await load(created.id);
    expect(after.engagements[1]?.transfers).toEqual([
      expect.objectContaining({ id: originalTransfer.id, documentRef: 'Mailcrest DPA §9' }),
      expect.objectContaining({ destinationCountry: 'IN', onwardVia: 'Helpdesk Partners Pvt Ltd' }),
    ]);
    expect(after.engagements[2]?.transfers).toEqual([]);
  });

  it('replaces link tables wholesale', async () => {
    const created = await createActivity(db().db, p1({ engagements: [] }), PRIYA);
    await replaceActivity(
      db().db,
      created.id,
      1,
      p1({ engagements: [], dataCategories: ['cv'] }),
      PRIYA,
    );
    expect((await load(created.id)).dataCategoryIds).toEqual([world.cv]);
  });

  it('diffs retention rules, activity scope and engagement scope by id as well', async () => {
    const created = await createActivity(db().db, c2(), PRIYA);
    const rule = (await load(created.id)).retentionRules[0]!;

    await replaceActivity(
      db().db,
      created.id,
      1,
      c2({
        dataCategories: ['billing', 'identity'],
        retentionRules: [
          {
            id: rule.id,
            dataCategory: 'billing',
            retentionPeriod: 'P10Y',
            triggerEvent: 'after invoice date',
          },
          { retentionPeriod: 'P90D', triggerEvent: 'after contract end' },
        ],
      }),
      PRIYA,
    );
    const rules = (await load(created.id)).retentionRules;
    expect(rules).toEqual([
      expect.objectContaining({ id: rule.id, retentionPeriod: 'P10Y' }),
      expect.objectContaining({ dataCategoryId: null, retentionPeriod: 'P90D' }),
    ]);

    const scoped = await createActivity(
      db().db,
      p1({
        engagements: [],
        clientScope: {
          mode: 'exclude',
          clients: [{ client: 'aurelia', reason: 'Client objected', startedAt: '2026-04-14' }],
        },
      }),
      PRIYA,
    );
    const entry = (await load(scoped.id)).clientScope[0]!;
    await replaceActivity(
      db().db,
      scoped.id,
      1,
      p1({
        engagements: [],
        clientScope: {
          mode: 'exclude',
          clients: [
            {
              id: entry.id,
              client: 'aurelia',
              reason: 'Client objected (Aurelia DPA, specific authorization)',
              startedAt: '2026-04-14',
            },
          ],
        },
      }),
      PRIYA,
    );
    expect((await load(scoped.id)).clientScope).toEqual([
      expect.objectContaining({
        id: entry.id,
        reason: 'Client objected (Aurelia DPA, specific authorization)',
      }),
    ]);
  });

  describe('refuses a nested id that is not part of this aggregate', () => {
    it('from another activity', async () => {
      const other = await createActivity(db().db, p1(), PRIYA);
      const foreign = (await load(other.id)).engagements[0]!.id;
      const created = await createActivity(db().db, p1(), PRIYA);
      const input = p1();

      const problem = await rejected(() =>
        replaceActivity(
          db().db,
          created.id,
          1,
          { ...input, engagements: [{ ...input.engagements[0]!, id: foreign }] },
          PRIYA,
        ),
      );
      expect(errorsOf(problem)).toEqual([
        expect.objectContaining({ path: '/engagements/0/id', code: 'unknown_row' }),
      ]);
    });

    it('moved from one engagement to another', async () => {
      const created = await createActivity(db().db, p1(), PRIYA);
      const { stored, input } = await p1WithIds(created.id);
      const glitchlogTransfer = stored.engagements[2]!.transfers[0]!.id;

      const problem = await rejected(() =>
        replaceActivity(
          db().db,
          created.id,
          1,
          {
            ...input,
            engagements: [
              {
                ...input.engagements[1]!,
                transfers: [{ ...input.engagements[1]!.transfers[0]!, id: glitchlogTransfer }],
              },
            ],
          },
          PRIYA,
        ),
      );
      expect(errorsOf(problem)).toEqual([
        expect.objectContaining({ path: '/engagements/0/transfers/0/id', code: 'unknown_row' }),
      ]);
    });

    it('sent twice', async () => {
      const created = await createActivity(db().db, p1(), PRIYA);
      const { input } = await p1WithIds(created.id);
      const problem = await rejected(() =>
        replaceActivity(
          db().db,
          created.id,
          1,
          { ...input, engagements: [input.engagements[0]!, input.engagements[0]!] },
          PRIYA,
        ),
      );
      expect(errorsOf(problem)).toEqual([
        expect.objectContaining({ path: '/engagements/1/id', code: 'duplicate_row' }),
      ]);
    });
  });

  it('refuses a stale version with 412 and changes nothing (§1.8)', async () => {
    const created = await createActivity(db().db, p1(), PRIYA);
    const { input } = await p1WithIds(created.id);
    await replaceActivity(db().db, created.id, 1, input, PRIYA);

    const problem = await rejected(() =>
      replaceActivity(db().db, created.id, 1, { ...input, engagements: [] }, PRIYA),
    );
    expect(problem.status).toBe(412);
    expect((await load(created.id)).engagements).toHaveLength(3);
  });

  it('makes a second writer on the same version fail, even when they edit a different engagement (open question 3)', async () => {
    const created = await createActivity(db().db, p1(), PRIYA);
    const { input } = await p1WithIds(created.id);
    const [render, mailcrest, glitchlog] = input.engagements;

    // Both read version 1. Priya edits Render; Tomás edits Glitchlog.
    await replaceActivity(
      db().db,
      created.id,
      1,
      {
        ...input,
        engagements: [
          { ...render!, serviceDescription: 'Hosting (Frankfurt)' },
          mailcrest!,
          glitchlog!,
        ],
      },
      PRIYA,
    );
    const problem = await rejected(() =>
      replaceActivity(
        db().db,
        created.id,
        1,
        {
          ...input,
          engagements: [render!, mailcrest!, { ...glitchlog!, serviceDescription: 'Errors' }],
        },
        { actor: 'tomas.herrera' },
      ),
    );
    expect(problem.status).toBe(412);
  });

  it('refuses to change the role: that is a new activity (DM §3.0)', async () => {
    const created = await createActivity(db().db, c2(), PRIYA);
    const problem = await rejected(() =>
      replaceActivity(db().db, created.id, 1, p1({ engagements: [] }), PRIYA),
    );
    expect(problem.status).toBe(422);
    expect(errorsOf(problem)).toEqual([
      expect.objectContaining({ path: '/role', code: 'role_immutable' }),
    ]);
  });

  it('refuses to edit a retired activity (API §3.4)', async () => {
    const created = await createActivity(db().db, c2(), PRIYA);
    await db().sql.query(
      `UPDATE processing_activity SET status = 'retired', started_at = '2026-02-10' WHERE id = $1`,
      [created.id],
    );
    const problem = await rejected(() => replaceActivity(db().db, created.id, 1, c2(), PRIYA));
    expect(problem.status).toBe(409);
  });

  it('answers 404 for an activity that does not exist', async () => {
    const problem = await rejected(() =>
      replaceActivity(db().db, '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e', 1, c2(), PRIYA),
    );
    expect(problem.status).toBe(404);
  });
});
