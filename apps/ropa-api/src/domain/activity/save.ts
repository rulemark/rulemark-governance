import type { FieldError } from '@rulemark/ropa-schemas';
import { eq } from 'drizzle-orm';

import { processingActivity } from '../../db/schema/index.js';
import { conflict, notFound, validationFailed } from '../../shared/problems.js';
import { createAggregate, updateAggregate, type SaveContext } from '../aggregate.js';
import { allocateCode } from '../codes.js';
import type { Transaction } from '../transaction.js';
import { nestedIdErrors, writeChildren } from './children.js';
import { activityAggregate, loadActivity, loadActivitySnapshot, type ActivityRow } from './load.js';
import { resolveActivity, type ActivitySaveInput, type ResolvedActivity } from './resolve.js';
import { crossEntityErrors, roleRuleErrors } from './rules.js';

export { loadActivity };
export type { ActivitySaveInput };

/**
 * Creating and replacing the activity aggregate (`ropa-database.md` §6.1), on
 * top of the generic save: the root row goes through `createAggregate` or
 * `updateAggregate` — code allocation, version check, revision, events — and
 * the nested rows are written in its `afterWrite` step, so the snapshot sees
 * them.
 *
 * The input has already passed `ActivityInput` (structure and forbidden by
 * role). Required by role applies once an activity is live: here on every save
 * of an active one, and in `lifecycle.ts` on activation.
 */

const CODE_PREFIX = { controller: 'C', processor: 'P' } as const;

function refuseIfAny(title: string, errors: readonly FieldError[]): void {
  if (errors.length > 0) throw validationFailed(title, errors);
}

/**
 * References resolved, then the rules that need other records. Both run before
 * anything is written; a request that is also stale therefore hears about its
 * content first, and nothing is written either way.
 */
async function prepare(
  tx: Transaction,
  input: ActivitySaveInput,
  context: SaveContext,
): Promise<ResolvedActivity> {
  const resolved = await resolveActivity(tx, input);
  refuseIfAny(
    'This activity breaks a rule that involves other records',
    await crossEntityErrors(tx, resolved, context.validFrom ?? new Date()),
  );
  return resolved;
}

export async function createActivity(
  tx: Transaction,
  input: ActivitySaveInput,
  context: SaveContext,
): Promise<ActivityRow> {
  const resolved = await prepare(tx, input, context);
  refuseIfAny('This activity refers to rows it does not hold', nestedIdErrors(resolved, undefined));

  const code = await allocateCode(tx, CODE_PREFIX[input.role]);
  return createAggregate(tx, activityAggregate, { ...resolved.root, code }, context, {
    afterWrite: (row) => writeChildren(tx, row.id, resolved, undefined),
  });
}

/** `PUT`: replaces the whole aggregate (API §1.4). */
export async function replaceActivity(
  tx: Transaction,
  id: string,
  expectedVersion: number,
  input: ActivitySaveInput,
  context: SaveContext,
): Promise<ActivityRow> {
  const [existing] = await tx
    .select({
      role: processingActivity.role,
      status: processingActivity.status,
      startedAt: processingActivity.startedAt,
    })
    .from(processingActivity)
    .where(eq(processingActivity.id, id));

  if (existing === undefined) throw notFound(`No activity with id ${id}`);
  if (existing.role !== input.role) {
    // Postgres refuses this too (`forbid_immutable_change`); saying so here
    // turns a database error into an answer the caller can act on.
    throw validationFailed('An activity’s role cannot change', [
      {
        path: '/role',
        code: 'role_immutable',
        message: `This is a ${existing.role} activity. To change its role, retire it and create a new activity that supersedes it.`,
      },
    ]);
  }
  if (existing.status === 'retired') {
    throw conflict('A retired activity cannot be edited (API §3.4)');
  }

  const resolved = await prepare(tx, input, context);

  // A live activity stays live only while it passes the role rules (API §1.5).
  if (existing.status === 'active') {
    refuseIfAny(
      'This activity no longer satisfies its role rules',
      await roleRuleErrors(tx, resolved),
    );
  }

  // A live activity's start date was set when it went live; a save that leaves
  // it out keeps it rather than clearing it.
  const root = {
    ...resolved.root,
    startedAt: resolved.root.startedAt ?? (existing.status === 'draft' ? null : existing.startedAt),
  };

  return updateAggregate(tx, activityAggregate, id, expectedVersion, root, context, 'updated', {
    // The root row is now locked, so what is stored cannot move under the diff.
    afterWrite: async (row) => {
      const stored = await loadActivitySnapshot(tx, row);
      refuseIfAny(
        'This activity refers to rows it does not hold',
        nestedIdErrors(resolved, stored),
      );
      await writeChildren(tx, row.id, resolved, stored);
    },
  });
}
