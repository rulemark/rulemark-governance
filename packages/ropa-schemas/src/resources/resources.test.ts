import { describe, expect, it } from 'vitest';

import {
  Agreement,
  AgreementInput,
  AgreementTerms,
  AgreementTermsInput,
  DataCategory,
  DataCategoryInput,
  Offering,
  OfferingInput,
  Party,
  PartyInput,
  SecurityMeasureInput,
  SubjectCategoryInput,
  System,
  SystemInput,
  listResponse,
} from './index.js';

const UUID = '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e';
const TIMESTAMPS = { createdAt: '2026-03-16T10:00:00Z', updatedAt: '2026-03-16T10:00:00Z' };

describe('PartyInput', () => {
  const mailcrest = {
    kind: 'vendor',
    legalName: 'Mailcrest Inc.',
    country: 'US',
    subprocessorListUrl: 'https://mailcrest.example/subprocessors',
  };

  it('accepts a vendor', () => {
    expect(PartyInput.safeParse(mailcrest).success).toBe(true);
  });

  it('takes an optional slug on create, derived from the name when absent (§1.2)', () => {
    expect(PartyInput.safeParse({ ...mailcrest, slug: 'mailcrest' }).success).toBe(true);
    expect(PartyInput.safeParse({ ...mailcrest, slug: 'Mailcrest' }).success).toBe(false);
  });

  it('requires a DPO on the self party (Art. 30(1)(a), DM §3.5)', () => {
    const self = { kind: 'self', legalName: 'Hireloop B.V.', country: 'NL' };
    expect(PartyInput.safeParse(self).success).toBe(false);

    const result = PartyInput.safeParse({
      ...self,
      dpoName: 'Priya Raman',
      dpoEmail: 'dpo@hireloop.example',
    });
    expect(result.success).toBe(true);
  });

  it('points the DPO error at the missing field, not at the record', () => {
    const result = PartyInput.safeParse({
      kind: 'self',
      legalName: 'Hireloop B.V.',
      country: 'NL',
    });
    const paths = result.error?.issues.map((issue) => issue.path.join('.')) ?? [];
    expect(paths).toContain('dpoName');
    expect(paths).toContain('dpoEmail');
  });

  it('does not ask a vendor for a DPO', () => {
    expect(PartyInput.safeParse(mailcrest).success).toBe(true);
  });

  it('rejects an unknown kind and a malformed country', () => {
    expect(PartyInput.safeParse({ ...mailcrest, kind: 'supplier' }).success).toBe(false);
    expect(PartyInput.safeParse({ ...mailcrest, country: 'USA' }).success).toBe(false);
  });

  it('rejects an email that is not one', () => {
    expect(PartyInput.safeParse({ ...mailcrest, contactEmail: 'not-an-email' }).success).toBe(
      false,
    );
  });

  it('takes an optional changeNote, which belongs to the change and not the record (§1.6)', () => {
    const parsed = PartyInput.parse({ ...mailcrest, changeNote: 'Added Mailcrest' });
    expect(parsed.changeNote).toBe('Added Mailcrest');
  });

  it('ignores read-only fields if a caller sends them back', () => {
    const parsed = PartyInput.parse({ ...mailcrest, id: UUID, version: 7, createdAt: 'whenever' });
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('version');
    expect(parsed).not.toHaveProperty('createdAt');
  });
});

describe('Party (output)', () => {
  const row = {
    id: UUID,
    slug: 'mailcrest',
    kind: 'vendor',
    name: 'Mailcrest Inc.',
    legalName: 'Mailcrest Inc.',
    country: 'US',
    contactName: null,
    contactEmail: null,
    dpoName: null,
    dpoEmail: null,
    trustUrl: null,
    dpaUrl: null,
    subprocessorListUrl: 'https://mailcrest.example/subprocessors',
    version: 1,
    ...TIMESTAMPS,
  };

  it('returns every identifier plus the name (DM §3.0, Q6)', () => {
    const parsed = Party.parse(row);
    expect(parsed.id).toBe(UUID);
    expect(parsed.slug).toBe('mailcrest');
    expect(parsed.name).toBe('Mailcrest Inc.');
  });

  it('carries the version, which is also the ETag (§1.8)', () => {
    expect(Party.parse(row).version).toBe(1);
  });

  it('never returns the changeNote: it belongs to the revision, not the record (§1.6)', () => {
    const parsed = Party.parse({ ...row, changeNote: 'Added Mailcrest' });
    expect(parsed).not.toHaveProperty('changeNote');
  });

  it('spells an unset optional field as null rather than leaving it out', () => {
    const { contactName: _contactName, ...withoutContactName } = row;
    expect(Party.safeParse(withoutContactName).success).toBe(false);
    expect(Party.parse(row).contactName).toBeNull();
  });
});

