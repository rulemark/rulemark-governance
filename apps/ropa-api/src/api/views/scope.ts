import type { FieldError } from '@rulemark/ropa-schemas';

import type { RecordReader } from '../../domain/record/reader.js';
import { compareStrings } from '../../domain/record/reader.js';
import type { ActivitySnapshot } from '../../domain/snapshots.js';
import type { ClientAgreement } from '../../domain/views/impact.js';
import { validationFailed } from '../../shared/problems.js';

/**
 * What the views share (`ropa-api.md` §5): the record they read, live or as
 * of a date; turning `?offering=` or `?client=` into an offering and the terms
 * that apply; and the lookups several views make.
 */

export function refused(errors: FieldError[]): never {
  throw validationFailed('This view cannot be answered as asked', errors);
}

/** One reading of the record, and what the response says about it. */
export interface ViewRead {
  /** Live, or as it stood at `asOf` (DB §6.3). */
  readonly record: RecordReader;
  /** When the answer was computed: now, even for a past date. */
  readonly generatedAt: Date;
  /** The `asOf` asked for, echoed as written; null for the record today. */
  readonly asOf: string | null;
}

/** "No party matching …", saying which day it was looked for on. */
export function noMatch(read: ViewRead, what: string, identifier: string): string {
  const message = `No ${what} matching "${identifier}"`;
  return read.asOf === null ? message : `${message} as of ${read.asOf}`;
}

/** An offering and the terms in play, plus the client when there is one. */
export interface ViewScope {
  readonly offeringId: string;
  readonly termsId: string;
  readonly clientId: string | null;
}

/**
 * By offering: its default terms. By client: the offering and terms of the
 * agreement the client holds on the day. A client with none, or with
 * agreements for several offerings, cannot be answered for one offering and
 * one set of terms, and is refused with a field error that says which.
 */
export async function resolveViewScope(
  read: ViewRead,
  query: { readonly offering?: string | undefined; readonly client?: string | undefined },
): Promise<ViewScope> {
  const { record } = read;
  if (query.offering !== undefined) {
    const offering = await record.find('offering', query.offering);
    if (offering === undefined) {
      refused([
        {
          path: '/offering',
          code: 'unknown_reference',
          message: noMatch(read, 'offering', query.offering),
        },
      ]);
    }
    return { offeringId: offering.id, termsId: offering.defaultTermsId, clientId: null };
  }

  const identifier = query.client ?? '';
  const client = await record.find('party', identifier);
  if (client === undefined) {
    refused([
      { path: '/client', code: 'unknown_reference', message: noMatch(read, 'party', identifier) },
    ]);
  }
  const agreements = await clientAgreementsOf(record, client.id);
  if (agreements.length === 0) {
    refused([
      {
        path: '/client',
        code: 'no_active_agreement',
        message: 'This client holds no agreement in force, so none of its data is processed',
      },
    ]);
  }
  if (new Set(agreements.map((row) => row.offeringId)).size > 1) {
    refused([
      {
        path: '/client',
        code: 'several_offerings',
        message:
          'This client holds agreements for several offerings; a per-client view of more than one is not supported yet',
      },
    ]);
  }
  const [chosen] = agreements;
  return { offeringId: chosen!.offeringId, termsId: chosen!.termsId, clientId: client.id };
}

/**
 * A client's outbound agreements in force, for any offering. Outbound terms
 * always name an offering (§4); the filter makes that visible.
 */
export async function clientAgreementsOf(
  record: RecordReader,
  clientId: string,
): Promise<ClientAgreement[]> {
  const rows = await record.agreementsInForce({ direction: 'outbound', partyId: clientId });
  return rows.flatMap((row) =>
    row.offeringId === null
      ? []
      : [{ clientId: row.partyId, offeringId: row.offeringId, termsId: row.termsId }],
  );
}

/**
 * The client agreements in force for these offerings, with the terms each
 * client signed: who a processor activity's engagements reach, and on what
 * terms (API §5.3). One per client and offering, the most recently signed.
 */
export async function clientAgreementsFor(
  record: RecordReader,
  offeringIds: readonly string[],
): Promise<ClientAgreement[]> {
  if (offeringIds.length === 0) return [];
  const rows = await record.agreementsInForce({ direction: 'outbound', offeringIds });
  const latestFirst = [...rows].sort(
    (a, b) => compareStrings(b.signedAt, a.signedAt) || compareStrings(a.id, b.id),
  );
  const seen = new Set<string>();
  return latestFirst.flatMap((row) => {
    const key = `${row.partyId}/${row.offeringId}`;
    if (row.offeringId === null || seen.has(key)) return [];
    seen.add(key);
    return [{ clientId: row.partyId, offeringId: row.offeringId, termsId: row.termsId }];
  });
}

/** Active processor activities, optionally of one offering, in code order. */
export function processorActivities(
  record: RecordReader,
  offeringId?: string,
): Promise<ActivitySnapshot[]> {
  return record.activities({ role: 'processor', offeringId });
}

/** Terms with the two properties a subprocessor change turns on (Art. 28(2)). */
export async function termsRef(record: RecordReader, termsId: string) {
  const terms = (await record.get('agreement_terms', [termsId])).get(termsId);
  if (terms === undefined) throw new Error(`Dangling reference: terms ${termsId}`);
  return {
    id: terms.id,
    slug: terms.slug,
    name: terms.name,
    authorizationType: terms.authorizationType,
    noticeDays: terms.noticeDays,
  };
}
