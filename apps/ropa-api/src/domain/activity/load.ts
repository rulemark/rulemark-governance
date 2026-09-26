import type { Ref } from '@rulemark/ropa-schemas';
import { asc, eq, inArray } from 'drizzle-orm';

import {
  activityClientScope,
  activityDataCategory,
  activitySecurityMeasure,
  activitySubjectCategory,
  activitySystem,
  engagement,
  engagementClientScope,
  engagementDataCategory,
  processingActivity,
  retentionRule,
  transfer,
} from '../../db/schema/index.js';
import type { AggregateSpec } from '../aggregate.js';
import type { Identifiable } from '../identifiers.js';
import { ActivitySnapshot, SNAPSHOT_SCHEMA_VERSION, toSnapshotTimestamps } from '../snapshots.js';
import type { Transaction } from '../transaction.js';

/**
 * The activity aggregate read back from its eleven tables, in canonical form:
 * ids rather than Refs, every nested row with its id, lists in id order
 * (`ropa-database.md` §6.2). This is what a revision stores, and what the views
 * and the API response are built from.
 */

export type ActivityRow = typeof processingActivity.$inferSelect;

// Nested rows are read in id order: ids are UUIDv7, so that is also the order
// they were added in, and two snapshots of the same state compare equal.

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group === undefined) groups.set(key(row), [row]);
    else group.push(row);
  }
  return groups;
}

/**
 * Several activities at once, one query per table rather than per activity, so
 * a page of fifty costs the same ten queries as a single record. Queries run
 * one at a time: a transaction is one connection, and pg does not run queries
 * on a connection concurrently.
 */
