import { describe, expect, it } from 'vitest';

import { SMALL_GROUP, listsClients } from './impact.js';

/**
 * The seeded record's groups are all small (two Standard DPA clients, not
 * 399), so the rule for large ones is tested here rather than through it.
 */
describe('listsClients (§5.3)', () => {
  it('names the clients of a small group without being asked', () => {
    expect(listsClients(1, false)).toBe(true);
    expect(listsClients(SMALL_GROUP, false)).toBe(true);
  });

  it('only counts a large group, like the 399 on the Standard DPA', () => {
    expect(listsClients(SMALL_GROUP + 1, false)).toBe(false);
    expect(listsClients(399, false)).toBe(false);
  });

  it('names every client with expandClients=true', () => {
    expect(listsClients(399, true)).toBe(true);
  });
});
