import type { FieldError } from '@rulemark/ropa-schemas';
import { eq, inArray } from 'drizzle-orm';

import {
  activityClientScope,
  activityDataCategory,
  activitySecurityMeasure,
  activitySubjectCategory,
  activitySystem,
  engagement,
  engagementClientScope,
  engagementDataCategory,
  retentionRule,
  transfer,
} from '../../db/schema/index.js';
import type { ActivitySnapshot } from '../snapshots.js';
import type { Transaction } from '../transaction.js';
import type { ResolvedActivity } from './resolve.js';

/**
 * Step 3 of the save (`ropa-database.md` §6.1): nested rows keep their identity
 * across a `PUT` (API §1.4). A row sent with its `id` is updated, one sent
 * without is inserted, and a stored row that was left out is deleted. Link
 * tables have no identity of their own and are replaced wholesale.
 *
 * This runs after the root row is locked by the version check, so the stored
 * rows it compares against cannot change underneath it. That is also why the
 * root's `If-Match` is enough for the whole aggregate: nothing writes a nested
 * row except through here.
 */

/**
 * A sent id must name a row this aggregate already holds, under the same
 * parent, once. Anything else would let a request adopt another activity's
 * engagement, or move a transfer between engagements, by quoting its id.
 */
function checkIds(
  sent: readonly { readonly id: string | undefined }[],
  stored: readonly { readonly id: string }[],
  path: string,
): FieldError[] {
  const known = new Set(stored.map((row) => row.id));
  const seen = new Set<string>();
  const errors: FieldError[] = [];

  sent.forEach((row, index) => {
    if (row.id === undefined) return;
    const at = `${path}/${index}/id`;
    if (seen.has(row.id)) {
      errors.push({ path: at, code: 'duplicate_row', message: 'This row appears twice' });
    } else if (!known.has(row.id)) {
      errors.push({
        path: at,
        code: 'unknown_row',
        message: 'No such row here. Leave the id out to add a new one.',
      });
    }
    seen.add(row.id);
  });
  return errors;
}

/** Every nested id, checked against what is stored. `stored` is absent on create. */
export function nestedIdErrors(
  activity: ResolvedActivity,
  stored: ActivitySnapshot | undefined,
): FieldError[] {
  const storedEngagements = new Map(stored?.engagements.map((row) => [row.id, row]));

  return [
    ...checkIds(activity.retentionRules, stored?.retentionRules ?? [], '/retentionRules'),
    ...checkIds(activity.clientScope, stored?.clientScope ?? [], '/clientScope/clients'),
    ...checkIds(activity.engagements, stored?.engagements ?? [], '/engagements'),
    ...activity.engagements.flatMap((row, index) => {
      // A new engagement has no children yet, so any id under it is unknown.
      const parent = row.id === undefined ? undefined : storedEngagements.get(row.id);
      const path = `/engagements/${index}`;
      return [
        ...checkIds(row.transfers, parent?.transfers ?? [], `${path}/transfers`),
        ...checkIds(row.clientScope, parent?.clientScope ?? [], `${path}/clientScope/clients`),
      ];
    }),
  ];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Drizzle's builders are typed per table; `syncRows` is written once for five. */
type AnyTable = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Brings one nested table in line with what was sent, and returns the id of
 * each sent row in order. Deletes go first, so a row that takes over a value
 * from one being removed — a data category, a client — does not trip a unique
 * constraint on the way.
 */
async function syncRows<T extends { readonly id: string | undefined }>(
  tx: Transaction,
  table: AnyTable,
  storedIds: readonly string[],
  sent: readonly T[],
  values: (row: T) => Record<string, unknown>,
): Promise<string[]> {
  const kept = new Set(sent.flatMap((row) => (row.id === undefined ? [] : [row.id])));
  const removed = storedIds.filter((id) => !kept.has(id));
  if (removed.length > 0) await tx.delete(table).where(inArray(table.id, removed));

  const ids: string[] = [];
  for (const row of sent) {
    if (row.id !== undefined) {
      await tx.update(table).set(values(row)).where(eq(table.id, row.id));
      ids.push(row.id);
    } else {
      const [inserted] = (await tx
        .insert(table)
        .values(values(row))
        .returning({ id: table.id })) as { id: string }[];
      ids.push(inserted!.id);
    }
  }
  return ids;
}

/** Link rows, once each: two identifiers may have named the same record. */
async function replaceLinks(
  tx: Transaction,
  table: AnyTable,
  parentColumn: string,
  parentId: string,
  targetColumn: string,
  targetIds: readonly string[],
): Promise<void> {
  await tx.delete(table).where(eq(table[parentColumn], parentId));
  const unique = [...new Set(targetIds)];
  if (unique.length === 0) return;
  await tx
    .insert(table)
    .values(unique.map((targetId) => ({ [parentColumn]: parentId, [targetColumn]: targetId })));
}

/** Writes every nested row and link of the aggregate. `stored` is absent on create. */
export async function writeChildren(
  tx: Transaction,
  activityId: string,
  activity: ResolvedActivity,
  stored: ActivitySnapshot | undefined,
): Promise<void> {
  const links = [
    [activitySubjectCategory, 'subjectCategoryId', activity.subjectCategoryIds],
    [activityDataCategory, 'dataCategoryId', activity.dataCategoryIds],
    [activitySystem, 'systemId', activity.systemIds],
    [activitySecurityMeasure, 'securityMeasureId', activity.securityMeasureIds],
  ] as const;
  for (const [table, column, ids] of links) {
    await replaceLinks(tx, table, 'activityId', activityId, column, ids);
  }

  await syncRows(
    tx,
    retentionRule,
    stored?.retentionRules.map((row) => row.id) ?? [],
    activity.retentionRules,
    ({ id: _id, ...rule }) => ({ ...rule, activityId }),
  );
  await syncRows(
    tx,
    activityClientScope,
    stored?.clientScope.map((row) => row.id) ?? [],
    activity.clientScope,
    ({ id: _id, ...entry }) => ({ ...entry, activityId }),
  );

  const engagementIds = await syncRows(
    tx,
    engagement,
    stored?.engagements.map((row) => row.id) ?? [],
    activity.engagements,
    ({
      id: _id,
      dataCategoryIds: _categories,
      transfers: _transfers,
      clientScope: _scope,
      ...row
    }) => ({
      ...row,
      activityId,
    }),
  );

  const storedEngagements = new Map(stored?.engagements.map((row) => [row.id, row]));
  for (const [index, row] of activity.engagements.entries()) {
    const engagementId = engagementIds[index]!;
    const previous = storedEngagements.get(engagementId);

    await replaceLinks(
      tx,
      engagementDataCategory,
      'engagementId',
      engagementId,
      'dataCategoryId',
      row.dataCategoryIds,
    );
    await syncRows(
      tx,
      transfer,
      previous?.transfers.map((child) => child.id) ?? [],
      row.transfers,
      ({ id: _id, ...child }) => ({ ...child, engagementId }),
    );
    await syncRows(
      tx,
      engagementClientScope,
      previous?.clientScope.map((child) => child.id) ?? [],
      row.clientScope,
      ({ id: _id, ...child }) => ({ ...child, engagementId }),
    );
  }
}
