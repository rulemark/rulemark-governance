import type { FieldError } from '@rulemark/ropa-schemas';
import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';

import { agreement, agreementTerms, processingActivity } from '../../db/schema/index.js';
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

/** YYYY-MM-DD, the form a `date` column compares against. */
function isoDate(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/**
 * The clients holding an outbound agreement for `offeringId` that is in force
 * on `asOf`: signed on or before it, and not ended by it. This is the first
 * half of DM §3.8's "covers"; `/subprocessors` reuses it.
 */
export async function clientsWithActiveAgreement(
  tx: Transaction,
  offeringId: string,
  clientIds: readonly string[],
  asOf: Date,
): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const day = isoDate(asOf);
  const rows = await tx
    .select({ partyId: agreement.partyId })
    .from(agreement)
    .innerJoin(agreementTerms, eq(agreementTerms.id, agreement.termsId))
    .where(
      and(
        eq(agreement.offeringId, offeringId),
        eq(agreementTerms.direction, 'outbound'),
        inArray(agreement.partyId, [...new Set(clientIds)]),
        lte(agreement.signedAt, day),
        or(isNull(agreement.endedAt), gt(agreement.endedAt, day)),
      ),
    );
  return new Set(rows.map((row) => row.partyId));
}

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
    ...(await supersedesARetiredActivity(tx, activity)),
    ...(await scopedClientsHaveAgreements(tx, activity, asOf)),
    ...(await citedAgreementsBelongToClient(tx, activity)),
    ...dataCategoriesWithinActivity(activity),
  ];
}
