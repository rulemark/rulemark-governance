import { ReviewItem, ReviewItemInput } from '@rulemark/ropa-schemas';
import { inArray, like, or, sql } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/api/app.js';
import { recordsRouter } from '../../src/api/resources/index.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { party, processingActivity, reviewItem, system } from '../../src/db/schema/index.js';
import { openReviewItem } from '../../src/domain/review-items.js';
import { loadConfig } from '../../src/shared/config.js';
import { TEST_DATABASE_URL } from './harness.js';

/**
 * Review items (`ropa-api.md` §2 workflow, §1.8), over HTTP against a real
 * database. The router opens its own transaction per write, so these commit:
 * every record this file creates is prefixed `ri-` and removed afterwards,
 * review items first. Codes are spent for good, which is the point of them.
 */
const ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([
    { sub: 'svc:monitor', name: 'Subprocessor Monitor', roles: ['service:monitor'] },
    { sub: 'priya.raman', name: 'Priya Raman', roles: ['editor'] },
    { sub: 'root', name: 'Administrator', roles: ['admin'] },
  ]),
};

const PREFIX = 'ri-';

let db: Database;
let pool: ReturnType<typeof createPool>;
let server: Server;
const tokens = { monitor: '', editor: '', admin: '' };
type Who = keyof typeof tokens | 'anonymous';

/** The activity's code, allocated when the world is seeded. */
let p1Code: string;

