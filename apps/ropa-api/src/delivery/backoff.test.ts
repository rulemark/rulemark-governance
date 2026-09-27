import { describe, expect, it } from 'vitest';

import { MINUTE, retryDelayMs } from './backoff.js';

/** DB §7: a failed delivery waits 1 min, 5 min, 30 min, then an hour each time. */
describe('retryDelayMs', () => {
  it('waits longer after each failure, then hourly', () => {
    expect([1, 2, 3, 4, 5, 24, 1000].map((attempts) => retryDelayMs(attempts) / MINUTE)).toEqual([
      1, 5, 30, 60, 60, 60, 60,
    ]);
  });

  it('refuses a count that is not an attempt', () => {
    for (const attempts of [0, -1, 1.5]) {
      expect(() => retryDelayMs(attempts), String(attempts)).toThrow(RangeError);
    }
  });
});
