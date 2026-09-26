import { describe, expect, it } from 'vitest';

import {
  ATS,
  AURELIA,
  C1,
  C4,
  MAILCREST,
  NORTHWIND,
  P1,
  P2,
  P3,
  PEOPLEHUB,
  RENDER,
  TODAY,
  activity,
  engagement,
  transfer,
} from '../../../test/fixtures/story-snapshots.js';
import type { ClientAgreement } from './impact.js';
import { coverage, type CoverageInput, type CoverageSystem } from './coverage.js';

/**
 * `GET /coverage` as a pure function over aggregates (DM §5, §7; API §5.5).
 * One block per finding type: each fires on its case and stays quiet on the
 * legitimate ones the story insists on.
 */

const FJORD = 'party-fjord';
const STANDARD = 'terms-standard-dpa';
const AURELIA_DPA = 'terms-aurelia-dpa';
const HELPDESK = 'Helpdesk Partners Pvt Ltd';

const render = (id: string, kind: CoverageSystem['kind']): CoverageSystem => ({
  id,
  kind,
  hostingPartyId: RENDER,
});

/** The systems the fixture activities use, plus Peoplehub's SaaS. */
const SYSTEMS: CoverageSystem[] = [
  render('sys-hireloop-app', 'render_web_service'),
  render('sys-hireloop-api', 'render_web_service'),
  render('sys-hireloop-db', 'render_postgres'),
  { id: 'sys-peoplehub-hr', kind: 'external_saas', hostingPartyId: PEOPLEHUB },
];

/** P1 after Chapter 6: Helpdesk Partners in India reaches every Mailcrest region. */
const P1_CH6 = {
  ...P1,
  systemIds: ['sys-hireloop-app', 'sys-hireloop-db'],
  engagements: P1.engagements.map((row) =>
    row.partyId === MAILCREST
      ? { ...row, transfers: [...row.transfers, transfer('IN', 'sccs', HELPDESK)] }
      : row,
  ),
};
const EU_REGION = P1_CH6.engagements.find(
  (row) => row.serviceDescription === 'Candidate notifications (EU region)',
)!;

const AGREEMENTS: ClientAgreement[] = [
  { clientId: NORTHWIND, offeringId: ATS, termsId: STANDARD },
  { clientId: FJORD, offeringId: ATS, termsId: STANDARD },
  { clientId: AURELIA, offeringId: ATS, termsId: AURELIA_DPA },
];

function findings(overrides: Partial<CoverageInput> = {}) {
  return coverage({
    activities: [C1, C4, P1_CH6, P2, P3],
    systems: SYSTEMS,
    agreements: AGREEMENTS,
    terms: new Map([
      [STANDARD, { id: STANDARD, allowedRegions: [] }],
      [AURELIA_DPA, { id: AURELIA_DPA, allowedRegions: ['EEA'] }],
    ]),
    day: TODAY,
    ...overrides,
  });
}

const typesOf = (list: ReturnType<typeof findings>) => list.map((finding) => finding.type);

/** One type's findings, so a test about it isn't about the rest of the record. */
const ofType = (type: string, overrides: Partial<CoverageInput> = {}) =>
  findings(overrides).filter((finding) => finding.type === type);

describe('the story’s record (Ch5–Ch6)', () => {
  it('finds exactly one thing: Aurelia’s region violation, through Helpdesk Partners', () => {
    expect(findings()).toEqual([
      {
        type: 'region_violation',
        key: `region_violation:${EU_REGION.id}:${AURELIA}:IN`,
        activityId: P1.id,
        engagementId: EU_REGION.id,
        partyId: MAILCREST,
        clientId: AURELIA,
        termsId: AURELIA_DPA,
        allowedRegions: ['EEA'],
        country: 'IN',
        via: 'transfer',
        onwardVia: HELPDESK,
      },
    ]);
  });
});

