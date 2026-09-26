import type { AgreementDirection } from '@rulemark/ropa-schemas';
import { and, desc, eq, gt, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';

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
    .where(and(eq(agreement.partyId, clientId), agreementInForce(isoDate(asOf))));
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
        agreementInForce(isoDate(asOf)),
      ),
    );
  return new Set(rows.map((row) => row.partyId));
}

/** Every client with an agreement in force on `asOf`, for each of these offerings. */
export async function clientsByOffering(
  tx: Transaction,
  offeringIds: readonly string[],
  asOf: Date,
): Promise<Map<string, string[]>> {
  const byOffering = new Map<string, string[]>();
  if (offeringIds.length === 0) return byOffering;
  const rows = await tx
    .select({ partyId: agreement.partyId, offeringId: agreement.offeringId })
    .from(agreement)
    .innerJoin(agreementTerms, eq(agreementTerms.id, agreement.termsId))
    .where(
      and(
        inArray(agreement.offeringId, [...new Set(offeringIds)]),
        agreementInForce(isoDate(asOf)),
      ),
    );
  for (const row of rows) {
    if (row.offeringId === null) continue;
    const clients = byOffering.get(row.offeringId) ?? [];
    if (!clients.includes(row.partyId)) clients.push(row.partyId);
    byOffering.set(row.offeringId, clients);
  }
  return byOffering;
}

/**
 * The client agreements in force for these offerings, with the terms each
 * client signed: who a processor activity's engagements reach, and on what
 * terms (API §5.3). One per client and offering, the most recently signed.
 */
export async function clientAgreementsFor(
  tx: Transaction,
  offeringIds: readonly string[],
  asOf: Date,
): Promise<{ clientId: string; offeringId: string; termsId: string }[]> {
  if (offeringIds.length === 0) return [];
  const rows = await tx
    .select({
      clientId: agreement.partyId,
      offeringId: agreement.offeringId,
      termsId: agreement.termsId,
    })
    .from(agreement)
    .innerJoin(agreementTerms, eq(agreementTerms.id, agreement.termsId))
    .where(
      and(
        inArray(agreement.offeringId, [...new Set(offeringIds)]),
        agreementInForce(isoDate(asOf)),
      ),
    )
    .orderBy(desc(agreement.signedAt), agreement.id);

  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const key = `${row.clientId}/${row.offeringId}`;
    if (row.offeringId === null || seen.has(key)) return [];
    seen.add(key);
    return [{ clientId: row.clientId, offeringId: row.offeringId, termsId: row.termsId }];
  });
}

/**
 * The terms of a vendor's inbound agreements in force: every one, since
 * nothing ties an engagement to one of them (step 3, open question 5).
 */
export async function vendorTermsIdsOf(
  tx: Transaction,
  partyId: string,
  asOf: Date,
): Promise<string[]> {
  const rows = await tx
    .select({ termsId: agreement.termsId })
    .from(agreement)
    .innerJoin(agreementTerms, eq(agreementTerms.id, agreement.termsId))
    .where(and(eq(agreement.partyId, partyId), agreementInForce(isoDate(asOf), 'inbound')))
    .orderBy(agreement.signedAt, agreement.id);
  return [...new Set(rows.map((row) => row.termsId))];
}
