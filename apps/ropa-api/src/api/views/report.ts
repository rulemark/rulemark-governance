import {
  ReportResponse,
  type ControllersServed,
  type ReportEngagement,
  type ReportQuery,
  type Ref,
} from '@rulemark/ropa-schemas';
import { eq, inArray } from 'drizzle-orm';

import { dataCategory, party } from '../../db/schema/index.js';
import {
  offeringAggregate,
  partyAggregate,
  securityMeasureAggregate,
  subjectCategoryAggregate,
} from '../../domain/aggregates.js';
import { clientsByOffering, isoDate } from '../../domain/agreements.js';
import { loadRefs, requireRef } from '../../domain/refs.js';
import type { ActivitySnapshot } from '../../domain/snapshots.js';
import type { Transaction } from '../../domain/transaction.js';
import {
  coversClient,
  inForce,
  scopeProcessorActivities,
  type ProcessorScope,
} from '../../domain/views/subprocessors.js';
import { buildSubprocessors } from './subprocessors.js';
import { liveActivities, resolveViewScope, termsRef } from './scope.js';

/**
 * `GET /report` (`ropa-api.md` §5.1): the Art. 30 record, in the JSON the
 * Markdown is rendered from. Only active activities appear (DM §3.1). The
 * processor section is scoped by the same function the subprocessor list
 * uses, and a scoped report closes with that very list.
 */

type Engagement = ActivitySnapshot['engagements'][number];