async function mint(subject: string): Promise<string> {
  const response = await request(server)
    .post('/v1/tokens')
    .send({ subject, secret: ENV.TOKEN_MINT_SECRET });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

function call(who: Who, method: 'get' | 'post' | 'delete', path: string) {
  const pending = request(server)[method](path);
  return who === 'anonymous' ? pending : pending.set('Authorization', `Bearer ${tokens[who]}`);
}

const ours = () =>
  db
    .select({ id: reviewItem.id })
    .from(reviewItem)
    .where(
      or(
        inArray(
          reviewItem.targetPartyId,
          db
            .select({ id: party.id })
            .from(party)
            .where(like(party.slug, `${PREFIX}%`)),
        ),
        inArray(
          reviewItem.targetSystemId,
          db
            .select({ id: system.id })
            .from(system)
            .where(like(system.slug, `${PREFIX}%`)),
        ),
        inArray(
          reviewItem.targetActivityId,
          db
            .select({ id: processingActivity.id })
            .from(processingActivity)
            .where(like(processingActivity.name, `${PREFIX}%`)),
        ),
      ),
    );

async function cleanup(): Promise<void> {
  // Items first: they RESTRICT their targets, which is tested below.
  await db.delete(reviewItem).where(inArray(reviewItem.id, ours()));
  await db.delete(processingActivity).where(like(processingActivity.name, `${PREFIX}%`));
  await db.delete(system).where(like(system.slug, `${PREFIX}%`));
  await db.delete(party).where(like(party.slug, `${PREFIX}%`));
}

async function seedWorld(): Promise<void> {
  const [render] = await db
    .insert(party)
    .values([
      { slug: `${PREFIX}render`, kind: 'vendor', legalName: 'Render Inc.', country: 'US' },
      { slug: `${PREFIX}mailcrest`, kind: 'vendor', legalName: 'Mailcrest Inc.', country: 'US' },
      { slug: `${PREFIX}glitchlog`, kind: 'vendor', legalName: 'Glitchlog Ltd', country: 'GB' },
    ])
    .returning();
  await db.insert(system).values({
    slug: `${PREFIX}cv-parser`,
    name: 'CV parser',
    kind: 'render_worker',
    region: 'frankfurt',
    hostingPartyId: render!.id,
  });
  const response = await call('admin', 'post', '/v1/activities').send({
    role: 'processor',
    name: `${PREFIX}Candidate application management`,
    owner: 'Priya Raman',
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  p1Code = response.body.code as string;
}

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  db = createDb(pool);
  server = createApp({ config: loadConfig(ENV), router: recordsRouter(db) }).listen(0);
  tokens.monitor = await mint('svc:monitor');
  tokens.editor = await mint('priya.raman');
  tokens.admin = await mint('root');
  await cleanup();
  await seedWorld();
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

/** The Monitor's Ch6 item: Mailcrest added Helpdesk Partners, effective in 30 days. */
function ch6(overrides: Record<string, unknown> = {}) {
  return {
    targetType: 'party',
    target: `${PREFIX}mailcrest`,
    source: 'monitor',
    reason: 'vendor_subprocessor_added',
    details: { added: ['Helpdesk Partners Pvt Ltd'], country: 'IN' },
    deadlines: { vendorEffective: '2026-07-03', clientNotice: [{ client: 'aurelia', days: 60 }] },
    dueAt: '2026-07-03',
    ...overrides,
  };
}

async function open(who: Who = 'monitor', body: Record<string, unknown> = ch6()) {
  const response = await call(who, 'post', '/v1/review-items').send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as ReviewItem;
}

/** The outbox rows about one item, oldest first. */
async function eventsFor(id: string) {
  const { rows } = await pool.query<{
    event_type: string;
    destination: string;
    revision_id: string | null;
    payload: { type: string; occurredAt: string; data: Record<string, unknown> };
  }>(
    `SELECT event_type, destination, revision_id, payload FROM event_outbox
     WHERE payload->'data'->'reviewItem'->>'id' = $1 ORDER BY id`,
    [id],
  );
  return rows;
}

/** The history rows about one item, oldest first (step 4, open question 3). */
async function historyOf(id: string) {
  const { rows } = await pool.query<{
    event_id: string;
    change_type: string;
    occurred_at: Date;
    actor: string;
    review_item: ReviewItem;
  }>(
    `SELECT event_id, change_type, occurred_at, actor, review_item FROM review_item_event
     WHERE review_item_id = $1 ORDER BY occurred_at, id`,
    [id],
  );
  return rows;
}

const codeNumber = (code: string) => Number(code.replace('RI-', ''));

describe('POST /review-items', () => {
  it('opens the Monitor’s Ch6 item, with a code and the Monitor as its opener', async () => {
    const response = await call('monitor', 'post', '/v1/review-items').send(ch6());

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const item = ReviewItem.parse(response.body);
    expect(item.code).toMatch(/^RI-[1-9][0-9]*$/);
    expect(response.headers['location']).toBe(`/v1/review-items/${item.code}`);
    expect(item).toMatchObject({
      targetType: 'party',
      target: { slug: `${PREFIX}mailcrest`, name: 'Mailcrest Inc.' },
      source: 'monitor',
      reason: 'vendor_subprocessor_added',
      details: { added: ['Helpdesk Partners Pvt Ltd'], country: 'IN' },
      dueAt: '2026-07-03',
      status: 'open',
      resolutionNote: null,
      openedBy: 'svc:monitor',
      closedBy: null,
      closedAt: null,
    });
  });

  it('sends no ETag: review items are not versioned, and closing is guarded by status (§1.8)', async () => {
    const response = await call('monitor', 'post', '/v1/review-items').send(ch6());
    expect(response.status).toBe(201);
    // Express's own weak ETag (W/"…") is a content hash for caching; what must be
    // absent is a version to send back in If-Match.
    expect(response.headers['etag'] ?? '').not.toMatch(/^"\d+"$/);
    expect(response.body).not.toHaveProperty('version');
  });

  it('hands out consecutive codes', async () => {
    const first = await open();
    const second = await open();
    expect(codeNumber(second.code)).toBe(codeNumber(first.code) + 1);
  });

  it('points at a system by slug and an activity by code', async () => {
    const onSystem = await open(
      'admin',
      ch6({
        targetType: 'system',
        target: `${PREFIX}cv-parser`,
        source: 'snapshot',
        reason: 'unmapped_system',
      }),
    );
    expect(onSystem.target).toMatchObject({ slug: `${PREFIX}cv-parser`, name: 'CV parser' });

    const onActivity = await open(
      'editor',
      ch6({ targetType: 'activity', target: p1Code, source: 'manual', reason: 'region_violation' }),
    );
    expect(onActivity.target).toMatchObject({ code: p1Code });
  });

  it('refuses a target that does not exist, naming the field', async () => {
    const response = await call('monitor', 'post', '/v1/review-items').send(
      ch6({ target: `${PREFIX}nobody` }),
    );
    expect(response.status).toBe(422);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ path: '/target', code: 'unknown_reference' }),
    );
  });

  it('reads the target as the type says: an activity code is no party', async () => {
    const response = await call('monitor', 'post', '/v1/review-items').send(
      ch6({ target: p1Code }),
    );
    expect(response.status).toBe(422);
  });

  it('records the opener from the token, whatever the body claims (§1.6)', async () => {
    const item = await open('monitor', { ...ch6(), openedBy: 'priya.raman', status: 'resolved' });
    expect(item.openedBy).toBe('svc:monitor');
    expect(item.status).toBe('open');
  });

  it('needs a token', async () => {
    const response = await call('anonymous', 'post', '/v1/review-items').send(ch6());
    expect(response.status).toBe(401);
  });

  it('writes a review_item.changed event with the whole item, and no revision (Q1)', async () => {
    const item = await open();
    const events = await eventsFor(item.id);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'review_item.changed',
      destination: 'audit-log',
      revision_id: null,
    });
    expect(events[0]!.payload).toMatchObject({
      type: 'review_item.changed',
      source: 'ropa',
      occurredAt: item.createdAt,
      data: { changeType: 'opened', actor: 'svc:monitor', reviewItem: item },
    });
  });
});

