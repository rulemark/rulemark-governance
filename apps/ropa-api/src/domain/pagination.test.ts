import { describe, expect, it } from 'vitest';

import { Problem } from '../shared/problems.js';
import {
  decodeCursor,
  decodePositionCursor,
  encodeCursor,
  encodePositionCursor,
  pageOf,
} from './pagination.js';

const ID = '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e';

function catchProblem(run: () => unknown): Problem {
  try {
    run();
  } catch (error) {
    if (error instanceof Problem) return error;
    throw error;
  }
  throw new Error('expected a Problem');
}

describe('cursors', () => {
  it('round-trips an id', () => {
    expect(decodeCursor(encodeCursor(ID))).toBe(ID);
  });

  it('is opaque: the caller should not read or build one', () => {
    expect(encodeCursor(ID)).not.toContain(ID);
  });

  it('is URL-safe, since it travels as a query parameter', () => {
    expect(encodeCursor(ID)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('answers 400 for a cursor that is not one of ours', () => {
    for (const cursor of ['not-a-cursor', 'YWJj', '']) {
      expect(catchProblem(() => decodeCursor(cursor)).status, cursor).toBe(400);
    }
  });
});

describe('pageOf', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('returns the rows and no cursor when the page is not full', () => {
    // Asked for 3, given 3: there is no fourth row, so this is the last page.
    expect(pageOf(rows, 3)).toEqual({ data: rows, nextCursor: null });
  });

  it('drops the extra row and returns a cursor when there is more', () => {
    // The query asks for limit + 1 so it can tell "full page" from "last page"
    // without a second count query.
    const page = pageOf([...rows, { id: 'd' }], 3);
    expect(page.data).toEqual(rows);
    expect(page.nextCursor).toBe(encodeCursor('c'));
  });

  it('handles an empty result', () => {
    expect(pageOf([], 50)).toEqual({ data: [], nextCursor: null });
  });
});

describe('the position cursor (/changes)', () => {
  const at = '2026-03-16T08:00:00.123456Z';
  const id = '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e';

  it('round-trips a time to the microsecond, and an id', () => {
    expect(decodePositionCursor(encodePositionCursor(at, id))).toEqual({ at, id });
  });

  it('refuses an id cursor, and one that is not ours', () => {
    expect(() => decodePositionCursor(encodeCursor(id))).toThrow(/did not come from us/);
    expect(() => decodePositionCursor('bm9wZQ')).toThrow(/did not come from us/);
  });

  it('refuses a position without microseconds, or without a proper id', () => {
    const forged = (text: string) => Buffer.from(`ropa1t:${text}`).toString('base64url');
    expect(() => decodePositionCursor(forged(`2026-03-16T08:00:00Z/${id}`))).toThrow(/not valid/);
    expect(() => decodePositionCursor(forged(`${at}/not-an-id`))).toThrow(/not valid/);
  });
});
