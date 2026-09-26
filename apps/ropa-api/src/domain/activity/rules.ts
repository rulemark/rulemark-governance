import { canActivate, type FieldError } from '@rulemark/ropa-schemas';
import { eq, inArray } from 'drizzle-orm';

import { agreement, dataCategory, processingActivity } from '../../db/schema/index.js';
import { clientsWithActiveAgreement } from '../agreements.js';
import type { Transaction } from '../transaction.js';
import type { ResolvedActivity } from './resolve.js';

/**
 * DM §5's cross-entity rules: the ones that need another record, so they run
 * in the domain inside the save transaction and see a consistent state
 * (`ropa-database.md` §2). The rules that need only the record itself are in
 * `@rulemark/ropa-schemas`, where a form can run them too.
 *
 * Every rule reports at the path of the value that breaks it, and all of them
 * run, so a caller sees everything wrong at once.
 */

/** One client-scope entry, wherever it sits, with the path it came from. */
interface ScopeEntry {
  readonly path: string;
  readonly clientPartyId: string;
  readonly agreementId: string | null;
}

function scopeEntries(activity: ResolvedActivity): ScopeEntry[] {
  return [
    ...activity.clientScope.map((entry, index) => ({
      path: `/clientScope/clients/${index}`,
      ...entry,
    })),
    ...activity.engagements.flatMap((engagement, index) =>
      engagement.clientScope.map((entry, entryIndex) => ({
        path: `/engagements/${index}/clientScope/clients/${entryIndex}`,
        ...entry,
      })),
    ),
  ];
}

/** An engagement can only share data the activity processes (DM §3.2). */
function dataCategoriesWithinActivity(activity: ResolvedActivity): FieldError[] {
  const processed = new Set(activity.dataCategoryIds);
  return activity.engagements.flatMap((engagement, index) =>
    engagement.dataCategoryIds.flatMap((id, categoryIndex) =>
      processed.has(id)
        ? []
        : [
            {
              path: `/engagements/${index}/dataCategories/${categoryIndex}`,
              code: 'not_in_activity',
              message: 'Must be one of the activity’s own data categories',
            },
          ],
    ),
  );
}

/**
 * A client scope names a client that holds an active outbound agreement for
 * the activity's offering, at activity or engagement level (DM §3.8). A draft
 * with no offering yet has nothing to check against; activation requires one.
 */
async function scopedClientsHaveAgreements(
  tx: Transaction,
  activity: ResolvedActivity,
  asOf: Date,
): Promise<FieldError[]> {
  const entries = scopeEntries(activity);
  const { offeringId } = activity.root;
  if (entries.length === 0 || offeringId === null) return [];

  const covered = await clientsWithActiveAgreement(
    tx,
    offeringId,
    entries.map((entry) => entry.clientPartyId),
    asOf,
  );
  return entries
    .filter((entry) => !covered.has(entry.clientPartyId))
    .map((entry) => ({
      path: `${entry.path}/client`,
      code: 'no_active_agreement',
      message: 'This client holds no active outbound agreement for the activity’s offering',
    }));
}

/** The agreement a scope entry cites must be that client's own. */
async function citedAgreementsBelongToClient(
  tx: Transaction,
  activity: ResolvedActivity,
): Promise<FieldError[]> {
  const citing = scopeEntries(activity).filter((entry) => entry.agreementId !== null);
  if (citing.length === 0) return [];

  const rows = await tx
    .select({ id: agreement.id, partyId: agreement.partyId })
    .from(agreement)
    .where(inArray(agreement.id, [...new Set(citing.map((entry) => entry.agreementId!))]));
  const ownerOf = new Map(rows.map((row) => [row.id, row.partyId]));

  return citing
    .filter((entry) => ownerOf.get(entry.agreementId!) !== entry.clientPartyId)
    .map((entry) => ({
      path: `${entry.path}/agreement`,
      code: 'agreement_not_for_client',
      message: 'This agreement belongs to a different party',
    }));
}

/**
 * An activity supersedes a retired one: a role change retires the old entry
 * and creates a new one pointing back at it (DM §3.0).
 */
async function supersedesARetiredActivity(
  tx: Transaction,
  activity: ResolvedActivity,
): Promise<FieldError[]> {
  const { supersedesId } = activity.root;
  if (supersedesId === null) return [];

  const [superseded] = await tx
    .select({ status: processingActivity.status })
    .from(processingActivity)
    .where(eq(processingActivity.id, supersedesId));
  return superseded?.status === 'retired'
    ? []
    : [
        {
          path: '/supersedes',
          code: 'supersedes_not_retired',
          message: 'Only a retired activity can be superseded: retire it first',
        },
      ];
}

