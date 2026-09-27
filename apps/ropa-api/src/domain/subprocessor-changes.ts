import type { ActivitySnapshot } from './snapshots.js';
import {
  clientSubprocessors,
  standardSubprocessors,
  type SubprocessorGroup,
} from './views/subprocessors.js';

/**
 * What a save does to the subprocessor lists (API §6, DB §6.1 step 5), for
 * `subprocessors.changed`. Art. 28(2) asks for notice before a change takes
 * effect, so lists are compared **as planned**: once every start and end date
 * recorded has arrived. A future-dated change is heard when it is recorded,
 * and nothing needs to fire on the day it lands (step 4, open question 5).
 *
 * The lists are the ones `GET /subprocessors` serves, from the same
 * functions: the offering's, with its opt-in modules marked, or one client's.
 */

export type ListScope =
  | { readonly kind: 'offering'; readonly offeringId: string }
  | { readonly kind: 'client'; readonly offeringId: string; readonly clientId: string };

type Transfer = SubprocessorGroup['transfers'][number];

/** What a list says about one subprocessor. */
export interface ListedDetails {
  readonly services: readonly string[];
  readonly processingCountries: readonly string[];
  readonly transfers: readonly Transfer[];
}

/** An entry, keyed by party and by module: a party can be listed under both. */
export interface ListedEntry extends ListedDetails {
  readonly partyId: string;
  /** The opt-in activity it is listed under, on the offering's list; else null. */
  readonly moduleId: string | null;
}

export interface PlannedChanges {
  readonly added: (ListedEntry & { readonly effectiveFrom: string })[];
  readonly removed: (ListedEntry & { readonly effectiveFrom: string })[];
  readonly changed: {
    readonly partyId: string;
    readonly moduleId: string | null;
    readonly before: ListedDetails;
    readonly after: ListedDetails;
    readonly effectiveFrom: string;
  }[];
}

/** A day after every date the record could hold: the list as planned. */
const PLANNED = '9999-12-31';

const keyOf = (entry: { partyId: string; moduleId: string | null }) =>
  `${entry.moduleId ?? ''}/${entry.partyId}`;

function entry(group: SubprocessorGroup, moduleId: string | null): ListedEntry {
  return {
    partyId: group.partyId,
    moduleId,
    services: group.services,
    processingCountries: group.processingCountries,
    transfers: group.transfers,
  };
}

function listOn(
  scope: ListScope,
  activities: readonly ActivitySnapshot[],
  day: string,
): Map<string, ListedEntry> {
  const entries =
    scope.kind === 'client'
      ? clientSubprocessors(activities, scope.offeringId, scope.clientId, day).map((group) =>
          entry(group, null),
        )
      : (() => {
          const standard = standardSubprocessors(activities, scope.offeringId, day);
          return [
            ...standard.subprocessors.map((group) => entry(group, null)),
            ...standard.optionalModules.flatMap((module) =>
              module.subprocessors.map((group) => entry(group, module.activityId)),
            ),
          ];
        })();
  return new Map(entries.map((row) => [keyOf(row), row]));
}

/** Where a subprocessor's data goes: what a change is about (step 4, open question 5). */
function sameReach(a: ListedDetails, b: ListedDetails): boolean {
  const reach = (details: ListedDetails) =>
    JSON.stringify([
      [...details.processingCountries].sort(),
      details.transfers
        .map((row) => `${row.destinationCountry}|${row.mechanism}|${row.onwardVia ?? ''}`)
        .sort(),
    ]);
  return reach(a) === reach(b);
}

/** Every date in the saved activities from the save's day on, in order. */
function datesFrom(saveDay: string, activities: readonly ActivitySnapshot[]): string[] {
  const dates = new Set([saveDay]);
  for (const activity of activities) {
    for (const row of [...activity.clientScope, ...activity.engagements]) {
      for (const date of [row.startedAt, row.endedAt]) {
        if (date !== null && date > saveDay) dates.add(date);
      }
    }
  }
  return [...dates].sort();
}

/**
 * The planned list before and after a save, compared. `before` and `after`
 * are the offering's activities, of any status: only active ones are listed.
 * Each change is effective from the first day, from `saveDay` on, on which the
 * saved record shows it as planned (Phase 4, question 1).
 */
export function plannedChanges(
  scope: ListScope,
  before: readonly ActivitySnapshot[],
  after: readonly ActivitySnapshot[],
  saveDay: string,
): PlannedChanges {
  const was = listOn(scope, before, PLANNED);
  const will = listOn(scope, after, PLANNED);

  const days = datesFrom(saveDay, after);
  const timeline = days.map((day) => listOn(scope, after, day));
  // The planned list is the timeline's last, so a match is always found;
  // the save's day stands in only as a safe answer.
  const firstDay = (holds: (list: Map<string, ListedEntry>) => boolean) =>
    days[Math.max(timeline.findIndex(holds), 0)]!;

  const changes: {
    added: PlannedChanges['added'];
    removed: PlannedChanges['removed'];
    changed: PlannedChanges['changed'];
  } = { added: [], removed: [], changed: [] };

  for (const [key, planned] of will) {
    const listed = (list: Map<string, ListedEntry>) => {
      const current = list.get(key);
      return current !== undefined && sameReach(current, planned);
    };
    const previous = was.get(key);
    if (previous === undefined) {
      changes.added.push({ ...planned, effectiveFrom: firstDay(listed) });
    } else if (!sameReach(previous, planned)) {
      const { partyId, moduleId, ...details } = planned;
      const { partyId: _party, moduleId: _module, ...earlier } = previous;
      changes.changed.push({
        partyId,
        moduleId,
        before: earlier,
        after: details,
        effectiveFrom: firstDay(listed),
      });
    }
  }
  for (const [key, previous] of was) {
    if (!will.has(key)) {
      changes.removed.push({ ...previous, effectiveFrom: firstDay((list) => !list.has(key)) });
    }
  }
  return changes;
}
