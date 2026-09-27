import type { EventEnvelope } from '@rulemark/ropa-schemas/events';
import { describe, expect, it } from 'vitest';

import { summarize } from './summary.js';

/**
 * One readable line per event, so the backlog can be watched arriving in
 * Render's logs. The whole event is logged beside it.
 */

const envelope = (type: EventEnvelope['type'], data: Record<string, unknown>): EventEnvelope => ({
  id: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
  type,
  source: 'ropa',
  occurredAt: '2026-04-14T10:02:11.000Z',
  data,
});

describe('summarize', () => {
  it('names a record by its code, slug or name, with the version and who', () => {
    const change = (entity: Record<string, string>) =>
      summarize(
        envelope('record.changed', {
          entityType: 'activity',
          entity: { id: 'x', ...entity },
          version: 1,
          changeType: 'created',
          actor: 'priya.raman',
        }),
      );
    expect(change({ code: 'P3', name: 'CV parsing' })).toBe(
      'record.changed activity P3 v1 created by priya.raman',
    );
    expect(change({ slug: 'mailcrest', name: 'Mailcrest' })).toBe(
      'record.changed activity mailcrest v1 created by priya.raman',
    );
    expect(change({ name: 'Aurelia DPA' })).toBe(
      'record.changed activity "Aurelia DPA" v1 created by priya.raman',
    );
  });

  it('names a review item by its code', () => {
    expect(
      summarize(
        envelope('review_item.changed', {
          changeType: 'resolved',
          actor: 'priya.raman',
          reviewItem: { code: 'RI-2' },
        }),
      ),
    ).toBe('review_item.changed RI-2 resolved by priya.raman');
  });

  it('counts a subprocessor list’s changes, for the offering or a client', () => {
    const list = (client: unknown) =>
      summarize(
        envelope('subprocessors.changed', {
          offering: { slug: 'ats', name: 'Hireloop ATS' },
          client,
          added: [{}],
          removed: [],
          changed: [{}, {}],
        }),
      );
    expect(list(null)).toBe('subprocessors.changed ats: +1 -0 ~2');
    expect(list({ slug: 'aurelia', name: 'Aurelia' })).toBe(
      'subprocessors.changed ats for aurelia: +1 -0 ~2',
    );
  });

  it('falls back to the type and id when the data is not what it expects', () => {
    expect(summarize(envelope('record.changed', {}))).toBe(
      'record.changed 0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
    );
    expect(summarize(envelope('subprocessors.changed', { offering: 'ats' }))).toBe(
      'subprocessors.changed 0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
    );
  });
});
