import { describe, expect, it } from 'vitest';

import {
  ATS,
  AURELIA,
  MAILCREST,
  NORTHWIND,
  P1,
  P2,
  P3,
  RENDER,
  SCRIBE,
  TODAY,
  activity,
  engagement,
} from '../../../test/fixtures/story-snapshots.js';
import { partyImpact, type ClientAgreement, type ImpactInput, type TermsFacts } from './impact.js';

/**
 * `GET /parties/{ref}/impact` as a pure function over aggregates (DM §7, API
 * §5.3): Chapter 6, when Mailcrest adds Helpdesk Partners and the Monitor asks
 * what depends on Mailcrest.
 */

const FJORD = 'party-fjord';
const STANDARD = 'terms-standard-dpa';
const AURELIA_DPA = 'terms-aurelia-dpa';
const IDENTITY = 'dc-identity';
const HEALTH = 'dc-health';

/** C2 and C3: Hireloop's own customers and leads, emailed through Mailcrest (Ch2). */
const C2 = activity('C2', {
  role: 'controller',
  offeringId: null,
  clientCoverage: null,
  engagements: [
    engagement(RENDER, 'Hosting', ['DE'], { role: 'processor' }),
    engagement(MAILCREST, 'Transactional email', ['US'], {
      role: 'processor',
      dataCategoryIds: [IDENTITY],
    }),
  ],
});
const C3 = activity('C3', {
  role: 'controller',
  offeringId: null,
  clientCoverage: null,
  engagements: [
    engagement(MAILCREST, 'Newsletter and demo requests', ['US'], {
      role: 'processor',
      dataCategoryIds: [IDENTITY],
    }),
  ],
});

const TERMS = new Map<string, TermsFacts>([
  [STANDARD, { id: STANDARD, authorizationType: 'general', noticeDays: 30, allowedRegions: [] }],
  [
    AURELIA_DPA,
    { id: AURELIA_DPA, authorizationType: 'specific', noticeDays: 60, allowedRegions: ['EEA'] },
  ],
]);

const AGREEMENTS: ClientAgreement[] = [
  { clientId: NORTHWIND, offeringId: ATS, termsId: STANDARD },
  { clientId: FJORD, offeringId: ATS, termsId: STANDARD },
  { clientId: AURELIA, offeringId: ATS, termsId: AURELIA_DPA },
];

function impact(overrides: Partial<ImpactInput> = {}) {
  return partyImpact({
    partyId: MAILCREST,
    activities: [P3, C3, P1, C2, P2],
    agreements: AGREEMENTS,
    terms: TERMS,
    vendorNoticeDays: [30],
    specialDataCategoryIds: new Set([HEALTH]),
    day: TODAY,
    ...overrides,
  });
}

const rows = (result: ReturnType<typeof impact>) =>
  result.entries.map((entry) => `${entry.activity.code} ${entry.engagement.serviceDescription}`);

describe('what depends on Mailcrest (Ch6)', () => {
  it('lists every Mailcrest engagement, P1 twice, in code order, and nothing else', () => {
    expect(rows(impact())).toEqual([
      'C2 Transactional email',
      'C3 Newsletter and demo requests',
      'P1 Candidate notifications (US region)',
      'P1 Candidate notifications (EU region)',
    ]);
  });

  it('tells no client about a controller activity: Hireloop decides (C2, C3)', () => {
    const [c2, c3] = impact().entries;
    expect(c2!.clientGroups).toEqual([]);
    expect(c3!.clientGroups).toEqual([]);
  });

  it('reaches Northwind and Fjord through the US region, on the standard terms', () => {
    const us = impact().entries[2]!;
    expect(us.clientGroups).toEqual([
      {
        termsId: STANDARD,
        authorizationType: 'general',
        noticeDays: 30,
        allowedRegions: [],
        clientIds: [NORTHWIND, FJORD],
        requiresApproval: false,
        noticeConflict: false,
      },
    ]);
  });

  it('reaches only Aurelia through the EU region: approval needed, notice short, EEA only', () => {
    const eu = impact().entries[3]!;
    expect(eu.clientGroups).toEqual([
      {
        termsId: AURELIA_DPA,
        authorizationType: 'specific',
        noticeDays: 60,
        allowedRegions: ['EEA'],
        clientIds: [AURELIA],
        requiresApproval: true,
        noticeConflict: true,
      },
    ]);
  });

  it('sums it up for the Monitor', () => {
    expect(impact().summary).toEqual({
      engagements: 4,
      activities: 3,
      processorActivities: 1,
      affectedClients: 3,
      clientsRequiringApproval: 1,
      noticeConflicts: 1,
    });
  });
});

