import { IsoDuration } from '@rulemark/ropa-schemas';
import { beforeEach, describe, expect, it } from 'vitest';

import { expectRaise, expectViolation, useDatabase } from './harness.js';

/**
 * One test per named constraint on the activity aggregate (`ropa-database.md`
 * §4.4, §4.6), proving each rejects bad data. Raw SQL throughout, because most
 * of the rows worth rejecting are ones TypeScript would never let us write.
 */
const db = useDatabase();

function toSnakeCase(name: string): string {
  return name.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Inserts one row and returns its id. Arrays go in as Postgres arrays. */
async function insert(table: string, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_column, index) => `$${index + 1}`);
  const { rows } = await db().sql.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.map(toSnakeCase).join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING *`,
    Object.values(values),
  );
  return rows[0]!.id;
}

/** Link tables have no id, so they get their own insert. */
async function link(table: string, values: Record<string, string>): Promise<void> {
  const columns = Object.keys(values);
  await db().sql.query(
    `INSERT INTO ${table} (${columns.map(toSnakeCase).join(', ')})
     VALUES (${columns.map((_column, index) => `$${index + 1}`).join(', ')})`,
    Object.values(values),
  );
}

/** The records an activity points at, created fresh for every test. */
interface World {
  readonly mailcrest: string;
  readonly aurelia: string;
  readonly aureliaDpa: string;
  readonly ats: string;
  readonly identity: string;
  readonly billing: string;
  readonly candidates: string;
  readonly hireloopApp: string;
  readonly encryption: string;
}

let world: World;

beforeEach(async () => {
  const terms = await insert('agreement_terms', {
    slug: 'standard-dpa-v3',
    name: 'Standard DPA v3',
    direction: 'outbound',
    authorizationType: 'general',
    noticeDays: 30,
  });
  const render = await insert('party', {
    slug: 'render',
    kind: 'vendor',
    legalName: 'Render Inc.',
    country: 'US',
  });
  const aurelia = await insert('party', {
    slug: 'aurelia',
    kind: 'client',
    legalName: 'Aurelia Health N.V.',
    country: 'NL',
  });
  const ats = await insert('offering', {
    slug: 'ats',
    name: 'Applicant tracking',
    defaultTermsId: terms,
  });
  world = {
    mailcrest: await insert('party', {
      slug: 'mailcrest',
      kind: 'vendor',
      legalName: 'Mailcrest Inc.',
      country: 'US',
    }),
    aurelia,
    aureliaDpa: await insert('agreement', {
      partyId: aurelia,
      termsId: terms,
      offeringId: ats,
      signedAt: '2026-04-14',
    }),
    ats,
    identity: await insert('data_category', { slug: 'identity', name: 'Identity & contact' }),
    billing: await insert('data_category', { slug: 'billing', name: 'Billing data' }),
    candidates: await insert('subject_category', { slug: 'candidates', name: 'Candidates' }),
    hireloopApp: await insert('system', {
      slug: 'hireloop-app',
      name: 'Recruiter app',
      kind: 'render_web_service',
      region: 'frankfurt',
      hostingPartyId: render,
    }),
    encryption: await insert('security_measure', {
      slug: 'encryption-at-rest',
      name: 'Encryption at rest',
    }),
  };
});

/** A controller draft: everything else is allowed to be missing. */
function aController(overrides: Record<string, unknown> = {}) {
  return {
    code: 'C1',
    name: 'Recruitment',
    role: 'controller',
    owner: 'Priya Raman',
    ...overrides,
  };
}

function aProcessor(overrides: Record<string, unknown> = {}) {
  return {
    code: 'P1',
    name: 'Candidate application management',
    role: 'processor',
    owner: 'Priya Raman',
    ...overrides,
  };
}

const insertActivity = (values: Record<string, unknown>) => insert('processing_activity', values);

/** The fields an active processor must have (§4.4 `processing_activity_active_processor`). */
function completeProcessor() {
  return {
    offeringId: world.ats,
    clientCoverage: 'all_enrolled',
    processingCategories: ['hosting'],
    startedAt: '2026-03-01',
  };
}

async function anEngagement(activityId: string, overrides: Record<string, unknown> = {}) {
  return insert('engagement', {
    activityId,
    partyId: world.mailcrest,
    role: 'subprocessor',
    serviceDescription: 'Candidate notifications',
    processingCountries: ['US'],
    ...overrides,
  });
}

describe('processing_activity', () => {
  it('accepts a draft with nothing but its identity: drafts may be incomplete (API §1.5)', async () => {
    const id = await insertActivity(aController());
    const { rows } = await db().sql.query(
      `SELECT status, purposes, lawful_bases, version FROM processing_activity WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ status: 'draft', purposes: [], lawful_bases: [], version: 1 });

    await expect(insertActivity(aProcessor())).resolves.toBeDefined();
  });

  it('processing_activity_code rejects anything but a prefix and a number from 1', async () => {
    for (const code of ['C0', 'c1', 'X1', 'C1a', 'C', 'RI-1']) {
      await expectViolation('processing_activity_code', () =>
        insertActivity(aController({ code })),
      );
    }
  });

  it('processing_activity_code_unique never hands out a code twice', async () => {
    await insertActivity(aController());
    await expectViolation('processing_activity_code_unique', () =>
      insertActivity(aController({ name: 'Another' })),
    );
  });

  it('processing_activity_code_prefix keeps the prefix and the role in step (DM §3.0)', async () => {
    await expectViolation('processing_activity_code_prefix', () =>
      insertActivity(aController({ code: 'P1' })),
    );
    await expectViolation('processing_activity_code_prefix', () =>
      insertActivity(aProcessor({ code: 'C1' })),
    );
  });

  it('processing_activity_role, _status and _client_coverage reject values outside the enums', async () => {
    await expectViolation('processing_activity_role', () =>
      insertActivity(aController({ code: 'J1', role: 'owner' })),
    );
    await expectViolation('processing_activity_status', () =>
      insertActivity(aController({ status: 'archived', startedAt: '2026-02-10' })),
    );
    await expectViolation('processing_activity_client_coverage', () =>
      insertActivity(aProcessor({ clientCoverage: 'everyone' })),
    );
  });

  it('processing_activity_lawful_bases and _special_conditions check every element', async () => {
    await expectViolation('processing_activity_lawful_bases', () =>
      insertActivity(aController({ lawfulBases: ['6(1)(b)', '6(1)(g)'] })),
    );
    await expectViolation('processing_activity_special_conditions', () =>
      insertActivity(aController({ specialConditions: ['9(2)(k)'] })),
    );
    await expect(
      insertActivity(aController({ lawfulBases: ['6(1)(b)'], specialConditions: ['art10'] })),
    ).resolves.toBeDefined();
  });

  it('processing_activity_processor_fields refuses a processor with purposes, even as a draft', async () => {
    const forbidden = {
      purposes: ['Recruitment'],
      lawfulBases: ['6(1)(f)'],
      specialConditions: ['9(2)(b)'],
      dpiaRequired: false,
      dpiaRef: 'DPIA-1',
    };
    for (const [field, value] of Object.entries(forbidden)) {
      await expectViolation('processing_activity_processor_fields', () =>
        insertActivity(aProcessor({ [field]: value })),
      );
    }
  });

  it('processing_activity_controller_fields refuses processor fields on a controller', async () => {
    const forbidden = {
      offeringId: world.ats,
      clientCoverage: 'all_enrolled',
      processingCategories: ['hosting'],
      dpiaSupportRef: 'DPIA-SUPPORT-ATS',
    };
    for (const [field, value] of Object.entries(forbidden)) {
      await expectViolation('processing_activity_controller_fields', () =>
        insertActivity(aController({ [field]: value })),
      );
    }
  });

  it('processing_activity_dates rejects an activity that ends before it starts', async () => {
    await expectViolation('processing_activity_dates', () =>
      insertActivity(aController({ startedAt: '2026-03-01', endedAt: '2026-02-01' })),
    );
  });

  it('processing_activity_active_controller needs purposes, lawful bases and a DPIA answer', async () => {
    const complete = {
      status: 'active',
      startedAt: '2026-02-10',
      purposes: ['Recruitment'],
      lawfulBases: ['6(1)(f)'],
      dpiaRequired: false,
    };
    for (const missing of ['purposes', 'lawfulBases', 'dpiaRequired'] as const) {
      const { [missing]: _left, ...incomplete } = complete;
      await expectViolation('processing_activity_active_controller', () =>
        insertActivity(aController(incomplete)),
      );
    }
    await expect(insertActivity(aController(complete))).resolves.toBeDefined();
  });

  it('processing_activity_active_processor needs an offering, a coverage and categories', async () => {
    const complete = { status: 'active', ...completeProcessor() };
    for (const missing of ['offeringId', 'clientCoverage', 'processingCategories'] as const) {
      const { [missing]: _left, ...incomplete } = complete;
      await expectViolation('processing_activity_active_processor', () =>
        insertActivity(aProcessor(incomplete)),
      );
    }
    await expect(insertActivity(aProcessor(complete))).resolves.toBeDefined();
  });

  it('processing_activity_active_started needs a start date once an activity has been live', async () => {
    const { startedAt: _startedAt, ...unstarted } = completeProcessor();
    await expectViolation('processing_activity_active_started', () =>
      insertActivity(aProcessor({ status: 'active', ...unstarted })),
    );
    await expectViolation('processing_activity_active_started', () =>
      insertActivity(aProcessor({ status: 'retired', ...unstarted })),
    );
  });

  it('refuses to delete a retired activity that a newer one supersedes', async () => {
    const c4 = await insertActivity(
      aController({ code: 'C4', status: 'retired', startedAt: '2026-02-10' }),
    );
    await insertActivity(aProcessor({ code: 'P4', supersedesId: c4 }));
    await expectViolation('processing_activity_supersedes_id_processing_activity_id_fk', () =>
      db().sql.query(`DELETE FROM processing_activity WHERE id = $1`, [c4]),
    );
  });

  it('refuses to delete an offering that an activity still names (409 in the API)', async () => {
    await insertActivity(aProcessor({ offeringId: world.ats }));
    // Aurelia's agreement names the offering too, and would refuse first.
    await db().sql.query(`DELETE FROM agreement WHERE id = $1`, [world.aureliaDpa]);
    await expectViolation('processing_activity_offering_id_offering_id_fk', () =>
      db().sql.query(`DELETE FROM offering WHERE id = $1`, [world.ats]),
    );
  });
});

