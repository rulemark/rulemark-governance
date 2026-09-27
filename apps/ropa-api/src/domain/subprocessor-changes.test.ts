import { describe, expect, it } from 'vitest';

import {
  ATS,
  AURELIA,
  GLITCHLOG,
  MAILCREST,
  NORTHWIND,
  P1,
  P2,
  P3,
  PEOPLEHUB,
  RENDER,
  SCRIBE,
  engagement,
  transfer,
} from '../../test/fixtures/story-snapshots.js';
import type { ActivitySnapshot } from './snapshots.js';
import { plannedChanges, type ListScope } from './subprocessor-changes.js';

/**
 * Which subprocessor lists a save changes, compared as planned (step 4, open
 * question 5 and Phase 4's questions): every recorded start and end counts,
 * and each change says from when it takes effect. Pure, over the story's
 * snapshots.
 */

const SAVED = '2026-09-26';
const OFFERING: ListScope = { kind: 'offering', offeringId: ATS };
const client = (clientId: string): ListScope => ({ kind: 'client', offeringId: ATS, clientId });

const draft = (activity: ActivitySnapshot): ActivitySnapshot => ({ ...activity, status: 'draft' });
const withEngagements = (
  activity: ActivitySnapshot,
  engagements: ActivitySnapshot['engagements'],
): ActivitySnapshot => ({ ...activity, engagements });

const parties = (entries: readonly { partyId: string }[]) => entries.map((entry) => entry.partyId);
const nothing = { added: [], removed: [], changed: [] };

describe('P3 goes live (Ch5)', () => {
  const before = [P1, P2, draft(P3)];
  const after = [P1, P2, P3];

  it('adds Scribe AI to the standard list, from the day it was saved', () => {
    const changes = plannedChanges(OFFERING, before, after, SAVED);
    expect(changes.added).toEqual([
      {
        partyId: SCRIBE,
        moduleId: null,
        services: ['CV parsing'],
        processingCountries: ['US'],
        transfers: [{ destinationCountry: 'US', mechanism: 'sccs', onwardVia: null }],
        effectiveFrom: SAVED,
      },
    ]);
    expect(changes.removed).toEqual([]);
    expect(changes.changed).toEqual([]);
  });

  it('adds it to Northwind’s list too, and changes nothing for Aurelia, who objected', () => {
    expect(parties(plannedChanges(client(NORTHWIND), before, after, SAVED).added)).toEqual([
      SCRIBE,
    ]);
    expect(plannedChanges(client(AURELIA), before, after, SAVED)).toEqual(nothing);
  });

  it('hears nothing while P3 is a draft: drafts are on no list', () => {
    const edited = draft(
      withEngagements(P3, [...P3.engagements, engagement(PEOPLEHUB, 'X', ['DE'])]),
    );
    expect(plannedChanges(OFFERING, before, [P1, P2, edited], SAVED)).toEqual(nothing);
  });

  it('removes it again when P3 is retired', () => {
    const retired = { ...P3, status: 'retired' as const };
    expect(parties(plannedChanges(OFFERING, after, [P1, P2, retired], SAVED).removed)).toEqual([
      SCRIBE,
    ]);
  });
});

describe('an opt-in module', () => {
  it('reaches the offering list marked with its module (Phase 4, question 2)', () => {
    const changes = plannedChanges(OFFERING, [P1, draft(P2)], [P1, P2], SAVED);
    expect(changes.added.map((entry) => [entry.partyId, entry.moduleId])).toEqual([
      [RENDER, P2.id],
    ]);
  });

  it('changes nothing for Aurelia, whose list already has Render from P1', () => {
    expect(plannedChanges(client(AURELIA), [P1, draft(P2)], [P1, P2], SAVED)).toEqual(nothing);
  });
});

describe('excluding Aurelia from P3 (Ch5)', () => {
  const open = { ...P3, clientScope: [] };

  it('removes Scribe AI for her alone', () => {
    expect(plannedChanges(client(AURELIA), [P1, open], [P1, P3], SAVED).removed).toEqual([
      {
        partyId: SCRIBE,
        moduleId: null,
        services: ['CV parsing'],
        processingCountries: ['US'],
        transfers: [{ destinationCountry: 'US', mechanism: 'sccs', onwardVia: null }],
        effectiveFrom: SAVED,
      },
    ]);
    expect(plannedChanges(client(NORTHWIND), [P1, open], [P1, P3], SAVED)).toEqual(nothing);
    expect(plannedChanges(OFFERING, [P1, open], [P1, P3], SAVED)).toEqual(nothing);
  });

  it('says from when, if the exclusion starts later', () => {
    const later = {
      ...P3,
      clientScope: [{ ...P3.clientScope[0]!, startedAt: '2026-10-15' }],
    };
    expect(plannedChanges(client(AURELIA), [P1, open], [P1, later], SAVED).removed).toEqual([
      expect.objectContaining({ partyId: SCRIBE, effectiveFrom: '2026-10-15' }),
    ]);
  });
});