describe('who counts as reached (DM §3.8)', () => {
  it('counts only clients the activity covers: an opt-in module reaches those who enabled it', () => {
    const [p2] = impact({ partyId: RENDER }).entries.filter(
      (entry) => entry.activity.code === 'P2',
    );
    expect(p2!.clientGroups.flatMap((group) => group.clientIds)).toEqual([AURELIA]);
  });

  it('leaves out a client the activity excludes as a whole (Aurelia from P3)', () => {
    const [p3] = impact({ partyId: SCRIBE }).entries;
    expect(p3!.clientGroups.flatMap((group) => group.clientIds)).toEqual([NORTHWIND, FJORD]);
  });

  it('counts only clients with an agreement for the activity’s offering', () => {
    const us = impact({ agreements: AGREEMENTS.slice(0, 1) }).entries[2]!;
    expect(us.clientGroups.flatMap((group) => group.clientIds)).toEqual([NORTHWIND]);
  });

  it('drops a group that nobody is left in', () => {
    const us = impact({ agreements: [AGREEMENTS[2]!] }).entries[2]!;
    expect(us.clientGroups).toEqual([]);
  });

  it('puts the larger group first', () => {
    const everyone = activity('P9', {
      engagements: [engagement(MAILCREST, 'Everything', ['US'])],
    });
    const [entry] = impact({ activities: [everyone] }).entries;
    expect(entry!.clientGroups.map((group) => group.termsId)).toEqual([STANDARD, AURELIA_DPA]);
  });
});

describe('the notice conflict (step 3, open question 5)', () => {
  const eu = (vendorNoticeDays: number[]) =>
    impact({ vendorNoticeDays }).entries[3]!.clientGroups[0]!.noticeConflict;

  it('judges on the vendor’s shortest notice, the worst case', () => {
    expect(eu([90, 30])).toBe(true);
    expect(eu([90, 60])).toBe(false);
  });

  it('is not a conflict when the notice is exactly what is owed', () => {
    expect(impact({ vendorNoticeDays: [30] }).entries[2]!.clientGroups[0]!.noticeConflict).toBe(
      false,
    );
  });

  it('cannot be judged without a vendor DPA: null, not false', () => {
    expect(eu([])).toBeNull();
    expect(impact({ vendorNoticeDays: [] }).summary.noticeConflicts).toBe(0);
  });
});

describe('what is left out', () => {
  it('ignores drafts, retired activities and engagements not in force', () => {
    const draft = activity('P7', {
      status: 'draft',
      engagements: [engagement(MAILCREST, 'Draft', ['US'])],
    });
    const retired = activity('P8', {
      status: 'retired',
      engagements: [engagement(MAILCREST, 'Retired', ['US'])],
    });
    const ended = activity('P9', {
      engagements: [engagement(MAILCREST, 'Ended', ['US'], { endedAt: '2026-01-01' })],
    });
    expect(rows(impact({ activities: [draft, retired, ended] }))).toEqual([]);
  });

  it('marks special categories from what the vendor receives, not the whole activity', () => {
    const p2 = activity('P2', {
      dataCategoryIds: [IDENTITY, HEALTH],
      engagements: [
        engagement(MAILCREST, 'Reminders', ['IE'], { dataCategoryIds: [IDENTITY] }),
        engagement(MAILCREST, 'Accommodation requests', ['IE'], {
          dataCategoryIds: [HEALTH],
        }),
      ],
    });
    const entries = impact({ activities: [p2] }).entries;
    expect(entries.map((entry) => entry.specialCategories)).toEqual([false, true]);
  });
});
