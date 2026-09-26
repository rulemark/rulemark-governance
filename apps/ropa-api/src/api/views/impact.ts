import { ImpactResponse, type Ref } from '@rulemark/ropa-schemas';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import {
  agreementTerms,
  dataCategory,
  engagement,
  processingActivity,
} from '../../db/schema/index.js';
import { loadActivitySnapshots } from '../../domain/activity/load.js';
import {
  dataCategoryAggregate,
  partyAggregate,
  subjectCategoryAggregate,
} from '../../domain/aggregates.js';
import { clientAgreementsFor, isoDate, vendorTermsIdsOf } from '../../domain/agreements.js';
import { loadRefs, requireRef } from '../../domain/refs.js';
import type { Transaction } from '../../domain/transaction.js';
import { partyImpact, type TermsFacts } from '../../domain/views/impact.js';

/** Groups this small list their clients without being asked (§5.3). */
export const SMALL_GROUP = 10;

/** Whether a group names its clients: small ones always, all of them on request. */
export function listsClients(clientCount: number, expandClients: boolean): boolean {
  return expandClients || clientCount <= SMALL_GROUP;
}

/**
 * `GET /parties/{ref}/impact` (`ropa-api.md` §5.3). SQL chooses what to load —
 * the live activities engaging the party, the agreements and terms in play —
 * and `partyImpact` decides who is reached (DB §6.3).
 */
export async function buildImpact(
  tx: Transaction,
  party: Ref,
  options: { readonly expandClients: boolean },
  now: Date,
): Promise<ImpactResponse> {
  const rows = await tx
    .select()
    .from(processingActivity)
    .where(
      and(
        eq(processingActivity.status, 'active'),
        sql`EXISTS (SELECT 1 FROM ${engagement} WHERE ${engagement.activityId} = ${processingActivity.id} AND ${engagement.partyId} = ${party.id})`,
      ),
    );
  const activities = await loadActivitySnapshots(tx, rows);

  const offeringIds = activities.flatMap((activity) =>
    activity.role === 'processor' && activity.offeringId !== null ? [activity.offeringId] : [],
  );
  const agreements = await clientAgreementsFor(tx, offeringIds, now);
  const vendorTermsIds = await vendorTermsIdsOf(tx, party.id, now);

  const termsIds = [...new Set([...agreements.map((row) => row.termsId), ...vendorTermsIds])];
  const termsRows =
    termsIds.length === 0
      ? []
      : await tx.select().from(agreementTerms).where(inArray(agreementTerms.id, termsIds));
  const terms = new Map(termsRows.map((row) => [row.id, row]));
  const termsOf = (id: string) => {
    const row = terms.get(id);
    if (row === undefined) throw new Error(`Dangling reference: terms ${id}`);
    return row;
  };

  const special = await tx
    .select({ id: dataCategory.id })
    .from(dataCategory)
    .where(ne(dataCategory.special, 'none'));

  const impact = partyImpact({
    partyId: party.id,
    activities,
    agreements,
    terms: new Map<string, TermsFacts>(
      termsRows.map((row) => [
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
    day: isoDate(now),
  });

  const [subjects, categories, clients] = await Promise.all([
    loadRefs(
      tx,
      subjectCategoryAggregate,
      impact.entries.flatMap((entry) => entry.activity.subjectCategoryIds),
    ),
    loadRefs(
      tx,
      dataCategoryAggregate,
      impact.entries.flatMap((entry) => entry.engagement.dataCategoryIds),
    ),
    loadRefs(
      tx,
      partyAggregate,
      impact.entries.flatMap((entry) => entry.clientGroups.flatMap((group) => group.clientIds)),
    ),
  ]);

  const termsRef = (id: string) => {
    const row = termsOf(id);
    return { id: row.id, slug: row.slug, name: row.name };
  };

  return ImpactResponse.parse({
    generatedAt: now.toISOString(),
    asOf: null,
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