describe('unmapped_system', () => {
  it('fires for a Render system no live activity uses: cv-parser before P3 (Ch5)', () => {
    const list = findings({ systems: [...SYSTEMS, render('sys-cv-parser', 'render_worker')] });
    expect(list).toContainEqual({
      type: 'unmapped_system',
      key: 'unmapped_system:sys-cv-parser',
      systemId: 'sys-cv-parser',
    });
  });

  it('fires when only a draft uses it: a draft processes nothing yet', () => {
    const draft = activity('P7', { status: 'draft', systemIds: ['sys-cv-parser'] });
    const list = findings({
      activities: [C1, C4, P1_CH6, draft],
      systems: [...SYSTEMS, render('sys-cv-parser', 'render_worker')],
    });
    expect(typesOf(list)).toContain('unmapped_system');
  });

  it('is quiet about an activity with no Render system: C1 lives in Peoplehub', () => {
    const aboutC1 = findings().filter(
      (finding) => 'activityId' in finding && finding.activityId === C1.id,
    );
    expect(aboutC1).toEqual([]);
  });

  it('is about Render systems only, not unused SaaS', () => {
    const list = findings({ activities: [C4, P1_CH6] });
    expect(list.filter((finding) => finding.type === 'unmapped_system')).toEqual([]);
  });
});

describe('transfer_missing', () => {
  const withEngagement = (countries: string[], transfers: ReturnType<typeof transfer>[] = []) =>
    activity('C9', {
      role: 'controller',
      offeringId: null,
      clientCoverage: null,
      engagements: [engagement(MAILCREST, 'Email', countries, { role: 'processor', transfers })],
    });

  it('fires for a country outside the EEA with no transfer to it', () => {
    const c9 = withEngagement(['US']);
    const [finding] = ofType('transfer_missing', { activities: [c9] });
    expect(finding).toEqual({
      type: 'transfer_missing',
      key: `transfer_missing:${c9.engagements[0]!.id}:US`,
      activityId: c9.id,
      engagementId: c9.engagements[0]!.id,
      partyId: MAILCREST,
      country: 'US',
    });
  });

  it('fires for an adequacy country too: adequacy is a mechanism to record, not an exemption (Q2)', () => {
    expect(typesOf(ofType('transfer_missing', { activities: [withEngagement(['GB'])] }))).toEqual([
      'transfer_missing',
    ]);
    expect(typesOf(ofType('transfer_missing', { activities: [withEngagement(['CH'])] }))).toEqual([
      'transfer_missing',
    ]);
  });

  it('is quiet once the transfer is recorded, adequacy included', () => {
    expect(
      ofType('transfer_missing', {
        activities: [withEngagement(['GB'], [transfer('GB', 'adequacy')])],
      }),
    ).toEqual([]);
    expect(
      ofType('transfer_missing', { activities: [withEngagement(['US'], [transfer('US', 'dpf')])] }),
    ).toEqual([]);
  });

  it('is quiet inside the EEA, its non-EU members included', () => {
    expect(
      ofType('transfer_missing', { activities: [withEngagement(['IE', 'DE', 'NO', 'IS', 'LI'])] }),
    ).toEqual([]);
  });

  it('matches the transfer to the country: a US transfer does not cover India', () => {
    const list = ofType('transfer_missing', {
      activities: [withEngagement(['US', 'IN'], [transfer('US', 'dpf')])],
    });
    expect(list.map((finding) => finding.key.split(':').at(-1))).toEqual(['IN']);
  });
});

describe('external_saas_mismatch (DM §5)', () => {
  it('fires for a SaaS system on an activity with no engagement with its host', () => {
    const c1 = { ...C1, engagements: [] };
    expect(ofType('external_saas_mismatch', { activities: [c1] })).toEqual([
      {
        type: 'external_saas_mismatch',
        key: `external_saas_mismatch:system:${C1.id}:sys-peoplehub-hr`,
        activityId: C1.id,
        direction: 'system_without_engagement',
        partyId: PEOPLEHUB,
        systemIds: ['sys-peoplehub-hr'],
        engagementId: null,
      },
    ]);
  });

  it('fires the other way: an engagement with a SaaS host whose systems the activity lists none of', () => {
    const c1 = { ...C1, systemIds: [] };
    const [finding] = ofType('external_saas_mismatch', { activities: [c1] });
    expect(finding).toMatchObject({
      type: 'external_saas_mismatch',
      key: `external_saas_mismatch:engagement:${C1.engagements[0]!.id}`,
      direction: 'engagement_without_system',
      partyId: PEOPLEHUB,
      systemIds: ['sys-peoplehub-hr'],
      engagementId: C1.engagements[0]!.id,
    });
  });

  it('is quiet when both are there, as in C1', () => {
    expect(ofType('external_saas_mismatch', { activities: [C1] })).toEqual([]);
  });

  it('is quiet about Render: it hosts Render systems, not SaaS', () => {
    expect(ofType('external_saas_mismatch', { activities: [C4] })).toEqual([]);
  });
});

