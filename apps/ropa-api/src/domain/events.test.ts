import { EventEnvelope, type ReviewItem } from '@rulemark/ropa-schemas';
import { describe, expect, it } from 'vitest';

import {
  EVENT_ROUTES,
  recordChangedEvent,
  reviewItemChangedEvent,
  subprocessorsChangedEvent,
} from './events.js';

/**
 * What the API writes to the outbox is what its consumers read with the
 * package's `EventEnvelope` (step 4, Phase 5 question 3): a builder that
 * drifted from the contract would be refused by every consumer, and retried
 * forever.
 */

const id = (n: number) => `0199c3a1-8f2e-7c4d-b8e1-${String(n).padStart(12, '0')}`;
const p3 = { id: id(1), code: 'P3', name: 'CV parsing' };

const reviewItem: ReviewItem = {
  id: id(2),
  code: 'RI-1',
  targetType: 'activity',
  target: { id: id(3), code: 'P1', name: 'Hiring platform' },
  source: 'snapshot',
  reason: 'region_violation',
  details: null,
  deadlines: null,
  dueAt: null,
  status: 'resolved',
  resolutionNote: 'Aurelia told; Helpdesk Partners kept out of her EU region',
  openedBy: 'svc:snapshot',
  closedBy: 'priya.raman',
  closedAt: '2026-07-10T09:00:00.000Z',
  createdAt: '2026-07-03T09:00:00.000Z',
  updatedAt: '2026-07-10T09:00:00.000Z',
};

describe('the events the API writes', () => {
  it('record.changed satisfies the envelope', () => {
    const event = recordChangedEvent({
      entityType: 'activity',
      entity: p3,
      version: 1,
      changeType: 'created',
      actor: 'priya.raman',
      changeNote: 'Added Scribe AI for CV parsing',
      validFrom: '2026-04-14T10:02:11.000Z',
    });
    expect(EventEnvelope.parse(event)).toEqual(event);
  });

  it('subprocessors.changed satisfies the envelope', () => {
    const event = subprocessorsChangedEvent(
      {
        offering: { id: id(4), slug: 'ats', name: 'Hireloop ATS' },
        client: null,
        terms: {
          id: id(5),
          slug: 'standard-dpa-v3',
          name: 'Standard DPA v3',
          authorizationType: 'general',
          noticeDays: 30,
        },
        cause: {
          activity: p3,
          version: 1,
          changeType: 'activated',
          actor: 'priya.raman',
          changeNote: null,
        },
        added: [],
        removed: [],
        changed: [],
      },
      '2026-04-14T10:02:11.000Z',
    );
    expect(EventEnvelope.parse(event)).toEqual(event);
  });

  it('review_item.changed satisfies the envelope, opened and closed', () => {
    for (const changeType of ['opened', 'resolved'] as const) {
      const event = reviewItemChangedEvent({ changeType, actor: 'priya.raman', reviewItem });
      expect(EventEnvelope.parse(event), changeType).toEqual(event);
    }
  });
});

describe('EVENT_ROUTES', () => {
  it('routes every event type somewhere', () => {
    for (const [type, destinations] of Object.entries(EVENT_ROUTES)) {
      expect(destinations.length, type).toBeGreaterThan(0);
    }
  });
});