describe('forbid_immutable_change on processing_activity', () => {
  it('refuses to change a saved role: a role change is a new activity (DM §3.0)', async () => {
    const id = await insertActivity(aController({ code: 'C4' }));
    await expectRaise(/processing_activity\.role is immutable/, () =>
      db().sql.query(`UPDATE processing_activity SET role = 'processor' WHERE id = $1`, [id]),
    );
  });

  it('refuses to change a code, which may already be in a contract annex', async () => {
    const id = await insertActivity(aController());
    await expectRaise(/processing_activity\.code is immutable/, () =>
      db().sql.query(`UPDATE processing_activity SET code = 'C2' WHERE id = $1`, [id]),
    );
  });

  it('lets every other column change, including a no-op write of the same role', async () => {
    const id = await insertActivity(aController());
    await expect(
      db().sql.query(
        `UPDATE processing_activity SET name = 'Hiring', role = 'controller', version = 2 WHERE id = $1`,
        [id],
      ),
    ).resolves.toBeDefined();
  });
});

describe('retention_rule', () => {
  /**
   * The same values `primitives.test.ts` holds `IsoDuration` to. Each one is
   * checked against both, so the API and Postgres cannot disagree about a
   * retention period without this failing.
   */
  const ACCEPTED = ['P90D', 'P7Y', 'P6M', 'P2W', 'P1Y6M', 'P1Y2M3W4D', 'P1Y2W', 'P0D'];
  const REJECTED = [
    'PT12H',
    'PT30M',
    'P1DT12H',
    'P',
    'P1.5Y',
    'P6M1Y',
    'P1D1D',
    'p90d',
    '-P1D',
    '90D',
    '7 years',
    '',
  ];

  const aRule = (activityId: string, overrides: Record<string, unknown> = {}) =>
    insert('retention_rule', {
      activityId,
      retentionPeriod: 'P90D',
      triggerEvent: 'after contract end',
      ...overrides,
    });

  it('retention_rule_period accepts exactly what IsoDuration accepts', async () => {
    const activity = await insertActivity(aController());
    for (const retentionPeriod of ACCEPTED) {
      expect(IsoDuration.safeParse(retentionPeriod).success, retentionPeriod).toBe(true);
      await db().sql.query(`SAVEPOINT period`);
      await expect(aRule(activity, { retentionPeriod })).resolves.toBeDefined();
      await db().sql.query(`ROLLBACK TO SAVEPOINT period`);
    }
  });

  it('retention_rule_period rejects exactly what IsoDuration rejects', async () => {
    const activity = await insertActivity(aController());
    for (const retentionPeriod of REJECTED) {
      expect(IsoDuration.safeParse(retentionPeriod).success, retentionPeriod).toBe(false);
      await expectViolation('retention_rule_period', () => aRule(activity, { retentionPeriod }));
    }
  });

  it('retention_rule_one_per_category allows one rule per data category', async () => {
    const activity = await insertActivity(aController());
    await aRule(activity, { dataCategoryId: world.billing, retentionPeriod: 'P7Y' });
    await expectViolation('retention_rule_one_per_category', () =>
      aRule(activity, { dataCategoryId: world.billing }),
    );
    await expect(aRule(activity, { dataCategoryId: world.identity })).resolves.toBeDefined();
  });

  it('retention_rule_one_per_category allows one default rule, because NULLs are not distinct', async () => {
    const activity = await insertActivity(aController());
    await aRule(activity);
    await expectViolation('retention_rule_one_per_category', () => aRule(activity));
  });
});

