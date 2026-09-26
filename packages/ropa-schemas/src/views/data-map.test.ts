import { describe, expect, it } from 'vitest';

import { DataMapQuery, DataMapResponse } from './data-map.js';

const id = (n: number) => `0199c3a1-8f2e-7c4d-b8e1-${String(n).padStart(12, '0')}`;

/** Kees's request (Ch7): C1, where Hireloop decides, and its retention rules. */
const kees = {
  generatedAt: '2026-07-10T09:00:00Z',
  asOf: null,
  subjectCategory: { id: id(1), slug: 'employees', name: 'Employees' },
  client: null,
  entries: [
    {
      activity: { id: id(2), code: 'C1', name: 'Hireloop staff administration' },
      role: 'controller',
      action: 'act',
      systems: [{ id: id(3), slug: 'peoplehub-hr', name: 'Peoplehub HR' }],
      vendors: [
        {
          party: { id: id(4), slug: 'peoplehub', name: 'Peoplehub GmbH' },
          role: 'processor',
          dataCategories: [{ id: id(5), slug: 'health', name: 'Health data' }],
        },
      ],
      retention: [
        {
          id: id(6),
          dataCategory: { id: id(5), slug: 'health', name: 'Health data' },
          retentionPeriod: 'P2Y',
          triggerEvent: 'after the sick-leave period ends',
          legalRef: null,
        },
      ],
    },
  ],
};

describe('DataMapResponse (§5.4)', () => {
  it('describes a controller entry, which acts and carries its retention rules', () => {
    const parsed = DataMapResponse.safeParse(kees);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('describes a processor entry, which forwards and has no retention: the client decides', () => {
    const [entry] = kees.entries;
    const forward = { ...entry, role: 'processor', action: 'forward', retention: null };
    expect(DataMapResponse.safeParse({ ...kees, entries: [forward] }).success).toBe(true);
  });

  it('refuses an action other than act or forward', () => {
    const [entry] = kees.entries;
    const odd = { ...entry, action: 'ignore' };
    expect(DataMapResponse.safeParse({ ...kees, entries: [odd] }).success).toBe(false);
  });
});

describe('DataMapQuery', () => {
  it('requires a subject category, and takes a client and asOf', () => {
    expect(DataMapQuery.safeParse({}).success).toBe(false);
    expect(DataMapQuery.safeParse({ subjectCategory: 'candidates' }).success).toBe(true);
    expect(
      DataMapQuery.safeParse({ subjectCategory: 'candidates', client: 'northwind' }).success,
    ).toBe(true);
    expect(
      DataMapQuery.safeParse({ subjectCategory: 'candidates', asOf: '2026-07-01' }).success,
    ).toBe(true);
  });
});
