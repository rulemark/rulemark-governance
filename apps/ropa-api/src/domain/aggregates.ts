import type { Ref } from '@rulemark/ropa-schemas';

import {
  agreement,
  agreementTerms,
  dataCategory,
  offering,
  party,
  securityMeasure,
  subjectCategory,
  system,
} from '../db/schema/index.js';
import type { AggregateSpec } from './aggregate.js';
import type { Identifiable } from './identifiers.js';
import {
  AgreementSnapshot,
  AgreementTermsSnapshot,
  DataCategorySnapshot,
  OfferingSnapshot,
  PartySnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  SecurityMeasureSnapshot,
  SubjectCategorySnapshot,
  SystemSnapshot,
} from './snapshots.js';

/**
 * One definition per foundation aggregate (DM §4): which table it lives in,
 * how a row becomes a canonical snapshot, and how it is named in an event.
 *
 * This is the rows ↔ aggregate mapping. Foundation aggregates are a single row
 * each, so it is mostly a projection; the activity aggregate in step 2 gathers
 * its children here instead.
 */

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

/** Every snapshot is stamped, and timestamps are added by the save (§6.2). */
const stamp = { schemaVersion: SNAPSHOT_SCHEMA_VERSION } as const;
type Timestamps = { createdAt: string; updatedAt: string };
const withoutTimestamps = <T extends object>(value: T) => value as T & Timestamps;

export const partyAggregate: AggregateSpec<Row<typeof party>, PartySnapshot> & Identifiable = {
  entityType: 'party',
  table: party,
  slugColumn: party.slug,
  snapshotSchema: PartySnapshot,
  toSnapshot: (row) =>
    withoutTimestamps({
      ...stamp,
      id: row.id,
      version: row.version,
      slug: row.slug,
      kind: row.kind,
      legalName: row.legalName,
      country: row.country,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      dpoName: row.dpoName,
      dpoEmail: row.dpoEmail,
      trustUrl: row.trustUrl,
      dpaUrl: row.dpaUrl,
      subprocessorListUrl: row.subprocessorListUrl,
    }),
  // A party's name is its legal name (`ropa-api.md` §4).
  toRef: (row): Ref => ({ id: row.id, slug: row.slug, name: row.legalName }),
};

export const agreementTermsAggregate: AggregateSpec<
  Row<typeof agreementTerms>,
  AgreementTermsSnapshot
> &
  Identifiable = {
  entityType: 'agreement_terms',
  table: agreementTerms,
  slugColumn: agreementTerms.slug,
  snapshotSchema: AgreementTermsSnapshot,
  toSnapshot: (row) =>
    withoutTimestamps({
      ...stamp,
      id: row.id,
      version: row.version,
      slug: row.slug,
      name: row.name,
      direction: row.direction,
      authorizationType: row.authorizationType,
      noticeDays: row.noticeDays,
      allowedRegions: row.allowedRegions,
      documentUrl: row.documentUrl,
    }),
  toRef: (row): Ref => ({ id: row.id, slug: row.slug, name: row.name }),
};

export const offeringAggregate: AggregateSpec<Row<typeof offering>, OfferingSnapshot> &
  Identifiable = {
  entityType: 'offering',
  table: offering,
  slugColumn: offering.slug,
  snapshotSchema: OfferingSnapshot,
  toSnapshot: (row) =>
    withoutTimestamps({
      ...stamp,
      id: row.id,
      version: row.version,
      slug: row.slug,
      name: row.name,
      // An id, never a Ref: renaming the terms must not change this snapshot.
      defaultTermsId: row.defaultTermsId,
    }),
  toRef: (row): Ref => ({ id: row.id, slug: row.slug, name: row.name }),
};

export const agreementAggregate: AggregateSpec<Row<typeof agreement>, AgreementSnapshot> &
  Identifiable = {
  entityType: 'agreement',
  table: agreement,
  snapshotSchema: AgreementSnapshot,
  toSnapshot: (row) =>
    withoutTimestamps({
      ...stamp,
      id: row.id,
      version: row.version,
      partyId: row.partyId,
      termsId: row.termsId,
      offeringId: row.offeringId,
      signedAt: row.signedAt,
      endedAt: row.endedAt,
    }),
  // An agreement has neither slug nor code and no name of its own (§4), so the
  // event names it by what a reader would recognise: when it was signed.
  toRef: (row): Ref => ({ id: row.id, name: `Agreement signed ${row.signedAt}` }),
};

export const systemAggregate: AggregateSpec<Row<typeof system>, SystemSnapshot> & Identifiable = {
  entityType: 'system',
  table: system,
  slugColumn: system.slug,
  snapshotSchema: SystemSnapshot,
  toSnapshot: (row) =>
    withoutTimestamps({
      ...stamp,
      id: row.id,
      version: row.version,
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      renderResourceId: row.renderResourceId,
      region: row.region,
      hostingPartyId: row.hostingPartyId,
    }),
  toRef: (row): Ref => ({ id: row.id, slug: row.slug, name: row.name }),
};

function taxonomyAggregate<T extends typeof subjectCategory | typeof securityMeasure>(
  entityType: 'subject_category' | 'security_measure',
  table: T,
  snapshotSchema: typeof SubjectCategorySnapshot,
) {
  return {
    entityType,
    table,
    slugColumn: table.slug,
    snapshotSchema,
    toSnapshot: (row: Row<T>) =>
      withoutTimestamps({
        ...stamp,
        id: row.id,
        version: row.version,
        slug: row.slug,
        name: row.name,
        description: row.description,
      }),
    toRef: (row: Row<T>): Ref => ({ id: row.id, slug: row.slug, name: row.name }),
  };
}

export const subjectCategoryAggregate = taxonomyAggregate(
  'subject_category',
  subjectCategory,
  SubjectCategorySnapshot,
);

export const securityMeasureAggregate = taxonomyAggregate(
  'security_measure',
  securityMeasure,
  SecurityMeasureSnapshot,
);

export const dataCategoryAggregate = {
  entityType: 'data_category',
  table: dataCategory,
  slugColumn: dataCategory.slug,
  snapshotSchema: DataCategorySnapshot,
  toSnapshot: (row: Row<typeof dataCategory>) =>
    withoutTimestamps({
      ...stamp,
      id: row.id,
      version: row.version,
      slug: row.slug,
      name: row.name,
      description: row.description,
      special: row.special,
    }),
  toRef: (row: Row<typeof dataCategory>): Ref => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
  }),
};