export async function loadActivitySnapshots(
  tx: Transaction,
  rows: readonly ActivityRow[],
): Promise<ActivitySnapshot[]> {
  if (rows.length === 0) return [];
  const activityIds = rows.map((row) => row.id);

  const subjectCategories = await tx
    .select()
    .from(activitySubjectCategory)
    .where(inArray(activitySubjectCategory.activityId, activityIds));
  const dataCategories = await tx
    .select()
    .from(activityDataCategory)
    .where(inArray(activityDataCategory.activityId, activityIds));
  const systems = await tx
    .select()
    .from(activitySystem)
    .where(inArray(activitySystem.activityId, activityIds));
  const securityMeasures = await tx
    .select()
    .from(activitySecurityMeasure)
    .where(inArray(activitySecurityMeasure.activityId, activityIds));
  const rules = await tx
    .select()
    .from(retentionRule)
    .where(inArray(retentionRule.activityId, activityIds))
    .orderBy(asc(retentionRule.id));
  const scopes = await tx
    .select()
    .from(activityClientScope)
    .where(inArray(activityClientScope.activityId, activityIds))
    .orderBy(asc(activityClientScope.id));
  const engagements = await tx
    .select()
    .from(engagement)
    .where(inArray(engagement.activityId, activityIds))
    .orderBy(asc(engagement.id));

  const engagementIds = engagements.map((row) => row.id);
  const inEngagements = engagementIds.length > 0;
  const engagementCategories = inEngagements
    ? await tx
        .select()
        .from(engagementDataCategory)
        .where(inArray(engagementDataCategory.engagementId, engagementIds))
    : [];
  const transfers = inEngagements
    ? await tx
        .select()
        .from(transfer)
        .where(inArray(transfer.engagementId, engagementIds))
        .orderBy(asc(transfer.id))
    : [];
  const engagementScopes = inEngagements
    ? await tx
        .select()
        .from(engagementClientScope)
        .where(inArray(engagementClientScope.engagementId, engagementIds))
        .orderBy(asc(engagementClientScope.id))
    : [];

  const idsOf = <T extends { activityId: string }>(
    links: readonly T[],
    pick: (link: T) => string,
  ) => {
    const grouped = groupBy(links, (link) => link.activityId);
    return (activityId: string) => (grouped.get(activityId) ?? []).map(pick).sort();
  };
  const subjectCategoryIdsOf = idsOf(subjectCategories, (link) => link.subjectCategoryId);
  const dataCategoryIdsOf = idsOf(dataCategories, (link) => link.dataCategoryId);
  const systemIdsOf = idsOf(systems, (link) => link.systemId);
  const securityMeasureIdsOf = idsOf(securityMeasures, (link) => link.securityMeasureId);
  const rulesOf = groupBy(rules, (row) => row.activityId);
  const scopesOf = groupBy(scopes, (row) => row.activityId);
  const engagementsOf = groupBy(engagements, (row) => row.activityId);
  const categoriesOf = groupBy(engagementCategories, (link) => link.engagementId);
  const transfersOf = groupBy(transfers, (row) => row.engagementId);
  const engagementScopesOf = groupBy(engagementScopes, (row) => row.engagementId);

  return rows.map((row) => ({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: row.id,
    version: row.version,
    ...toSnapshotTimestamps(row),
    code: row.code,
    name: row.name,
    description: row.description,
    supersedesId: row.supersedesId,
    role: row.role,
    roleRationale: row.roleRationale,
    status: row.status,
    owner: row.owner,
    offeringId: row.offeringId,
    clientCoverage: row.clientCoverage,
    purposes: row.purposes,
    lawfulBases: row.lawfulBases,
    specialConditions: row.specialConditions,
    processingCategories: row.processingCategories,
    dpiaRequired: row.dpiaRequired,
    dpiaRef: row.dpiaRef,
    dpiaSupportRef: row.dpiaSupportRef,
    reviewDueAt: row.reviewDueAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    subjectCategoryIds: subjectCategoryIdsOf(row.id),
    dataCategoryIds: dataCategoryIdsOf(row.id),
    systemIds: systemIdsOf(row.id),
    securityMeasureIds: securityMeasureIdsOf(row.id),
    retentionRules: (rulesOf.get(row.id) ?? []).map((rule) => ({
      id: rule.id,
      dataCategoryId: rule.dataCategoryId,
      retentionPeriod: rule.retentionPeriod,
      triggerEvent: rule.triggerEvent,
      legalRef: rule.legalRef,
    })),
    clientScope: (scopesOf.get(row.id) ?? []).map((entry) => ({
      id: entry.id,
      clientPartyId: entry.clientPartyId,
      mode: entry.mode,
      reason: entry.reason,
      agreementId: entry.agreementId,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    })),
    engagements: (engagementsOf.get(row.id) ?? []).map((item) => ({
      id: item.id,
      partyId: item.partyId,
      role: item.role,
      serviceDescription: item.serviceDescription,
      processingCountries: item.processingCountries,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      dataCategoryIds: (categoriesOf.get(item.id) ?? []).map((link) => link.dataCategoryId).sort(),
      transfers: (transfersOf.get(item.id) ?? []).map((child) => ({
        id: child.id,
        destinationCountry: child.destinationCountry,
        mechanism: child.mechanism,
        onwardVia: child.onwardVia,
        documentRef: child.documentRef,
      })),
      clientScope: (engagementScopesOf.get(item.id) ?? []).map((entry) => ({
        id: entry.id,
        clientPartyId: entry.clientPartyId,
        mode: entry.mode,
        reason: entry.reason,
        agreementId: entry.agreementId,
      })),
    })),
  }));
}

export async function loadActivitySnapshot(
  tx: Transaction,
  row: ActivityRow,
): Promise<ActivitySnapshot> {
  const [snapshot] = await loadActivitySnapshots(tx, [row]);
  return snapshot!;
}

/** The whole aggregate, or undefined when there is no such activity. */
export async function loadActivity(
  tx: Transaction,
  id: string,
): Promise<ActivitySnapshot | undefined> {
  const [row] = await tx.select().from(processingActivity).where(eq(processingActivity.id, id));
  return row === undefined ? undefined : loadActivitySnapshot(tx, row);
}

export const activityAggregate: AggregateSpec<ActivityRow, ActivitySnapshot> & Identifiable = {
  entityType: 'activity',
  table: processingActivity,
  codeColumn: processingActivity.code,
  snapshotSchema: ActivitySnapshot,
  toSnapshot: (row, tx) => loadActivitySnapshot(tx, row),
  toRef: (row): Ref => ({ id: row.id, code: row.code, name: row.name }),
};
