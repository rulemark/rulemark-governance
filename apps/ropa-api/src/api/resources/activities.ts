import {
  ActivateInput,
  Activity,
  ActivityInput,
  CountryCode,
  RetireInput,
} from '@rulemark/ropa-schemas';
import { eq, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import {
  activityDataCategory,
  activitySubjectCategory,
  activitySystem,
  dataCategory,
  engagement,
  processingActivity,
} from '../../db/schema/index.js';
import {
  dataCategoryAggregate,
  offeringAggregate,
  partyAggregate,
  subjectCategoryAggregate,
  systemAggregate,
} from '../../domain/aggregates.js';
import { activateActivity, retireActivity } from '../../domain/activity/lifecycle.js';
import {
  activityAggregate,
  loadActivitySnapshots,
  type ActivityRow,
} from '../../domain/activity/load.js';
import { toActivityOutputs } from '../../domain/activity/output.js';
import {
  createActivity,
  replaceActivity,
  type ActivitySaveInput,
} from '../../domain/activity/save.js';
import { conflict } from '../../shared/problems.js';
import { defineAction, type ResourceDefinition } from './resource-router.js';

/**
 * Activities (`ropa-api.md` §2, §3): the seven record routes, saved through the
 * activity aggregate rather than as a single row, plus the lifecycle actions.
 */

/** `ActivityInput` refuses `joint_controller`, so a parsed input is one of the two. */
function saveable(input: ActivityInput): ActivitySaveInput {
  if (input.role === 'joint_controller') {
    throw new Error('ActivityInput should have refused joint_controller');
  }
  return input;
}

/** An activity linked to a record through one of its link tables. */
const linkedTo =
  (table: PgTable, activityColumn: AnyPgColumn, targetColumn: AnyPgColumn) => (id: string) =>
    sql`EXISTS (SELECT 1 FROM ${table} WHERE ${activityColumn} = ${processingActivity.id} AND ${targetColumn} = ${id})`;

export const activitiesResource: ResourceDefinition<ActivityRow, never, ActivityInput> = {
  path: 'activities',
  label: 'activity',
  aggregate: activityAggregate as never,
  input: ActivityInput,
  output: Activity,
  schemaNames: { input: 'ActivityInput', output: 'Activity' },
  permissions: { read: 'record:read', write: 'record:write', delete: 'record:delete' },

  create: (context, input, save) => createActivity(context.tx, saveable(input), save),
  replace: (context, existing, expectedVersion, input, save) =>
    replaceActivity(context.tx, existing.id, expectedVersion, saveable(input), save),
  toOutput: async (context, rows) =>
    toActivityOutputs(context.tx, await loadActivitySnapshots(context.tx, rows)),

  // Only a draft was never part of the record. Anything that has been live is
  // retired instead, so its history stays intact (§3.4).
  guardDelete: async (_context, row) => {
    if (row.status !== 'draft') {
      throw conflict(`Only a draft can be deleted; retire this ${row.status} activity instead`);
    }
  },

  actions: [
    defineAction({
      name: 'activate',
      summary: 'Activate an activity',
      description:
        'Puts a draft live once it passes the role rules (§1.5). If-Match names the version you reviewed: activating a later one answers 412 (§1.8). Sets startedAt to today unless the draft names one.',
      permission: 'activity:approve',
      input: ActivateInput,
      schemaName: 'ActivateInput',
      run: (context, existing, expectedVersion, _input, save) =>
        activateActivity(context.tx, existing.id, expectedVersion, save),
    }),
    defineAction({
      name: 'retire',
      summary: 'Retire an activity',
      description:
        'Takes an active activity out of the record. It can be neither edited nor reactivated, and its code is never reused. A role change retires the activity and creates a new one that supersedes it (DM §3.0).',
      permission: 'activity:approve',
      input: RetireInput,
      schemaName: 'RetireInput',
      run: (context, existing, expectedVersion, input, save) =>
        retireActivity(context.tx, existing.id, expectedVersion, input, save),
    }),
  ],

  filters: [
    {
      name: 'role',
      kind: 'equals',
      column: processingActivity.role,
      description: 'controller or processor',
    },
    {
      name: 'status',
      kind: 'equals',
      column: processingActivity.status,
      description: 'draft, active or retired',
    },
    {
      name: 'offering',
      kind: 'reference',
      target: offeringAggregate,
      label: 'offering',
      description: 'Processor activities of this offering',
      matches: (id) => eq(processingActivity.offeringId, id),
    },
    {
      name: 'subjectCategory',
      kind: 'reference',
      target: subjectCategoryAggregate,
      label: 'subject category',
      description: 'Activities that process data about these subjects',
      matches: linkedTo(
        activitySubjectCategory,
        activitySubjectCategory.activityId,
        activitySubjectCategory.subjectCategoryId,
      ),
    },
    {
      name: 'dataCategory',
      kind: 'reference',
      target: dataCategoryAggregate,
      label: 'data category',
      description: 'Activities that process this data category',
      matches: linkedTo(
        activityDataCategory,
        activityDataCategory.activityId,
        activityDataCategory.dataCategoryId,
      ),
    },
    {
      name: 'party',
      kind: 'reference',
      target: partyAggregate,
      label: 'party',
      description: 'Activities with an engagement of this party',
      matches: (id) =>
        sql`EXISTS (SELECT 1 FROM ${engagement} WHERE ${engagement.activityId} = ${processingActivity.id} AND ${engagement.partyId} = ${id})`,
    },
    {
      name: 'system',
      kind: 'reference',
      target: systemAggregate,
      label: 'system',
      description: 'Activities that run on this system',
      matches: linkedTo(activitySystem, activitySystem.activityId, activitySystem.systemId),
    },
    {
      name: 'country',
      kind: 'value',
      schema: CountryCode,
      description:
        'Activities with an engagement processing data in this country (ISO 3166-1 alpha-2)',
      matches: (country) =>
        sql`EXISTS (SELECT 1 FROM ${engagement} WHERE ${engagement.activityId} = ${processingActivity.id} AND ${country} = ANY(${engagement.processingCountries}))`,
    },
    {
      name: 'special',
      kind: 'flag',
      description:
        'true: activities that process a special category (Art. 9) or criminal data (Art. 10)',
      matches: sql`EXISTS (SELECT 1 FROM ${activityDataCategory} JOIN ${dataCategory} ON ${dataCategory.id} = ${activityDataCategory.dataCategoryId} WHERE ${activityDataCategory.activityId} = ${processingActivity.id} AND ${dataCategory.special} <> 'none')`,
    },
  ],
};