describe('AgreementTermsInput', () => {
  const standard = {
    name: 'Standard DPA v3',
    direction: 'outbound',
    authorizationType: 'general',
    noticeDays: 30,
  };

  it('accepts the standard terms', () => {
    expect(AgreementTermsInput.safeParse(standard).success).toBe(true);
  });

  it('defaults allowedRegions to none, meaning no restriction (DM §3.6)', () => {
    expect(AgreementTermsInput.parse(standard).allowedRegions).toEqual([]);
  });

  it("accepts Aurelia's EEA restriction", () => {
    expect(
      AgreementTermsInput.parse({ ...standard, allowedRegions: ['EEA'] }).allowedRegions,
    ).toEqual(['EEA']);
  });

  it('rejects a notice period that is negative or fractional', () => {
    expect(AgreementTermsInput.safeParse({ ...standard, noticeDays: -1 }).success).toBe(false);
    expect(AgreementTermsInput.safeParse({ ...standard, noticeDays: 30.5 }).success).toBe(false);
  });

  it('rejects an unknown direction or authorization type', () => {
    expect(AgreementTermsInput.safeParse({ ...standard, direction: 'sideways' }).success).toBe(
      false,
    );
    expect(AgreementTermsInput.safeParse({ ...standard, authorizationType: 'vague' }).success).toBe(
      false,
    );
  });
});

describe('AgreementTerms (output)', () => {
  it('returns the slug, name and version', () => {
    const parsed = AgreementTerms.parse({
      id: UUID,
      slug: 'standard-dpa-v3',
      name: 'Standard DPA v3',
      direction: 'outbound',
      authorizationType: 'general',
      noticeDays: 30,
      allowedRegions: [],
      documentUrl: null,
      version: 3,
      ...TIMESTAMPS,
    });
    expect(parsed.slug).toBe('standard-dpa-v3');
    expect(parsed.version).toBe(3);
  });
});

describe('OfferingInput', () => {
  it('takes the default terms by any identifier (§1.2)', () => {
    expect(
      OfferingInput.parse({ name: 'Hireloop ATS', defaultTerms: 'standard-dpa-v3' }).defaultTerms,
    ).toBe('standard-dpa-v3');
    expect(OfferingInput.safeParse({ name: 'Hireloop ATS', defaultTerms: UUID }).success).toBe(
      true,
    );
  });

  it('requires the default terms', () => {
    expect(OfferingInput.safeParse({ name: 'Hireloop ATS' }).success).toBe(false);
  });
});

describe('Offering (output)', () => {
  it('returns the default terms as a Ref, not an identifier string', () => {
    const parsed = Offering.parse({
      id: UUID,
      slug: 'ats',
      name: 'Hireloop ATS',
      defaultTerms: { id: UUID, slug: 'standard-dpa-v3', name: 'Standard DPA v3' },
      version: 1,
      ...TIMESTAMPS,
    });
    expect(parsed.defaultTerms.slug).toBe('standard-dpa-v3');
  });
});