describe('activity_client_scope', () => {
  const aScope = (activityId: string, overrides: Record<string, unknown> = {}) =>
    insert('activity_client_scope', {
      activityId,
      clientPartyId: world.aurelia,
      mode: 'exclude',
      reason: 'Client objected (Aurelia DPA, specific authorization)',
      agreementId: world.aureliaDpa,
      startedAt: '2026-04-14',
      ...overrides,
    });

  it('activity_client_scope_mode rejects a mode outside include and exclude', async () => {
    const activity = await insertActivity(aProcessor());
    await expectViolation('activity_client_scope_mode', () => aScope(activity, { mode: 'only' }));
  });

  it('activity_client_scope_dates rejects a scope that ends before it starts', async () => {
    const activity = await insertActivity(aProcessor());
    await expectViolation('activity_client_scope_dates', () =>
      aScope(activity, { endedAt: '2026-04-01' }),
    );
  });

  it('activity_client_scope_one_active allows one open row per client, and history beside it', async () => {
    const activity = await insertActivity(aProcessor());
    await aScope(activity, { startedAt: '2026-03-16', endedAt: '2026-04-01' });
    await aScope(activity);
    await expectViolation('activity_client_scope_one_active', () =>
      aScope(activity, { startedAt: '2026-05-01' }),
    );
  });
});

