import { SubprocessorsResponse, type ActivityRef } from '@rulemark/ropa-schemas';

import { offeringAggregate, partyAggregate } from '../../domain/aggregates.js';
import { isoDate } from '../../domain/agreements.js';
import { loadRefs, requireRef } from '../../domain/refs.js';
import type { Transaction } from '../../domain/transaction.js';
import {
  clientSubprocessors,
  standardSubprocessors,
  type SubprocessorGroup,
} from '../../domain/views/subprocessors.js';
import { liveActivities, termsRef, type ViewScope } from './scope.js';

/**
 * `GET /subprocessors` for a resolved scope (`ropa-api.md` §5.2). The report's
 * closing list calls this same function, which is what makes the two
 * identical rather than merely alike.
 */
export async function buildSubprocessors(
  tx: Transaction,
  scope: ViewScope,
  now: Date,
): Promise<SubprocessorsResponse> {
  const day = isoDate(now);
  const activities = await liveActivities(tx, 'processor', scope.offeringId);
  const standard =
    scope.clientId === null ? standardSubprocessors(activities, scope.offeringId, day) : undefined;
  const groups =
    standard?.subprocessors ??
    clientSubprocessors(activities, scope.offeringId, scope.clientId!, day);
  const modules = standard?.optionalModules ?? [];

  const parties = await loadRefs(tx, partyAggregate, [
    ...[...groups, ...modules.flatMap((module) => module.subprocessors)].map(
      (group) => group.partyId,
    ),
    ...(scope.clientId === null ? [] : [scope.clientId]),
  ]);
  const offerings = await loadRefs(tx, offeringAggregate, [scope.offeringId]);
  const activityRefs = new Map<string, ActivityRef>(
    activities.map((activity) => [
      activity.id,
      { id: activity.id, code: activity.code, name: activity.name },
    ]),
  );

  const toEntry = (group: SubprocessorGroup) => ({
    party: requireRef(parties, group.partyId, 'subprocessor.party'),
    services: group.services,
    processingCountries: group.processingCountries,
    transfers: group.transfers,
    activities: group.activityIds.map((id) => activityRefs.get(id)!),
  });

  return SubprocessorsResponse.parse({
    generatedAt: now.toISOString(),
    asOf: null,
    scope: {
      offering: requireRef(offerings, scope.offeringId, 'offering'),
      client: scope.clientId === null ? null : requireRef(parties, scope.clientId, 'client'),
      terms: await termsRef(tx, scope.termsId),
    },
    subprocessors: groups.map(toEntry),
    optionalModules: modules.map((module) => ({
      activity: activityRefs.get(module.activityId)!,
      subprocessors: module.subprocessors.map(toEntry),
    })),
  });
}
