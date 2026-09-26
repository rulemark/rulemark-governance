import type { AuthorizationType } from '@rulemark/ropa-schemas';

import type { ActivitySnapshot } from '../snapshots.js';
import { byCode, coversClient, inForce, isEffectiveFor } from './subprocessors.js';

/**
 * What depends on a party (DM §7, API §5.3), as a function over aggregates so
 * `asOf` can later answer it from revisions (DB §6.3). The route loads the
 * activities, the clients' agreements and the terms; who is reached, and on
 * what terms, is decided here.
 */

type Engagement = ActivitySnapshot['engagements'][number];

/** A client's outbound agreement in force: who, for which offering, on which terms. */
export interface ClientAgreement {
  readonly clientId: string;
  readonly offeringId: string;
  readonly termsId: string;
}

/** The properties of a client's terms that a vendor change turns on. */
export interface TermsFacts {
  readonly id: string;
  readonly authorizationType: AuthorizationType;
  readonly noticeDays: number;
  readonly allowedRegions: readonly string[];
}

export interface ImpactInput {
  readonly partyId: string;
  readonly activities: readonly ActivitySnapshot[];
  /** Outbound agreements in force, at most one per client and offering. */
  readonly agreements: readonly ClientAgreement[];
  readonly terms: ReadonlyMap<string, TermsFacts>;
  /** The notice each of the vendor's inbound agreements in force gives. */
  readonly vendorNoticeDays: readonly number[];
  readonly specialDataCategoryIds: ReadonlySet<string>;
  readonly day: string;
}

export interface ImpactClientGroup {
  readonly termsId: string;
  readonly authorizationType: AuthorizationType;
  readonly noticeDays: number;
  readonly allowedRegions: readonly string[];
  readonly clientIds: string[];
  readonly requiresApproval: boolean;
  /** Null when the vendor has no DPA in force: nothing to compare against. */
  readonly noticeConflict: boolean | null;
}

export interface ImpactEntry {
  readonly activity: ActivitySnapshot;
  readonly engagement: Engagement;
  readonly specialCategories: boolean;
  readonly clientGroups: ImpactClientGroup[];
}

export interface PartyImpact {
  readonly entries: ImpactEntry[];
  readonly summary: {
    readonly engagements: number;
    readonly activities: number;
    readonly processorActivities: number;
    readonly affectedClients: number;
    readonly clientsRequiringApproval: number;
    readonly noticeConflicts: number;
  };
}

/**
 * The clients an engagement of a processor activity is used for (DM §3.8),
 * grouped by the terms they signed: the activity must cover them, and the
 * engagement must be effective for them. Larger groups first.
 */
function clientGroups(
  activity: ActivitySnapshot,
  engagement: Engagement,
  input: ImpactInput,
  vendorNotice: number | undefined,
): ImpactClientGroup[] {
  const groups = new Map<string, ImpactClientGroup>();

  for (const agreement of input.agreements) {
    if (agreement.offeringId !== activity.offeringId) continue;
    if (!coversClient(activity, agreement.clientId, input.day)) continue;
    if (!isEffectiveFor(engagement, agreement.clientId)) continue;

    let group = groups.get(agreement.termsId);
    if (group === undefined) {
      const terms = input.terms.get(agreement.termsId);
      if (terms === undefined) throw new Error(`Terms ${agreement.termsId} were not loaded`);
      group = {
        termsId: terms.id,
        authorizationType: terms.authorizationType,
        noticeDays: terms.noticeDays,
        allowedRegions: terms.allowedRegions,
        clientIds: [],
        // Specific authorization (Art. 28(2)): a notice is not enough.
        requiresApproval: terms.authorizationType === 'specific',
        noticeConflict: vendorNotice === undefined ? null : vendorNotice < terms.noticeDays,
      };
      groups.set(agreement.termsId, group);
    }
    if (!group.clientIds.includes(agreement.clientId)) group.clientIds.push(agreement.clientId);
  }

  return [...groups.values()].sort(
    (a, b) => b.clientIds.length - a.clientIds.length || a.termsId.localeCompare(b.termsId),
  );
}

export function partyImpact(input: ImpactInput): PartyImpact {
  // The worst case: a vendor with two DPAs in force can give the shorter notice.
  const vendorNotice =
    input.vendorNoticeDays.length === 0 ? undefined : Math.min(...input.vendorNoticeDays);

  const entries: ImpactEntry[] = [];
  for (const activity of [...input.activities].sort(byCode)) {
    if (activity.status !== 'active') continue;
    for (const engagement of activity.engagements) {
      if (engagement.partyId !== input.partyId || !inForce(engagement, input.day)) continue;
      entries.push({
        activity,
        engagement,
        specialCategories: engagement.dataCategoryIds.some((id) =>
          input.specialDataCategoryIds.has(id),
        ),
        // A controller activity is Hireloop's own decision: no client is told.
        clientGroups:
          activity.role === 'processor'
            ? clientGroups(activity, engagement, input, vendorNotice)
            : [],
      });
    }
  }

  const clientsWhere = (keep: (group: ImpactClientGroup) => boolean) =>
    new Set(
      entries.flatMap((entry) =>
        entry.clientGroups.filter(keep).flatMap((group) => group.clientIds),
      ),
    ).size;
  const activityIds = (role?: string) =>
    new Set(
      entries
        .filter((entry) => role === undefined || entry.activity.role === role)
        .map((entry) => entry.activity.id),
    ).size;

  return {
    entries,
    summary: {
      engagements: entries.length,
      activities: activityIds(),
      processorActivities: activityIds('processor'),
      affectedClients: clientsWhere(() => true),
      clientsRequiringApproval: clientsWhere((group) => group.requiresApproval),
      noticeConflicts: clientsWhere((group) => group.noticeConflict === true),
    },
  };
}
