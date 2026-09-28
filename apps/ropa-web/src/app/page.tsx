import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { connection } from 'next/server';

import { ActivityList } from '@/components/activity-list';
import { activityList } from '@/lib/queries';
import { getQueryClient } from '@/lib/query-client';
import { serverRopa } from '@/lib/ropa-server';

// The layout's title template applies to pages below it, not beside it.
export const metadata: Metadata = { title: { absolute: 'Processing activities · Rulemark' } };

/**
 * The record's activities. The server prefetches them straight from ropa-api
 * and hands them to the browser in the page (open question 2), so the first
 * paint has them; the list refetches through the proxy from there.
 */
export default async function HomePage() {
  // Read at request time, never prerendered: the record changes.
  await connection();
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(activityList(serverRopa()));

  return (
    <>
      <h1>Processing activities</h1>
      <p className="mt-1 mb-section text-fg-muted">
        What Hireloop does with personal data, as the controller and as a processor.
      </p>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <ActivityList />
      </HydrationBoundary>
    </>
  );
}
