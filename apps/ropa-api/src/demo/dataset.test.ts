import {
  AgreementInput,
  AgreementTermsInput,
  DataCategoryInput,
  OfferingInput,
  PartyInput,
  SecurityMeasureInput,
  SubjectCategoryInput,
  SystemInput,
} from '@rulemark/ropa-schemas';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { DEMO_AGREEMENTS, DEMO_RECORDS } from './dataset.js';

/**
 * The demo data is only exercised when someone runs `demo:data` against a live
 * service, which is exactly when a typo is most annoying to find. These checks
 * need no server and no database.
 */
const SCHEMAS: Record<string, z.ZodType> = {
  parties: PartyInput,
  'agreement-terms': AgreementTermsInput,
  offerings: OfferingInput,
  systems: SystemInput,
  'taxonomy/subject-categories': SubjectCategoryInput,
  'taxonomy/data-categories': DataCategoryInput,
  'taxonomy/security-measures': SecurityMeasureInput,
};

describe('the demo dataset', () => {
  it('sends only bodies the API would accept', () => {
    for (const record of DEMO_RECORDS) {
      const schema = SCHEMAS[record.path];
      expect(schema, `no schema known for ${record.path}`).toBeDefined();

      const result = schema!.safeParse(record.body);
      expect(
        result.success,
        `${record.path}/${record.slug}: ${result.error?.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
      ).toBe(true);
    }
  });

  it('agrees with itself about slugs', () => {
    for (const record of DEMO_RECORDS) {
      expect((record.body as { slug?: string }).slug, record.slug).toBe(record.slug);
    }
  });

  it('never defines the same record twice', () => {
    const keys = DEMO_RECORDS.map((record) => `${record.path}/${record.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only references records it defines, and defines them first', () => {
    // The loader posts these in order, so a forward reference would fail
    // against an empty database but pass against a seeded one — the kind of
    // bug that only appears on a fresh environment.
    const seen = new Set<string>();

    for (const record of DEMO_RECORDS) {
      const body = record.body as Record<string, unknown>;
      for (const field of ['defaultTerms', 'hostingParty'] as const) {
        const reference = body[field];
        if (typeof reference !== 'string') continue;
        expect(seen, `${record.slug}.${field} -> ${reference}`).toContain(reference);
      }
      seen.add(record.slug);
    }

    for (const agreement of DEMO_AGREEMENTS) {
      expect(seen, `agreement party ${agreement.party}`).toContain(agreement.party);
      expect(seen, `agreement terms ${agreement.terms}`).toContain(agreement.terms);
      if (agreement.offering !== undefined) {
        expect(seen, `agreement offering ${agreement.offering}`).toContain(agreement.offering);
      }
    }
  });

  it('describes agreements the API would accept', () => {
    for (const agreement of DEMO_AGREEMENTS) {
      expect(AgreementInput.safeParse(agreement).success, agreement.party).toBe(true);
    }
  });

  it('includes exactly one self party, because only one is allowed', () => {
    const selves = DEMO_RECORDS.filter(
      (record) => (record.body as { kind?: string }).kind === 'self',
    );
    expect(selves).toHaveLength(1);
  });

  it('covers enough of the story to be worth loading', () => {
    expect(DEMO_RECORDS.length + DEMO_AGREEMENTS.length).toBeGreaterThan(30);
  });
});
