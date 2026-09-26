import type { Activity } from './activity.js';

/**
 * An activity as the API returns it (`Activity`), turned back into the body a
 * `PUT` accepts (`ActivityInput`) that saves it unchanged (API §1.4): every
 * nested row keeps its `id`, every Ref becomes its `id`, and read-only or unset
 * fields are left out. A client edits an activity by reading it, changing
 * what it means to change, and sending the rest back.
 */

type Body = Record<string, unknown>;

/** Only the fields that are set: inputs spell "none" by absence. */
function present(fields: Body): Body {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== undefined),
  );
}

const ids = (refs: readonly { id: string }[]) => refs.map((ref) => ref.id);

export function inputFromActivity(activity: Activity): Body {
  const common = present({
    role: activity.role,
    name: activity.name,
    description: activity.description,
    roleRationale: activity.roleRationale,
    owner: activity.owner,
    supersedes: activity.supersedes?.id,
    subjectCategories: ids(activity.subjectCategories),
    dataCategories: ids(activity.dataCategories),
    systems: ids(activity.systems),
    securityMeasures: ids(activity.securityMeasures),
    startedAt: activity.startedAt,
    endedAt: activity.endedAt,
    reviewDueAt: activity.reviewDueAt,
  });

  const engagementFields = (engagement: Activity['engagements'][number]) =>
    present({
      id: engagement.id,
      party: engagement.party.id,
      role: engagement.role,
      serviceDescription: engagement.serviceDescription,
      processingCountries: engagement.processingCountries,
      dataCategories: ids(engagement.dataCategories),
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
          dataCategory: rule.dataCategory?.id,
          retentionPeriod: rule.retentionPeriod,
          triggerEvent: rule.triggerEvent,
          legalRef: rule.legalRef,
        }),
      ),
      engagements: activity.engagements.map(engagementFields),
    };
  }

  return {
    ...common,
    ...present({
      offering: activity.offering?.id,
      clientCoverage: activity.clientCoverage,
      processingCategories: activity.processingCategories,
      dpiaSupportRef: activity.dpiaSupportRef,
    }),
    clientScope:
      activity.clientScope === null
        ? null
        : {
            mode: activity.clientScope.mode,
            clients: activity.clientScope.clients.map((entry) =>
              present({
                id: entry.id,
                client: entry.client.id,
                reason: entry.reason,
                agreement: entry.agreement?.id,
                startedAt: entry.startedAt,
                endedAt: entry.endedAt,
              }),
            ),
          },
    engagements: activity.engagements.map((engagement) => ({
      ...engagementFields(engagement),
      clientScope:
        engagement.clientScope === null
          ? null
          : {
              mode: engagement.clientScope.mode,
              clients: engagement.clientScope.clients.map((entry) =>
                present({
                  id: entry.id,
                  client: entry.client.id,
                  reason: entry.reason,
                  agreement: entry.agreement?.id,
                }),
              ),
            },
    })),
  };
}
