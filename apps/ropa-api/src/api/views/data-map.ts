import { DataMapResponse, type Ref } from '@rulemark/ropa-schemas';

import { refOf, refsOf } from '../../domain/record/reader.js';
import { requireRef } from '../../domain/refs.js';
import { dataMap } from '../../domain/views/data-map.js';
import { clientAgreementsOf, noMatch, refused, type ViewRead } from './scope.js';

/**
 * `GET /data-map` (`ropa-api.md` §5.4). The record chooses what to load — the
 * active activities about the subject category, and the client's agreements —
 * and `dataMap` decides what a request touches and who acts on it (DB §6.3).
 */
export async function buildDataMap(
  read: ViewRead,
  query: { readonly subjectCategory: string; readonly client?: string | undefined },
): Promise<DataMapResponse> {
  const { record } = read;
  const subject = await record.find('subject_category', query.subjectCategory);
  if (subject === undefined) {
    refused([
      {
        path: '/subjectCategory',
        code: 'unknown_reference',
        message: noMatch(read, 'subject category', query.subjectCategory),
      },
    ]);
  }

  let client: { ref: Ref; offeringIds: Set<string> } | null = null;
  if (query.client !== undefined) {
    const found = await record.find('party', query.client);
    if (found === undefined) {
      refused([
        {
          path: '/client',
          code: 'unknown_reference',
          message: noMatch(read, 'party', query.client),
        },
      ]);
    }
    // No agreement is not an error here: the controller side still answers,
    // and the processor side is rightly empty.
    const agreements = await clientAgreementsOf(record, found.id);
    client = {
      ref: refOf('party', found),
      offeringIds: new Set(agreements.map((agreement) => agreement.offeringId)),
    };
  }

  const entries = dataMap({
    subjectCategoryId: subject.id,
    client: client === null ? null : { id: client.ref.id, offeringIds: client.offeringIds },
    activities: await record.activities({ about: subject.id }),
    day: record.day,
  });

  const [systems, parties, categories] = await Promise.all([
    refsOf(
      record,
      'system',
      entries.flatMap((entry) => entry.activity.systemIds),
    ),
    refsOf(
      record,
      'party',
      entries.flatMap((entry) => entry.vendors.map((vendor) => vendor.partyId)),
    ),
    refsOf(record, 'data_category', [
      ...entries.flatMap((entry) => entry.vendors.flatMap((vendor) => vendor.dataCategoryIds)),
      ...entries.flatMap((entry) =>
        entry.activity.retentionRules.flatMap((rule) => rule.dataCategoryId ?? []),
      ),
    ]),
  ]);

  return DataMapResponse.parse({
    generatedAt: read.generatedAt.toISOString(),
    asOf: read.asOf,
    subjectCategory: refOf('subject_category', subject),
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