/**
 * A record listed twice where the database allows it once: two rules for one
 * data category (or two default rules), a client twice in one scope. The
 * schema cannot see these, because two different identifiers may name the
 * same record; left to Postgres they would surface as a 409 about an
 * identifier, which is not what went wrong.
 */
function duplicates(activity: ResolvedActivity): FieldError[] {
  const repeated = <T>(
    rows: readonly T[],
    key: (row: T) => string | null | undefined,
    path: (index: number) => string,
    message: string,
  ): FieldError[] => {
    const seen = new Set<string | null>();
    return rows.flatMap((row, index) => {
      const value = key(row);
      if (value === undefined) return [];
      if (seen.has(value)) return [{ path: path(index), code: 'duplicate', message }];
      seen.add(value);
      return [];
    });
  };

  return [
    ...repeated(
      activity.retentionRules,
      (rule) => rule.dataCategoryId,
      (index) => `/retentionRules/${index}/dataCategory`,
      'Another rule already covers this data category (or is already the default rule)',
    ),
    // Ended entries are history; only one open entry per client (DDL §4.4).
    ...repeated(
      activity.clientScope,
      (entry) => (entry.endedAt === null ? entry.clientPartyId : undefined),
      (index) => `/clientScope/clients/${index}/client`,
      'This client is already listed',
    ),
    ...activity.engagements.flatMap((engagement, engagementIndex) =>
      repeated(
        engagement.clientScope,
        (entry) => entry.clientPartyId,
        (index) => `/engagements/${engagementIndex}/clientScope/clients/${index}/client`,
        'This client is already listed',
      ),
    ),
  ];
}

/**
 * Every cross-entity rule, judged as of `asOf`: the save's own effective date,
 * so a backdated save (the seed replaying the story, §9) is judged by the
 * agreements that were in force then, not today.
 */
export async function crossEntityErrors(
  tx: Transaction,
  activity: ResolvedActivity,
  asOf: Date,
): Promise<FieldError[]> {
  return [
    ...duplicates(activity),
    ...(await supersedesARetiredActivity(tx, activity)),
    ...(await scopedClientsHaveAgreements(tx, activity, asOf)),
    ...(await citedAgreementsBelongToClient(tx, activity)),
    ...dataCategoriesWithinActivity(activity),
  ];
}

/**
 * Art. 9 and Art. 10 (DM §5): a controller processing a special category needs
 * a condition for it. Which categories are special lives in the taxonomy, so
 * this is the server's half of "required by role".
 */
async function specialConditionErrors(
  tx: Transaction,
  activity: ResolvedActivity,
): Promise<FieldError[]> {
  const { role, specialConditions } = activity.root;
  if (role !== 'controller' || activity.dataCategoryIds.length === 0) return [];

  const specials = new Set(
    (
      await tx
        .select({ special: dataCategory.special })
        .from(dataCategory)
        .where(inArray(dataCategory.id, [...new Set(activity.dataCategoryIds)]))
    ).map((row) => row.special),
  );
  const errors: FieldError[] = [];
  if (
    specials.has('art9') &&
    !specialConditions.some((condition) => condition.startsWith('9(2)'))
  ) {
    errors.push({
      path: '/specialConditions',
      code: 'required_for_role',
      message: 'A special category of data needs an Art. 9(2) condition before activation',
    });
  }
  if (specials.has('art10') && !specialConditions.includes('art10')) {
    errors.push({
      path: '/specialConditions',
      code: 'required_for_role',
      message: 'Criminal convictions data needs the Art. 10 condition before activation',
    });
  }
  return errors;
}

/**
 * Required by role (API §1.5): what activation checks, and what every save of
 * an active activity checks again. The single-record part is `canActivate`
 * from `@rulemark/ropa-schemas`, the very function a form runs; this adds the
 * part that needs the taxonomy.
 */
export async function roleRuleErrors(
  tx: Transaction,
  activity: ResolvedActivity,
): Promise<FieldError[]> {
  const { root } = activity;
  return [
    ...canActivate({
      role: root.role,
      purposes: root.purposes,
      lawfulBases: root.lawfulBases,
      specialConditions: root.specialConditions,
      retentionRules: activity.retentionRules,
      dpiaRequired: root.dpiaRequired,
      dpiaRef: root.dpiaRef,
      offering: root.offeringId,
      clientCoverage: root.clientCoverage,
      processingCategories: root.processingCategories,
      clientScope: activity.clientScope,
      dpiaSupportRef: root.dpiaSupportRef,
    }),
    ...(await specialConditionErrors(tx, activity)),
  ];
}
