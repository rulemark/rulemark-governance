'use client';

import { RopaError } from '@rulemark/ropa-client';
import type { Activity } from '@rulemark/ropa-schemas';
import { Button } from '@rulemark/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@rulemark/ui/components/table';
import { useQuery } from '@tanstack/react-query';

import { activityList } from '@/lib/queries';
import { browserRopa } from '@/lib/ropa-browser';

const ROLES: Record<Activity['role'], string> = {
  controller: 'Controller',
  processor: 'Processor',
};

const STATUSES: Record<Activity['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  retired: 'Retired',
};

/**
 * What went wrong, for a reader: the API's own words for a problem it
 * reports (a 4xx), plain words when it or the network fails (Next answers a
 * bare 500 when the API behind the rewrite is down).
 */
function describe(error: Error): string {
  if (error instanceof RopaError && error.status < 500) return error.message;
  return 'The RoPA API isn’t answering right now. Try again in a moment.';
}

/**
 * The record's activities. On the first paint the server has usually
 * prefetched them (the page's HydrationBoundary); the browser refetches
 * through the proxy when they go stale.
 */
export function ActivityList() {
  const { data, error, isPending, refetch } = useQuery(activityList(browserRopa));

  if (isPending) {
    return (
      <p role="status" className="text-fg-muted">
        Loading the record…
      </p>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-card border border-danger-border bg-danger-subtle p-card text-danger-subtle-fg"
      >
        <div>
          <p className="text-label">The record couldn&rsquo;t be loaded.</p>
          <p>{describe(error)}</p>
        </div>
        <Button variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (data.data.length === 0) {
    return <p className="text-fg-muted">No activities yet.</p>;
  }

  return (
    <Table aria-label="Processing activities">
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Owner</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.data.map((activity) => (
          <TableRow key={activity.id}>
            <TableCell className="font-mono text-code">{activity.code}</TableCell>
            <TableCell>{activity.name}</TableCell>
            <TableCell>{ROLES[activity.role]}</TableCell>
            <TableCell>{STATUSES[activity.status]}</TableCell>
            <TableCell>{activity.owner}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