export async function buildReport(
  tx: Transaction,
  query: Pick<ReportQuery, 'view' | 'offering' | 'client'>,
  now: Date,
): Promise<ReportResponse> {
  const day = isoDate(now);
  const scoped = query.offering !== undefined || query.client !== undefined;
  const view = query.view ?? (scoped ? 'processor' : 'all');
  const scope = scoped ? await resolveViewScope(tx, query, now) : null;

  const controllers = view === 'processor' ? [] : await liveActivities(tx, 'controller');
  const processorScope: ProcessorScope =
    scope === null
      ? { kind: 'all' }
      : scope.clientId === null
        ? { kind: 'standard', offeringId: scope.offeringId }
        : { kind: 'client', offeringId: scope.offeringId, clientId: scope.clientId };
  const processors =
    view === 'controller'
      ? []
      : scopeProcessorActivities(
          await liveActivities(tx, 'processor', scope?.offeringId),
          processorScope,
          day,
        );

  // For the whole record, name the clients each activity covers today.
  const clientsOf = new Map<string, string[]>();
  if (processorScope.kind === 'all' && processors.length > 0) {
    const byOffering = await clientsByOffering(
      tx,
      processors.map(({ activity }) => activity.offeringId!),
      now,
    );
    for (const { activity } of processors) {
      clientsOf.set(
        activity.id,
        (byOffering.get(activity.offeringId!) ?? []).filter((clientId) =>
          coversClient(activity, clientId, day),
        ),
      );
    }
  }

  const [self] = await tx.select().from(party).where(eq(party.kind, 'self')).limit(1);

  // Every reference, loaded once per table for the whole report.
  const recipients = controllers.map((activity) =>
    activity.engagements.filter((engagement) => inForce(engagement, day)),
  );
  const engagements = [...recipients.flat(), ...processors.flatMap((entry) => entry.engagements)];
  const activities = [...controllers, ...processors.map((entry) => entry.activity)];

  const parties = await loadRefs(tx, partyAggregate, [
    ...engagements.map((engagement) => engagement.partyId),
    ...[...clientsOf.values()].flat(),
    ...(scope?.clientId === null || scope === null ? [] : [scope.clientId]),
    ...(self === undefined ? [] : [self.id]),
  ]);
  const subjectCategories = await loadRefs(
    tx,
    subjectCategoryAggregate,
    activities.flatMap((activity) => activity.subjectCategoryIds),
  );
  const securityMeasures = await loadRefs(
    tx,
    securityMeasureAggregate,
    activities.flatMap((activity) => activity.securityMeasureIds),
  );
  const offerings = await loadRefs(tx, offeringAggregate, [
    ...processors.map(({ activity }) => activity.offeringId!),
    ...(scope === null ? [] : [scope.offeringId]),
  ]);
  const categoryIds = [
    ...new Set([
      ...activities.flatMap((activity) => activity.dataCategoryIds),
      ...engagements.flatMap((engagement) => engagement.dataCategoryIds),
      ...controllers.flatMap((activity) =>
        activity.retentionRules.flatMap((rule) =>
          rule.dataCategoryId === null ? [] : [rule.dataCategoryId],
        ),
      ),
    ]),
  ];
  const categories = new Map(
    categoryIds.length === 0
      ? []
      : (
          await tx
            .select({
              id: dataCategory.id,
              slug: dataCategory.slug,
              name: dataCategory.name,
              special: dataCategory.special,
            })
            .from(dataCategory)
            .where(inArray(dataCategory.id, categoryIds))
        ).map((row) => [row.id, row]),
  );
  const category = (id: string) => {
    const row = categories.get(id);
    if (row === undefined) throw new Error(`Dangling reference: data category ${id}`);
    return row;
  };
  const categoryRef = (id: string): Ref => {
    const { special: _special, ...ref } = category(id);
    return ref;
  };
  const terms = scope === null ? null : await termsRef(tx, scope.termsId);

  const engagement = (row: Engagement): ReportEngagement => ({
    party: requireRef(parties, row.partyId, 'engagement.party'),
    role: row.role,
    service: row.serviceDescription,
    processingCountries: row.processingCountries,
    transfers: row.transfers.map((transfer) => ({
      destinationCountry: transfer.destinationCountry,
      mechanism: transfer.mechanism,
      onwardVia: transfer.onwardVia,
    })),
    dataCategories: row.dataCategoryIds.map(categoryRef),
  });

  const common = (activity: ActivitySnapshot) => ({
    id: activity.id,
    code: activity.code,
    name: activity.name,
    description: activity.description,
    owner: activity.owner,
    startedAt: activity.startedAt,
    reviewDueAt: activity.reviewDueAt,
    subjectCategories: activity.subjectCategoryIds.map((id) =>
      requireRef(subjectCategories, id, 'subjectCategories'),
    ),
    dataCategories: activity.dataCategoryIds.map(category),
    securityMeasures: activity.securityMeasureIds.map((id) =>
      requireRef(securityMeasures, id, 'securityMeasures'),
    ),
  });

  const served = (activity: ActivitySnapshot): ControllersServed => {
    if (scope !== null && scope.clientId !== null) {
      return { kind: 'client', client: requireRef(parties, scope.clientId, 'client') };
    }
    if (scope !== null && terms !== null) return { kind: 'standard', terms };
    return {
      kind: 'covered',
      clients: (clientsOf.get(activity.id) ?? []).map((id) => requireRef(parties, id, 'client')),
    };
  };

  return ReportResponse.parse({
    generatedAt: now.toISOString(),
    asOf: null,
    scope: {
      view,
      offering: scope === null ? null : requireRef(offerings, scope.offeringId, 'offering'),
      client:
        scope === null || scope.clientId === null
          ? null
          : requireRef(parties, scope.clientId, 'client'),
      terms,
    },
    organisation:
      self === undefined
        ? null
        : {
            party: requireRef(parties, self.id, 'organisation'),
            legalName: self.legalName,
            country: self.country,
            contactName: self.contactName,
            contactEmail: self.contactEmail,
            dpoName: self.dpoName,
            dpoEmail: self.dpoEmail,
          },
    controllerActivities: controllers.map((activity, index) => ({
      ...common(activity),
      purposes: activity.purposes,
      lawfulBases: activity.lawfulBases,
      specialConditions: activity.specialConditions,
      recipients: recipients[index]!.map(engagement),
      retentionRules: activity.retentionRules.map((rule) => ({
        dataCategory: rule.dataCategoryId === null ? null : categoryRef(rule.dataCategoryId),
        retentionPeriod: rule.retentionPeriod,
        triggerEvent: rule.triggerEvent,
        legalRef: rule.legalRef,
      })),
      dpiaRequired: activity.dpiaRequired ?? false,
      dpiaRef: activity.dpiaRef,
    })),
    processorActivities: processors.map(
      ({ activity, engagements: scopedEngagements, optionalModule }) => ({
        ...common(activity),
        offering: requireRef(offerings, activity.offeringId!, 'offering'),
        clientCoverage: activity.clientCoverage,
        optionalModule,
        controllers: served(activity),
        processingCategories: activity.processingCategories,
        subprocessors: scopedEngagements.map(engagement),
        dpiaSupportRef: activity.dpiaSupportRef,
      }),
    ),
    subprocessors: scope === null ? null : await buildSubprocessors(tx, scope, now),
  });
}
