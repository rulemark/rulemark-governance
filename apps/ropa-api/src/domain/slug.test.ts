import { Slug } from '@rulemark/ropa-schemas';
import { describe, expect, it } from 'vitest';

import { slugify } from './slug.js';

describe('slugify', () => {
  it('derives the slug the story uses from the name (§1.2)', () => {
    expect(slugify('Mailcrest Inc.')).toBe('mailcrest-inc');
    expect(slugify('Hireloop ATS')).toBe('hireloop-ats');
    expect(slugify('Standard DPA v3')).toBe('standard-dpa-v3');
    expect(slugify('Health data')).toBe('health-data');
  });

  it('folds accents rather than dropping the letter', () => {
    // "Tomás" must not become "tom-s".
    expect(slugify('Tomás Herrera')).toBe('tomas-herrera');
    expect(slugify('Aurelia Health N.V.')).toBe('aurelia-health-n-v');
  });

  it('collapses punctuation and whitespace into single hyphens', () => {
    expect(slugify('  Peoplehub   HR  ')).toBe('peoplehub-hr');
    expect(slugify('A/B — testing')).toBe('a-b-testing');
    expect(slugify('encryption_at_rest')).toBe('encryption-at-rest');
  });

  it('always produces something the Slug schema accepts', () => {
    for (const name of ['Mailcrest Inc.', 'Tomás Herrera', 'A/B — testing', '99 Problems']) {
      expect(Slug.safeParse(slugify(name)).success, name).toBe(true);
    }
  });

  it('gives up rather than inventing a slug from nothing', () => {
    // The caller is told to supply one, instead of getting "-" or "".
    expect(slugify('...')).toBeUndefined();
    expect(slugify('   ')).toBeUndefined();
    expect(slugify('')).toBeUndefined();
  });

  it('breaks a name that would otherwise look like a UUID', () => {
    // A slug may never be UUID-shaped, or a path segment becomes ambiguous.
    const derived = slugify('0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e');
    expect(derived).toBeDefined();
    expect(Slug.safeParse(derived).success).toBe(true);
  });
});
