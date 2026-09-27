import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { getQueryClient } from './query-client';

// TanStack Query's App Router pattern: on the server, a client per request, so
// no user's data reaches another's page; the browser keeps one.
describe('getQueryClient, on the server', () => {
  it('makes a new client every time', () => {
    expect(getQueryClient()).toBeInstanceOf(QueryClient);
    expect(getQueryClient()).not.toBe(getQueryClient());
  });

  // Data the server prefetched isn't refetched the moment the page hydrates.
  it('keeps data fresh for a minute', () => {
    expect(getQueryClient().getDefaultOptions().queries?.staleTime).toBe(60_000);
  });

  // So a query still pending when the server renders streams to the browser.
  it('dehydrates pending queries as well as successful ones', () => {
    const shouldDehydrate = getQueryClient().getDefaultOptions().dehydrate?.shouldDehydrateQuery;
    const client = new QueryClient();
    const pending = client
      .getQueryCache()
      .build(client, { queryKey: ['pending'] as readonly unknown[] });

    expect(shouldDehydrate?.(pending)).toBe(true);
  });
});
