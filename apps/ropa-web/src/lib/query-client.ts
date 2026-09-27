import { QueryClient, defaultShouldDehydrateQuery, isServer } from '@tanstack/react-query';

// TanStack Query's pattern for the App Router (its "Advanced Server Rendering"
// guide): Server Components prefetch into a client, which is dehydrated into
// the page, and the browser's client picks the data up (open question 2).

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Above zero, so data the server just fetched isn't refetched as the
        // page hydrates.
        staleTime: 60_000,
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
