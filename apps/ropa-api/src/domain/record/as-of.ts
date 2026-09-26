import { desc, lt, lte } from 'drizzle-orm';

import { revision } from '../../db/schema/history.js';
import { validationFailed } from '../../shared/problems.js';
import { isoDate } from '../agreements.js';
import { identifierKind } from '../identifiers.js';
import { readSnapshot, type ActivitySnapshot, type AgreementSnapshot } from '../snapshots.js';
import type { Transaction } from '../transaction.js';
import { byCode } from '../views/subprocessors.js';
import {
  RECORD_KINDS,
  byId,
  bySigning,
  type AgreementInForce,
  type RecordKind,
  type RecordReader,
  type SnapshotsByKind,
} from './reader.js';

/**
 * The record as it stood at a moment (`ropa-database.md` §6.3): every
 * aggregate's latest revision at or before it, read through the upgrade path
 * and held in memory, answering the same questions the live tables answer.
 */

/** A resolved `?asOf=`: which revisions count, and which day business dates are judged on. */
export interface AsOfPoint {
  /** As the caller wrote it, a date or a timestamp; responses echo it. */
  readonly asked: string;
  /** Revisions count if `valid_from` is before this instant, or at it when `inclusive`. */
  readonly cutoff: Date;
  readonly inclusive: boolean;
  /** YYYY-MM-DD, UTC: the day agreements, scopes and engagements are judged on. */
  readonly day: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Step 4, open question 4. A date is the end of that day in UTC, so "the
 * record on 1 March" includes that day's changes, and `asOf` today reads the
 * same as no `asOf` (`isoDate` decides "today" in UTC too). A timestamp is
 * taken as given, its day its UTC date. A moment after `now` is refused: the
 * record cannot know tomorrow, and judging "in force" on a future day would
 * read as a prediction.
 */
export function resolveAsOf(asked: string, now: Date): AsOfPoint {
  const future = () =>
    validationFailed('This view cannot be answered as asked', [
      {
        path: '/asOf',
        code: 'in_the_future',
        message:
          'The record says how things stood, not how they will stand; asOf must not be later than now',
      },
    ]);

  if (DATE.test(asked)) {
    if (asked > isoDate(now)) throw future();
    const cutoff = new Date(`${asked}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + 1);
    return { asked, cutoff, inclusive: false, day: asked };
  }

  const cutoff = new Date(asked);
  if (Number.isNaN(cutoff.getTime())) {
    // The query schemas accept only dates and RFC 3339 timestamps.
    throw new Error(`asOf "${asked}" is neither a date nor a timestamp`);
  }
  if (cutoff > now) throw future();
  return { asked, cutoff, inclusive: true, day: isoDate(cutoff) };
}

type AnySnapshot = SnapshotsByKind[RecordKind];

export async function recordAsOf(tx: Transaction, point: AsOfPoint): Promise<RecordReader> {
  // DB §6.3, served by `revision_as_of`. Version breaks a tie between two
  // revisions of one record at the same instant.
  const stored = await tx
    .selectDistinctOn([revision.entityType, revision.entityId], {
      entityType: revision.entityType,
      changeType: revision.changeType,
      snapshot: revision.snapshot,
    })
    .from(revision)
    .where(
      point.inclusive
        ? lte(revision.validFrom, point.cutoff)
        : lt(revision.validFrom, point.cutoff),
    )
    .orderBy(
      revision.entityType,
      revision.entityId,
      desc(revision.validFrom),
      desc(revision.version),
    );

  const records = new Map<RecordKind, Map<string, AnySnapshot>>(
    RECORD_KINDS.map((kind) => [kind, new Map()]),
  );
  const activities: ActivitySnapshot[] = [];
  const agreements: AgreementSnapshot[] = [];
  for (const row of stored) {
    // A record whose latest revision is its deletion was gone by then.
    if (row.changeType === 'deleted') continue;
    const snapshot = readSnapshot(row.entityType, row.snapshot);
    if (row.entityType === 'activity') activities.push(snapshot as ActivitySnapshot);
    else if (row.entityType === 'agreement') agreements.push(snapshot as AgreementSnapshot);
    else records.get(row.entityType)!.set(snapshot.id, snapshot as AnySnapshot);
  }

  const { day } = point;
  const of = <K extends RecordKind>(kind: K) =>
    records.get(kind) as Map<string, SnapshotsByKind[K]>;
  const terms = of('agreement_terms');

  // The SQL of `agreementInForce`, over the agreements and terms of the time.
  const inForce = (row: AgreementSnapshot) => {
    const signed = terms.get(row.termsId);
    if (signed === undefined) throw new Error(`Dangling reference: terms ${row.termsId}`);
    return {
      direction: signed.direction,
      holds: row.signedAt <= day && (row.endedAt === null || row.endedAt > day),
    };
  };

  return {
    day,

    async find(kind, identifier) {
      const kindOf = identifierKind(identifier);
      if (kindOf === 'id') return of(kind).get(identifier);
      // Slugs as the record named them then; these records have no code.
      if (kindOf === 'code') return undefined;
      return [...of(kind).values()].find((snapshot) => snapshot.slug === identifier);
    },

    async get(kind, ids) {
      const found = new Map<string, SnapshotsByKind[typeof kind]>();
      for (const id of ids) {
        const snapshot = of(kind).get(id);
        if (snapshot !== undefined) found.set(id, snapshot);
      }
      return found;
    },

    async all(kind) {
      return [...of(kind).values()].sort(byId);
    },

    async self() {
      return [...of('party').values()].find((snapshot) => snapshot.kind === 'self');
    },

    async activities(filter = {}) {
      return activities
        .filter(
          (activity) =>
            activity.status === 'active' &&
            (filter.role === undefined || activity.role === filter.role) &&
            (filter.offeringId === undefined || activity.offeringId === filter.offeringId) &&
            (filter.engaging === undefined ||
              activity.engagements.some((row) => row.partyId === filter.engaging)) &&
            (filter.about === undefined || activity.subjectCategoryIds.includes(filter.about)),
        )
        .sort(byCode);
    },

    async agreementsInForce(filter) {
      return agreements
        .filter((row) => {
          const { direction, holds } = inForce(row);
          return (
            holds &&
            direction === filter.direction &&
            (filter.partyId === undefined || row.partyId === filter.partyId) &&
            (filter.offeringIds === undefined ||
              (row.offeringId !== null && filter.offeringIds.includes(row.offeringId)))
          );
        })
        .map((row): AgreementInForce => ({
          id: row.id,
          partyId: row.partyId,
          offeringId: row.offeringId,
          termsId: row.termsId,
          signedAt: row.signedAt,
        }))
        .sort(bySigning);
    },
  };
}
