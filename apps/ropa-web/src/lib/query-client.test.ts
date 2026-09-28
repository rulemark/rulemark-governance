import { RopaError, RopaNotFoundError, RopaResponseError } from '@rulemark/ropa-client';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { getQueryClient, shouldRetry } from './query-client';

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

// Only what another try might fix: the network, a busy or failing API. Never
// a 4xx, and never a response in the wrong shape.
describe('shouldRetry, in the browser', () => {
  const failed = (status: number) =>
    new RopaError(
      status,
      { type: 'about:blank', title: 'x', status },
      new Response(null, { status }),
    );

  it.each([
    ['a network failure', new TypeError('fetch failed')],
    ['a 502', failed(502)],
    ['a 503', failed(503)],
    ['a 429', failed(429)],
  ])('retries %s, twice', (_what, error) => {
    expect([0, 1, 2].map((failures) => shouldRetry(failures, error))).toEqual([true, true, false]);
  });

  it.each([
    [
      'a 404',
      new RopaNotFoundError(
        404,
        { type: 'about:blank', title: 'x', status: 404 },
        new Response(null, { status: 404 }),
      ),
    ],
    ['a 403', failed(403)],
    ['a drifted response', new RopaResponseError([], new Response())],
  ])('never retries %s', (_what, error) => {
    expect(shouldRetry(0, error)).toBe(false);
  });
});

// A server that retries holds the whole page back: with the API down it
// renders at once, and the browser retries through the proxy.
describe('retries, on the server', () => {
  it('are none', () => {
    expect(getQueryClient().getDefaultOptions().queries?.retry).toBe(false);
  });
});
