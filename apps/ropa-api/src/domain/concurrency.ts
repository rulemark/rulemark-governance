import { badRequest, preconditionRequired, type Problem } from '../shared/problems.js';

/**
 * Optimistic concurrency (`ropa-api.md` §1.8). A versioned record's `ETag` is
 * its version, and a write must name the version it was based on, so nobody
 * silently overwrites a change they never saw — and, on `activate`, so an
 * approver provably approves the version they reviewed.
 */

/** A strong validator: the version is exact, not a hash that might collide. */
export function etagFor(version: number): string {
  return `"${version}"`;
}

const VALIDATOR = /^(?:W\/)?"?(\d+)"?$/;

/**
 * Reads the version out of an `If-Match` header, or throws the problem that
 * says what is wrong with it.
 *
 * `*` is rejected rather than honoured. RFC 9110 reads it as "any current
 * representation", which would let a caller write without naming the version
 * they reviewed — exactly what this header is here to prevent.
 */
export function requireIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim() === '') {
    throw preconditionRequired('This write needs an If-Match header carrying the record version');
  }

  const value = header.trim();
  if (value === '*') {
    throw preconditionRequired('If-Match must name a version, such as If-Match: "3"');
  }

  const match = VALIDATOR.exec(value);
  const version = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(version) || version < 1) {
    throw badRequest(`If-Match must be a record version, such as "3" (received ${header})`);
  }

  return version;
}

export type { Problem };