describe('review-item history (step 4, open question 3)', () => {
  it('writes a history row beside the outbox row, sharing its event id', async () => {
    const item = await open();
    const [event] = await eventsFor(item.id);
    const history = await historyOf(item.id);

    expect(history).toEqual([
      {
        event_id: (event!.payload as unknown as { id: string }).id,
        change_type: 'opened',
        occurred_at: new Date(item.createdAt),
        actor: 'svc:monitor',
        review_item: item,
      },
    ]);
  });

  it('writes the close too, and nothing for a refused second close', async () => {
    const item = await open();
    const resolved = await call('editor', 'post', `/v1/review-items/${item.code}/resolve`).send({
      resolutionNote: 'Aurelia told, and the EU region kept',
    });
    await call('editor', 'post', `/v1/review-items/${item.code}/dismiss`).send({
      resolutionNote: 'Too late',
    });

    const history = await historyOf(item.id);
    expect(history.map((row) => [row.change_type, row.actor])).toEqual([
      ['opened', 'svc:monitor'],
      ['resolved', 'priya.raman'],
    ]);
    expect(history[1]).toMatchObject({
      occurred_at: new Date(resolved.body.closedAt as string),
      review_item: resolved.body,
    });
  });

  it('keeps the history even when the event goes to no destination', async () => {
    const item = await db.transaction((tx) =>
      openReviewItem(tx, ReviewItemInput.parse(ch6()), { actor: 'test', destinations: [] }),
    );
    expect(await eventsFor(item.id)).toEqual([]);
    expect((await historyOf(item.id)).map((row) => row.change_type)).toEqual(['opened']);
  });
});

describe('GET /review-items/{ref}', () => {
  it('lets the Monitor read what it opened, by code or by id', async () => {
    const item = await open();

    const byCode = await call('monitor', 'get', `/v1/review-items/${item.code}`);
    expect(byCode.status).toBe(200);
    expect(byCode.body).toEqual(item);

    const byId = await call('monitor', 'get', `/v1/review-items/${item.id}`);
    expect(byId.body).toEqual(item);
  });

  it('is readable without a token, like the rest of the public demo (§1.9)', async () => {
    const item = await open();
    expect((await call('anonymous', 'get', `/v1/review-items/${item.code}`)).status).toBe(200);
  });

  it('answers 404 for a code nobody was given', async () => {
    expect((await call('monitor', 'get', '/v1/review-items/RI-999999')).status).toBe(404);
  });
});

