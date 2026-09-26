import type { RetireInput } from '@rulemark/ropa-schemas';
import { eq } from 'drizzle-orm';

import { processingActivity } from '../../db/schema/index.js';
import { conflict, notFound, validationFailed } from '../../shared/problems.js';
import { staleVersion, updateAggregate, type SaveContext } from '../aggregate.js';
import { isoDate } from '../agreements.js';
import type { Transaction } from '../transaction.js';
import { activityAggregate, loadActivitySnapshot, type ActivityRow } from './load.js';
import { resolvedFromSnapshot } from './resolve.js';
import { crossEntityErrors, roleRuleErrors } from './rules.js';

/**
 * The lifecycle (`ropa-api.md` §3.4): draft → active → retired, one way only.
 * Both transitions name the version they were based on, and that is checked
 * before anything else: an approver holding version 3 must hear that version 4
 * exists, not be told what is wrong with a version they never saw (§1.8).
 * The `UPDATE` checks it again, inside the transaction.
 */

async function current(tx: Transaction, id: string, expectedVersion: number): Promise<ActivityRow> {
  const [row] = await tx.select().from(processingActivity).where(eq(processingActivity.id, id));
  if (row === undefined) throw notFound(`No activity with id ${id}`);
  if (row.version !== expectedVersion) {
    throw staleVersion('activity', expectedVersion, row.version);
  }
  return row;
}

/** The day the change takes effect: backdated for the seed, today otherwise. */
const effectiveDay = (context: SaveContext) => isoDate(context.validFrom ?? new Date());

/**
 * Puts a draft live once it passes every rule a live activity must: the role
 * rules and the cross-entity rules, judged afresh, because the records it
 * points at may have changed since it was saved. Starts it today unless the
 * draft already names a start date.
 */
export async function activateActivity(
  tx: Transaction,
  id: string,
  expectedVersion: number,
  context: SaveContext,
): Promise<ActivityRow> {
  const row = await current(tx, id, expectedVersion);
  if (row.status !== 'draft') {
    throw conflict(`Only a draft can be activated; this activity is ${row.status}`);
  }

  const activity = resolvedFromSnapshot(await loadActivitySnapshot(tx, row));
  const errors = [
    ...(await roleRuleErrors(tx, activity)),
    ...(await crossEntityErrors(tx, activity, context.validFrom ?? new Date())),
  ];
  if (errors.length > 0) throw validationFailed('This activity cannot be activated yet', errors);

  return updateAggregate(
    tx,
    activityAggregate,
    id,
    expectedVersion,
    { status: 'active', startedAt: row.startedAt ?? effectiveDay(context) },
    context,
    'activated',
  );
}

/**
 * Takes a live activity out of the record. Its code is never reused, and it
 * can be neither edited nor reactivated; a role change creates a new activity
 * that supersedes it (DM §3.0). A draft that was never live is deleted instead.
 */
export async function retireActivity(
  tx: Transaction,
  id: string,
  expectedVersion: number,
  input: RetireInput,
  context: SaveContext,
): Promise<ActivityRow> {
  const row = await current(tx, id, expectedVersion);
  if (row.status !== 'active') {
    throw conflict(
      row.status === 'draft'
        ? 'Only an active activity can be retired; delete a draft instead'
        : 'This activity is already retired',
    );
  }

  const endedAt = input.endedAt ?? effectiveDay(context);
  // ISO dates compare correctly as strings. Said here rather than left to
  // `processing_activity_dates`, so the caller gets a field error.
  if (row.startedAt !== null && endedAt < row.startedAt) {
    throw validationFailed('This activity cannot end before it started', [
      {
        path: '/endedAt',
        code: 'before_start',
        message: `Must not be before the activity started (${row.startedAt})`,
      },
    ]);
  }

  return updateAggregate(
    tx,
    activityAggregate,
    id,
    expectedVersion,
    { status: 'retired', endedAt },
    context,
    'retired',
  );
}
