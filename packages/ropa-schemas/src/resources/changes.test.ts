import { describe, expect, it } from 'vitest';

import { CHANGE_ENTITY_TYPES, REVISION_ENTITY_TYPES } from '../enums.ts';
import { Change, ChangesQuery, ChangesResponse } from './changes.ts';

/** `GET /changes` (`ropa-api.md` §2): what changed across the record, and when. */

const id = (n: number) => `0199c3a1-8f2e-7c4d-b8e1-${String(n).padStart(12, '0')}`;

const p3Created = {
  id: id(1),
  entityType: 'activity',
  entity: { id: id(2), code: 'P3', name: 'CV parsing' },
  version: 1,
  changeType: 'created',
  occurredAt: '2026-04-14T10:00:00.000Z',
  actor: 'priya.raman',
  changeNote: 'AI CV parsing, with Scribe AI',
};

const riResolved = {
  id: id(3),
  entityType: 'review_item',
  entity: { id: id(4), code: 'RI-1', name: 'Region violation on P1' },
  version: null,
  changeType: 'resolved',
  occurredAt: '2026-07-10T09:00:00.000Z',
  actor: 'priya.raman',
  changeNote: 'Aurelia told, and the EU region kept',
};

describe('CHANGE_ENTITY_TYPES', () => {
  it('is every revision entity type, and review items', () => {
    expect(CHANGE_ENTITY_TYPES).toEqual([...REVISION_ENTITY_TYPES, 'review_item']);
  });
});

describe('Change', () => {
  it('reads a revision: a version and a record change type', () => {
    expect(Change.parse(p3Created)).toEqual(p3Created);
  });

  it('reads a review-item event: no version, and an open or close', () => {
    expect(Change.parse(riResolved)).toEqual(riResolved);
  });

  it('keeps each kind to its own change types and versions', () => {
    expect(Change.safeParse({ ...p3Created, changeType: 'resolved' }).success).toBe(false);
    expect(Change.safeParse({ ...p3Created, version: null }).success).toBe(false);
    expect(Change.safeParse({ ...riResolved, changeType: 'updated' }).success).toBe(false);
    expect(Change.safeParse({ ...riResolved, version: 1 }).success).toBe(false);
  });

  it('pages like every list (§1.3)', () => {
    expect(ChangesResponse.parse({ data: [p3Created, riResolved], nextCursor: null }).data).toEqual(
      [p3Created, riResolved],
    );
  });
});

describe('ChangesQuery', () => {
  it('takes a range of dates or timestamps, an entity type, and paging', () => {
    expect(
      ChangesQuery.parse({
        from: '2026-03-01',
        to: '2026-07-03T09:00:00Z',
        entityType: 'review_item',
        limit: '10',
      }),
    ).toEqual({
      from: '2026-03-01',
      to: '2026-07-03T09:00:00Z',
      entityType: 'review_item',
      limit: 10,
    });
  });

  it('needs none of them', () => {
    expect(ChangesQuery.parse({})).toMatchObject({ limit: 50 });
  });

  it('refuses an entity type that has no history', () => {
    expect(ChangesQuery.safeParse({ entityType: 'engagement' }).success).toBe(false);
    expect(ChangesQuery.safeParse({ from: 'March' }).success).toBe(false);
  });
});
