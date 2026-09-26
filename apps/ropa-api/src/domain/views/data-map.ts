import type { EngagementRole } from '@rulemark/ropa-schemas';

import type { ActivitySnapshot } from '../snapshots.js';
import { byCode, coversClient, inForce, isEffectiveFor } from './subprocessors.js';

/**
 * Where a subject category's data lives (DM §7, API §5.4), as a function over
 * aggregates so `asOf` can later answer it from revisions (DB §6.3). The role
 * decides the action: Hireloop acts where it is the controller and forwards
 * where it is the processor.
 */

type Engagement = ActivitySnapshot['engagements'][number];

export interface DataMapInput {
  readonly subjectCategoryId: string;
  /**
   * The client a request is about, with the offerings it holds an agreement
   * for today. Null: every client, so every processor activity counts.
   */
  readonly client: { readonly id: string; readonly offeringIds: ReadonlySet<string> } | null;
  readonly activities: readonly ActivitySnapshot[];
  readonly day: string;
}

export interface DataMapVendor {
  readonly partyId: string;
  readonly role: EngagementRole;
  /**
   * What the party receives for the activity, as recorded: an upper bound,
   * since data categories aren't tied to subject categories (step 3, Q6).
   */
  readonly dataCategoryIds: string[];
}

export interface DataMapEntry {
  readonly activity: ActivitySnapshot;
  readonly action: 'act' | 'forward';
  readonly vendors: DataMapVendor[];
}

/** One entry per party and role, in the order they first appear. */
function vendorsOf(engagements: readonly Engagement[]): DataMapVendor[] {
  const vendors = new Map<string, DataMapVendor>();
  for (const engagement of engagements) {
    const key = `${engagement.partyId}/${engagement.role}`;
    let vendor = vendors.get(key);
    if (vendor === undefined) {
      vendor = { partyId: engagement.partyId, role: engagement.role, dataCategoryIds: [] };
      vendors.set(key, vendor);
    }
    for (const id of engagement.dataCategoryIds) {
      if (!vendor.dataCategoryIds.includes(id)) vendor.dataCategoryIds.push(id);
    }
  }
  return [...vendors.values()];
}

export function dataMap(input: DataMapInput): DataMapEntry[] {
  const { client, day } = input;
  const entries: DataMapEntry[] = [];

  for (const activity of [...input.activities].sort(byCode)) {
    if (activity.status !== 'active') continue;
    if (!activity.subjectCategoryIds.includes(input.subjectCategoryId)) continue;

    let engagements = activity.engagements.filter((engagement) => inForce(engagement, day));

    if (activity.role === 'processor' && client !== null) {
      // Performed for this client only if they hold an agreement for its
      // offering and the activity covers them (DM §3.8).
      if (activity.offeringId === null || !client.offeringIds.has(activity.offeringId)) continue;
      if (!coversClient(activity, client.id, day)) continue;
      engagements = engagements.filter((engagement) => isEffectiveFor(engagement, client.id));
    }

    entries.push({
      activity,
      action: activity.role === 'controller' ? 'act' : 'forward',
      vendors: vendorsOf(engagements),
    });
  }

  return entries;
}
