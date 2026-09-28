import { z } from 'zod';

import {
  CHANGE_TYPES,
  REVIEW_CHANGE_TYPES,
  REVISION_ENTITY_TYPES,
  CHANGE_ENTITY_TYPES,
} from '../enums.ts';
import { AsOf, IsoDateTime, Ref, Uuid } from '../primitives.ts';
import { ListQuery, listResponse } from './common.ts';

/**
 * `GET /changes` (`ropa-api.md` §2): every change across the record in a time
 * range, oldest first. The regulator's "what changed since March" (Ch8), and
 * how the audit log backfills what it missed (§6).
 */

const common = {
  id: Uuid.describe('The revision’s id, or the review-item event’s.'),
  entity: Ref.describe('The record, named as it was named by this change.'),
  occurredAt: IsoDateTime.describe('When the change took effect.'),
  actor: z.string().min(1).describe('The token subject that made the change (§1.6).'),
};

/** A revision of a versioned record. */
const RecordChange = z.object({
  ...common,
  entityType: z.enum(REVISION_ENTITY_TYPES),
  version: z.number().int().positive(),
  changeType: z.enum(CHANGE_TYPES),
  changeNote: z.string().nullable().describe('Why, as the change said.'),
});

/** A review item opened or closed: no revision, so no version. */
const ReviewItemChange = z.object({
  ...common,
  entityType: z.literal('review_item'),
  version: z.null(),
  changeType: z.enum(REVIEW_CHANGE_TYPES),
  changeNote: z.string().nullable().describe('The resolution note, when the item was closed.'),
});

export const Change = z.union([RecordChange, ReviewItemChange]);

export const ChangesResponse = listResponse(Change);

export const ChangesQuery = ListQuery.extend({
  from: AsOf.optional().describe(
    'Changes at or after this. A date means from the start of that day, UTC.',
  ),
  to: AsOf.optional().describe(
    'Changes at or before this. A date means to the end of that day, UTC.',
  ),
  entityType: z.enum(CHANGE_ENTITY_TYPES).optional(),
});

export type Change = z.infer<typeof Change>;
export type ChangesResponse = z.infer<typeof ChangesResponse>;
export type ChangesQuery = z.infer<typeof ChangesQuery>;
