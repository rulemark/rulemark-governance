import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  activitySubjectCategory,
  agreement,
  agreementTerms,
  engagement,
  party,
  processingActivity,
} from '../../db/schema/index.js';
import { loadActivitySnapshots } from '../activity/load.js';
import type { AggregateSpec } from '../aggregate.js';
import {
  agreementTermsAggregate,
  dataCategoryAggregate,
  offeringAggregate,
  partyAggregate,
  securityMeasureAggregate,
  subjectCategoryAggregate,
  systemAggregate,
} from '../aggregates.js';
import { agreementInForce, isoDate } from '../agreements.js';
import { findByIdentifier, type Identifiable } from '../identifiers.js';
import { toSnapshotTimestamps } from '../snapshots.js';
import type { Transaction } from '../transaction.js';
import { byCode } from '../views/subprocessors.js';
import {
  byId,
  bySigning,
  type RecordKind,
  type RecordReader,
  type SnapshotsByKind,
} from './reader.js';

/**
 * The record as it is now, from the live tables (`ropa-database.md` §6.4).
 * SQL chooses what to load, through the indexes built for each view; rows
 * become snapshots on the way out, so a view cannot tell this reader from one
 * reading history.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySpec = AggregateSpec<any, any> & Identifiable;
type AnyBuilder = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const AGGREGATES: Record<RecordKind, AnySpec> = {
  party: partyAggregate,
  agreement_terms: agreementTermsAggregate,
  offering: offeringAggregate,
  system: systemAggregate,
  subject_category: subjectCategoryAggregate as AnySpec,
  data_category: dataCategoryAggregate as AnySpec,
  security_measure: securityMeasureAggregate as AnySpec,
};

/**
 * A foundation row in snapshot form. Their `toSnapshot` is a projection that
 * never reads the database, and leaves the timestamps to the save (§6.2).
 */
function snapshotOf<K extends RecordKind>(
  kind: K,
  row: { createdAt: Date; updatedAt: Date },
): SnapshotsByKind[K] {
  const projected = AGGREGATES[kind].toSnapshot(row, undefined as never) as object;
  return { ...projected, ...toSnapshotTimestamps(row) } as SnapshotsByKind[K];
}

export function liveRecord(tx: Transaction, now: Date): RecordReader {
  const day = isoDate(now);

  type Row = { id: string; createdAt: Date; updatedAt: Date };
  const rowsOf = async <K extends RecordKind>(
    kind: K,
    ids?: readonly string[],
  ): Promise<SnapshotsByKind[K][]> => {
    const { table } = AGGREGATES[kind];
    const query = (tx.select() as AnyBuilder).from(table);
    const rows = (await (ids === undefined
      ? query
      : query.where(inArray(table.id, [...ids])))) as Row[];
    return rows.map((row) => snapshotOf(kind, row)).sort(byId);
  };

  return {
    day,

    async find(kind, identifier) {
      const row = await findByIdentifier<{ createdAt: Date; updatedAt: Date }>(
        tx,
        AGGREGATES[kind],
        identifier,
      );
      return row === undefined ? undefined : snapshotOf(kind, row);
    },

    async get(kind, ids) {
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return new Map();
      const snapshots = await rowsOf(kind, wanted);
      return new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    },

    all: (kind) => rowsOf(kind),

    async self() {
      const [row] = await tx.select().from(party).where(eq(party.kind, 'self')).limit(1);
      return row === undefined ? undefined : snapshotOf('party', row);
    },

    async activities(filter = {}) {
      const rows = await tx
        .select()
        .from(processingActivity)
        .where(
          and(
            eq(processingActivity.status, 'active'),
            filter.role === undefined ? undefined : eq(processingActivity.role, filter.role),
            filter.offeringId === undefined
              ? undefined
              : eq(processingActivity.offeringId, filter.offeringId),
            filter.engaging === undefined
              ? undefined
              : sql`EXISTS (SELECT 1 FROM ${engagement} WHERE ${engagement.activityId} = ${processingActivity.id} AND ${engagement.partyId} = ${filter.engaging})`,
            filter.about === undefined
              ? undefined
              : sql`EXISTS (SELECT 1 FROM ${activitySubjectCategory} WHERE ${activitySubjectCategory.activityId} = ${processingActivity.id} AND ${activitySubjectCategory.subjectCategoryId} = ${filter.about})`,
          ),
        );
      return (await loadActivitySnapshots(tx, rows)).sort(byCode);
    },

    async agreementsInForce(filter) {
      if (filter.offeringIds?.length === 0) return [];
      const rows = await tx
        .select({
          id: agreement.id,
          partyId: agreement.partyId,
          offeringId: agreement.offeringId,
          termsId: agreement.termsId,
          signedAt: agreement.signedAt,
        })
        .from(agreement)
        .innerJoin(agreementTerms, eq(agreementTerms.id, agreement.termsId))
        .where(
          and(
            agreementInForce(day, filter.direction),
            filter.partyId === undefined ? undefined : eq(agreement.partyId, filter.partyId),
            filter.offeringIds === undefined
              ? undefined
              : inArray(agreement.offeringId, [...new Set(filter.offeringIds)]),
          ),
        );
      return rows.sort(bySigning);
    },
  };
}
