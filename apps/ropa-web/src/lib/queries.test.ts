import type { RopaClient } from '@rulemark/ropa-client';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { activityKeys, activityList } from './queries';

// One set of query keys and functions for the server's prefetch and the
// browser's refetch (open question 2): only the client instance differs.
describe('activityList', () => {
  function fakeClient() {
    const list = vi.fn(async () => ({ data: [], nextCursor: null }));
    return { ropa: { activities: { list } } as unknown as RopaClient, list };
  }

  it('keys the same query the same way, whichever client runs it', () => {
    const server = fakeClient();
    const browser = fakeClient();

    expect(activityList(server.ropa, { role: 'processor' }).queryKey).toEqual(
      activityList(browser.ropa, { role: 'processor' }).queryKey,
    );
    expect(activityList(server.ropa).queryKey).toEqual(['activities', 'list', {}]);
  });

  it('keys every activity list under one prefix, to invalidate together', () => {
    const { ropa } = fakeClient();

    expect(activityList(ropa, { status: 'active' }).queryKey.slice(0, 1)).toEqual(activityKeys.all);
  });

  it("calls the client's list with the query and the query's signal", async () => {
    const { ropa, list } = fakeClient();
    const client = new QueryClient();

    await client.fetchQuery(activityList(ropa, { role: 'controller' }));

    expect(list).toHaveBeenCalledWith({ role: 'controller' }, { signal: expect.any(AbortSignal) });
  });
});
