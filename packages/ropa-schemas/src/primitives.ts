import { z } from 'zod';

/**
 * The small value types the whole API is built from (`ropa-packages.md` §4.1).
 * Nothing here touches the environment or a Node API: the package has to work
 * in a browser too.
 */

/** Lowercase, hyphenated, and never UUID-shaped (DM §3.0). */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Uuid = z.uuid().describe('A UUID. Records are keyed by UUIDv7.');

/**
 * A slug may never look like a UUID, so a path segment can always be told
 * apart from an id without a database lookup.
 */
export const Slug = z
  .string()
  .regex(SLUG_PATTERN, 'Must be lowercase words separated by single hyphens')
  .refine((value) => !UUID_PATTERN.test(value), 'Must not look like a UUID')
  .describe(
    'A human-readable identifier, unique within its table: "mailcrest", "standard-dpa-v3".',
  );

/** A system-assigned code: `C1`, `P3`, `RI-42` (DM §3.0). Never typed by hand. */
export const Code = z
  .string()
  .regex(/^[A-Z]+-?\d+$/, 'Must be letters followed by a number, e.g. "P3" or "RI-42"')
  .describe('A stable, system-assigned code shown next to the name: "P3".');

/** ISO 3166-1 alpha-2. */
export const CountryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Must be an ISO 3166-1 alpha-2 country code, e.g. "DE"')
  .describe('An ISO 3166-1 alpha-2 country code.');

/**
 * A region for `agreement_terms.allowedRegions`: the EEA, which expands to its
 * member countries, or a single country (DM §3.6).
 */
export const RegionCode = z
  .union([z.literal('EEA'), CountryCode])
  .describe('"EEA", or an ISO 3166-1 alpha-2 country code.');

/** ISO 8601 duration: `P90D`, `P7Y`, `P1Y6M` (retention periods). */
export const IsoDuration = z
  .string()
  .regex(
    /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+S)?)?$/,
    'Must be an ISO 8601 duration, e.g. "P90D" or "P7Y"',
  )
  .describe('An ISO 8601 duration: "P90D", "P7Y".');

/** A business date, `YYYY-MM-DD` (§1.1). Rejects a calendar date that does not exist. */
export const IsoDate = z.iso.date().describe('A date, "YYYY-MM-DD".');

/** An RFC 3339 timestamp (§1.1). */
export const IsoDateTime = z.iso.datetime({ offset: true }).describe('An RFC 3339 timestamp.');

/** `?asOf=` takes either, because "the record on 16 March" is a normal question. */
export const AsOf = z
  .union([IsoDate, IsoDateTime])
  .describe('A point in time for a historical read: a date or an RFC 3339 timestamp.');

/**
 * Any of the three identifiers, as sent in a path or a request body: an `id`,
 * a `code` or a `slug` (DM §3.0, Q6). Which one it is, is worked out when the
 * record is resolved, so the schema only checks that it is a plausible string.
 */
export const Identifier = z
  .string()
  .min(1)
  .max(200)
  .describe('An id, code or slug: "mailcrest", "P3" or a UUID.');

/**
 * How every reference to another record is returned (§1.2). `slug` and `code`
 * are both optional because a record has one or the other, and an agreement has
 * neither.
 */
export const Ref = z
  .object({
    id: Uuid,
    slug: Slug.optional(),
    code: Code.optional(),
    name: z.string().min(1),
  })
  .describe('A reference to another record, with every identifier it has.');

/** An opaque paging token (§1.3). Its contents are the server's business. */
export const Cursor = z.string().min(1).describe('An opaque cursor from a previous page.');

export type Uuid = z.infer<typeof Uuid>;
export type Slug = z.infer<typeof Slug>;
export type Code = z.infer<typeof Code>;
export type CountryCode = z.infer<typeof CountryCode>;
export type RegionCode = z.infer<typeof RegionCode>;
export type IsoDuration = z.infer<typeof IsoDuration>;
export type IsoDate = z.infer<typeof IsoDate>;
export type IsoDateTime = z.infer<typeof IsoDateTime>;
export type AsOf = z.infer<typeof AsOf>;
export type Identifier = z.infer<typeof Identifier>;
export type Ref = z.infer<typeof Ref>;
export type Cursor = z.infer<typeof Cursor>;
