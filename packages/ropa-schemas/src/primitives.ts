import { z } from 'zod';

/**
 * The small value types the whole API is built from (`ropa-packages.md` §4.1).
 * Nothing here touches the environment or a Node API: the package has to work
 * in a browser too.
 */

/**
 * Upper bounds on every identifier and free-text field.
 *
 * A pattern says what a value looks like, not how much of it there may be. An
 * unbounded slug reaches URLs, database indexes, log lines and other services'
 * foreign keys — the Monitor stores `party.slug`, the DSAR tracker stores
 * `subject_category.slug` — and unbounded free text is capped only by the
 * request body limit. Both are cheap to bound now and awkward to bound once
 * data exists.
 */
export const MAX_SLUG = 100;
export const MAX_CODE = 20;
export const MAX_NAME = 200;
export const MAX_TEXT = 2_000;
/** RFC 5321's maximum for a forward path. */
export const MAX_EMAIL = 254;
/** Comfortably past what any browser accepts. */
export const MAX_URL = 2_048;

/** Lowercase, hyphenated, and never UUID-shaped (DM §3.0). */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Uuid = z
  .uuid()
  .describe('A UUID. Records are keyed by UUIDv7.')
  .meta({ examples: ['0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e'] });

/**
 * A slug may never look like a UUID, so a path segment can always be told
 * apart from an id without a database lookup.
 */
export const Slug = z
  .string()
  .min(1)
  .max(MAX_SLUG)
  .regex(SLUG_PATTERN, 'Must be lowercase words separated by single hyphens')
  .refine((value) => !UUID_PATTERN.test(value), 'Must not look like a UUID')
  .describe('A human-readable identifier, unique within its table: "mailcrest", "standard-dpa-v3".')
  .meta({ examples: ['mailcrest', 'standard-dpa-v3'] });

/** A system-assigned code: `C1`, `P3`, `RI-42` (DM §3.0). Never typed by hand. */
export const Code = z
  .string()
  .min(2)
  .max(MAX_CODE)
  .regex(/^[A-Z]+-?\d+$/, 'Must be letters followed by a number, e.g. "P3" or "RI-42"')
  .describe('A stable, system-assigned code shown next to the name: "P3".')
  .meta({ examples: ['P3', 'RI-42'] });

/** A record's main label. */
export const Name = z
  .string()
  .min(1)
  .max(MAX_NAME)
  .meta({ examples: ['Mailcrest Inc.'] });

/** Free text: descriptions, notes, rationales. */
export const Text = z.string().min(1).max(MAX_TEXT);

export const Email = z
  .email()
  .max(MAX_EMAIL)
  .meta({ examples: ['dpo@hireloop.example'] });

export const Url = z
  .url()
  .max(MAX_URL)
  .meta({ examples: ['https://mailcrest.example/dpa'] });

/** ISO 3166-1 alpha-2. */
export const CountryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Must be an ISO 3166-1 alpha-2 country code, e.g. "DE"')
  .describe('An ISO 3166-1 alpha-2 country code.')
  .meta({ examples: ['NL', 'US', 'DE'] });

/**
 * A region for `agreement_terms.allowedRegions`: the EEA, which expands to its
 * member countries, or a single country (DM §3.6).
 */
export const RegionCode = z
  .union([z.literal('EEA'), CountryCode])
  .describe('"EEA", or an ISO 3166-1 alpha-2 country code.')
  .meta({ examples: ['EEA', 'IE'] });

/** ISO 8601 duration: `P90D`, `P7Y`, `P1Y6M` (retention periods). */
export const IsoDuration = z
  .string()
  .min(2)
  .max(MAX_CODE)
  .regex(
    /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+S)?)?$/,
    'Must be an ISO 8601 duration, e.g. "P90D" or "P7Y"',
  )
  .describe('An ISO 8601 duration: "P90D", "P7Y".')
  .meta({ examples: ['P90D', 'P7Y'] });

/** A business date, `YYYY-MM-DD` (§1.1). Rejects a calendar date that does not exist. */
export const IsoDate = z.iso
  .date()
  .describe('A date, "YYYY-MM-DD".')
  .meta({ examples: ['2026-03-16'] });

/** An RFC 3339 timestamp (§1.1). */
export const IsoDateTime = z.iso
  .datetime({ offset: true })
  .describe('An RFC 3339 timestamp.')
  .meta({ examples: ['2026-03-16T10:00:00Z'] });

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
  .max(MAX_SLUG)
  .describe('An id, code or slug: "mailcrest", "P3" or a UUID.')
  .meta({ examples: ['mailcrest'] });

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
    name: Name,
  })
  .describe('A reference to another record, with every identifier it has.');

/** An opaque paging token (§1.3). Its contents are the server's business. */
export const Cursor = z
  .string()
  .min(1)
  .max(MAX_TEXT)
  .describe('An opaque cursor from a previous page.');

export type Uuid = z.infer<typeof Uuid>;
export type Slug = z.infer<typeof Slug>;
export type Code = z.infer<typeof Code>;
export type Name = z.infer<typeof Name>;
export type Text = z.infer<typeof Text>;
export type Email = z.infer<typeof Email>;
export type Url = z.infer<typeof Url>;
export type CountryCode = z.infer<typeof CountryCode>;
export type RegionCode = z.infer<typeof RegionCode>;
export type IsoDuration = z.infer<typeof IsoDuration>;
export type IsoDate = z.infer<typeof IsoDate>;
export type IsoDateTime = z.infer<typeof IsoDateTime>;
export type AsOf = z.infer<typeof AsOf>;
export type Identifier = z.infer<typeof Identifier>;
export type Ref = z.infer<typeof Ref>;
export type Cursor = z.infer<typeof Cursor>;
