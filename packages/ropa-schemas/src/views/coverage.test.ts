import { describe, expect, it } from 'vitest';

import { FINDING_TYPES } from '../enums.js';
import { CoverageResponse, FINDING_SEVERITY } from './coverage.js';

const id = (n: number) => `0199c3a1-8f2e-7c4d-b8e1-${String(n).padStart(12, '0')}`;
const p1 = { id: id(1), code: 'P1', name: 'Candidate application management' };
const mailcrest = { id: id(2), slug: 'mailcrest', name: 'Mailcrest Inc.' };
const eu = { id: id(3), serviceDescription: 'Candidate notifications (EU region)' };

/** Ch6: Helpdesk Partners in India reaching Mailcrest's EU region, for Aurelia. */
const regionViolation = {
  key: `region_violation:${eu.id}:${id(4)}:IN`,
  type: 'region_violation',
  severity: 'high',
  targetType: 'activity',
  target: p1,
  details: {
    engagement: eu,
    party: mailcrest,
    client: { id: id(4), slug: 'aurelia', name: 'Aurelia Bank S.A.' },
    terms: { id: id(5), slug: 'aurelia-dpa', name: 'Aurelia Bank DPA' },
    allowedRegions: ['EEA'],
    country: 'IN',
    via: 'transfer',
    onwardVia: 'Helpdesk Partners Pvt Ltd',
  },
};

describe('CoverageResponse (§5.5)', () => {
  it('describes Aurelia’s region violation', () => {
    const parsed = CoverageResponse.safeParse({
      generatedAt: '2026-09-26T08:00:00Z',
      findings: [regionViolation],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('describes each of the other findings', () => {
    const findings = [
      {
        key: `unmapped_system:${id(6)}`,
        type: 'unmapped_system',
        severity: 'medium',
        targetType: 'system',
        target: { id: id(6), slug: 'cv-parser', name: 'CV parsing worker' },
        details: { kind: 'render_worker', renderResourceId: null },
      },
      {
        key: `transfer_missing:${eu.id}:GB`,
        type: 'transfer_missing',
        severity: 'medium',
        targetType: 'activity',
        target: p1,
        details: { engagement: eu, party: mailcrest, country: 'GB' },
      },
      {
        key: `external_saas_mismatch:system:${id(7)}:${id(8)}`,
        type: 'external_saas_mismatch',
        severity: 'low',
        targetType: 'activity',
        target: { id: id(7), code: 'C1', name: 'Hireloop staff administration' },
        details: {
          direction: 'system_without_engagement',
          party: { id: id(9), slug: 'peoplehub', name: 'Peoplehub GmbH' },
          systems: [{ id: id(8), slug: 'peoplehub-hr', name: 'Peoplehub HR' }],
          engagement: null,
        },
      },
      {
        key: `review_overdue:${p1.id}`,
        type: 'review_overdue',
        severity: 'low',
        targetType: 'activity',
        target: p1,
        details: { reviewDueAt: '2026-06-01' },
      },
    ];
    const parsed = CoverageResponse.safeParse({ generatedAt: '2026-09-26T08:00:00Z', findings });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('holds each type to its fixed severity (Q3)', () => {
    const downgraded = { ...regionViolation, severity: 'low' };
    expect(
      CoverageResponse.safeParse({ generatedAt: '2026-09-26T08:00:00Z', findings: [downgraded] })
        .success,
    ).toBe(false);
  });

  it('needs a key: it is how a caller tells a new finding from one already opened (Q4)', () => {
    const { key: _key, ...keyless } = regionViolation;
    expect(
      CoverageResponse.safeParse({ generatedAt: '2026-09-26T08:00:00Z', findings: [keyless] })
        .success,
    ).toBe(false);
  });
});

describe('FINDING_SEVERITY', () => {
  it('gives every finding type one severity: high for a broken contract', () => {
    expect(Object.keys(FINDING_SEVERITY).sort()).toEqual([...FINDING_TYPES].sort());
    expect(FINDING_SEVERITY).toEqual({
      region_violation: 'high',
      transfer_missing: 'medium',
      unmapped_system: 'medium',
      external_saas_mismatch: 'low',
      review_overdue: 'low',
    });
  });
});