describe('AgreementInput', () => {
  const aurelia = {
    party: 'aurelia',
    terms: 'aurelia-dpa',
    offering: 'ats',
    signedAt: '2026-03-16',
  };

  it("accepts Aurelia's signing (Ch4)", () => {
    expect(AgreementInput.safeParse(aurelia).success).toBe(true);
  });

  it('allows no offering, because inbound terms have none', () => {
    const { offering: _offering, ...inbound } = aurelia;
    expect(AgreementInput.safeParse(inbound).success).toBe(true);
  });

  it('ends an agreement with endedAt (§4)', () => {
    expect(AgreementInput.safeParse({ ...aurelia, endedAt: '2027-03-16' }).success).toBe(true);
  });

  it('refuses an end date before the signature (agreement_dates)', () => {
    const result = AgreementInput.safeParse({ ...aurelia, endedAt: '2026-01-01' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('endedAt');
  });

  it('allows an end date equal to the signature date', () => {
    expect(AgreementInput.safeParse({ ...aurelia, endedAt: '2026-03-16' }).success).toBe(true);
  });

  it('requires the party, terms and signature date', () => {
    expect(AgreementInput.safeParse({ terms: 'aurelia-dpa', signedAt: '2026-03-16' }).success).toBe(
      false,
    );
    expect(AgreementInput.safeParse({ party: 'aurelia', signedAt: '2026-03-16' }).success).toBe(
      false,
    );
    expect(AgreementInput.safeParse({ party: 'aurelia', terms: 'aurelia-dpa' }).success).toBe(
      false,
    );
  });
});

describe('Agreement (output)', () => {
  it('returns each reference as a Ref and has no slug of its own (§4)', () => {
    const parsed = Agreement.parse({
      id: UUID,
      party: { id: UUID, slug: 'aurelia', name: 'Aurelia Health N.V.' },
      terms: { id: UUID, slug: 'aurelia-dpa', name: 'Aurelia DPA' },
      offering: { id: UUID, slug: 'ats', name: 'Hireloop ATS' },
      signedAt: '2026-03-16',
      endedAt: null,
      version: 1,
      ...TIMESTAMPS,
    });
    expect(parsed.party.slug).toBe('aurelia');
    expect(parsed).not.toHaveProperty('slug');
  });
});

describe('SystemInput', () => {
  const database = {
    name: 'Primary database',
    kind: 'render_postgres',
    region: 'frankfurt',
    hostingParty: 'render',
  };

  it('accepts a Render system', () => {
    expect(SystemInput.safeParse(database).success).toBe(true);
  });

  it('requires a region for a Render kind (system_render_region)', () => {
    const { region: _region, ...withoutRegion } = database;
    const result = SystemInput.safeParse(withoutRegion);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('region');
  });

  it('does not ask external SaaS for a region', () => {
    expect(
      SystemInput.safeParse({
        name: 'Peoplehub HR',
        kind: 'external_saas',
        hostingParty: 'peoplehub',
      }).success,
    ).toBe(true);
  });

  it('carries the Render resource id the Snapshot joins on (DM §3.9)', () => {
    expect(
      SystemInput.parse({ ...database, renderResourceId: 'dpg-abc123' }).renderResourceId,
    ).toBe('dpg-abc123');
  });
});

describe('System (output)', () => {
  it('returns the hosting party as a Ref', () => {
    const parsed = System.parse({
      id: UUID,
      slug: 'hireloop-db',
      name: 'Primary database',
      kind: 'render_postgres',
      renderResourceId: 'dpg-abc123',
      region: 'frankfurt',
      hostingParty: { id: UUID, slug: 'render', name: 'Render Inc.' },
      version: 1,
      ...TIMESTAMPS,
    });
    expect(parsed.hostingParty.name).toBe('Render Inc.');
  });
});

describe('taxonomies', () => {
  it('defaults a data category to not special (DM §3.10)', () => {
    expect(DataCategoryInput.parse({ name: 'Identity' }).special).toBe('none');
  });

  it('marks health data as Art. 9', () => {
    expect(DataCategoryInput.parse({ name: 'Health data', special: 'art9' }).special).toBe('art9');
  });

  it('rejects an unknown special value', () => {
    expect(DataCategoryInput.safeParse({ name: 'Health', special: 'sensitive' }).success).toBe(
      false,
    );
  });

  it('gives subject categories and security measures a name and an optional description', () => {
    expect(SubjectCategoryInput.safeParse({ name: 'Candidates' }).success).toBe(true);
    expect(
      SecurityMeasureInput.safeParse({ name: 'Encryption at rest', description: 'AES-256' })
        .success,
    ).toBe(true);
    expect(SubjectCategoryInput.safeParse({}).success).toBe(false);
  });

  it('returns the special flag on the way out', () => {
    const parsed = DataCategory.parse({
      id: UUID,
      slug: 'health',
      name: 'Health data',
      description: null,
      special: 'art9',
      version: 1,
      ...TIMESTAMPS,
    });
    expect(parsed.special).toBe('art9');
  });
});

describe('listResponse', () => {
  const PartyList = listResponse(Party);

  it('wraps a page as data plus nextCursor (§1.3)', () => {
    const parsed = PartyList.parse({ data: [], nextCursor: null });
    expect(parsed.data).toEqual([]);
    expect(parsed.nextCursor).toBeNull();
  });

  it('requires nextCursor to be present, null on the last page', () => {
    expect(PartyList.safeParse({ data: [] }).success).toBe(false);
  });

  it('validates the records it contains', () => {
    expect(PartyList.safeParse({ data: [{ nope: true }], nextCursor: null }).success).toBe(false);
  });
});
