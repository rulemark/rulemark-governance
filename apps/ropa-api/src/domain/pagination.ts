import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@rulemark/ropa-schemas';
import { z } from 'zod';

import { badRequest } from '../shared/problems.js';

/**
 * Keyset pagination (`ropa-api.md` §1.3). The cursor is the last id of the
 * previous page; because ids are UUIDv7 and therefore time-ordered, ordering by
 * id is both stable and meaningful, and a row inserted during paging cannot
 * shift the rows behind it the way an offset would.
 */

const CURSOR_PREFIX = 'ropa1:';

/** Opaque on purpose: its contents are the server's business, not a contract. */
export function encodeCursor(id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!decoded.startsWith(CURSOR_PREFIX)) {
    throw badRequest('This cursor did not come from us. Omit it to start from the beginning.');
  }

  const id = decoded.slice(CURSOR_PREFIX.length);
  if (!z.uuid().safeParse(id).success) {
    throw badRequest('This cursor is not valid. Omit it to start from the beginning.');
  }
  return id;
}

export interface Page<T> {
  readonly data: T[];
  readonly nextCursor: string | null;
}

/**
 * Turns `limit + 1` rows into a page. Asking for one more row than requested is
 * how "there is another page" is known without a second count query.
 */
export function pageOf<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  if (rows.length <= limit) return { data: rows, nextCursor: null };

  const data = rows.slice(0, limit);
  return { data, nextCursor: encodeCursor(data[data.length - 1]!.id) };
}

/** `?limit=` and `?cursor=`, validated (§1.3). */
export function parsePaging(query: unknown): { limit: number; cursor: string | undefined } {
  const parsed = z
    .object({
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
      cursor: z.string().min(1).optional(),
    })
    .safeParse(query);

  if (!parsed.success) {
    throw badRequest(
      `limit must be a whole number between 1 and ${MAX_PAGE_SIZE}, and cursor must come from a previous page`,
    );
  }

  return {
    limit: parsed.data.limit,
    cursor: parsed.data.cursor,
  };
}
