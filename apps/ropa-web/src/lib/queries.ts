import type { ActivityListQuery, RopaClient } from '@rulemark/ropa-client';
import { queryOptions } from '@tanstack/react-query';

// The record's queries, keyed once for the server's prefetch and the
// browser's refetch (open question 2). Each takes the client instance that
// runs it: the server's reaches ropa-api directly, the browser's the proxy.

export const activityKeys = {
  all: ['activities'] as const,
  list: (query: ActivityListQuery) => [...activityKeys.all, 'list', query] as const,
};

/** One page of activities. */
export function activityList(ropa: RopaClient, query: ActivityListQuery = {}) {
  return queryOptions({
    queryKey: activityKeys.list(query),
    queryFn: ({ signal }) => ropa.activities.list(query, { signal }),
  });
}
