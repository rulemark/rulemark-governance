import { describe, expect, it } from 'vitest';

import type { ActivitySnapshot } from '../snapshots.js';
import { clientSubprocessors, isEffectiveFor, standardSubprocessors } from './subprocessors.js';

/**
 * The subprocessor lists as pure functions over aggregates (DM §3.8, §7), so
 * the same code will answer `asOf` from revisions in step 4 (DB §6.3). These
 * are Chapter 4 and 5 of the story, written as snapshots.
 */

const ATS = 'off-ats';
const AURELIA = 'party-aurelia';
const NORTHWIND = 'party-northwind';
const RENDER = 'party-render';
const MAILCREST = 'party-mailcrest';
const GLITCHLOG = 'party-glitchlog';
const SCRIBE = 'party-scribe';
const TODAY = '2026-09-26';

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${String(++sequence).padStart(4, '0')}`;

type Engagement = ActivitySnapshot['engagements'][number];

function engagement(
  partyId: string,
  serviceDescription: string,
  processingCountries: string[],
  extra: Partial<Engagement> = {},
): Engagement {
  return {
    id: nextId('eng'),
    partyId,
    role: 'subprocessor',
    serviceDescription,
    processingCountries,
    startedAt: null,
    endedAt: null,
    dataCategoryIds: [],
    transfers: [],
    clientScope: [],
    ...extra,
  };
}

const transfer = (destinationCountry: string, mechanism: 'dpf' | 'sccs') => ({
  id: nextId('tr'),
  destinationCountry,
  mechanism,
  onwardVia: null,
  documentRef: null,
});

const scoped = (mode: 'include' | 'exclude', clientPartyId: string) => ({
  id: nextId('ecs'),
  clientPartyId,
  mode,
  reason: 'Aurelia DPA',
  agreementId: null,
});

function activity(code: string, overrides: Partial<ActivitySnapshot>): ActivitySnapshot {
  return {
    schemaVersion: 1,
    id: `act-${code}`,
    version: 1,
    createdAt: '2026-02-10T09:00:00.000Z',
    updatedAt: '2026-02-10T09:00:00.000Z',
    code,
    name: code,
    description: null,
    supersedesId: null,
    role: 'processor',
    roleRationale: null,
    status: 'active',
    owner: 'Priya Raman',
    offeringId: ATS,
    clientCoverage: 'all_enrolled',
    purposes: [],
    lawfulBases: [],
    specialConditions: [],
    processingCategories: ['hosting'],
    dpiaRequired: null,
    dpiaRef: null,
    dpiaSupportRef: null,
    reviewDueAt: null,
    startedAt: '2026-02-10',
    endedAt: null,
    subjectCategoryIds: [],
    dataCategoryIds: [],
    systemIds: [],
    securityMeasureIds: [],
    retentionRules: [],
    clientScope: [],
    engagements: [],
    ...overrides,
  };
}

/** P1 after Aurelia signed (Ch4): Mailcrest twice, one region each. */
const P1 = activity('P1', {
  name: 'Candidate application management',
  engagements: [
    engagement(RENDER, 'Hosting', ['DE']),
    engagement(MAILCREST, 'Candidate notifications (US region)', ['US'], {
      transfers: [transfer('US', 'dpf')],
      clientScope: [scoped('exclude', AURELIA)],
    }),
    engagement(MAILCREST, 'Candidate notifications (EU region)', ['IE'], {
      clientScope: [scoped('include', AURELIA)],
    }),
    engagement(GLITCHLOG, 'Error tracking', ['US'], {
      transfers: [transfer('US', 'sccs')],
      clientScope: [scoped('exclude', AURELIA)],
    }),
  ],
});

/** P2, the opt-in Diversity module, which Aurelia enabled (Ch4). */
const P2 = activity('P2', {
  name: 'Diversity & accommodations module',
  clientCoverage: 'opt_in',
  clientScope: [
    {
      id: nextId('acs'),
      clientPartyId: AURELIA,
      mode: 'include',
      reason: 'Client enabled the module',
      agreementId: null,
      startedAt: '2026-03-16',
      endedAt: null,
    },
  ],
  engagements: [engagement(RENDER, 'Hosting', ['DE'])],
});

/** P3 CV parsing, switched off for Aurelia as a whole (Ch5). */
const P3 = activity('P3', {
  name: 'CV parsing',
  clientScope: [
    {
      id: nextId('acs'),
      clientPartyId: AURELIA,
      mode: 'exclude',
      reason: 'Client objected',
      agreementId: null,
      startedAt: '2026-04-14',
      endedAt: null,
    },
  ],
  engagements: [engagement(SCRIBE, 'CV parsing', ['US'], { transfers: [transfer('US', 'sccs')] })],
});

const partiesOf = (groups: readonly { partyId: string }[]) => groups.map((group) => group.partyId);

describe('the offering view: the standard terms (DM §7)', () => {
  const view = standardSubprocessors([P1, P2, P3], ATS, TODAY);

  it('lists Render, Mailcrest (US) and Glitchlog, plus Scribe AI from P3', () => {
    expect(partiesOf(view.subprocessors)).toEqual([RENDER, MAILCREST, GLITCHLOG, SCRIBE]);
  });

  it('leaves out an engagement scoped to include particular clients: it is not standard', () => {
    const mailcrest = view.subprocessors.find((group) => group.partyId === MAILCREST);
    expect(mailcrest?.services).toEqual(['Candidate notifications (US region)']);
    expect(mailcrest?.processingCountries).toEqual(['US']);
  });

  it('keeps an engagement that only excludes some clients, and ignores activity opt-outs', () => {
    expect(partiesOf(view.subprocessors)).toContain(GLITCHLOG);
    expect(partiesOf(view.subprocessors)).toContain(SCRIBE);
  });

  it('lists an opt-in module on its own, with its own subprocessors', () => {
    expect(view.optionalModules).toEqual([
      { activityId: P2.id, subprocessors: [expect.objectContaining({ partyId: RENDER })] },
    ]);
    const render = view.subprocessors.find((group) => group.partyId === RENDER);
    expect(render?.activityIds).toEqual([P1.id]);
  });

  it('carries each subprocessor’s transfers', () => {
    const glitchlog = view.subprocessors.find((group) => group.partyId === GLITCHLOG);
    expect(glitchlog?.transfers).toEqual([
      { destinationCountry: 'US', mechanism: 'sccs', onwardVia: null },
    ]);
  });

  it('leaves out drafts, retired activities, controllers and other offerings', () => {
    const others = [
      activity('P7', { status: 'draft', engagements: [engagement('party-x', 'x', ['US'])] }),
      activity('P8', { status: 'retired', engagements: [engagement('party-y', 'y', ['US'])] }),
      activity('P9', {
        offeringId: 'off-other',
        engagements: [engagement('party-z', 'z', ['US'])],
      }),
      activity('C1', { role: 'controller', offeringId: null, clientCoverage: null }),
    ];
    expect(partiesOf(standardSubprocessors([P1, ...others], ATS, TODAY).subprocessors)).toEqual([
      RENDER,
      MAILCREST,
      GLITCHLOG,
    ]);
  });

  it('counts only subprocessors, and only engagements in force', () => {
    const P5 = activity('P5', {
      engagements: [
        engagement('party-recipient', 'Reporting', ['NL'], { role: 'recipient' }),
        engagement('party-gone', 'Old CDN', ['US'], { endedAt: '2026-05-01' }),
        engagement('party-future', 'New CDN', ['US'], { startedAt: '2026-12-01' }),
      ],
    });
    expect(standardSubprocessors([P5], ATS, TODAY).subprocessors).toEqual([]);
  });
});

describe('the client view: effective engagements (DM §3.8)', () => {
  it('shows Aurelia Render and Mailcrest in Ireland, with no Glitchlog and no Scribe AI (Ch4, Ch5)', () => {
    const view = clientSubprocessors([P1, P2, P3], ATS, AURELIA, TODAY);
    expect(partiesOf(view)).toEqual([RENDER, MAILCREST]);

    const mailcrest = view.find((group) => group.partyId === MAILCREST);
    expect(mailcrest?.services).toEqual(['Candidate notifications (EU region)']);
    expect(mailcrest?.processingCountries).toEqual(['IE']);
    expect(mailcrest?.transfers).toEqual([]);
  });

  it('includes the module Aurelia opted into, under the subprocessor it uses', () => {
    const render = clientSubprocessors([P1, P2, P3], ATS, AURELIA, TODAY).find(
      (group) => group.partyId === RENDER,
    );
    expect(render?.activityIds).toEqual([P1.id, P2.id]);
  });

  it('shows Northwind Mailcrest in the US and Glitchlog, on the standard terms', () => {
    const view = clientSubprocessors([P1, P2, P3], ATS, NORTHWIND, TODAY);
    expect(partiesOf(view)).toEqual([RENDER, MAILCREST, GLITCHLOG, SCRIBE]);
    const mailcrest = view.find((group) => group.partyId === MAILCREST);
    expect(mailcrest?.processingCountries).toEqual(['US']);
    expect(mailcrest?.transfers).toEqual([
      { destinationCountry: 'US', mechanism: 'dpf', onwardVia: null },
    ]);
    // Northwind never enabled the module.
    expect(view.find((group) => group.partyId === RENDER)?.activityIds).toEqual([P1.id]);
  });

  it('differs between the two clients in exactly the way Chapter 4 describes', () => {
    const aurelia = clientSubprocessors([P1], ATS, AURELIA, TODAY);
    const northwind = clientSubprocessors([P1], ATS, NORTHWIND, TODAY);
    const summary = (view: typeof aurelia) =>
      view.map((group) => `${group.partyId} ${group.processingCountries.join('+')}`);
    expect(summary(aurelia)).toEqual([`${RENDER} DE`, `${MAILCREST} IE`]);
    expect(summary(northwind)).toEqual([`${RENDER} DE`, `${MAILCREST} US`, `${GLITCHLOG} US`]);
  });

  it('honours only the scope rows in force on the day', () => {
    const lapsedOptOut = activity('P3', {
      ...P3,
      clientScope: [{ ...P3.clientScope[0]!, endedAt: '2026-06-01' }],
    });
    expect(partiesOf(clientSubprocessors([lapsedOptOut], ATS, AURELIA, TODAY))).toEqual([SCRIBE]);
    expect(partiesOf(clientSubprocessors([P3], ATS, AURELIA, '2026-04-01'))).toEqual([SCRIBE]);
  });
});

describe('isEffectiveFor', () => {
  it('applies an unscoped engagement to everyone, include to the listed, exclude to the rest', () => {
    const [, us, eu] = P1.engagements;
    expect(isEffectiveFor(P1.engagements[0]!, AURELIA)).toBe(true);
    expect(isEffectiveFor(us!, AURELIA)).toBe(false);
    expect(isEffectiveFor(us!, NORTHWIND)).toBe(true);
    expect(isEffectiveFor(eu!, AURELIA)).toBe(true);
    expect(isEffectiveFor(eu!, NORTHWIND)).toBe(false);
  });
});
