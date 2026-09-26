import { describe, expect, it } from 'vitest';

import {
  AsOf,
  Code,
  CountryCode,
  Cursor,
  Email,
  Identifier,
  IsoDate,
  IsoDateTime,
  IsoDuration,
  MAX_CODE,
  MAX_EMAIL,
  MAX_NAME,
  MAX_SLUG,
  MAX_TEXT,
  MAX_URL,
  Name,
  Ref,
  RegionCode,
  Slug,
  Text,
  Url,
  Uuid,
} from './primitives.js';

describe('Slug', () => {
  it.each(['health', 'standard-dpa-v3', 'hireloop-db', 'ats'])('accepts %s', (value) => {
    expect(Slug.safeParse(value).success).toBe(true);
  });

  it.each(['Health', 'has space', '-leading', 'trailing-', 'double--hyphen', ''])(
    'rejects %s',
    (value) => {
      expect(Slug.safeParse(value).success).toBe(false);
    },
  );

  it('rejects a UUID-shaped slug, so the API can always tell the two apart (DM §3.0)', () => {
    expect(Slug.safeParse('3f9c1a2b-4d5e-7f80-9a1b-2c3d4e5f6071').success).toBe(false);
  });
});

describe('CountryCode', () => {
  it.each(['DE', 'US', 'IN', 'IE'])('accepts %s', (value) => {
    expect(CountryCode.safeParse(value).success).toBe(true);
  });

  it.each(['de', 'DEU', 'D', ''])('rejects %s', (value) => {
    expect(CountryCode.safeParse(value).success).toBe(false);
  });
});

describe('RegionCode', () => {
  it('accepts the EEA region and plain country codes (agreement_terms.allowed_regions)', () => {
    expect(RegionCode.safeParse('EEA').success).toBe(true);
    expect(RegionCode.safeParse('IE').success).toBe(true);
    expect(RegionCode.safeParse('eea').success).toBe(false);
  });
});

/**
 * Exactly what the database's `retention_period` check accepts (DB §4.4), so a
 * request that passes here cannot fail there. Zero and weeks mixed with other
 * components are allowed on both sides.
 */
describe('IsoDuration', () => {
  it.each(['P90D', 'P7Y', 'P6M', 'P2W', 'P1Y6M', 'P1Y2M3W4D', 'P1Y2W', 'P0D'])(
    'accepts %s',
    (value) => {
      expect(IsoDuration.safeParse(value).success).toBe(true);
    },
  );

  it.each(['PT12H', 'PT30M', 'P1DT12H'])('rejects %s: no time components', (value) => {
    expect(IsoDuration.safeParse(value).success).toBe(false);
  });

  it.each(['P', 'P1.5Y', 'P6M1Y', 'P1D1D', 'p90d', '-P1D', '90D', '7 years', ''])(
    'rejects %s',
    (value) => {
      expect(IsoDuration.safeParse(value).success).toBe(false);
    },
  );
});

describe('IsoDate and IsoDateTime', () => {
  it('accepts a business date', () => {
    expect(IsoDate.safeParse('2026-03-16').success).toBe(true);
  });

  it('rejects a timestamp where a date is expected', () => {
    expect(IsoDate.safeParse('2026-03-16T10:00:00Z').success).toBe(false);
  });

  it('rejects a date that does not exist', () => {
    expect(IsoDate.safeParse('2026-02-30').success).toBe(false);
  });

  it('accepts an RFC 3339 timestamp', () => {
    expect(IsoDateTime.safeParse('2026-03-16T10:00:00Z').success).toBe(true);
  });
});

describe('AsOf', () => {
  it('takes either a date or a timestamp, because a report can be asked for either', () => {
    expect(AsOf.safeParse('2026-03-16').success).toBe(true);
    expect(AsOf.safeParse('2026-03-16T10:00:00Z').success).toBe(true);
    expect(AsOf.safeParse('March').success).toBe(false);
  });
});

describe('Uuid', () => {
  it('accepts a UUIDv7, which is what Postgres 18 generates', () => {
    expect(Uuid.safeParse('0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e').success).toBe(true);
  });

  it('rejects a slug', () => {
    expect(Uuid.safeParse('mailcrest').success).toBe(false);
  });
});

describe('Identifier', () => {
  it('accepts any of the three identifier kinds a path or body may carry (DM §3.0)', () => {
    expect(Identifier.safeParse('0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e').success).toBe(true);
    expect(Identifier.safeParse('mailcrest').success).toBe(true);
    expect(Identifier.safeParse('P3').success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(Identifier.safeParse('').success).toBe(false);
  });
});

describe('Ref', () => {
  it('is the small object every reference is returned as (§1.2)', () => {
    const parsed = Ref.parse({
      id: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
      slug: 'mailcrest',
      name: 'Mailcrest Inc.',
    });
    expect(parsed.slug).toBe('mailcrest');
  });

  it('allows a code instead of a slug, for activities and review items', () => {
    expect(
      Ref.safeParse({
        id: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
        code: 'P3',
        name: 'CV parsing',
      }).success,
    ).toBe(true);
  });

  it('allows neither, because an agreement has only an id', () => {
    expect(
      Ref.safeParse({ id: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e', name: 'Aurelia — Standard DPA' })
        .success,
    ).toBe(true);
  });

  it('always needs an id and a name', () => {
    expect(Ref.safeParse({ slug: 'mailcrest', name: 'Mailcrest Inc.' }).success).toBe(false);
    expect(Ref.safeParse({ id: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e' }).success).toBe(false);
  });
});

describe('Cursor', () => {
  it('is an opaque non-empty string', () => {
    expect(Cursor.safeParse('eyJpZCI6IjAxOTkifQ').success).toBe(true);
    expect(Cursor.safeParse('').success).toBe(false);
  });
});

describe('length bounds', () => {
  /**
   * A pattern says what a value looks like, not how much of it there may be.
   * Without these, the API accepted a 5,000-character slug and a megabyte-long
   * name — which is how the Swagger UI example came to be a wall of text.
   */
  it('bounds a slug', () => {
    expect(Slug.safeParse('a'.repeat(MAX_SLUG)).success).toBe(true);
    expect(Slug.safeParse('a'.repeat(MAX_SLUG + 1)).success).toBe(false);
  });

  it('bounds a code', () => {
    expect(Code.safeParse(`P${'9'.repeat(MAX_CODE)}`).success).toBe(false);
  });

  it('bounds a name', () => {
    expect(Name.safeParse('x'.repeat(MAX_NAME)).success).toBe(true);
    expect(Name.safeParse('x'.repeat(MAX_NAME + 1)).success).toBe(false);
  });

  it('bounds free text, an email and a URL', () => {
    expect(Text.safeParse('x'.repeat(MAX_TEXT + 1)).success).toBe(false);
    expect(Email.safeParse(`${'x'.repeat(MAX_EMAIL)}@example.com`).success).toBe(false);
    expect(Url.safeParse(`https://example.com/${'x'.repeat(MAX_URL)}`).success).toBe(false);
  });

  it('bounds an identifier, which arrives in a path segment', () => {
    expect(Identifier.safeParse('x'.repeat(MAX_SLUG + 1)).success).toBe(false);
  });

  it('leaves the values the story actually uses well inside the bounds', () => {
    for (const slug of ['mailcrest', 'standard-dpa-v3', 'encryption-at-rest']) {
      expect(Slug.safeParse(slug).success, slug).toBe(true);
    }
    expect(Name.safeParse('Aurelia Health N.V.').success).toBe(true);
  });
});
