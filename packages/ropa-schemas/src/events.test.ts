import { describe, expect, it } from 'vitest';

import { EventEnvelope } from './events.ts';

/**
 * The envelope every consumer of RoPA's events receives (`ropa-api.md` §6).
 * Only the frame is a contract so far; each event's `data` is checked by its
 * consumer (step 4, Phase 5 question 3).
 */

const p3Created = {
  id: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
  type: 'record.changed',
  source: 'ropa',
  occurredAt: '2026-04-14T10:02:11.000Z',
  data: {
    entityType: 'activity',
    entity: { id: '0199c3a1-8f2e-7c4d-b8e1-000000000001', code: 'P3', name: 'CV parsing' },
    version: 1,
    changeType: 'created',
    actor: 'priya.raman',
    changeNote: 'Added Scribe AI for CV parsing',
    validFrom: '2026-04-14T10:02:11.000Z',
  },
};

describe('EventEnvelope', () => {
  it('reads §6’s example, data untouched', () => {
    expect(EventEnvelope.parse(p3Created)).toEqual(p3Created);
  });

  it('takes every event type', () => {
    for (const type of ['record.changed', 'subprocessors.changed', 'review_item.changed']) {
      expect(EventEnvelope.safeParse({ ...p3Created, type }).success, type).toBe(true);
    }
  });

  it('needs an id to deduplicate by', () => {
    expect(EventEnvelope.safeParse({ ...p3Created, id: undefined }).success).toBe(false);
    expect(EventEnvelope.safeParse({ ...p3Created, id: 'e7c2' }).success).toBe(false);
  });

  it('refuses an event type RoPA does not send', () => {
    expect(EventEnvelope.safeParse({ ...p3Created, type: 'record.deleted' }).success).toBe(false);
  });

  it('is from RoPA', () => {
    expect(EventEnvelope.safeParse({ ...p3Created, source: 'monitor' }).success).toBe(false);
  });

  it('says when it happened, as a timestamp', () => {
    expect(EventEnvelope.safeParse({ ...p3Created, occurredAt: '2026-04-14' }).success).toBe(false);
  });

  it('carries its data as an object', () => {
    for (const data of [undefined, null, 'P3', ['P3']]) {
      expect(EventEnvelope.safeParse({ ...p3Created, data }).success, String(data)).toBe(false);
    }
  });
});
