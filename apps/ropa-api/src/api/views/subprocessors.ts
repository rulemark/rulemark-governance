import { SubprocessorsResponse, type ActivityRef } from '@rulemark/ropa-schemas';

import { refsOf } from '../../domain/record/reader.js';
import { requireRef } from '../../domain/refs.js';
import {
  clientSubprocessors,
  standardSubprocessors,
  type SubprocessorGroup,
} from '../../domain/views/subprocessors.js';
import { processorActivities, termsRef, type ViewRead, type ViewScope } from './scope.js';

/**
 * `GET /subprocessors` for a resolved scope (`ropa-api.md` §5.2). The report's
 * closing list calls this same function, which is what makes the two
 * identical rather than merely alike.
 */
export async function buildSubprocessors(
  read: ViewRead,
  scope: ViewScope,
): Promise<SubprocessorsResponse> {
  const { record } = read;
  const activities = await processorActivities(record, scope.offeringId);
  const standard =
    scope.clientId === null
      ? standardSubprocessors(activities, scope.offeringId, record.day)
      : undefined;
  const groups =
    standard?.subprocessors ??
    clientSubprocessors(activities, scope.offeringId, scope.clientId!, record.day);
  const modules = standard?.optionalModules ?? [];

  const parties = await refsOf(record, 'party', [
    ...[...groups, ...modules.flatMap((module) => module.subprocessors)].map(
      (group) => group.partyId,
    ),
    ...(scope.clientId === null ? [] : [scope.clientId]),
  ]);
  const offerings = await refsOf(record, 'offering', [scope.offeringId]);
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
    generatedAt: read.generatedAt.toISOString(),
    asOf: read.asOf,
    scope: {
      offering: requireRef(offerings, scope.offeringId, 'offering'),
      client: scope.clientId === null ? null : requireRef(parties, scope.clientId, 'client'),
      terms: await termsRef(record, scope.termsId),
    },
    subprocessors: groups.map(toEntry),
    optionalModules: modules.map((module) => ({
      activity: activityRefs.get(module.activityId)!,
      subprocessors: module.subprocessors.map(toEntry),
    })),
  });
}
