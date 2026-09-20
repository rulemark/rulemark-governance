import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants.js';
import { Cursor, IsoDateTime, Slug, Uuid } from '../primitives.js';

/**
 * Input and Output are separate schemas for every record, because the API
 * differs from the stored row on purpose (`ropa-packages.md` §4.2): inputs take
 * identifiers as strings, outputs return `Ref` objects; `changeNote` is
 * input-only; ids, versions and timestamps are output-only.
 */

/**
 * Why the change was made. Write-only: it belongs to the change, not the
 * record, so it is stored on the revision and never returned (§1.6).
 */
export const changeNote = z
  .string()
  .min(1)
  .max(2000)
  .optional()
  .describe('Why this change was made. Stored on the revision, never returned.');

/** The read-only fields every versioned record carries (§1.2). */
export const recordMeta = {
  id: Uuid,
  /** Also the record's `ETag`, used for `If-Match` (§1.8). */
  version: z.number().int().positive(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
};

/**
 * A slug may be chosen on create and is otherwise derived from the name; it
 * cannot be changed through the API in v1 (§1.2).
 */
export const optionalSlug = Slug.optional();

/** A page of records (§1.3). `nextCursor` is null on the last page. */
export function listResponse<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: Cursor.nullable(),
  });
}

/** The paging parameters every list endpoint accepts (§1.3). */
export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: Cursor.optional(),
});

export type ListQuery = z.infer<typeof ListQuery>;
