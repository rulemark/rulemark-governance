import type { AgreementDirection, Ref } from '@rulemark/ropa-schemas';

import type {
  ActivitySnapshot,
  AgreementTermsSnapshot,
  DataCategorySnapshot,
  OfferingSnapshot,
  PartySnapshot,
  SecurityMeasureSnapshot,
  SubjectCategorySnapshot,
  SystemSnapshot,
} from '../snapshots.js';

/**
 * The record as the views read it: today's, from the live tables, or as it
 * stood at a moment, from the revisions (`ropa-database.md` §6.3). The views
 * are pure functions over snapshots, so what differs between now and then is
 * only this: where the snapshots come from, and which day "active" and "in
 * force" are judged on.
 *
 * Both readers answer in the same shape, and for today they answer the same
 * (`test/db/record-as-of.test.ts`), which is what lets a view take either.
 */

/** The single-row aggregates, by the snapshot each reads as. */
export interface SnapshotsByKind {
  party: PartySnapshot;
  agreement_terms: AgreementTermsSnapshot;
  offering: OfferingSnapshot;
  system: SystemSnapshot;
  subject_category: SubjectCategorySnapshot;
  data_category: DataCategorySnapshot;
  security_measure: SecurityMeasureSnapshot;
}

export type RecordKind = keyof SnapshotsByKind;

export const RECORD_KINDS = [
  'party',
  'agreement_terms',
  'offering',
  'system',
  'subject_category',
  'data_category',
  'security_measure',
] as const satisfies readonly RecordKind[];

/** Which active activities to read. Every condition given must hold. */
export interface ActivityFilter {
  readonly role?: 'controller' | 'processor' | undefined;
  readonly offeringId?: string | undefined;
  /** Only activities with an engagement of this party (impact, §5.3). */
  readonly engaging?: string | undefined;
  /** Only activities about this subject category (data map, §5.4). */
  readonly about?: string | undefined;
}

/** Which agreements in force to read. Every condition given must hold. */
export interface AgreementFilter {
  /** Outbound: with a client. Inbound: a vendor's DPA with us. */
  readonly direction: AgreementDirection;
  readonly partyId?: string | undefined;
  readonly offeringIds?: readonly string[] | undefined;
}

export interface AgreementInForce {
  readonly id: string;
  readonly partyId: string;
  readonly offeringId: string | null;
  readonly termsId: string;
  readonly signedAt: string;
}

export interface RecordReader {
  /** The day business dates are judged on: signed, started, ended (YYYY-MM-DD, UTC). */
  readonly day: string;
  /** By id or slug, as the record named it then; undefined when there was no such record. */
  find<K extends RecordKind>(kind: K, identifier: string): Promise<SnapshotsByKind[K] | undefined>;
  /** Those of `ids` that existed; a missing one is simply absent from the map. */
  get<K extends RecordKind>(
    kind: K,
    ids: readonly string[],
  ): Promise<Map<string, SnapshotsByKind[K]>>;
  /** Every record of the kind, in id order. */
  all<K extends RecordKind>(kind: K): Promise<SnapshotsByKind[K][]>;
  /** The organisation keeping the record. */
  self(): Promise<PartySnapshot | undefined>;
  /** Active activities, in code order. */
  activities(filter?: ActivityFilter): Promise<ActivitySnapshot[]>;
  /** Agreements in force on `day`: signed on or before it, not ended by it. By signing date, then id. */
  agreementsInForce(filter: AgreementFilter): Promise<AgreementInForce[]>;
}

/**
 * How each kind is named in a response (`ropa-api.md` §1.2). A party's name is
 * its legal name; everything else has a `name` of its own.
 */
export function refOf<K extends RecordKind>(kind: K, snapshot: SnapshotsByKind[K]): Ref {
  const name =
    kind === 'party' ? (snapshot as PartySnapshot).legalName : (snapshot as { name: string }).name;
  return { id: snapshot.id, slug: snapshot.slug, name };
}

/**
 * Refs for every id, named as the reader's record names them: today's names
 * live, and the names of the day for a read as of a date (DB §6.2).
 */
export async function refsOf(
  reader: RecordReader,
  kind: RecordKind,
  ids: readonly string[],
): Promise<Map<string, Ref>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const snapshots = await reader.get(kind, wanted);
  return new Map([...snapshots].map(([id, snapshot]) => [id, refOf(kind, snapshot)]));
}

/**
 * Plain code-unit order. Not `localeCompare`: collation may ignore the hyphens
 * in a UUID, and the two readers must agree on order to the character.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Agreement rows in the order every reader returns them. */
export function bySigning(a: AgreementInForce, b: AgreementInForce): number {
  return compareStrings(a.signedAt, b.signedAt) || compareStrings(a.id, b.id);
}

export function byId(a: { id: string }, b: { id: string }): number {
  return compareStrings(a.id, b.id);
}
