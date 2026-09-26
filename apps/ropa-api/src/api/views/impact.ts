import { ImpactResponse, type Ref } from '@rulemark/ropa-schemas';

import { refsOf } from '../../domain/record/reader.js';
import { requireRef } from '../../domain/refs.js';
import { partyImpact, type TermsFacts } from '../../domain/views/impact.js';
import { clientAgreementsFor, type ViewRead } from './scope.js';

/** Groups this small list their clients without being asked (§5.3). */
export const SMALL_GROUP = 10;

/** Whether a group names its clients: small ones always, all of them on request. */
export function listsClients(clientCount: number, expandClients: boolean): boolean {
  return expandClients || clientCount <= SMALL_GROUP;
}

/**
 * `GET /parties/{ref}/impact` (`ropa-api.md` §5.3). The record chooses what to
 * load — the active activities engaging the party, the agreements and terms in
 * play — and `partyImpact` decides who is reached (DB §6.3).
 */
export async function buildImpact(
  read: ViewRead,
  party: Ref,
  options: { readonly expandClients: boolean },
): Promise<ImpactResponse> {
  const { record } = read;
  const activities = await record.activities({ engaging: party.id });

  const offeringIds = activities.flatMap((activity) =>
    activity.role === 'processor' && activity.offeringId !== null ? [activity.offeringId] : [],
  );
  const agreements = await clientAgreementsFor(record, offeringIds);
  // Every inbound agreement in force: nothing ties an engagement to one of
  // them (step 3, open question 5).
  const vendorTermsIds = [
    ...new Set(
      (await record.agreementsInForce({ direction: 'inbound', partyId: party.id })).map(
        (row) => row.termsId,
      ),
    ),
  ];

  const terms = await record.get('agreement_terms', [
    ...agreements.map((row) => row.termsId),
    ...vendorTermsIds,
  ]);
  const termsOf = (id: string) => {
    const row = terms.get(id);
    if (row === undefined) throw new Error(`Dangling reference: terms ${id}`);
    return row;
  };

  const special = (await record.all('data_category')).filter((row) => row.special !== 'none');

  const impact = partyImpact({
    partyId: party.id,
    activities,
    agreements,
    terms: new Map<string, TermsFacts>(
      [...terms.values()].map((row) => [
        row.id,
        {
          id: row.id,
          authorizationType: row.authorizationType,
          noticeDays: row.noticeDays,
          allowedRegions: row.allowedRegions,
        },
      ]),
    ),
    vendorNoticeDays: vendorTermsIds.map((id) => termsOf(id).noticeDays),
    specialDataCategoryIds: new Set(special.map((row) => row.id)),
    day: record.day,
  });

  const [subjects, categories, clients] = await Promise.all([
    refsOf(
      record,
      'subject_category',
      impact.entries.flatMap((entry) => entry.activity.subjectCategoryIds),
    ),
    refsOf(
      record,
      'data_category',
      impact.entries.flatMap((entry) => entry.engagement.dataCategoryIds),
    ),
    refsOf(
      record,
      'party',
      impact.entries.flatMap((entry) => entry.clientGroups.flatMap((group) => group.clientIds)),
    ),
  ]);

  const termsRef = (id: string) => {
    const row = termsOf(id);
    return { id: row.id, slug: row.slug, name: row.name };
  };

  return ImpactResponse.parse({
    generatedAt: read.generatedAt.toISOString(),
    asOf: read.asOf,
    party,
    vendorTerms: vendorTermsIds.map((id) => ({
      ...termsRef(id),
      authorizationType: termsOf(id).authorizationType,
      noticeDays: termsOf(id).noticeDays,
    })),
    engagements: impact.entries.map(({ activity, engagement: row, ...entry }) => ({
      activity: { id: activity.id, code: activity.code, name: activity.name },
      engagement: { id: row.id, serviceDescription: row.serviceDescription },
      activityRole: activity.role,
      engagementRole: row.role,
      subjectCategories: activity.subjectCategoryIds.map((id) =>
        requireRef(subjects, id, 'subjectCategories'),
      ),
      dataCategories: row.dataCategoryIds.map((id) => requireRef(categories, id, 'dataCategories')),
      specialCategories: entry.specialCategories,
      processingCountries: row.processingCountries,
      clientGroups: entry.clientGroups.map((group) => ({
        terms: termsRef(group.termsId),
        authorizationType: group.authorizationType,
        noticeDays: group.noticeDays,
        ...(group.allowedRegions.length > 0 ? { allowedRegions: group.allowedRegions } : {}),
        clientCount: group.clientIds.length,
        ...(listsClients(group.clientIds.length, options.expandClients)
          ? { clients: group.clientIds.map((id) => requireRef(clients, id, 'clients')) }
          : {}),
        requiresApproval: group.requiresApproval,
        noticeConflict: group.noticeConflict,
      })),
    })),
    summary: impact.summary,
  });
}