describe('dates recorded ahead of time', () => {
  it('hears a future start when it is recorded, effective from that day', () => {
    const future = withEngagements(P1, [
      ...P1.engagements,
      engagement(PEOPLEHUB, 'Backups', ['DE'], { startedAt: '2026-11-01' }),
    ]);
    expect(plannedChanges(client(NORTHWIND), [P1], [future], SAVED).added).toEqual([
      expect.objectContaining({ partyId: PEOPLEHUB, effectiveFrom: '2026-11-01' }),
    ]);
  });

  it('hears a future end the same way', () => {
    const ending = withEngagements(
      P1,
      P1.engagements.map((row) =>
        row.partyId === GLITCHLOG ? { ...row, endedAt: '2026-12-01' } : row,
      ),
    );
    expect(plannedChanges(client(NORTHWIND), [P1], [ending], SAVED).removed).toEqual([
      expect.objectContaining({ partyId: GLITCHLOG, effectiveFrom: '2026-12-01' }),
    ]);
  });

  it('hears nothing about an engagement that had already ended', () => {
    const ended = (activity: ActivitySnapshot, service: string) =>
      withEngagements(activity, [
        ...activity.engagements,
        engagement(PEOPLEHUB, service, ['DE'], { endedAt: '2026-01-01' }),
      ]);
    expect(
      plannedChanges(client(NORTHWIND), [ended(P1, 'Old')], [ended(P1, 'Older')], SAVED),
    ).toEqual(nothing);
  });
});

describe('Mailcrest adds Helpdesk Partners in India (Ch6)', () => {
  const india = transfer('IN', 'sccs', 'Helpdesk Partners Pvt Ltd');
  const after = withEngagements(
    P1,
    P1.engagements.map((row) =>
      row.partyId === MAILCREST ? { ...row, transfers: [...row.transfers, india] } : row,
    ),
  );

  it('changes Mailcrest on the standard list: still listed, with a new onward transfer', () => {
    expect(plannedChanges(OFFERING, [P1], [after], SAVED)).toEqual({
      added: [],
      removed: [],
      changed: [
        {
          partyId: MAILCREST,
          moduleId: null,
          before: {
            services: ['Candidate notifications (US region)'],
            processingCountries: ['US'],
            transfers: [{ destinationCountry: 'US', mechanism: 'dpf', onwardVia: null }],
          },
          after: {
            services: ['Candidate notifications (US region)'],
            processingCountries: ['US'],
            transfers: [
              { destinationCountry: 'US', mechanism: 'dpf', onwardVia: null },
              {
                destinationCountry: 'IN',
                mechanism: 'sccs',
                onwardVia: 'Helpdesk Partners Pvt Ltd',
              },
            ],
          },
          effectiveFrom: SAVED,
        },
      ],
    });
  });

  it('changes it for Aurelia too, in her EU region', () => {
    const [change] = plannedChanges(client(AURELIA), [P1], [after], SAVED).changed;
    expect(change).toMatchObject({ partyId: MAILCREST, before: { processingCountries: ['IE'] } });
    expect(change!.after.transfers).toEqual([
      { destinationCountry: 'IN', mechanism: 'sccs', onwardVia: 'Helpdesk Partners Pvt Ltd' },
    ]);
  });

  it('is a change when only the countries move', () => {
    const moved = withEngagements(
      P1,
      P1.engagements.map((row) =>
        row.partyId === RENDER ? { ...row, processingCountries: ['IE'] } : row,
      ),
    );
    const [change] = plannedChanges(OFFERING, [P1], [moved], SAVED).changed;
    expect(change).toMatchObject({
      partyId: RENDER,
      before: { processingCountries: ['DE'] },
      after: { processingCountries: ['IE'] },
    });
  });

  it('is not a change when only a service description moves', () => {
    const renamed = withEngagements(
      P1,
      P1.engagements.map((row) =>
        row.partyId === RENDER ? { ...row, serviceDescription: 'Hosting and backups' } : row,
      ),
    );
    expect(plannedChanges(OFFERING, [P1], [renamed], SAVED)).toEqual(nothing);
  });
});
