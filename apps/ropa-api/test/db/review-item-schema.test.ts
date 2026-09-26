import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { eventOutbox } from '../../src/db/schema/index.js';
import { expectRaise, expectViolation, useDatabase } from './harness.js';

/**
 * One test per named constraint on `review_item` (`ropa-database.md` §4.5,
 * §4.6), proving each rejects bad data. Raw SQL, because the rows worth
 * rejecting are ones TypeScript would never let us write.
 */
const db = useDatabase();

function toSnakeCase(name: string): string {
  return name.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

async function insert(table: string, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_column, index) => `$${index + 1}`);
  const { rows } = await db().sql.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.map(toSnakeCase).join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING id`,
    Object.values(values),
  );
  return rows[0]!.id;
}

/** The three kinds of record an item can point at, created fresh for every test. */
let mailcrest: string;
let cvParser: string;
let p1: string;

beforeEach(async () => {
  mailcrest = await insert('party', {
    slug: 'ris-mailcrest',
    kind: 'vendor',
    legalName: 'Mailcrest Inc.',
    country: 'US',
  });
  // Hosted by someone else, so deleting Mailcrest meets only the review item.
  const render = await insert('party', {
    slug: 'ris-render',
    kind: 'vendor',
    legalName: 'Render Inc.',
    country: 'US',
  });
  cvParser = await insert('system', {
    slug: 'ris-cv-parser',
    name: 'CV parser',
    kind: 'render_worker',
    region: 'frankfurt',
    hostingPartyId: render,
  });
  p1 = await insert('processing_activity', {
    code: 'P901',
    name: 'Candidate application management',
    role: 'processor',
    owner: 'Priya Raman',
  });
});

/** The Monitor's Ch6 item, open, to be spoiled one field at a time. */
function anItem(overrides: Record<string, unknown> = {}) {
  return {
    code: 'RI-901',
    targetPartyId: mailcrest,
    source: 'monitor',
    reason: 'vendor_subprocessor_added',
    openedBy: 'svc:monitor',
    ...overrides,
  };
}

/** What closing adds: a decision, who took it and when. */
function closed(status: 'resolved' | 'dismissed' = 'resolved') {
  return {
    status,
    resolutionNote: 'Mailcrest keeps Helpdesk Partners out of the EU region',
    closedBy: 'priya.raman',
    closedAt: '2026-06-10T09:00:00Z',
  };
}

const insertItem = (values: Record<string, unknown>) => insert('review_item', values);

describe('review_item', () => {
  it('accepts an open item on a party, a system or an activity', async () => {
    await expect(insertItem(anItem())).resolves.toBeDefined();
    await expect(
      insertItem(
        anItem({
          code: 'RI-902',
          targetPartyId: null,
          targetSystemId: cvParser,
          source: 'snapshot',
          reason: 'unmapped_system',
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      insertItem(
        anItem({
          code: 'RI-903',
          targetPartyId: null,
          targetActivityId: p1,
          reason: 'region_violation',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('starts open, with nothing about its closing', async () => {
    const id = await insertItem(anItem());
    const { rows } = await db().sql.query(
      `SELECT status, resolution_note, closed_by, closed_at FROM review_item WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      status: 'open',
      resolution_note: null,
      closed_by: null,
      closed_at: null,
    });
  });

  it('keeps details and deadlines as JSON', async () => {
    const id = await insertItem(
      anItem({
        details: JSON.stringify({ added: ['Helpdesk Partners Pvt Ltd'] }),
        deadlines: JSON.stringify({ vendorEffective: '2026-07-03' }),
        dueAt: '2026-07-03',
      }),
    );
    const { rows } = await db().sql.query(
      `SELECT details, deadlines FROM review_item WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      details: { added: ['Helpdesk Partners Pvt Ltd'] },
      deadlines: { vendorEffective: '2026-07-03' },
    });
  });

  it('review_item_one_target refuses an item about nothing', async () => {
    await expectViolation('review_item_one_target', () =>
      insertItem(anItem({ targetPartyId: null })),
    );
  });

  it('review_item_one_target refuses an item about two things at once', async () => {
    await expectViolation('review_item_one_target', () =>
      insertItem(anItem({ targetSystemId: cvParser })),
    );
  });

  it('review_item_code refuses anything but RI-n', async () => {
    for (const code of ['RI42', 'P3', 'RI-0', 'RI-07', 'ri-1']) {
      await expectViolation('review_item_code', () => insertItem(anItem({ code })));
    }
  });

  it('review_item_code_unique refuses a code already taken', async () => {
    await insertItem(anItem());
    await expectViolation('review_item_code_unique', () => insertItem(anItem()));
  });

  it('review_item_source, _reason and _status refuse values outside the shared lists', async () => {
    await expectViolation('review_item_source', () => insertItem(anItem({ source: 'email' })));
    await expectViolation('review_item_reason', () => insertItem(anItem({ reason: 'hunch' })));
    // Closed in every other respect, so review_item_closed (checked first,
    // alphabetically) passes and the status is what fails.
    await expectViolation('review_item_status', () =>
      insertItem(anItem({ ...closed(), status: 'closed' })),
    );
  });

  it('review_item_reason accepts every coverage finding, external_saas_mismatch included', async () => {
    await expect(
      insertItem(
        anItem({ reason: 'external_saas_mismatch', targetPartyId: null, targetActivityId: p1 }),
      ),
    ).resolves.toBeDefined();
  });

  it('review_item_resolution refuses a closed item that says nothing about why', async () => {
    await expectViolation('review_item_resolution', () =>
      insertItem(anItem({ ...closed(), resolutionNote: null })),
    );
  });

  it('review_item_closed refuses a closed item without who closed it and when', async () => {
    await expectViolation('review_item_closed', () =>
      insertItem(anItem({ ...closed(), closedBy: null })),
    );
    await expectViolation('review_item_closed', () =>
      insertItem(anItem({ ...closed('dismissed'), closedAt: null })),
    );
  });

  it('review_item_closed refuses an open item that claims to have been closed', async () => {
    await expectViolation('review_item_closed', () =>
      insertItem(anItem({ closedBy: 'priya.raman', closedAt: '2026-06-10T09:00:00Z' })),
    );
  });

  it('accepts a resolved item and a dismissed one', async () => {
    await expect(insertItem(anItem(closed('resolved')))).resolves.toBeDefined();
    await expect(
      insertItem(anItem({ code: 'RI-902', ...closed('dismissed') })),
    ).resolves.toBeDefined();
  });

  it('keeps its target: a party with a review item cannot be deleted (409 in the API)', async () => {
    await insertItem(anItem());
    await expectViolation('review_item_target_party_id_party_id_fk', () =>
      db().sql.query(`DELETE FROM party WHERE id = $1`, [mailcrest]),
    );
  });
});

describe('forbid_immutable_change on review_item', () => {
  it('refuses to change a code, which people quote in email and tickets', async () => {
    const id = await insertItem(anItem());
    await expectRaise(/review_item\.code is immutable/, () =>
      db().sql.query(`UPDATE review_item SET code = 'RI-999' WHERE id = $1`, [id]),
    );
  });

  it('lets it be closed', async () => {
    const id = await insertItem(anItem());
    await expect(
      db().sql.query(
        `UPDATE review_item SET status = 'resolved', resolution_note = 'Done',
           closed_by = 'priya.raman', closed_at = now() WHERE id = $1`,
        [id],
      ),
    ).resolves.toBeDefined();
  });
});

describe('set_updated_at on review_item', () => {
  it('ignores an updated_at the caller sets by hand', async () => {
    const id = await insertItem(anItem());
    const { rows } = await db().sql.query<{ updated_at: Date }>(
      `UPDATE review_item SET due_at = '2026-07-03', updated_at = '1999-01-01T00:00:00Z'
       WHERE id = $1 RETURNING updated_at`,
      [id],
    );
    expect(rows[0]!.updated_at.getUTCFullYear()).toBeGreaterThan(2000);
  });
});

describe('event_outbox', () => {
  it('takes review_item.changed, with no revision behind it (step 3, Q1)', async () => {
    const eventId = '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e';
    await expect(
      db()
        .db.insert(eventOutbox)
        .values({
          eventId,
          eventType: 'review_item.changed',
          destination: 'audit-log',
          payload: { type: 'review_item.changed' },
        }),
    ).resolves.toBeDefined();

    const [row] = await db().db.select().from(eventOutbox).where(eq(eventOutbox.eventId, eventId));
    expect(row?.revisionId).toBeNull();
  });

  it('event_outbox_event_type still refuses an event nobody defined', async () => {
    await expectViolation('event_outbox_event_type', () =>
      db().sql.query(
        `INSERT INTO event_outbox (event_id, event_type, destination, payload)
         VALUES (uuidv7(), 'review_item.deleted', 'audit-log', '{}')`,
      ),
    );
  });
});
