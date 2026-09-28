import { RopaError, RopaResponseError } from '@rulemark/ropa-client';
import { QueryClient, defaultShouldDehydrateQuery, isServer } from '@tanstack/react-query';

// TanStack Query's pattern for the App Router (its "Advanced Server Rendering"
// guide): Server Components prefetch into a client, which is dehydrated into
// the page, and the browser's client picks the data up (open question 2).

/**
 * Worth another try: the network, or an API that's busy or failing. Never a
 * 4xx, which will say the same again, nor a response in the wrong shape.
 */
function isTransient(error: unknown): boolean {
  if (error instanceof RopaResponseError) return false;
  if (error instanceof RopaError) return error.status === 429 || error.status >= 500;
  return true;
}

/** In the browser: twice more, with TanStack Query's backoff, for what might pass. */
export function shouldRetry(failures: number, error: unknown): boolean {
  return failures < 2 && isTransient(error);
}

/** A client with the app's defaults. `getQueryClient()` decides how many. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Above zero, so data the server just fetched isn't refetched as the
        // page hydrates.
        staleTime: 60_000,
        // Never on the server, where a retry holds the whole page back: with
        // the API down the page renders at once, and the browser retries.
        retry: isServer ? false : shouldRetry,
      },
      dehydrate: {
        // Pending queries too, so one still loading as the server renders
        // streams to the browser rather than starting again there.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * On the server, a new client per call: one per request, so no data crosses
 * from one user's page to another's. In the browser, one for the page's life,
 * so a suspending render doesn't throw its cache away.
 */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