describe('engagement, transfer and engagement_client_scope', () => {
  it('engagement_role rejects a role outside the enum', async () => {
    const activity = await insertActivity(aProcessor());
    await expectViolation('engagement_role', () => anEngagement(activity, { role: 'owner' }));
  });

  it('engagement_processing_countries needs at least one country', async () => {
    const activity = await insertActivity(aProcessor());
    await expectViolation('engagement_processing_countries', () =>
      anEngagement(activity, { processingCountries: [] }),
    );
  });

  it('refuses to delete a party that an engagement still names (409 in the API)', async () => {
    const activity = await insertActivity(aProcessor());
    await anEngagement(activity);
    await expectViolation('engagement_party_id_party_id_fk', () =>
      db().sql.query(`DELETE FROM party WHERE id = $1`, [world.mailcrest]),
    );
  });

  it('transfer_destination_country and transfer_mechanism reject malformed values', async () => {
    const activity = await insertActivity(aProcessor());
    const engagementId = await anEngagement(activity);
    await expectViolation('transfer_destination_country', () =>
      insert('transfer', { engagementId, destinationCountry: 'USA', mechanism: 'dpf' }),
    );
    await expectViolation('transfer_mechanism', () =>
      insert('transfer', { engagementId, destinationCountry: 'US', mechanism: 'handshake' }),
    );
  });

  it('engagement_client_scope_mode rejects a mode outside include and exclude', async () => {
    const activity = await insertActivity(aProcessor());
    const engagementId = await anEngagement(activity);
    await expectViolation('engagement_client_scope_mode', () =>
      insert('engagement_client_scope', {
        engagementId,
        clientPartyId: world.aurelia,
        mode: 'only',
        reason: 'EU data region',
      }),
    );
  });

  it('engagement_client_scope_once lists a client once per engagement', async () => {
    const activity = await insertActivity(aProcessor());
    const engagementId = await anEngagement(activity);
    const scope = {
      engagementId,
      clientPartyId: world.aurelia,
      mode: 'exclude',
      reason: 'EU-only processing (Aurelia DPA)',
    };
    await insert('engagement_client_scope', scope);
    await expectViolation('engagement_client_scope_once', () =>
      insert('engagement_client_scope', scope),
    );
  });
});

