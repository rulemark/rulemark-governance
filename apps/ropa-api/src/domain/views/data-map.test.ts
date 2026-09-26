import { describe, expect, it } from 'vitest';

import {
  ATS,
  AURELIA,
  C1,
  C4,
  CANDIDATES,
  EMPLOYEES,
  GLITCHLOG,
  HEALTH,
  IDENTITY,
  MAILCREST,
  NORTHWIND,
  P1,
  P2,
  P3,
  PAYROLL,
  PEOPLEHUB,
  RENDER,
  SCRIBE,
  TELEMETRY,
  TODAY,
  activity,
  engagement,
} from '../../../test/fixtures/story-snapshots.js';
import { dataMap, type DataMapInput } from './data-map.js';

/**
 * `GET /data-map` as a pure function over aggregates (DM §7, API §5.4):
 * Chapter 7's two requests. Lena, a candidate who applied to Northwind, and
 * Kees, a former Hireloop employee, both ask for their data to be erased.
 */

const EVERYONE = [C1, C4, P1, P2, P3];

function map(overrides: Partial<DataMapInput> = {}) {
  return dataMap({
    subjectCategoryId: CANDIDATES,
    client: { id: NORTHWIND, offeringIds: new Set([ATS]) },
    activities: EVERYONE,
    day: TODAY,
    ...overrides,
  });
}

const summary = (entries: ReturnType<typeof map>) =>
  entries.map((entry) => `${entry.activity.code} ${entry.action}`);
const vendorsOf = (entries: ReturnType<typeof map>, code: string) =>
  entries.find((entry) => entry.activity.code === code)!.vendors.map((vendor) => vendor.partyId);

describe('Lena’s request: candidates, for Northwind (Ch7)', () => {
  it('acts on C4 and forwards P1 and P3; P2 is a module Northwind never enabled', () => {
    expect(summary(map())).toEqual(['C4 act', 'P1 forward', 'P3 forward']);
  });

  it('points at the vendors each activity uses for Northwind: Mailcrest in the US, Glitchlog', () => {
    expect(vendorsOf(map(), 'P1')).toEqual([RENDER, MAILCREST, GLITCHLOG]);
    expect(vendorsOf(map(), 'P3')).toEqual([SCRIBE]);
  });

  it('lists what Glitchlog receives for C4 as recorded, telemetry too: an upper bound (Q6)', () => {
    const c4 = map().find((entry) => entry.activity.code === 'C4')!;
    expect(c4.vendors).toEqual([
      { partyId: RENDER, role: 'processor', dataCategoryIds: [TELEMETRY, IDENTITY] },
      { partyId: GLITCHLOG, role: 'processor', dataCategoryIds: [TELEMETRY, IDENTITY] },
    ]);
  });
});

describe('the same request for an Aurelia candidate', () => {
  const aurelia = () => map({ client: { id: AURELIA, offeringIds: new Set([ATS]) } });

  it('includes the module she enabled and leaves out CV parsing, switched off for her', () => {
    expect(summary(aurelia())).toEqual(['C4 act', 'P1 forward', 'P2 forward']);
  });

  it('uses Mailcrest’s EU region for her, and no Glitchlog', () => {
    expect(vendorsOf(aurelia(), 'P1')).toEqual([RENDER, MAILCREST]);
  });
});

describe('Kees’s request: employees (Ch7)', () => {
  it('finds only C1, where Hireloop decides, and Peoplehub with what it holds', () => {
    const entries = map({ subjectCategoryId: EMPLOYEES, client: null });
    expect(summary(entries)).toEqual(['C1 act']);
    expect(entries[0]!.vendors).toEqual([
      { partyId: PEOPLEHUB, role: 'processor', dataCategoryIds: [IDENTITY, PAYROLL, HEALTH] },
    ]);
  });
});

describe('scoping by client (DM §3.8)', () => {
  it('without a client, forwards for every processor activity and lists every engagement', () => {
    const entries = map({ client: null });
    expect(summary(entries)).toEqual(['C4 act', 'P1 forward', 'P2 forward', 'P3 forward']);
    expect(vendorsOf(entries, 'P1')).toEqual([RENDER, MAILCREST, GLITCHLOG]);
  });

  it('gives a client with no agreement for the offering only Hireloop’s own activities', () => {
    expect(summary(map({ client: { id: NORTHWIND, offeringIds: new Set() } }))).toEqual(['C4 act']);
  });

  it('always includes controller activities, whatever the client', () => {
    const entries = map({ client: { id: 'party-someone', offeringIds: new Set() } });
    expect(summary(entries)).toEqual(['C4 act']);
  });
});

describe('vendors', () => {
  it('names a party once per role, merging what its engagements receive', () => {
    const p9 = activity('P9', {
      subjectCategoryIds: [CANDIDATES],
      engagements: [
        engagement(MAILCREST, 'Notifications (US)', ['US'], { dataCategoryIds: [IDENTITY] }),
        engagement(MAILCREST, 'Notifications (EU)', ['IE'], {
          dataCategoryIds: [IDENTITY, HEALTH],
        }),
      ],
    });
    const [entry] = map({ activities: [p9], client: null });
    expect(entry!.vendors).toEqual([
      { partyId: MAILCREST, role: 'subprocessor', dataCategoryIds: [IDENTITY, HEALTH] },
    ]);
  });

  it('includes a recipient: erasure must be passed on to it too (Art. 19)', () => {
    const c9 = activity('C9', {
      role: 'controller',
      offeringId: null,
      clientCoverage: null,
      subjectCategoryIds: [CANDIDATES],
      engagements: [engagement('party-ledgerpay', 'Payments', ['IE'], { role: 'recipient' })],
    });
    expect(map({ activities: [c9] })[0]!.vendors[0]!.role).toBe('recipient');
  });
});

describe('what is left out', () => {
  it('ignores drafts, retired activities and other subject categories', () => {
    const draft = activity('P7', { status: 'draft', subjectCategoryIds: [CANDIDATES] });
    const retired = activity('P8', { status: 'retired', subjectCategoryIds: [CANDIDATES] });
    expect(map({ activities: [draft, retired, C1] })).toEqual([]);
  });

  it('ignores an engagement no longer in force', () => {
    const p9 = activity('P9', {
      subjectCategoryIds: [CANDIDATES],
      engagements: [engagement(MAILCREST, 'Old', ['US'], { endedAt: '2026-01-01' })],
    });
    expect(map({ activities: [p9], client: null })[0]!.vendors).toEqual([]);
  });
});
