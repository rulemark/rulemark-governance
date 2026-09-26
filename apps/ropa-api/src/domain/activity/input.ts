import type { ActivitySnapshot } from '../snapshots.js';

/**
 * A stored activity as the `PUT` body that would save it unchanged (API §1.4):
 * every nested row keeps its `id`, and references are given by id, which is
 * one of the identifiers a body may use (§1.2). Unset fields are left out,
 * because inputs spell "none" by absence.
 *
 * This is how a writer that is not a form edits an activity: read it, change
 * what it means to change, send the rest back. The seed's story edits start
 * here, and so will the engagement sub-resource (§3.5).
 */

type Body = Record<string, unknown>;

/** Only the fields that are set. */
function present(fields: Body): Body {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== undefined),
  );
}

export function inputFromSnapshot(activity: ActivitySnapshot): Body {
  const common = present({
    role: activity.role,
    name: activity.name,
    description: activity.description,
    roleRationale: activity.roleRationale,
    owner: activity.owner,
    supersedes: activity.supersedesId,
    subjectCategories: activity.subjectCategoryIds,
    dataCategories: activity.dataCategoryIds,
    systems: activity.systemIds,
    securityMeasures: activity.securityMeasureIds,
    startedAt: activity.startedAt,
    endedAt: activity.endedAt,
    reviewDueAt: activity.reviewDueAt,
  });

  const engagements = activity.engagements.map((engagement) => {
    const [firstScope] = engagement.clientScope;
    return present({
      id: engagement.id,
      party: engagement.partyId,
      role: engagement.role,
      serviceDescription: engagement.serviceDescription,
      processingCountries: engagement.processingCountries,
      dataCategories: engagement.dataCategoryIds,
      startedAt: engagement.startedAt,
      endedAt: engagement.endedAt,
      transfers: engagement.transfers.map((transfer) =>
        present({
          id: transfer.id,
          destinationCountry: transfer.destinationCountry,
          mechanism: transfer.mechanism,
          onwardVia: transfer.onwardVia,
          documentRef: transfer.documentRef,
        }),
      ),
      // Engagement scope exists only on processor activities (DM §3.8).
      clientScope:
        activity.role !== 'processor' || firstScope === undefined
          ? undefined
          : {
              mode: firstScope.mode,
              clients: engagement.clientScope.map((entry) =>
                present({
                  id: entry.id,
                  client: entry.clientPartyId,
                  reason: entry.reason,
                  agreement: entry.agreementId,
                }),
              ),
            },
    });
  });

  if (activity.role === 'controller') {
    return {
      ...common,
      ...present({
        purposes: activity.purposes,
        lawfulBases: activity.lawfulBases,
        specialConditions: activity.specialConditions,
        dpiaRequired: activity.dpiaRequired,
        dpiaRef: activity.dpiaRef,
      }),
      retentionRules: activity.retentionRules.map((rule) =>
        present({
          id: rule.id,
          dataCategory: rule.dataCategoryId,
          retentionPeriod: rule.retentionPeriod,
          triggerEvent: rule.triggerEvent,
          legalRef: rule.legalRef,
        }),
      ),
      engagements,
    };
  }

  const [firstScope] = activity.clientScope;
  return {
    ...common,
    ...present({
      offering: activity.offeringId,
      clientCoverage: activity.clientCoverage,
      processingCategories: activity.processingCategories,
      dpiaSupportRef: activity.dpiaSupportRef,
    }),
    clientScope:
      firstScope === undefined
        ? null
        : {
            mode: firstScope.mode,
            clients: activity.clientScope.map((entry) =>
              present({
                id: entry.id,
                client: entry.clientPartyId,
                reason: entry.reason,
                agreement: entry.agreementId,
                startedAt: entry.startedAt,
                endedAt: entry.endedAt,
              }),
            ),
          },
    engagements,
  };
}
