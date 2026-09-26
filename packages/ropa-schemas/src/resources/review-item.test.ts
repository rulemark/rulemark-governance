import { describe, expect, it } from 'vitest';

import { CloseReviewItemInput, ReviewItem, ReviewItemInput, ReviewItemsQuery } from './index.js';

const UUID = '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e';

/** Ch6: the Monitor opens an item against Mailcrest when its list changes. */
const ch6 = {
  targetType: 'party',
  target: 'mailcrest',
  source: 'monitor',
  reason: 'vendor_subprocessor_added',
  details: { added: ['Helpdesk Partners Pvt Ltd'], country: 'IN' },
  deadlines: { vendorEffective: '2026-07-03' },
  dueAt: '2026-07-03',
};

describe('ReviewItemInput', () => {
  it('accepts the Monitor’s Ch6 item', () => {
    expect(ReviewItemInput.safeParse(ch6).success).toBe(true);
  });

  it('needs only a target, a source and a reason', () => {
    const minimal = {
      targetType: 'system',
      target: 'cv-parser',
      source: 'snapshot',
      reason: 'unmapped_system',
    };
    expect(ReviewItemInput.safeParse(minimal).success).toBe(true);
  });

  it('points at an activity, a party or a system, and nothing else (DM §3.11)', () => {
    for (const targetType of ['activity', 'party', 'system']) {
      expect(ReviewItemInput.safeParse({ ...ch6, targetType }).success, targetType).toBe(true);
    }
    expect(ReviewItemInput.safeParse({ ...ch6, targetType: 'agreement' }).success).toBe(false);
  });

  it('refuses a source or reason outside the vocabulary', () => {
    expect(ReviewItemInput.safeParse({ ...ch6, source: 'email' }).success).toBe(false);
    expect(ReviewItemInput.safeParse({ ...ch6, reason: 'just_because' }).success).toBe(false);
  });

  it('takes details and deadlines as JSON objects, not as anything else', () => {
    expect(ReviewItemInput.safeParse({ ...ch6, details: ['a list'] }).success).toBe(false);
    expect(ReviewItemInput.safeParse({ ...ch6, deadlines: 'soon' }).success).toBe(false);
  });

  it('takes dueAt as a date', () => {
    expect(ReviewItemInput.safeParse({ ...ch6, dueAt: '2026-07-03T00:00:00Z' }).success).toBe(
      false,
    );
  });

  it('ignores what the server decides: code, status, who and when (§1.2)', () => {
    const parsed = ReviewItemInput.parse({
      ...ch6,
      code: 'RI-99',
      status: 'resolved',
      resolutionNote: 'Nothing to see',
      openedBy: 'someone.else',
    });
    expect(parsed).not.toHaveProperty('code');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('resolutionNote');
    expect(parsed).not.toHaveProperty('openedBy');
  });
});

describe('CloseReviewItemInput', () => {
  it('requires a resolution note: what was decided (§2)', () => {
    expect(CloseReviewItemInput.safeParse({}).success).toBe(false);
    expect(CloseReviewItemInput.safeParse({ resolutionNote: '' }).success).toBe(false);
    expect(
      CloseReviewItemInput.safeParse({ resolutionNote: 'Mailcrest keeps India out of the EU' })
        .success,
    ).toBe(true);
  });
});

describe('ReviewItem', () => {
  const open = {
    id: UUID,
    code: 'RI-1',
    targetType: 'party',
    target: { id: UUID, slug: 'mailcrest', name: 'Mailcrest Inc.' },
    source: 'monitor',
    reason: 'vendor_subprocessor_added',
    details: { added: ['Helpdesk Partners Pvt Ltd'] },
    deadlines: null,
    dueAt: '2026-07-03',
    status: 'open',
    resolutionNote: null,
    openedBy: 'svc:monitor',
    closedBy: null,
    closedAt: null,
    createdAt: '2026-06-03T08:00:00Z',
    updatedAt: '2026-06-03T08:00:00Z',
  };

  it('describes an open item', () => {
    expect(ReviewItem.safeParse(open).success).toBe(true);
  });

  it('describes a closed one, with who closed it, when and why', () => {
    const resolved = {
      ...open,
      status: 'resolved',
      resolutionNote: 'Mailcrest keeps Helpdesk Partners out of the EU region',
      closedBy: 'priya.raman',
      closedAt: '2026-06-10T09:00:00Z',
    };
    expect(ReviewItem.safeParse(resolved).success).toBe(true);
  });

  it('carries no version: review items are not versioned (§1.8)', () => {
    expect(ReviewItem.shape).not.toHaveProperty('version');
  });
});

describe('ReviewItemsQuery', () => {
  it('filters by status, source, reason and due date', () => {
    const parsed = ReviewItemsQuery.safeParse({
      status: 'open',
      source: 'monitor',
      reason: 'region_violation',
      dueBefore: '2026-07-01',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses values outside the vocabulary', () => {
    expect(ReviewItemsQuery.safeParse({ status: 'closed' }).success).toBe(false);
    expect(ReviewItemsQuery.safeParse({ dueBefore: 'next week' }).success).toBe(false);
  });

  it('takes a target only with its type, because a slug alone is ambiguous', () => {
    expect(ReviewItemsQuery.safeParse({ targetType: 'party', target: 'mailcrest' }).success).toBe(
      true,
    );

    const alone = ReviewItemsQuery.safeParse({ target: 'mailcrest' });
    expect(alone.success).toBe(false);
    expect(alone.error?.issues.map((issue) => issue.path.join('.'))).toContain('targetType');
  });

  it('allows a type on its own: every item about a party', () => {
    expect(ReviewItemsQuery.safeParse({ targetType: 'party' }).success).toBe(true);
  });
});
