import {
  AGREEMENT_DIRECTIONS,
  AUTHORIZATION_TYPES,
  CountryCode,
  DATA_CATEGORY_SPECIALS,
  IsoDate,
  IsoDateTime,
  PARTY_KINDS,
  RegionCode,
  Slug,
  SYSTEM_KINDS,
  Uuid,
  type RevisionEntityType,
} from '@rulemark/ropa-schemas';
import { z } from 'zod';

/**
 * The canonical form of an aggregate, as written to `revision.snapshot`
 * (`ropa-database.md` §6.2).
 *
 * Three properties matter:
 *
 * - **Canonical, not the API shape.** Snapshots hold ids, never `Ref` objects,
 *   so renaming a party does not change what an old snapshot says. Names are
 *   resolved from the referenced record's own revision at the same date.
 * - **Versioned and never migrated.** `schemaVersion` is stamped on every
 *   snapshot. Revisions are append-only, so an old shape is upgraded on read by
 *   an upgrader, never rewritten in place.
 * - **Written by hand, not derived from the tables.** A snapshot schema is a
 *   record of what the shape *was*. Generating it from the current Drizzle
 *   table would silently redefine history every time a column changed, which is
 *   precisely what `schemaVersion` exists to prevent.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

const schemaVersion = z.literal(SNAPSHOT_SCHEMA_VERSION);

/** Present on every aggregate root. */
const rootFields = {
  schemaVersion,
  id: Uuid,
  version: z.number().int().positive(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
};

const named = {
  slug: Slug,
  name: z.string().min(1),
};

export const PartySnapshot = z.object({
  ...rootFields,
  slug: Slug,
  kind: z.enum(PARTY_KINDS),
  legalName: z.string().min(1),
  country: CountryCode,
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  dpoName: z.string().nullable(),
  dpoEmail: z.string().nullable(),
  trustUrl: z.string().nullable(),
  dpaUrl: z.string().nullable(),
  subprocessorListUrl: z.string().nullable(),
});

export const AgreementTermsSnapshot = z.object({
  ...rootFields,
  ...named,
  direction: z.enum(AGREEMENT_DIRECTIONS),
  authorizationType: z.enum(AUTHORIZATION_TYPES),
  noticeDays: z.number().int().min(0),
  allowedRegions: z.array(RegionCode),
  documentUrl: z.string().nullable(),
});

export const OfferingSnapshot = z.object({
  ...rootFields,
  ...named,
  defaultTermsId: Uuid,
});

export const AgreementSnapshot = z.object({
  ...rootFields,
  partyId: Uuid,
  termsId: Uuid,
  offeringId: Uuid.nullable(),
  signedAt: IsoDate,
  endedAt: IsoDate.nullable(),
});

export const SystemSnapshot = z.object({
  ...rootFields,
  ...named,
  kind: z.enum(SYSTEM_KINDS),
  renderResourceId: z.string().nullable(),
  region: z.string().nullable(),
  hostingPartyId: Uuid,
});

const taxonomyFields = { ...rootFields, ...named, description: z.string().nullable() };

export const SubjectCategorySnapshot = z.object(taxonomyFields);
export const DataCategorySnapshot = z.object({
  ...taxonomyFields,
  special: z.enum(DATA_CATEGORY_SPECIALS),
});
export const SecurityMeasureSnapshot = z.object(taxonomyFields);

/**
 * The schema for each entity type, used when a snapshot is written and again
 * when it is read back. A snapshot that cannot be parsed is a bug worth failing
 * on: it means history no longer says what the code thinks it says.
 */
export const SNAPSHOT_SCHEMAS = {
  party: PartySnapshot,
  agreement_terms: AgreementTermsSnapshot,
  offering: OfferingSnapshot,
  agreement: AgreementSnapshot,
  system: SystemSnapshot,
  subject_category: SubjectCategorySnapshot,
  data_category: DataCategorySnapshot,
  security_measure: SecurityMeasureSnapshot,
} as const satisfies Partial<Record<RevisionEntityType, z.ZodType>>;

export type SnapshotEntityType = keyof typeof SNAPSHOT_SCHEMAS;

/**
 * The schema for an entity type. Throws rather than returning undefined: a
 * missing entry means a new aggregate was added without a snapshot schema,
 * which would otherwise be discovered by writing unvalidated history.
 */
export function snapshotSchemaFor(entityType: RevisionEntityType): z.ZodType {
  const schema = SNAPSHOT_SCHEMAS[entityType as SnapshotEntityType] as z.ZodType | undefined;
  if (schema === undefined) {
    throw new Error(`No snapshot schema for entity type "${entityType}"`);
  }
  return schema;
}

export type PartySnapshot = z.infer<typeof PartySnapshot>;
export type AgreementTermsSnapshot = z.infer<typeof AgreementTermsSnapshot>;
export type OfferingSnapshot = z.infer<typeof OfferingSnapshot>;
export type AgreementSnapshot = z.infer<typeof AgreementSnapshot>;
export type SystemSnapshot = z.infer<typeof SystemSnapshot>;

/**
 * Rows carry `Date` objects and snapshots are JSON, so timestamps are written
 * as RFC 3339 strings. Doing it in one place keeps every snapshot comparable.
 */
export function toSnapshotTimestamps(row: { createdAt: Date; updatedAt: Date }): {
  createdAt: string;
  updatedAt: string;
} {
  return { createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