describe('region_violation', () => {
  it('fires through an onward transfer: residency in Ireland doesn’t rule out access from India (Ch6)', () => {
    const [finding] = ofType('region_violation');
    expect(finding).toMatchObject({ via: 'transfer', country: 'IN', onwardVia: HELPDESK });
  });

  it('fires for processing outside the region, and reports a country once', () => {
    const p1 = {
      ...P1,
      engagements: [
        {
          ...EU_REGION,
          processingCountries: ['IE', 'US'],
          transfers: [transfer('US', 'dpf')],
        },
      ],
    };
    const list = ofType('region_violation', { activities: [p1] });
    expect(list.map((finding) => [finding.type, finding.key.split(':').at(-1)])).toEqual([
      ['region_violation', 'US'],
    ]);
    expect(list[0]).toMatchObject({ via: 'processing' });
  });

  it('is quiet about the US region: it is not used for Aurelia', () => {
    const list = ofType('region_violation');
    expect(
      list.every((finding) => finding.type !== 'region_violation' || finding.clientId === AURELIA),
    ).toBe(true);
    expect(list).toHaveLength(1);
  });

  it('is quiet for clients whose terms have no region limit', () => {
    const list = ofType('region_violation', { agreements: AGREEMENTS.slice(0, 2) });
    expect(list).toEqual([]);
  });

  it('is quiet about an activity that doesn’t cover the client: Aurelia is out of P3', () => {
    const list = ofType('region_violation', { activities: [P3] });
    expect(list).toEqual([]);
  });

  it('is quiet about controller activities: region terms are the clients’', () => {
    const c9 = activity('C9', {
      role: 'controller',
      offeringId: null,
      clientCoverage: null,
      engagements: [engagement(MAILCREST, 'Email', ['US'], { transfers: [transfer('US', 'dpf')] })],
    });
    expect(ofType('region_violation', { activities: [c9] })).toEqual([]);
  });
});

describe('review_overdue', () => {
  const due = (reviewDueAt: string | null) => ({ ...C1, reviewDueAt });

  it('fires once the review date has passed', () => {
    expect(ofType('review_overdue', { activities: [due('2026-09-25')] })).toEqual([
      {
        type: 'review_overdue',
        key: `review_overdue:${C1.id}`,
        activityId: C1.id,
        reviewDueAt: '2026-09-25',
      },
    ]);
  });

  it('is quiet on the day itself, after it, and with no date', () => {
    expect(ofType('review_overdue', { activities: [due(TODAY)] })).toEqual([]);
    expect(ofType('review_overdue', { activities: [due('2027-02-10')] })).toEqual([]);
    expect(ofType('review_overdue', { activities: [due(null)] })).toEqual([]);
  });
});

describe('the findings as a whole', () => {
  it('puts the most severe first: region violations, then medium, then low', () => {
    const c1 = { ...C1, reviewDueAt: '2026-01-01' };
    const list = findings({
      activities: [c1, P1_CH6],
      systems: [
        render('sys-hireloop-app', 'render_web_service'),
        render('sys-hireloop-db', 'render_postgres'),
        render('sys-cv-parser', 'render_worker'),
        SYSTEMS[3]!,
      ],
    });
    expect(typesOf(list)).toEqual(['region_violation', 'unmapped_system', 'review_overdue']);
  });

  it('ignores drafts and retired activities, and engagements no longer in force', () => {
    const ended = {
      ...P1_CH6,
      engagements: P1_CH6.engagements.map((row) => ({ ...row, endedAt: '2026-01-01' })),
    };
    expect(ofType('region_violation', { activities: [ended] })).toEqual([]);
    expect(
      ofType('region_violation', { activities: [{ ...P1_CH6, status: 'retired' as const }] }),
    ).toEqual([]);
  });

  it('gives the same keys on every run', () => {
    expect(findings().map((finding) => finding.key)).toEqual(
      findings().map((finding) => finding.key),
    );
  });
});
