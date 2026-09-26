import {
  ReviewItem,
  type Change,
  type ChangeEntityType,
  type Ref,
  type RevisionEntityType,
} from '@rulemark/ropa-schemas';
import { sql, type SQL } from 'drizzle-orm';

import { validationFailed } from '../shared/problems.js';
import { activityAggregate } from './activity/load.js';
import {
  agreementAggregate,
  agreementTermsAggregate,
  dataCategoryAggregate,
  offeringAggregate,
  partyAggregate,
  securityMeasureAggregate,
  subjectCategoryAggregate,
  systemAggregate,
} from './aggregates.js';
import { decodePositionCursor, encodePositionCursor, type Page } from './pagination.js';
import { readSnapshot } from './snapshots.js';
import type { Transaction } from './transaction.js';

/**
 * `GET /changes` (`ropa-api.md` §2): every revision and every review-item
 * event in a time range, oldest first, as one list. Revisions are ordered by
 * `valid_from`, when the change took effect, which the seed backdates; review
 * items by `occurred_at` (step 4, open question 3). Ties break on id.
 */

/** The bounds as Postgres compares them. `before` is exclusive, `through` inclusive. */
export interface ChangeRange {
  readonly from?: string | undefined;
  readonly before?: string | undefined;
  readonly through?: string | undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function nextMidnight(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/**
 * Dates mean whole days in UTC, as `asOf` does (step 4, open question 4): a
 * `from` date starts at its midnight, a `to` date runs to the next. A
 * timestamp is taken as given, and both ends include it.
 */
export function resolveRange(from: string | undefined, to: string | undefined): ChangeRange {
  const range: ChangeRange = {
    from: from === undefined ? undefined : DATE.test(from) ? `${from}T00:00:00Z` : from,
    ...(to === undefined ? {} : DATE.test(to) ? { before: nextMidnight(to) } : { through: to }),
  };
  const start = range.from === undefined ? undefined : Date.parse(range.from);
  const end = range.before ?? range.through;
  if (
    start !== undefined &&
    end !== undefined &&
    (range.before === undefined ? start > Date.parse(end) : start >= Date.parse(end))
  ) {
    throw validationFailed('This range cannot hold any change', [
      { path: '/to', code: 'from_after_to', message: 'to must not be earlier than from' },
    ]);
  }
  return range;
}

/** How each record type is named, from its own snapshot: the name of the time. */
const REF_OF: Record<RevisionEntityType, (snapshot: never) => Ref> = {
  activity: activityAggregate.toRef,
  party: partyAggregate.toRef,
  agreement: agreementAggregate.toRef,
  agreement_terms: agreementTermsAggregate.toRef,
  offering: offeringAggregate.toRef,
  system: systemAggregate.toRef,
  subject_category: subjectCategoryAggregate.toRef,
  data_category: dataCategoryAggregate.toRef,
  security_measure: securityMeasureAggregate.toRef,
};

/** A review item has no name of its own; it is named by what it is about. */
function reviewItemRef(item: ReviewItem): Ref {
  const reason = item.reason.replaceAll('_', ' ');
  const target = item.target.code ?? item.target.slug ?? item.target.name;
  return {
    id: item.id,
    code: item.code,
    name: `${reason[0]!.toUpperCase()}${reason.slice(1)} on ${target}`,
  };
}

interface ChangeRow extends Record<string, unknown> {
  id: string;
  entity_type: ChangeEntityType;
  version: number | null;
  change_type: string;
  /** Raw SQL comes back as Postgres writes it, not as a `Date`. */
  occurred_at: string;
  /** `occurred_at` to the microsecond, for the cursor. */
  position: string;
  actor: string;
  change_note: string | null;
  body: unknown;
}

function toChange(row: ChangeRow): Change {
  const common = {
    id: row.id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actor: row.actor,
  };
  if (row.entity_type === 'review_item') {
    const item = ReviewItem.parse(row.body);
    return {
      ...common,
      entityType: 'review_item',
      entity: reviewItemRef(item),
      version: null,
      changeType: row.change_type as 'opened' | 'resolved' | 'dismissed',
      // Opening says nothing; closing says why, in the resolution note.
      changeNote: row.change_type === 'opened' ? null : item.resolutionNote,
    };
  }
  const entityType = row.entity_type;
  return {
    ...common,
    entityType,
    entity: REF_OF[entityType](readSnapshot(entityType, row.body) as never),
    version: row.version!,
    changeType: row.change_type as Exclude<
      Change['changeType'],
      'opened' | 'resolved' | 'dismissed'
    >,
    changeNote: row.change_note,
  };
}

export async function listChanges(
  tx: Transaction,
  query: {
    readonly range: ChangeRange;
    readonly entityType?: ChangeEntityType | undefined;
    readonly limit: number;
    readonly cursor?: string | undefined;
  },
): Promise<Page<Change>> {
  const { range, entityType } = query;
  const within = (column: SQL): SQL => {
    const conditions: SQL[] = [sql`TRUE`];
    if (range.from !== undefined) conditions.push(sql`${column} >= ${range.from}::timestamptz`);
    if (range.before !== undefined) conditions.push(sql`${column} < ${range.before}::timestamptz`);
    if (range.through !== undefined) {
      conditions.push(sql`${column} <= ${range.through}::timestamptz`);
    }
    return sql.join(conditions, sql` AND `);
  };

  const parts: SQL[] = [];
  if (entityType !== 'review_item') {
    parts.push(sql`
      SELECT id, entity_type, version, change_type, valid_from AS occurred_at, actor, change_note,
             snapshot AS body
      FROM revision
      WHERE ${within(sql`valid_from`)}
        ${entityType === undefined ? sql`` : sql`AND entity_type = ${entityType}`}`);
  }
  if (entityType === undefined || entityType === 'review_item') {
    parts.push(sql`
      SELECT id, 'review_item' AS entity_type, NULL::integer AS version, change_type,
             occurred_at, actor, NULL::text AS change_note, review_item AS body
      FROM review_item_event
      WHERE ${within(sql`occurred_at`)}`);
  }

  const after =
    query.cursor === undefined
      ? sql`TRUE`
      : (() => {
          const { at, id } = decodePositionCursor(query.cursor);
          return sql`(occurred_at, id) > (${at}::timestamptz, ${id}::uuid)`;
        })();

  const { rows } = await tx.execute<ChangeRow>(sql`
    SELECT *,
           to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position
    FROM (${sql.join(parts, sql` UNION ALL `)}) AS change
    WHERE ${after}
    ORDER BY occurred_at, id
    LIMIT ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(toChange),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodePositionCursor(last.position, last.id)
        : null,
  };
}
