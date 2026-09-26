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

/** Ids are UUIDv7, so id order is also the order rows were added in. */
const byId = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group === undefined) groups.set(key(row), [row]);
    else group.push(row);
  }
  return groups;
}

export async function loadActivitySnapshot(
  tx: Transaction,
  row: ActivityRow,
): Promise<ActivitySnapshot> {
  // One query at a time: a transaction is one connection, and pg does not run
  // queries on a connection concurrently.
  const activityId = row.id;
  const subjectCategoryIds = (
    await tx
      .select({ id: activitySubjectCategory.subjectCategoryId })
      .from(activitySubjectCategory)
      .where(eq(activitySubjectCategory.activityId, activityId))
  ).map((link) => link.id);
  const dataCategoryIds = (
    await tx
      .select({ id: activityDataCategory.dataCategoryId })
      .from(activityDataCategory)
      .where(eq(activityDataCategory.activityId, activityId))
  ).map((link) => link.id);
  const systemIds = (
    await tx
      .select({ id: activitySystem.systemId })
      .from(activitySystem)
      .where(eq(activitySystem.activityId, activityId))
  ).map((link) => link.id);
  const securityMeasureIds = (
    await tx
      .select({ id: activitySecurityMeasure.securityMeasureId })
      .from(activitySecurityMeasure)
      .where(eq(activitySecurityMeasure.activityId, activityId))
  ).map((link) => link.id);

  const rules = await tx
    .select()
    .from(retentionRule)
    .where(eq(retentionRule.activityId, activityId))
    .orderBy(asc(retentionRule.id));
  const scope = await tx
    .select()
    .from(activityClientScope)
    .where(eq(activityClientScope.activityId, activityId))
    .orderBy(asc(activityClientScope.id));
  const engagements = await tx
    .select()
    .from(engagement)
    .where(eq(engagement.activityId, activityId))
    .orderBy(asc(engagement.id));

  const engagementIds = engagements.map((row) => row.id);
  const inEngagements = engagementIds.length > 0;
  const categories = inEngagements
    ? await tx
        .select()
        .from(engagementDataCategory)
        .where(inArray(engagementDataCategory.engagementId, engagementIds))
    : [];
  const transfers = inEngagements
    ? await tx.select().from(transfer).where(inArray(transfer.engagementId, engagementIds))
    : [];
  const scopes = inEngagements
    ? await tx
        .select()
        .from(engagementClientScope)
        .where(inArray(engagementClientScope.engagementId, engagementIds))
    : [];
  const categoriesOf = groupBy(categories, (link) => link.engagementId);
  const transfersOf = groupBy(transfers, (row) => row.engagementId);
  const scopesOf = groupBy(scopes, (row) => row.engagementId);

  return {
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
    subjectCategoryIds: subjectCategoryIds.sort(),
    dataCategoryIds: dataCategoryIds.sort(),
    systemIds: systemIds.sort(),
    securityMeasureIds: securityMeasureIds.sort(),
    retentionRules: rules.map((rule) => ({
      id: rule.id,
      dataCategoryId: rule.dataCategoryId,
      retentionPeriod: rule.retentionPeriod,
      triggerEvent: rule.triggerEvent,
      legalRef: rule.legalRef,
    })),
    clientScope: scope.map((entry) => ({
      id: entry.id,
      clientPartyId: entry.clientPartyId,
      mode: entry.mode,
      reason: entry.reason,
      agreementId: entry.agreementId,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    })),
    engagements: engagements.map((row) => ({
      id: row.id,
      partyId: row.partyId,
      role: row.role,
      serviceDescription: row.serviceDescription,
      processingCountries: row.processingCountries,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      dataCategoryIds: (categoriesOf.get(row.id) ?? []).map((link) => link.dataCategoryId).sort(),
      transfers: byId(transfersOf.get(row.id) ?? []).map((row) => ({
        id: row.id,
        destinationCountry: row.destinationCountry,
        mechanism: row.mechanism,
        onwardVia: row.onwardVia,
        documentRef: row.documentRef,
      })),
      clientScope: byId(scopesOf.get(row.id) ?? []).map((entry) => ({
        id: entry.id,
        clientPartyId: entry.clientPartyId,
        mode: entry.mode,
        reason: entry.reason,
        agreementId: entry.agreementId,
      })),
    })),
  };
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
