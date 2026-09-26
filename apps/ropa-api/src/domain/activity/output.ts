import { Activity, type Ref } from '@rulemark/ropa-schemas';

import {
  agreementAggregate,
  dataCategoryAggregate,
  offeringAggregate,
  partyAggregate,
  securityMeasureAggregate,
  subjectCategoryAggregate,
  systemAggregate,
} from '../aggregates.js';
import { loadRefs, requireRef, type RefSource } from '../refs.js';
import type { ActivitySnapshot } from '../snapshots.js';
import type { Transaction } from '../transaction.js';
import { activityAggregate } from './load.js';

/**
 * The canonical aggregate as the API returns it (`ropa-api.md` §3.1, §3.3):
 * every id becomes a `Ref`, each role shows only its own fields, and a client
 * scope comes back in the shape it was sent — one `mode` and a list of
 * clients, or `null`. References are loaded one table at a time for every
 * activity on the page.
 */

async function refsFor(
  tx: Transaction,
  source: RefSource<never>,
  ids: readonly (string | null)[],
): Promise<Map<string, Ref>> {
  return loadRefs(
    tx,
    source as RefSource<{ id: string }>,
    ids.filter((id): id is string => id !== null),
  );
}

export async function toActivityOutputs(
  tx: Transaction,
  activities: readonly ActivitySnapshot[],
): Promise<Activity[]> {
  const engagements = activities.flatMap((activity) => activity.engagements);
  const scopes = [
    ...activities.flatMap((activity) => activity.clientScope),
    ...engagements.flatMap((engagement) => engagement.clientScope),
  ];

  const offerings = await refsFor(
    tx,
    offeringAggregate,
    activities.map((a) => a.offeringId),
  );
  const superseded = await refsFor(
    tx,
    activityAggregate,
    activities.map((a) => a.supersedesId),
  );
  const parties = await refsFor(tx, partyAggregate, [
    ...engagements.map((engagement) => engagement.partyId),
    ...scopes.map((entry) => entry.clientPartyId),
  ]);
  const agreements = await refsFor(
    tx,
    agreementAggregate,
    scopes.map((entry) => entry.agreementId),
  );
  const subjectCategories = await refsFor(
    tx,
    subjectCategoryAggregate,
    activities.flatMap((activity) => activity.subjectCategoryIds),
  );
  const dataCategories = await refsFor(tx, dataCategoryAggregate, [
    ...activities.flatMap((activity) => activity.dataCategoryIds),
    ...activities.flatMap((activity) => activity.retentionRules.map((rule) => rule.dataCategoryId)),
    ...engagements.flatMap((engagement) => engagement.dataCategoryIds),
  ]);
  const systems = await refsFor(
    tx,
    systemAggregate,
    activities.flatMap((a) => a.systemIds),
  );
  const securityMeasures = await refsFor(
    tx,
    securityMeasureAggregate,
    activities.flatMap((activity) => activity.securityMeasureIds),
  );

  const one = (refs: Map<string, Ref>, id: string, field: string) => requireRef(refs, id, field);
  const optional = (refs: Map<string, Ref>, id: string | null, field: string) =>
    id === null ? null : requireRef(refs, id, field);
  const many = (refs: Map<string, Ref>, ids: readonly string[], field: string) =>
    ids.map((id) => requireRef(refs, id, field));

  return activities.map((activity) => {
    const transfers = (engagement: ActivitySnapshot['engagements'][number]) =>
      engagement.transfers.map((transfer) => ({
        id: transfer.id,
        destinationCountry: transfer.destinationCountry,
        mechanism: transfer.mechanism,
        onwardVia: transfer.onwardVia,
        documentRef: transfer.documentRef,
      }));
    const engagementFields = (engagement: ActivitySnapshot['engagements'][number]) => ({
      id: engagement.id,
      party: one(parties, engagement.partyId, 'engagement.party'),
      role: engagement.role,
      serviceDescription: engagement.serviceDescription,
      processingCountries: engagement.processingCountries,
      dataCategories: many(dataCategories, engagement.dataCategoryIds, 'engagement.dataCategories'),
      transfers: transfers(engagement),
      startedAt: engagement.startedAt,
      endedAt: engagement.endedAt,
    });

    const common = {
      id: activity.id,
      code: activity.code,
      name: activity.name,
      description: activity.description,
      roleRationale: activity.roleRationale,
      status: activity.status,
      owner: activity.owner,
      supersedes: optional(superseded, activity.supersedesId, 'supersedes'),
      subjectCategories: many(subjectCategories, activity.subjectCategoryIds, 'subjectCategories'),
      dataCategories: many(dataCategories, activity.dataCategoryIds, 'dataCategories'),
      systems: many(systems, activity.systemIds, 'systems'),
      securityMeasures: many(securityMeasures, activity.securityMeasureIds, 'securityMeasures'),
      startedAt: activity.startedAt,
      endedAt: activity.endedAt,
      reviewDueAt: activity.reviewDueAt,
      version: activity.version,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
    };

    if (activity.role === 'controller') {
      return Activity.parse({
        ...common,
        role: 'controller',
        purposes: activity.purposes,
        lawfulBases: activity.lawfulBases,
        specialConditions: activity.specialConditions,
        retentionRules: activity.retentionRules.map((rule) => ({
          id: rule.id,
          dataCategory: optional(dataCategories, rule.dataCategoryId, 'retentionRule.dataCategory'),
          retentionPeriod: rule.retentionPeriod,
          triggerEvent: rule.triggerEvent,
          legalRef: rule.legalRef,
        })),
        // Set by the save for every controller; never null once written.
        dpiaRequired: activity.dpiaRequired ?? false,
        dpiaRef: activity.dpiaRef,
        engagements: activity.engagements.map(engagementFields),
      });
    }

    // Every row of one scope shares its mode (DM §3.8), so the first says it.
    const scope = <T extends { mode: 'include' | 'exclude' }, U>(
      rows: readonly T[],
      entry: (row: T) => U,
    ) => (rows.length === 0 ? null : { mode: rows[0]!.mode, clients: rows.map(entry) });

    return Activity.parse({
      ...common,
      role: 'processor',
      offering: optional(offerings, activity.offeringId, 'offering'),
      clientCoverage: activity.clientCoverage,
      processingCategories: activity.processingCategories,
      clientScope: scope(activity.clientScope, (entry) => ({
        id: entry.id,
        client: one(parties, entry.clientPartyId, 'clientScope.client'),
        reason: entry.reason,
        agreement: optional(agreements, entry.agreementId, 'clientScope.agreement'),
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
      })),
      dpiaSupportRef: activity.dpiaSupportRef,
      engagements: activity.engagements.map((engagement) => ({
        ...engagementFields(engagement),
        clientScope: scope(engagement.clientScope, (entry) => ({
          id: entry.id,
          client: one(parties, entry.clientPartyId, 'engagement.clientScope.client'),
          reason: entry.reason,
          agreement: optional(agreements, entry.agreementId, 'engagement.clientScope.agreement'),
        })),
      })),
    });
  });
}
