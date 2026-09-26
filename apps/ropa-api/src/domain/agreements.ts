import type { AgreementDirection } from '@rulemark/ropa-schemas';
import { and, eq, gt, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';

import { agreement, agreementTerms } from '../db/schema/index.js';
import type { Transaction } from './transaction.js';

/**
 * Which clients an offering's processing is for: those holding an outbound
 * agreement for it that is **in force** on the day asked about — signed on or
 * before it, and not ended by it. The first half of DM §3.8's "covers", used
 * by the save rules here and by the live record the views read
 * (`record/live.ts`); `record/as-of.ts` applies the same test to snapshots.
 */

/** YYYY-MM-DD, the form a `date` column compares against. */
export function isoDate(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/**
 * Outbound by default: an agreement with a client. Inbound is a vendor's DPA
 * with us, which the impact view reads for the vendor's notice (API §5.3).
 */
export function agreementInForce(day: string, direction: AgreementDirection = 'outbound'): SQL {
  return and(
    eq(agreementTerms.direction, direction),
    lte(agreement.signedAt, day),
    or(isNull(agreement.endedAt), gt(agreement.endedAt, day)),
  )!;
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
        agreementInForce(isoDate(asOf)),
      ),
    );
  return new Set(rows.map((row) => row.partyId));
}
