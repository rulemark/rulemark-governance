import { DataMapResponse, type Ref } from '@rulemark/ropa-schemas';
import { and, eq, sql } from 'drizzle-orm';

import { activitySubjectCategory, processingActivity } from '../../db/schema/index.js';
import { loadActivitySnapshots } from '../../domain/activity/load.js';
import {
  dataCategoryAggregate,
  partyAggregate,
  subjectCategoryAggregate,
  systemAggregate,
} from '../../domain/aggregates.js';
import { activeAgreementsOf, isoDate } from '../../domain/agreements.js';
import { findByIdentifier } from '../../domain/identifiers.js';
import { loadRefs, requireRef } from '../../domain/refs.js';
import type { Transaction } from '../../domain/transaction.js';
import { dataMap } from '../../domain/views/data-map.js';
import { refused } from './scope.js';

/**
 * `GET /data-map` (`ropa-api.md` §5.4). SQL chooses what to load — the live
 * activities about the subject category, and the client's agreements — and
 * `dataMap` decides what a request touches and who acts on it (DB §6.3).
 */
export async function buildDataMap(
  tx: Transaction,
  query: { readonly subjectCategory: string; readonly client?: string | undefined },
  now: Date,
): Promise<DataMapResponse> {
  const subject = await findByIdentifier<Parameters<typeof subjectCategoryAggregate.toRef>[0]>(
    tx,
    subjectCategoryAggregate,
    query.subjectCategory,
  );
  if (subject === undefined) {
    refused([
      {
        path: '/subjectCategory',
        code: 'unknown_reference',
        message: `No subject category matching "${query.subjectCategory}"`,
      },
    ]);
  }

  let client: { ref: Ref; offeringIds: Set<string> } | null = null;
  if (query.client !== undefined) {
    const row = await findByIdentifier<Parameters<typeof partyAggregate.toRef>[0]>(
      tx,
      partyAggregate,
      query.client,
    );
    if (row === undefined) {
      refused([
        {
          path: '/client',
          code: 'unknown_reference',
          message: `No party matching "${query.client}"`,
        },
      ]);
    }
    // No agreement is not an error here: the controller side still answers,
    // and the processor side is rightly empty.
    const agreements = await activeAgreementsOf(tx, row.id, now);
    client = {
      ref: partyAggregate.toRef(row),
      offeringIds: new Set(agreements.map((agreement) => agreement.offeringId)),
    };
  }

  const rows = await tx
    .select()
    .from(processingActivity)
    .where(
      and(
        eq(processingActivity.status, 'active'),
        sql`EXISTS (SELECT 1 FROM ${activitySubjectCategory} WHERE ${activitySubjectCategory.activityId} = ${processingActivity.id} AND ${activitySubjectCategory.subjectCategoryId} = ${subject.id})`,
      ),
    );

  const entries = dataMap({
    subjectCategoryId: subject.id,
    client: client === null ? null : { id: client.ref.id, offeringIds: client.offeringIds },
    activities: await loadActivitySnapshots(tx, rows),
    day: isoDate(now),
  });

  const [systems, parties, categories] = await Promise.all([
    loadRefs(
      tx,
      systemAggregate,
      entries.flatMap((entry) => entry.activity.systemIds),
    ),
    loadRefs(
      tx,
      partyAggregate,
      entries.flatMap((entry) => entry.vendors.map((vendor) => vendor.partyId)),
    ),
    loadRefs(tx, dataCategoryAggregate, [
      ...entries.flatMap((entry) => entry.vendors.flatMap((vendor) => vendor.dataCategoryIds)),
      ...entries.flatMap((entry) =>
        entry.activity.retentionRules.flatMap((rule) => rule.dataCategoryId ?? []),
      ),
    ]),
  ]);

  return DataMapResponse.parse({
    generatedAt: now.toISOString(),
    asOf: null,
    subjectCategory: subjectCategoryAggregate.toRef(subject),
    client: client?.ref ?? null,
    entries: entries.map(({ activity, action, vendors }) => ({
      activity: { id: activity.id, code: activity.code, name: activity.name },
      role: activity.role,
      action,
      systems: activity.systemIds.map((id) => requireRef(systems, id, 'systems')),
      vendors: vendors.map((vendor) => ({
        party: requireRef(parties, vendor.partyId, 'vendors.party'),
        role: vendor.role,
        dataCategories: vendor.dataCategoryIds.map((id) =>
          requireRef(categories, id, 'vendors.dataCategories'),
        ),
      })),
      // Retention is the controller's decision; for a processor activity it
      // is the client's, so it is not ours to report (§5.4).
      retention:
        activity.role === 'controller'
          ? activity.retentionRules.map((rule) => ({
              id: rule.id,
              dataCategory:
                rule.dataCategoryId === null
                  ? null
                  : requireRef(categories, rule.dataCategoryId, 'retention.dataCategory'),
              retentionPeriod: rule.retentionPeriod,
              triggerEvent: rule.triggerEvent,
              legalRef: rule.legalRef,
            }))
          : null,
    })),
  });
}
