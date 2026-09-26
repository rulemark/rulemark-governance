import { describe, expect, it } from 'vitest';

import { fieldErrorsFromZod } from '../errors.js';
import { SubprocessorsQuery } from './subprocessors.js';

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
