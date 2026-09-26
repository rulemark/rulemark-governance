import { and, eq, gt, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';

import { agreement, agreementTerms } from '../db/schema/index.js';
import type { Transaction } from './transaction.js';

/**
 * Which clients an offering's processing is for: those holding an outbound
 * agreement for it that is **in force** on the day asked about — signed on or
 * before it, and not ended by it. The first half of DM §3.8's "covers", used
 * by the save rules and by every view that asks "for whom".
 */

/** YYYY-MM-DD, the form a `date` column compares against. */
export function isoDate(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

function inForce(day: string): SQL {
  return and(
    eq(agreementTerms.direction, 'outbound'),
    lte(agreement.signedAt, day),
    or(isNull(agreement.endedAt), gt(agreement.endedAt, day)),
  )!;
}

export interface ActiveAgreement {
  readonly id: string;
  readonly partyId: string;
  readonly offeringId: string;
  readonly termsId: string;
}

/** A client's agreements in force on `asOf`, for any offering. */
export async function activeAgreementsOf(
  tx: Transaction,
  clientId: string,
  asOf: Date,
): Promise<ActiveAgreement[]> {
  const rows = await tx
    .select({
      id: agreement.id,
      partyId: agreement.partyId,
      offeringId: agreement.offeringId,
      termsId: agreement.termsId,
    })
    .from(agreement)
    .innerJoin(agreementTerms, eq(agreementTerms.id, agreement.termsId))
    .where(and(eq(agreement.partyId, clientId), inForce(isoDate(asOf))));
  // Outbound terms always name an offering (§4); the filter makes that visible.
  return rows.flatMap((row) =>
    row.offeringId === null ? [] : [{ ...row, offeringId: row.offeringId }],
  );
}

/** Which of `clientIds` hold an agreement for `offeringId` in force on `asOf`. */
export async function clientsWithActiveAgreement(
  tx: Transaction,
  offeringId: string,
  clientIds: readonly string[],
  asOf: Date,
): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const rows = await tx
    .select({ partyId: agreement.partyId })
    .from(agreement)
    .innerJoin(agreementTerms, eq(agreementTerms.id, agreement.termsId))
    .where(
      and(
        eq(agreement.offeringId, offeringId),
        inArray(agreement.partyId, [...new Set(clientIds)]),
        inForce(isoDate(asOf)),
      ),
    );
  return new Set(rows.map((row) => row.partyId));
}
