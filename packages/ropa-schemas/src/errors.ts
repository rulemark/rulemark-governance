import { z } from 'zod';

/**
 * RFC 9457 problem details, the one error shape the API returns (§1.7).
 *
 * This is the wire shape, shared so a client can parse a failure; the server's
 * machinery for building and throwing one stays in `apps/ropa-api`
 * (`ropa-packages.md` §3).
 */

export const FieldError = z
  .object({
    /** A JSON Pointer into the request body: `/engagements/1/role`. */
    path: z.string(),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .describe('One field-level validation failure.');

/**
 * Loose on purpose: RFC 9457 allows extension members, and the API uses them
 * for `requiredPermission` (§1.9) and `requestId`. Dropping unknown keys would
 * throw away exactly the part a caller most needs.
 */
export const ProblemDetails = z
  .looseObject({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z.array(FieldError).optional(),
  })
  .describe('An RFC 9457 problem document (application/problem+json).');

export type FieldError = z.infer<typeof FieldError>;
export type ProblemDetails = z.infer<typeof ProblemDetails>;