describe('link tables', () => {
  it('link each record once per activity or engagement', async () => {
    const activityId = await insertActivity(aProcessor());
    const engagementId = await anEngagement(activityId);
    const links = [
      ['activity_subject_category', { activityId, subjectCategoryId: world.candidates }],
      ['activity_data_category', { activityId, dataCategoryId: world.identity }],
      ['activity_system', { activityId, systemId: world.hireloopApp }],
      ['activity_security_measure', { activityId, securityMeasureId: world.encryption }],
      ['engagement_data_category', { engagementId, dataCategoryId: world.identity }],
    ] as const;

    for (const [table, values] of links) {
      await link(table, values);
      await expectViolation(`${table}_pkey`, () => link(table, values));
    }
  });

  it('refuses to delete a data category an activity still uses (409 in the API)', async () => {
    const activityId = await insertActivity(aProcessor());
    await link('activity_data_category', { activityId, dataCategoryId: world.identity });
    await expectViolation('activity_data_category_data_category_id_data_category_id_fk', () =>
      db().sql.query(`DELETE FROM data_category WHERE id = $1`, [world.identity]),
    );
  });
});

describe('the activity aggregate', () => {
  it('deletes as a whole: every nested row and link goes with the activity (§3)', async () => {
    const activityId = await insertActivity(aProcessor());
    const engagementId = await anEngagement(activityId);
    await insert('transfer', { engagementId, destinationCountry: 'US', mechanism: 'dpf' });
    await insert('engagement_client_scope', {
      engagementId,
      clientPartyId: world.aurelia,
      mode: 'exclude',
      reason: 'EU-only processing (Aurelia DPA)',
    });
    await insert('activity_client_scope', {
      activityId,
      clientPartyId: world.aurelia,
      mode: 'exclude',
      startedAt: '2026-04-14',
    });
    await link('activity_data_category', { activityId, dataCategoryId: world.identity });
    await link('engagement_data_category', { engagementId, dataCategoryId: world.identity });

    await db().sql.query(`DELETE FROM processing_activity WHERE id = $1`, [activityId]);

    const { rows } = await db().sql.query<{ left: string }>(
      `SELECT (SELECT count(*) FROM engagement WHERE activity_id = $1)
            + (SELECT count(*) FROM transfer WHERE engagement_id = $2)
            + (SELECT count(*) FROM engagement_client_scope WHERE engagement_id = $2)
            + (SELECT count(*) FROM engagement_data_category WHERE engagement_id = $2)
            + (SELECT count(*) FROM activity_client_scope WHERE activity_id = $1)
            + (SELECT count(*) FROM activity_data_category WHERE activity_id = $1) AS left`,
      [activityId, engagementId],
    );
    expect(Number(rows[0]?.left)).toBe(0);
  });

  it('maintains updated_at on every editable table of the aggregate', async () => {
    const { rows } = await db().sql.query<{ table: string }>(
      `SELECT event_object_table AS table FROM information_schema.triggers
       WHERE trigger_name LIKE '%_set_updated_at' AND event_manipulation = 'UPDATE'
       ORDER BY 1`,
    );
    const tables = rows.map((row) => row.table);
    for (const table of [
      'processing_activity',
      'retention_rule',
      'activity_client_scope',
      'engagement',
      'transfer',
      'engagement_client_scope',
    ]) {
      expect(tables).toContain(table);
    }
  });

  it('has the indexes the views and the RESTRICT checks read through (§4.4)', async () => {
    const { rows } = await db().sql.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const indexes = rows.map((row) => row.indexname);
    for (const index of [
      'processing_activity_offering',
      'processing_activity_status',
      'activity_subject_category_rev',
      'activity_data_category_rev',
      'activity_system_rev',
      'activity_security_measure_rev',
      'activity_client_scope_client',
      'engagement_activity',
      'engagement_party',
      'transfer_engagement',
      'engagement_client_scope_client',
    ]) {
      expect(indexes).toContain(index);
    }
  });
});
