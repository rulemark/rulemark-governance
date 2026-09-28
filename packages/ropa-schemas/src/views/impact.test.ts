import { describe, expect, it } from 'vitest';

import { ImpactQuery, ImpactResponse } from './impact.ts';

const id = (n: number) => `0199c3a1-8f2e-7c4d-b8e1-${String(n).padStart(12, '0')}`;

/** The §5.3 example, with `vendorTerms` as a list (step 3, open question 5). */
const mailcrestImpact = {
  generatedAt: '2026-06-03T08:00:00Z',
  asOf: null,
  party: { id: id(1), slug: 'mailcrest', name: 'Mailcrest Inc.' },
  vendorTerms: [
    {
      id: id(2),
      slug: 'mailcrest-dpa',
      name: 'Mailcrest DPA',
      authorizationType: 'general',
      noticeDays: 30,
    },
  ],
  engagements: [
    {
      activity: { id: id(3), code: 'C2', name: 'Customer accounts & billing' },
      engagement: { id: id(4), serviceDescription: 'Transactional email' },
      activityRole: 'controller',
      engagementRole: 'processor',
      subjectCategories: [{ id: id(5), slug: 'client-users', name: 'Client users' }],
      dataCategories: [{ id: id(6), slug: 'identity', name: 'Identity & contact' }],
      specialCategories: false,
      processingCountries: ['US'],
      clientGroups: [],
    },
    {
      activity: { id: id(7), code: 'P1', name: 'Candidate application management' },
      engagement: { id: id(8), serviceDescription: 'Candidate notifications (EU region)' },
      activityRole: 'processor',
      engagementRole: 'subprocessor',
      subjectCategories: [{ id: id(9), slug: 'candidates', name: 'Candidates' }],
      dataCategories: [{ id: id(6), slug: 'identity', name: 'Identity & contact' }],
      specialCategories: false,
      processingCountries: ['IE'],
      clientGroups: [
        {
          terms: { id: id(10), slug: 'aurelia-dpa', name: 'Aurelia Bank DPA' },
          authorizationType: 'specific',
          noticeDays: 60,
          allowedRegions: ['EEA'],
          clientCount: 1,
          clients: [{ id: id(11), slug: 'aurelia', name: 'Aurelia Bank S.A.' }],
          requiresApproval: true,
          noticeConflict: true,
        },
      ],
    },
  ],
  summary: {
    engagements: 2,
    activities: 2,
    processorActivities: 1,
    affectedClients: 1,
    clientsRequiringApproval: 1,
    noticeConflicts: 1,
  },
};

describe('ImpactResponse (§5.3)', () => {
  it('describes Mailcrest’s impact as the API document shows it', () => {
    const parsed = ImpactResponse.safeParse(mailcrestImpact);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('lists the vendor’s inbound terms, which may be several or none', () => {
    expect(ImpactResponse.safeParse({ ...mailcrestImpact, vendorTerms: [] }).success).toBe(true);
    expect(
      ImpactResponse.safeParse({
        ...mailcrestImpact,
        vendorTerms: [mailcrestImpact.vendorTerms[0], mailcrestImpact.vendorTerms[0]],
      }).success,
    ).toBe(true);
  });

  it('says "can’t tell" about a notice conflict when the vendor has no DPA', () => {
    const [, p1] = mailcrestImpact.engagements;
    const unknown = {
      ...mailcrestImpact,
      vendorTerms: [],
      engagements: [{ ...p1, clientGroups: [{ ...p1!.clientGroups[0], noticeConflict: null }] }],
    };
    expect(ImpactResponse.safeParse(unknown).success).toBe(true);
  });

  it('may leave out a large group’s clients, and a group without region limits', () => {
    const [, p1] = mailcrestImpact.engagements;
    const { clients: _clients, allowedRegions: _regions, ...group } = p1!.clientGroups[0]!;
    const standard = {
      ...mailcrestImpact,
      engagements: [{ ...p1, clientGroups: [{ ...group, clientCount: 399 }] }],
    };
    expect(ImpactResponse.safeParse(standard).success).toBe(true);
  });
});

describe('ImpactResponse.asOf', () => {
  it('echoes the asOf asked for: a date, a timestamp, or null for today', () => {
    for (const asOf of ['2026-03-01', '2026-03-16T15:00:00+01:00', null]) {
      expect(ImpactResponse.shape.asOf.safeParse(asOf).success).toBe(true);
    }
    expect(ImpactResponse.shape.asOf.safeParse('1 March').success).toBe(false);
  });
});

describe('ImpactQuery', () => {
  it('takes expandClients as true or false, and nothing else', () => {
    expect(ImpactQuery.safeParse({}).success).toBe(true);
    expect(ImpactQuery.safeParse({ expandClients: 'true' }).data?.expandClients).toBe(true);
    expect(ImpactQuery.safeParse({ expandClients: 'false' }).data?.expandClients).toBe(false);
    expect(ImpactQuery.safeParse({ expandClients: 'yes' }).success).toBe(false);
  });

  it('accepts asOf', () => {
    expect(ImpactQuery.safeParse({ asOf: '2026-06-03' }).success).toBe(true);
  });
});