describe('POST /review-items/{ref}/resolve and /dismiss', () => {
  const note = { resolutionNote: 'Mailcrest keeps Helpdesk Partners out of the EU region' };

  it('refuses the Monitor: opening is not deciding (§1.9)', async () => {
    const item = await open();
    const response = await call('monitor', 'post', `/v1/review-items/${item.code}/resolve`).send(
      note,
    );
    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('review:resolve');
  });

  it('lets an editor resolve it, recording who, when and why', async () => {
    const item = await open();
    const response = await call('editor', 'post', `/v1/review-items/${item.code}/resolve`).send(
      note,
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const resolved = ReviewItem.parse(response.body);
    expect(resolved).toMatchObject({
      code: item.code,
      status: 'resolved',
      resolutionNote: note.resolutionNote,
      openedBy: 'svc:monitor',
      closedBy: 'priya.raman',
    });
    expect(resolved.closedAt).not.toBeNull();
  });

  it('dismisses the same way', async () => {
    const item = await open();
    const response = await call('editor', 'post', `/v1/review-items/${item.code}/dismiss`).send({
      resolutionNote: 'Not a real change: Mailcrest renamed an existing entry',
    });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('dismissed');
  });

  it('answers 409 to a second close, resolve or dismiss, and changes nothing (§1.8)', async () => {
    const item = await open();
    await call('editor', 'post', `/v1/review-items/${item.code}/resolve`).send(note);

    const again = await call('editor', 'post', `/v1/review-items/${item.code}/resolve`).send({
      resolutionNote: 'A second opinion',
    });
    expect(again.status).toBe(409);
    expect(again.body.status).toBe(409);

    const dismissed = await call('editor', 'post', `/v1/review-items/${item.code}/dismiss`).send({
      resolutionNote: 'Changed my mind',
    });
    expect(dismissed.status).toBe(409);

    const current = await call('editor', 'get', `/v1/review-items/${item.code}`);
    expect(current.body).toMatchObject({ status: 'resolved', resolutionNote: note.resolutionNote });
  });

  it('lets exactly one of two simultaneous closes win', async () => {
    const item = await open();
    const [first, second] = await Promise.all([
      call('editor', 'post', `/v1/review-items/${item.code}/resolve`).send(note),
      call('editor', 'post', `/v1/review-items/${item.code}/dismiss`).send({
        resolutionNote: 'Dismissed at the same moment',
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
  });

  it('requires a resolution note', async () => {
    const item = await open();
    const response = await call('editor', 'post', `/v1/review-items/${item.code}/resolve`).send({});
    expect(response.status).toBe(422);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ path: '/resolutionNote' }),
    );
  });

  it('answers 404 for an item that does not exist', async () => {
    const response = await call('editor', 'post', '/v1/review-items/RI-999999/resolve').send(note);
    expect(response.status).toBe(404);
  });

  it('writes one resolved event, and none for the refused second close', async () => {
    const item = await open();
    const resolved = await call('editor', 'post', `/v1/review-items/${item.code}/resolve`).send(
      note,
    );
    await call('editor', 'post', `/v1/review-items/${item.code}/dismiss`).send(note);

    const events = await eventsFor(item.id);
    expect(events.map((event) => event.payload.data['changeType'])).toEqual(['opened', 'resolved']);
    expect(events[1]!.payload).toMatchObject({
      occurredAt: resolved.body.closedAt,
      data: { actor: 'priya.raman', reviewItem: resolved.body },
    });
  });
});

describe('GET /review-items', () => {
  /** A small queue of our own, distinguishable from items other tests opened. */
  let queue: { mailcrest: ReviewItem; glitchlog: ReviewItem; cvParser: ReviewItem };

  beforeAll(async () => {
    queue = {
      mailcrest: await open('monitor', ch6({ dueAt: '2026-07-03' })),
      glitchlog: await open(
        'monitor',
        ch6({
          target: `${PREFIX}glitchlog`,
          reason: 'vendor_subprocessor_removed',
          dueAt: '2026-09-01',
        }),
      ),
      cvParser: await open(
        'admin',
        ch6({
          targetType: 'system',
          target: `${PREFIX}cv-parser`,
          source: 'snapshot',
          reason: 'unmapped_system',
          dueAt: undefined,
        }),
      ),
    };
    await call('editor', 'post', `/v1/review-items/${queue.glitchlog.code}/dismiss`).send({
      resolutionNote: 'Glitchlog only reworded its page',
    });
  });

  const codes = (body: { data: ReviewItem[] }) => body.data.map((item) => item.code);
  const list = async (query: string) => {
    const response = await call('monitor', 'get', `/v1/review-items?limit=200&${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return codes(response.body);
  };

  it('filters by target, given its type', async () => {
    const found = await list(`targetType=party&target=${PREFIX}glitchlog`);
    expect(found).toEqual([queue.glitchlog.code]);
  });

  it('refuses a target without its type, because a slug alone is ambiguous', async () => {
    const response = await call('monitor', 'get', `/v1/review-items?target=${PREFIX}mailcrest`);
    expect(response.status).toBe(422);
  });

  it('refuses a target that does not exist', async () => {
    const response = await call(
      'monitor',
      'get',
      `/v1/review-items?targetType=party&target=${PREFIX}nobody`,
    );
    expect(response.status).toBe(422);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ path: '/target', code: 'unknown_reference' }),
    );
  });

  it('filters by target type alone', async () => {
    const found = await list('targetType=system');
    expect(found).toContain(queue.cvParser.code);
    expect(found).not.toContain(queue.mailcrest.code);
  });

  it('filters by status, source and reason', async () => {
    expect(await list('status=dismissed')).toContain(queue.glitchlog.code);
    expect(await list('status=open')).not.toContain(queue.glitchlog.code);
    expect(await list('source=snapshot')).toContain(queue.cvParser.code);
    expect(await list('source=snapshot')).not.toContain(queue.mailcrest.code);
    expect(await list('reason=vendor_subprocessor_removed')).toContain(queue.glitchlog.code);
  });

  it('filters by due date, leaving out items with none', async () => {
    const found = await list('dueBefore=2026-08-01');
    expect(found).toContain(queue.mailcrest.code);
    expect(found).not.toContain(queue.glitchlog.code);
    expect(found).not.toContain(queue.cvParser.code);
  });

  it('refuses a filter value outside the vocabulary', async () => {
    expect((await call('monitor', 'get', '/v1/review-items?status=closed')).status).toBe(422);
  });

  it('pages like every other list (§1.3)', async () => {
    const first = await call('monitor', 'get', '/v1/review-items?limit=1');
    expect(first.body.data).toHaveLength(1);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await call(
      'monitor',
      'get',
      `/v1/review-items?limit=1&cursor=${first.body.nextCursor as string}`,
    );
    expect(second.body.data[0].code).not.toBe(first.body.data[0].code);
  });
});

describe('a review item keeps its target', () => {
  it('stops a party with review items from being deleted (409)', async () => {
    const response = await call('admin', 'get', `/v1/parties/${PREFIX}mailcrest`);
    const deleted = await call('admin', 'delete', `/v1/parties/${PREFIX}mailcrest`).set(
      'If-Match',
      `"${response.body.version as number}"`,
    );
    expect(deleted.status).toBe(409);
    expect(deleted.body.detail).toMatch(/review item/);
  });
});

// Guard the cleanup query itself: if it matched nothing, items would pile up.
describe('the cleanup', () => {
  it('finds the items this file opened', async () => {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewItem)
      .where(inArray(reviewItem.id, ours()));
    expect(rows[0]!.count).toBeGreaterThan(0);
  });
});
