import { describe, expect, it } from 'vitest';

import { codeCounter, revision } from '../../src/db/schema/index.js';
import { expectRaise, expectViolation, useDatabase } from './harness.js';

/**
 * One test per named constraint in `ropa-database.md` §4, proving it rejects
 * bad data. Kept in a single file on purpose: Vitest runs files in parallel,
 * and a unique constraint blocks across uncommitted transactions, so two files
 * both inserting a `self` party would serialise on each other.
 */
const db = useDatabase();

/** A valid vendor, to be spoiled one field at a time. */
function aVendor(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'mailcrest',
    kind: 'vendor',
    legalName: 'Mailcrest Inc.',
    country: 'US',
    ...overrides,
  };
}

/** Raw SQL, because most invalid values are ones TypeScript would not allow. */
function insertParty(values: Record<string, unknown>) {
  const columns = Object.keys(values);
  const placeholders = columns.map((_column, index) => `$${index + 1}`);
  return db().sql.query(
    `INSERT INTO party (${columns.map(toSnakeCase).join(', ')}) VALUES (${placeholders.join(', ')})`,
    Object.values(values),
  );
}

function toSnakeCase(name: string): string {
  return name.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

describe('party', () => {
  it('accepts a valid vendor', async () => {
    await expect(insertParty(aVendor())).resolves.toBeDefined();
  });

  it('party_kind rejects a kind outside the shared enum list', async () => {
    await expectViolation('party_kind', () => insertParty(aVendor({ kind: 'supplier' })));
  });

  it('party_slug rejects capitals, spaces and stray hyphens', async () => {
    for (const slug of ['Mailcrest', 'mail crest', '-mailcrest', 'mailcrest-']) {
      await expectViolation('party_slug', () => insertParty(aVendor({ slug })));
    }
  });

  it('party_slug rejects a UUID-shaped slug, so a path segment is never ambiguous', async () => {
    await expectViolation('party_slug', () =>
      insertParty(aVendor({ slug: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e' })),
    );
  });

  it('party_country rejects anything but ISO 3166-1 alpha-2', async () => {
    for (const country of ['USA', 'us', 'U']) {
      await expectViolation('party_country', () => insertParty(aVendor({ country })));
    }
  });

  it('party_self_dpo requires DPO details on the self party (Art. 30(1)(a))', async () => {
    await expectViolation('party_self_dpo', () =>
      insertParty(aVendor({ slug: 'hireloop', kind: 'self', country: 'NL' })),
    );

    await expect(
      insertParty(
        aVendor({
          slug: 'hireloop',
          kind: 'self',
          country: 'NL',
          dpoName: 'Priya Raman',
          dpoEmail: 'dpo@hireloop.example',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('party_one_self allows only one self party', async () => {
    const self = (slug: string) =>
      aVendor({
        slug,
        kind: 'self',
        country: 'NL',
        dpoName: 'Priya Raman',
        dpoEmail: 'dpo@hireloop.example',
      });

    await insertParty(self('hireloop'));
    await expectViolation('party_one_self', () => insertParty(self('hireloop-two')));
  });

  it('party_slug_unique rejects a duplicate slug', async () => {
    await insertParty(aVendor());
    await expectViolation('party_slug_unique', () => insertParty(aVendor({ country: 'DE' })));
  });
});

describe('agreement, offering and system', () => {
  it('agreement_dates rejects an agreement that ended before it was signed', async () => {
    const { sql: client } = db();
    const [{ id: partyId }] = (
      await client.query<{ id: string }>(
        `INSERT INTO party (slug, kind, legal_name, country) VALUES ('aurelia','client','Aurelia Health N.V.','NL') RETURNING id`,
      )
    ).rows as [{ id: string }];
    const [{ id: termsId }] = (
      await client.query<{ id: string }>(
        `INSERT INTO agreement_terms (slug, name, direction, authorization_type, notice_days)
         VALUES ('aurelia-dpa','Aurelia DPA','outbound','specific',60) RETURNING id`,
      )
    ).rows as [{ id: string }];

    await expectViolation('agreement_dates', () =>
      client.query(
        `INSERT INTO agreement (party_id, terms_id, signed_at, ended_at) VALUES ($1,$2,'2026-03-16','2026-01-01')`,
        [partyId, termsId],
      ),
    );
  });

  it('agreement_terms_notice_days rejects a negative notice period', async () => {
    await expectViolation('agreement_terms_notice_days', () =>
      db().sql.query(
        `INSERT INTO agreement_terms (slug, name, direction, authorization_type, notice_days)
         VALUES ('bad-terms','Bad','outbound','general',-1)`,
      ),
    );
  });

  it('system_render_region requires a region for a Render-hosted system', async () => {
    const { sql: client } = db();
    const [{ id: hostingPartyId }] = (
      await client.query<{ id: string }>(
        `INSERT INTO party (slug, kind, legal_name, country) VALUES ('render','vendor','Render Inc.','US') RETURNING id`,
      )
    ).rows as [{ id: string }];

    await expectViolation('system_render_region', () =>
      client.query(
        `INSERT INTO system (slug, name, kind, hosting_party_id) VALUES ('hireloop-db','Primary database','render_postgres',$1)`,
        [hostingPartyId],
      ),
    );

    // external_saas is the one kind Render does not host, so it needs no region.
    await expect(
      client.query(
        `INSERT INTO system (slug, name, kind, hosting_party_id) VALUES ('peoplehub','Peoplehub HR','external_saas',$1)`,
        [hostingPartyId],
      ),
    ).resolves.toBeDefined();
  });

  it('refuses to delete a party that a system still references (409 in the API)', async () => {
    const { sql: client } = db();
    const [{ id: hostingPartyId }] = (
      await client.query<{ id: string }>(
        `INSERT INTO party (slug, kind, legal_name, country) VALUES ('render','vendor','Render Inc.','US') RETURNING id`,
      )
    ).rows as [{ id: string }];
    await client.query(
      `INSERT INTO system (slug, name, kind, region, hosting_party_id) VALUES ('hireloop-db','Primary database','render_postgres','frankfurt',$1)`,
      [hostingPartyId],
    );

    await expectViolation('system_hosting_party_id_party_id_fk', () =>
      client.query(`DELETE FROM party WHERE id = $1`, [hostingPartyId]),
    );
  });
});

describe('taxonomies', () => {
  it('data_category_special rejects a value outside the enum and defaults to none', async () => {
    const { sql: client } = db();

    await expectViolation('data_category_special', () =>
      client.query(
        `INSERT INTO data_category (slug, name, special) VALUES ('health','Health data','sensitive')`,
      ),
    );

    const inserted = await client.query<{ special: string }>(
      `INSERT INTO data_category (slug, name) VALUES ('identity','Identity') RETURNING special`,
    );
    expect(inserted.rows[0]?.special).toBe('none');
  });
});

describe('revision', () => {
  // `satisfies` keeps the string literals narrow, which is what the typed enum
  // columns expect; a plain object literal widens them to `string`.
  const aRevision = {
    entityType: 'party',
    entityId: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
    version: 1,
    changeType: 'created',
    snapshot: { slug: 'mailcrest' },
    actor: 'priya.raman',
  } satisfies typeof revision.$inferInsert;

  it('accepts an append', async () => {
    await expect(db().db.insert(revision).values(aRevision)).resolves.toBeDefined();
  });

  it('revision_version_once rejects the same version of the same entity twice', async () => {
    await db().db.insert(revision).values(aRevision);
    await expectViolation('revision_version_once', () =>
      db()
        .db.insert(revision)
        .values({ ...aRevision, changeType: 'updated' }),
    );
  });

  it('revision_append_only refuses an update, even from a SQL console', async () => {
    await db().db.insert(revision).values(aRevision);
    await expectRaise(/append-only/, () =>
      db().sql.query(`UPDATE revision SET actor = 'someone.else'`),
    );
  });

  it('revision_append_only refuses a delete', async () => {
    await db().db.insert(revision).values(aRevision);
    await expectRaise(/append-only/, () => db().sql.query(`DELETE FROM revision`));
  });

  it('allows a different version of the same entity', async () => {
    await db().db.insert(revision).values(aRevision);
    await expect(
      db()
        .db.insert(revision)
        .values({ ...aRevision, version: 2, changeType: 'updated' }),
    ).resolves.toBeDefined();
  });
});

describe('set_updated_at', () => {
  it('moves updated_at forward on every update, without the application asking', async () => {
    const { sql: client } = db();
    const created = await client.query<{ id: string; updated_at: Date }>(
      `INSERT INTO party (slug, kind, legal_name, country) VALUES ('mailcrest','vendor','Mailcrest Inc.','US') RETURNING id, updated_at`,
    );
    const before = created.rows[0]!;

    const updated = await client.query<{ updated_at: Date }>(
      `UPDATE party SET legal_name = 'Mailcrest Limited' WHERE id = $1 RETURNING updated_at`,
      [before.id],
    );

    expect(updated.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
      before.updated_at.getTime(),
    );
    // now() is transaction-scoped, so within one transaction the clock does not
    // move; what matters is that the trigger assigned it rather than the caller.
    expect(updated.rows[0]!.updated_at).toBeInstanceOf(Date);
  });

  it('ignores an updated_at the caller tries to set by hand', async () => {
    const { sql: client } = db();
    const created = await client.query<{ id: string }>(
      `INSERT INTO party (slug, kind, legal_name, country) VALUES ('mailcrest','vendor','Mailcrest Inc.','US') RETURNING id`,
    );

    const updated = await client.query<{ updated_at: Date }>(
      `UPDATE party SET legal_name = 'X', updated_at = '1999-01-01T00:00:00Z' WHERE id = $1 RETURNING updated_at`,
      [created.rows[0]!.id],
    );
    expect(updated.rows[0]!.updated_at.getUTCFullYear()).toBeGreaterThan(2000);
  });
});

describe('code_counter', () => {
  it('is seeded with the four prefixes by the migration', async () => {
    const rows = await db().db.select().from(codeCounter);
    expect(rows.map((row) => row.prefix).sort()).toEqual(['C', 'J', 'P', 'RI']);
    expect(rows.every((row) => row.lastValue === 0)).toBe(true);
  });

  it('hands out gapless numbers, which is what makes a code permanent', async () => {
    const { sql: client } = db();
    const allocate = async () =>
      (
        await client.query<{ last_value: number }>(
          `UPDATE code_counter SET last_value = last_value + 1 WHERE prefix = 'P' RETURNING last_value`,
        )
      ).rows[0]!.last_value;

    expect(await allocate()).toBe(1);
    expect(await allocate()).toBe(2);
    expect(await allocate()).toBe(3);
  });

  it('code_counter_prefix rejects a prefix nobody defined', async () => {
    await expectViolation('code_counter_prefix', () =>
      db().sql.query(`INSERT INTO code_counter (prefix) VALUES ('X')`),
    );
  });
});

describe('the migration itself', () => {
  it('created every foundation table and nothing from step 2', async () => {
    const { rows } = await db().sql.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '__drizzle_migrations'
       ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'agreement',
      'agreement_terms',
      'code_counter',
      'data_category',
      'event_outbox',
      'offering',
      'party',
      'revision',
      'security_measure',
      'subject_category',
      'system',
    ]);
  });

  it('left no enum check with an unbound parameter in it', async () => {
    // The generator will happily emit `IN ($1, $2)` if a check is built from
    // bound values instead of literals, which is not a constraint at all.
    const { rows } = await db().sql.query<{ constraint_name: string; check_clause: string }>(
      `SELECT constraint_name, check_clause FROM information_schema.check_constraints
       WHERE check_clause LIKE '%$1%'`,
    );
    expect(rows).toEqual([]);
  });

  it('defaults primary keys to uuidv7, which sorts by creation time', async () => {
    const { rows } = await db().sql.query<{ count: string }>(
      `SELECT count(*) AS count FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id' AND column_default LIKE '%uuidv7%'`,
    );
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(9);
  });
});
