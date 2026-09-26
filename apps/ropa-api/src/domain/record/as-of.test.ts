import { describe, expect, it } from 'vitest';

import { Problem } from '../../shared/problems.js';
import { resolveAsOf } from './as-of.js';

/**
 * What `?asOf=` means (step 4, open question 4): a date is the end of that day
 * in UTC, a timestamp is taken as given, and the future is refused.
 */

const NOW = new Date('2026-09-26T14:30:00Z');

function refusal(asked: string): Problem {
  try {
    resolveAsOf(asked, NOW);
  } catch (error) {
    if (error instanceof Problem) return error;
    throw error;
  }
  throw new Error(`${asked} was not refused`);
}

describe('resolveAsOf', () => {
  it('reads a date as the end of that day, UTC: every revision before the next midnight', () => {
    expect(resolveAsOf('2026-03-01', NOW)).toEqual({
      asked: '2026-03-01',
      cutoff: new Date('2026-03-02T00:00:00Z'),
      inclusive: false,
      day: '2026-03-01',
    });
  });

  it('crosses months and years at midnight', () => {
    expect(resolveAsOf('2026-02-28', NOW).cutoff).toEqual(new Date('2026-03-01T00:00:00Z'));
    expect(resolveAsOf('2025-12-31', NOW).cutoff).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('takes a timestamp as given, up to and including that instant', () => {
    expect(resolveAsOf('2026-03-16T12:00:00Z', NOW)).toEqual({
      asked: '2026-03-16T12:00:00Z',
      cutoff: new Date('2026-03-16T12:00:00Z'),
      inclusive: true,
      day: '2026-03-16',
    });
  });

  it('judges business dates on the timestamp’s UTC date, whatever its offset', () => {
    // 00:30 in Amsterdam on 17 March is still 16 March in UTC.
    const point = resolveAsOf('2026-03-17T00:30:00+01:00', NOW);
    expect(point.cutoff).toEqual(new Date('2026-03-16T23:30:00Z'));
    expect(point.day).toBe('2026-03-16');
    expect(point.asked).toBe('2026-03-17T00:30:00+01:00');
  });

  it('accepts today, which reads the same as no asOf', () => {
    expect(resolveAsOf('2026-09-26', NOW)).toMatchObject({
      day: '2026-09-26',
      cutoff: new Date('2026-09-27T00:00:00Z'),
    });
    expect(resolveAsOf(NOW.toISOString(), NOW).cutoff).toEqual(NOW);
  });

  it('refuses a date after today: the record cannot know tomorrow', () => {
    const problem = refusal('2026-09-27');
    expect(problem.status).toBe(422);
    expect(problem.errors).toEqual([
      expect.objectContaining({ path: '/asOf', code: 'in_the_future' }),
    ]);
  });

  it('refuses a timestamp after now, even later today', () => {
    expect(refusal('2026-09-26T14:30:01Z').errors).toEqual([
      expect.objectContaining({ path: '/asOf', code: 'in_the_future' }),
    ]);
  });
});
