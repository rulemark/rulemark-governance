import type { FieldError } from '@rulemark/ropa-schemas';
import { and, eq } from 'drizzle-orm';

import { agreementTerms, processingActivity } from '../../db/schema/index.js';
import { loadActivitySnapshots } from '../../domain/activity/load.js';
import { offeringAggregate, partyAggregate } from '../../domain/aggregates.js';
import { activeAgreementsOf } from '../../domain/agreements.js';
import { findByIdentifier } from '../../domain/identifiers.js';
import type { ActivitySnapshot } from '../../domain/snapshots.js';
import type { Transaction } from '../../domain/transaction.js';
import { byCode } from '../../domain/views/subprocessors.js';
import { validationFailed } from '../../shared/problems.js';

/**
 * What the views share (`ropa-api.md` §5): turning `?offering=` or `?client=`
 * into an offering and the terms that apply, and loading live activities.
 */

export function refused(errors: FieldError[]): never {
  throw validationFailed('This view cannot be answered as asked', errors);
}

/** An offering and the terms in play, plus the client when there is one. */
export interface ViewScope {
  readonly offeringId: string;
  readonly termsId: string;
  readonly clientId: string | null;
}

/**
 * By offering: its default terms. By client: the offering and terms of the
 * agreement the client holds today. A client with none, or with agreements
 * for several offerings, cannot be answered for one offering and one set of
 * terms, and is refused with a field error that says which.
 */
export async function resolveViewScope(
  tx: Transaction,
  query: { readonly offering?: string | undefined; readonly client?: string | undefined },
  now: Date,
): Promise<ViewScope> {
  if (query.offering !== undefined) {
    const offering = await findByIdentifier<{ id: string; defaultTermsId: string }>(
      tx,
      offeringAggregate,
      query.offering,
    );
    if (offering === undefined) {
      refused([
        {
          path: '/offering',
          code: 'unknown_reference',
          message: `No offering matching "${query.offering}"`,
        },
      ]);
    }
    return { offeringId: offering.id, termsId: offering.defaultTermsId, clientId: null };
  }

  const identifier = query.client ?? '';
  const client = await findByIdentifier<{ id: string }>(tx, partyAggregate, identifier);
  if (client === undefined) {
    refused([
      { path: '/client', code: 'unknown_reference', message: `No party matching "${identifier}"` },
    ]);
  }
  const agreements = await activeAgreementsOf(tx, client.id, now);
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

/** Live activities of one role, optionally of one offering, in code order. */
export async function liveActivities(
  tx: Transaction,
  role: 'controller' | 'processor',
  offeringId?: string,
): Promise<ActivitySnapshot[]> {
  const rows = await tx
    .select()
    .from(processingActivity)
    .where(
      and(
        eq(processingActivity.role, role),
        eq(processingActivity.status, 'active'),
        offeringId === undefined ? undefined : eq(processingActivity.offeringId, offeringId),
      ),
    );
  return (await loadActivitySnapshots(tx, rows)).sort(byCode);
}

/** Terms with the two properties a subprocessor change turns on (Art. 28(2)). */
export async function termsRef(tx: Transaction, termsId: string) {
  const [terms] = await tx.select().from(agreementTerms).where(eq(agreementTerms.id, termsId));
  if (terms === undefined) throw new Error(`Dangling reference: terms ${termsId}`);
  return {
    id: terms.id,
    slug: terms.slug,
    name: terms.name,
    authorizationType: terms.authorizationType,
    noticeDays: terms.noticeDays,
  };
}
