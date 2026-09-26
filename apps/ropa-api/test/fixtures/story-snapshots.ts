import type { ActivitySnapshot } from '../../src/domain/snapshots.js';

/**
 * The Hireloop story as activity snapshots, for the views' pure-function tests
 * (DB §6.3). Ids are readable strings rather than UUIDs: these never touch a
 * database, and `party-mailcrest` says more in a failure than a UUID does.
 */

export const ATS = 'off-ats';
export const AURELIA = 'party-aurelia';
export const NORTHWIND = 'party-northwind';
export const RENDER = 'party-render';
export const MAILCREST = 'party-mailcrest';
export const GLITCHLOG = 'party-glitchlog';
export const SCRIBE = 'party-scribe';
export const TODAY = '2026-09-26';

let sequence = 0;
export const nextId = (prefix: string) => `${prefix}-${String(++sequence).padStart(4, '0')}`;

export type Engagement = ActivitySnapshot['engagements'][number];

export function engagement(
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

export const transfer = (destinationCountry: string, mechanism: 'dpf' | 'sccs') => ({
  id: nextId('tr'),
  destinationCountry,
  mechanism,
  onwardVia: null,
  documentRef: null,
});

export const scoped = (mode: 'include' | 'exclude', clientPartyId: string) => ({
  id: nextId('ecs'),
  clientPartyId,
  mode,
  reason: 'Aurelia DPA',
  agreementId: null,
});

export function activity(code: string, overrides: Partial<ActivitySnapshot>): ActivitySnapshot {
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
export const P1 = activity('P1', {
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
export const P2 = activity('P2', {
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
export const P3 = activity('P3', {
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
