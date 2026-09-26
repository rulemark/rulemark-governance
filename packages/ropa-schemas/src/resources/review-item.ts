import { z } from 'zod';

import { REVIEW_REASONS, REVIEW_SOURCES, REVIEW_STATUSES, REVIEW_TARGET_TYPES } from '../enums.js';
import { Code, Identifier, IsoDate, IsoDateTime, Name, Ref, Text, Uuid } from '../primitives.js';

/**
 * DM §3.11, API §2 (workflow). A review item carries a finding to a person: the
 * Monitor opens one when a vendor's list changes (Ch6), the Snapshot when a
 * system has no activity (Ch5).
 *
 * Unlike the records, review items are not versioned (§1.8): their only change
 * is a one-way close, guarded by status, so there is no `version`, `ETag` or
 * `If-Match`. Their history is the `review_item.changed` event.
 */

/** Free-form context from whoever opened the item: the Monitor's diff, say. */
const JsonObject = z.record(z.string(), z.unknown());

const fields = {
  targetType: z
    .enum(REVIEW_TARGET_TYPES)
    .describe('What kind of record needs attention. Says how to read `target`.'),
  source: z.enum(REVIEW_SOURCES).describe('Who opened it.'),
  reason: z.enum(REVIEW_REASONS),
  details: JsonObject.describe('Context from whoever opened it, e.g. the Monitor’s diff.'),
  deadlines: JsonObject.describe(
    'Dates that bear on the decision, e.g. the vendor’s effective date and each client’s notice.',
  ),
  dueAt: IsoDate.describe('The earliest deadline.'),
};

export const ReviewItemInput = z.object({
  targetType: fields.targetType,
  target: Identifier.describe('The record, by id, code or slug: "P3", "mailcrest", "cv-parser".'),
  source: fields.source,
  reason: fields.reason,
  details: fields.details.optional(),
  deadlines: fields.deadlines.optional(),
  dueAt: fields.dueAt.optional(),
});

/** `POST /review-items/{ref}/resolve` and `/dismiss`. */
export const CloseReviewItemInput = z.object({
  resolutionNote: Text.describe('What was decided. Required: closing says why.'),
});

export const ReviewItem = z.object({
  id: Uuid,
  code: Code,
  targetType: fields.targetType,
  target: Ref,
  source: fields.source,
  reason: fields.reason,
  details: fields.details.nullable(),
  deadlines: fields.deadlines.nullable(),
  dueAt: fields.dueAt.nullable(),
  status: z.enum(REVIEW_STATUSES),
  resolutionNote: Text.nullable(),
  /** From the token, like a revision's actor (§1.6): who, not who they claim. */
  openedBy: Name,
  closedBy: Name.nullable(),
  closedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

/** `GET /review-items` filters (API §2). */
export const ReviewItemsQuery = z
  .object({
    status: z.enum(REVIEW_STATUSES).optional(),
    source: fields.source.optional(),
    reason: fields.reason.optional(),
    targetType: fields.targetType.optional(),
    target: Identifier.optional().describe('Needs targetType: a slug alone could be either.'),
    dueBefore: IsoDate.optional().describe('Items due before this date.'),
  })
  .superRefine((query, ctx) => {
    // `mailcrest` could be a party's slug or a system's, so the type says which.
    if (query.target !== undefined && query.targetType === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetType'],
        message: 'Say which kind of record the target is',
      });
    }
  });

export type ReviewItemInput = z.infer<typeof ReviewItemInput>;
export type CloseReviewItemInput = z.infer<typeof CloseReviewItemInput>;
export type ReviewItem = z.infer<typeof ReviewItem>;
export type ReviewItemsQuery = z.infer<typeof ReviewItemsQuery>;
