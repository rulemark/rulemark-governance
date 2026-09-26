import type { ActivitySnapshot } from '../snapshots.js';

/**
 * The subprocessor lists (DM §3.8, §7), as functions over aggregates rather
 * than SQL (`ropa-database.md` §6.3). The route decides which activities to
 * load; everything about who counts lives here, so `asOf` can later feed these
 * the snapshots from revisions and get the same answers for a past date.
 *
 * `day` is `YYYY-MM-DD`: scope rows and engagements count only while they are
 * in force on it.
 */

type Engagement = ActivitySnapshot['engagements'][number];

export interface SubprocessorGroup {
  readonly partyId: string;
  readonly services: string[];
  readonly processingCountries: string[];
  readonly transfers: {
    readonly destinationCountry: string;
    readonly mechanism: Engagement['transfers'][number]['mechanism'];
    readonly onwardVia: string | null;
  }[];
  readonly activityIds: string[];
}

export interface StandardSubprocessors {
  readonly subprocessors: SubprocessorGroup[];
  readonly optionalModules: {
    readonly activityId: string;
    readonly subprocessors: SubprocessorGroup[];
  }[];
}

const inForce = (row: { startedAt: string | null; endedAt: string | null }, day: string) =>
  (row.startedAt === null || row.startedAt <= day) && (row.endedAt === null || row.endedAt > day);

/** P1 before P2 before P10: codes sort by prefix, then by number. */
function byCode(a: ActivitySnapshot, b: ActivitySnapshot): number {
  const parse = (code: string) => /^([A-Z]+)-?(\d+)$/.exec(code) ?? [code, code, '0'];
  const [, prefixA, numberA] = parse(a.code);
  const [, prefixB, numberB] = parse(b.code);
  return prefixA!.localeCompare(prefixB!) || Number(numberA) - Number(numberB);
}

/** Live processor activities of the offering, in code order. */
function liveActivities(
  activities: readonly ActivitySnapshot[],
  offeringId: string,
): ActivitySnapshot[] {
  return activities
    .filter(
      (activity) =>
        activity.role === 'processor' &&
        activity.status === 'active' &&
        activity.offeringId === offeringId,
    )
    .sort(byCode);
}

/**
 * Whether an engagement is used for this client's data (DM §3.8): unscoped
 * engagements are used for everyone, `include` only for the clients listed,
 * `exclude` for everyone but them. All rows of one engagement share a mode.
 */
export function isEffectiveFor(engagement: Engagement, clientId: string): boolean {
  const [first] = engagement.clientScope;
  if (first === undefined) return true;
  const listed = engagement.clientScope.some((entry) => entry.clientPartyId === clientId);
  return first.mode === 'include' ? listed : !listed;
}

/**
 * Whether the activity is performed for this client, assuming the client
 * holds an agreement for its offering (the caller checks that): an
 * `all_enrolled` activity unless the client opted out, an `opt_in` one only if
 * they opted in.
 */
export function coversClient(activity: ActivitySnapshot, clientId: string, day: string): boolean {
  const exceptions = activity.clientScope.filter(
    (entry) => entry.clientPartyId === clientId && inForce(entry, day),
  );
  return activity.clientCoverage === 'opt_in'
    ? exceptions.some((entry) => entry.mode === 'include')
    : !exceptions.some((entry) => entry.mode === 'exclude');
}

/** Subprocessor engagements in force on the day that pass `accept`. */
function subprocessorsOf(
  activity: ActivitySnapshot,
  day: string,
  accept: (engagement: Engagement) => boolean,
): { activity: ActivitySnapshot; engagement: Engagement }[] {
  return activity.engagements
    .filter(
      (engagement) =>
        engagement.role === 'subprocessor' && inForce(engagement, day) && accept(engagement),
    )
    .map((engagement) => ({ activity, engagement }));
}

/** One entry per party, in the order parties first appear. */
function groupByParty(
  pairs: readonly { activity: ActivitySnapshot; engagement: Engagement }[],
): SubprocessorGroup[] {
  const groups = new Map<string, SubprocessorGroup>();
  const addOnce = <T>(list: T[], value: T, same: (a: T, b: T) => boolean = (a, b) => a === b) => {
    if (!list.some((existing) => same(existing, value))) list.push(value);
  };

  for (const { activity, engagement } of pairs) {
    let group = groups.get(engagement.partyId);
    if (group === undefined) {
      group = {
        partyId: engagement.partyId,
        services: [],
        processingCountries: [],
        transfers: [],
        activityIds: [],
      };
      groups.set(engagement.partyId, group);
    }
    addOnce(group.services, engagement.serviceDescription);
    for (const country of engagement.processingCountries)
      addOnce(group.processingCountries, country);
    for (const transfer of engagement.transfers) {
      addOnce(
        group.transfers,
        {
          destinationCountry: transfer.destinationCountry,
          mechanism: transfer.mechanism,
          onwardVia: transfer.onwardVia,
        },
        (a, b) =>
          a.destinationCountry === b.destinationCountry &&
          a.mechanism === b.mechanism &&
          a.onwardVia === b.onwardVia,
      );
    }
    addOnce(group.activityIds, activity.id);
  }
  return [...groups.values()];
}

/**
 * The standard terms of an offering (DM §7): its `all_enrolled` activities,
 * with per-client opt-outs ignored because they are exceptions to the
 * standard, and engagements scoped to `include` clients left out because
 * they exist only for those clients. Opt-in modules are listed on their own.
 */
export function standardSubprocessors(
  activities: readonly ActivitySnapshot[],
  offeringId: string,
  day: string,
): StandardSubprocessors {
  const live = liveActivities(activities, offeringId);
  const isStandard = (engagement: Engagement) => engagement.clientScope[0]?.mode !== 'include';

  return {
    subprocessors: groupByParty(
      live
        .filter((activity) => activity.clientCoverage === 'all_enrolled')
        .flatMap((activity) => subprocessorsOf(activity, day, isStandard)),
    ),
    optionalModules: live
      .filter((activity) => activity.clientCoverage === 'opt_in')
      .map((activity) => ({
        activityId: activity.id,
        subprocessors: groupByParty(subprocessorsOf(activity, day, isStandard)),
      })),
  };
}

/**
 * A client's actual list (DM §3.8): the effective engagements of every
 * activity that covers them, the modules they enabled included. The caller
 * has established that the client holds an agreement for the offering.
 */
export function clientSubprocessors(
  activities: readonly ActivitySnapshot[],
  offeringId: string,
  clientId: string,
  day: string,
): SubprocessorGroup[] {
  return groupByParty(
    liveActivities(activities, offeringId)
      .filter((activity) => coversClient(activity, clientId, day))
      .flatMap((activity) =>
        subprocessorsOf(activity, day, (engagement) => isEffectiveFor(engagement, clientId)),
      ),
  );
}
