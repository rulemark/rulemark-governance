import { describe, expect, it } from 'vitest';

import { fieldErrorsFromZod } from '../errors.ts';
import { SubprocessorsQuery, SubprocessorsResponse } from './subprocessors.ts';

describe('SubprocessorsResponse.asOf', () => {
  it('echoes the asOf asked for: a date, a timestamp, or null for today', () => {
    for (const asOf of ['2026-03-01', '2026-03-16T15:00:00+01:00', null]) {
      expect(SubprocessorsResponse.shape.asOf.safeParse(asOf).success).toBe(true);
    }
    expect(SubprocessorsResponse.shape.asOf.safeParse('1 March').success).toBe(false);
  });
});

describe('SubprocessorsQuery (§5.2)', () => {
  it('takes an offering or a client', () => {
    expect(SubprocessorsQuery.safeParse({ offering: 'ats' }).success).toBe(true);
    expect(SubprocessorsQuery.safeParse({ client: 'aurelia', asOf: '2026-05-01' }).success).toBe(
      true,
    );
  });

  it('needs exactly one of them, and says so with its own code', () => {
    for (const query of [{}, { offering: 'ats', client: 'aurelia' }]) {
      const result = SubprocessorsQuery.safeParse(query);
      expect(fieldErrorsFromZod(result.error!)).toEqual([
        {
          path: '',
          code: 'exactly_one_scope',
          message: 'Ask by exactly one of offering or client',
        },
      ]);
    }
  });
});
