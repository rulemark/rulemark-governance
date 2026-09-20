import { describe, expect, it } from 'vitest';

import { Problem } from '../shared/problems.js';
import { etagFor, requireIfMatch } from './concurrency.js';

describe('etagFor', () => {
  it('is the version, quoted, as a strong validator', () => {
    expect(etagFor(1)).toBe('"1"');
    expect(etagFor(42)).toBe('"42"');
  });
});

describe('requireIfMatch', () => {
  it('reads the version a client read back', () => {
    expect(requireIfMatch('"3"')).toBe(3);
  });

  it('accepts the header without quotes, which clients get wrong constantly', () => {
    expect(requireIfMatch('3')).toBe(3);
  });

  it('accepts a weak validator, since our ETag is just a version number', () => {
    expect(requireIfMatch('W/"3"')).toBe(3);
  });

  it('answers 428 when the header is missing (§1.8)', () => {
    const error = catchProblem(() => requireIfMatch(undefined));
    expect(error.status).toBe(428);
    expect(error.type).toBe('if-match-required');
  });

  it('answers 428 for If-Match: *, which would skip the check it exists for', () => {
    // RFC 9110 reads `*` as "any current representation". Honouring it here
    // would let a caller write without naming the version they reviewed, which
    // is the whole point of requiring the header (§1.8).
    const error = catchProblem(() => requireIfMatch('*'));
    expect(error.status).toBe(428);
  });

  it('answers 400 when the version is not a number', () => {
    for (const header of ['"abc"', '"1.5"', '""', '"-1"', '"0"']) {
      const error = catchProblem(() => requireIfMatch(header));
      expect(error.status, header).toBe(400);
    }
  });

  it('answers 400 for a list of validators, which names no single version', () => {
    const error = catchProblem(() => requireIfMatch('"3", "4"'));
    expect(error.status).toBe(400);
  });
});

function catchProblem(run: () => unknown): Problem {
  try {
    run();
  } catch (error) {
    if (error instanceof Problem) return error;
    throw error;
  }
  throw new Error('expected a Problem to be thrown');
}
