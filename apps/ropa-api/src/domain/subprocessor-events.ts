import type { Ref } from '@rulemark/ropa-schemas';
import { and, desc, eq, lt } from 'drizzle-orm';

import { revision } from '../db/schema/history.js';
import type { WrittenRevision } from './aggregate.js';
import { isoDate } from './agreements.js';
import {
  enqueueEvent,
  subprocessorsChangedEvent,
  type SubprocessorsChangedData,
} from './events.js';
import { liveRecord } from './record/live.js';
import { bySigning, refsOf } from './record/reader.js';
import { requireRef } from './refs.js';
import { readSnapshot, type ActivitySnapshot } from './snapshots.js';
import { plannedChanges, type ListScope, type PlannedChanges } from './subprocessor-changes.js';
import type { Transaction } from './transaction.js';

/**
 * Step 5 of an activity's save (DB §6.1): if the save changed the offering's
 * subprocessor list, or a client's, write `subprocessors.changed` for each
 * list, in the save's transaction (API §6). Only activity saves emit: an
 * agreement signed or ended is onboarding, not a change (step 4, open
 * question 5).
 */

/** A day after every date the record could hold: clients as planned. */
const PLANNED_DAY = new Date('9999-12-31T00:00:00Z');

/** The activity as it stood before this revision, if it existed. */
async function previousSnapshot(
  tx: Transaction,
  written: WrittenRevision<ActivitySnapshot>,
): Promise<ActivitySnapshot | undefined> {
  const [row] = await tx
    .select({ snapshot: revision.snapshot })
    .from(revision)
    .where(
      and(
        eq(revision.entityType, 'activity'),
        eq(revision.entityId, written.entityId),
        lt(revision.version, written.version),
      ),
    )
    .orderBy(desc(revision.version))
    .limit(1);
  return row === undefined ? undefined : readSnapshot('activity', row.snapshot);
}

const offeringOf = (activity: ActivitySnapshot | undefined) =>
  activity !== undefined && activity.role === 'processor' ? activity.offeringId : null;

const isEmpty = (changes: PlannedChanges) =>
  changes.added.length + changes.removed.length + changes.changed.length === 0;

export async function recordSubprocessorChanges(
  tx: Transaction,
  written: WrittenRevision<ActivitySnapshot>,
): Promise<void> {
  const previous = await previousSnapshot(tx, written);
  const saved = written.changeType === 'deleted' ? undefined : written.snapshot;
  const offeringIds = new Set(
    [offeringOf(previous), offeringOf(saved)].filter((id): id is string => id !== null),
  );
  if (offeringIds.size === 0) return;

  const saveDay = isoDate(written.validFrom);
  const record = liveRecord(tx, written.validFrom);
  const planned = liveRecord(tx, PLANNED_DAY);

  for (const offeringId of offeringIds) {
    const others = (await record.activities({ role: 'processor', offeringId })).filter(
      (activity) => activity.id !== written.entityId,
    );
    const inOffering = (activity: ActivitySnapshot | undefined) =>
      activity !== undefined && activity.offeringId === offeringId ? [activity] : [];
    const before = [...others, ...inOffering(previous)];
    const after = [...others, ...inOffering(saved)];

    // Every client whose agreement for the offering has not ended, one signed
    // for a later date included, under the terms they signed most recently
    // (Phase 4, question 3).
    const agreements = [
      ...(await record.agreementsInForce({ direction: 'outbound', offeringIds: [offeringId] })),
      ...(await planned.agreementsInForce({ direction: 'outbound', offeringIds: [offeringId] })),
    ].sort(bySigning);
    const termsOfClient = new Map<string, string>();
    for (const row of agreements) termsOfClient.set(row.partyId, row.termsId);

    const [offering] = (await record.get('offering', [offeringId])).values();
    if (offering === undefined) throw new Error(`Dangling reference: offering ${offeringId}`);

    const lists: { scope: ListScope; clientId: string | null; termsId: string }[] = [
      { scope: { kind: 'offering', offeringId }, clientId: null, termsId: offering.defaultTermsId },
      ...[...termsOfClient].map(([clientId, termsId]) => ({
        scope: { kind: 'client' as const, offeringId, clientId },
        clientId,
        termsId,
      })),
    ];

    for (const list of lists) {
      const changes = plannedChanges(list.scope, before, after, saveDay);
      if (isEmpty(changes)) continue;
      await enqueueEvent(
        tx,
        subprocessorsChangedEvent(
          await describe(record, written, offeringId, list, changes, [...before, ...after]),
          written.validFrom.toISOString(),
        ),
        { destinations: written.context.destinations, revisionId: written.revisionId },
      );
    }
  }
}

/** The event's payload: the changes, with everything named. */
async function describe(
  record: ReturnType<typeof liveRecord>,
  written: WrittenRevision<ActivitySnapshot>,
  offeringId: string,
  list: { clientId: string | null; termsId: string },
  changes: PlannedChanges,
  activities: readonly ActivitySnapshot[],
): Promise<SubprocessorsChangedData> {
  const entries = [...changes.added, ...changes.removed, ...changes.changed];
  const parties = await refsOf(record, 'party', [
    ...entries.map((entry) => entry.partyId),
    ...(list.clientId === null ? [] : [list.clientId]),
  ]);
  const offerings = await refsOf(record, 'offering', [offeringId]);
  const terms = (await record.get('agreement_terms', [list.termsId])).get(list.termsId);
  if (terms === undefined) throw new Error(`Dangling reference: terms ${list.termsId}`);

  const activityRef = (activity: ActivitySnapshot): Ref => ({
    id: activity.id,
    code: activity.code,
    name: activity.name,
  });
  const modules = new Map(activities.map((activity) => [activity.id, activityRef(activity)]));
  const named = <T extends { partyId: string; moduleId: string | null }>({
    partyId,
    moduleId,
    ...rest
  }: T) => ({
    party: requireRef(parties, partyId, 'subprocessor.party'),
    module: moduleId === null ? null : modules.get(moduleId)!,
    ...rest,
  });

  return {
    offering: requireRef(offerings, offeringId, 'offering'),
    client: list.clientId === null ? null : requireRef(parties, list.clientId, 'client'),
    terms: {
      id: terms.id,
      slug: terms.slug,
      name: terms.name,
      authorizationType: terms.authorizationType,
      noticeDays: terms.noticeDays,
    },
    cause: {
      activity: activityRef(written.snapshot),
      version: written.version,
      changeType: written.changeType,
      actor: written.context.actor,
      changeNote: written.context.changeNote ?? null,
    },
    added: changes.added.map(named),
    removed: changes.removed.map(named),
    changed: changes.changed.map(named),
  };
}
