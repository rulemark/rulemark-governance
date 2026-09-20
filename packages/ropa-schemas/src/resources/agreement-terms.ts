import { z } from 'zod';

import { AGREEMENT_DIRECTIONS, AUTHORIZATION_TYPES } from '../enums.js';
import { RegionCode, Slug } from '../primitives.js';
import { changeNote, optionalSlug, recordMeta } from './common.js';

/**
 * DM §3.6. The terms document, split from the signed agreement because 400
 * clients sign one standard DPA while Aurelia signs its own.
 */
const fields = {
  name: z.string().min(1),
  direction: z
    .enum(AGREEMENT_DIRECTIONS)
    .describe('Outbound: we are the processor for a client. Inbound: a vendor processes for us.'),
  authorizationType: z.enum(AUTHORIZATION_TYPES).describe('Art. 28(2).'),
  noticeDays: z.number().int().min(0).describe('Notice owed before a subprocessor change.'),
  allowedRegions: z
    .array(RegionCode)
    .describe('Where processing may happen. Empty means no restriction.'),
  documentUrl: z.url(),
};

export const AgreementTermsInput = z.object({
  slug: optionalSlug,
  name: fields.name,
  direction: fields.direction,
  authorizationType: fields.authorizationType,
  noticeDays: fields.noticeDays,
  allowedRegions: fields.allowedRegions.default([]),
  documentUrl: fields.documentUrl.optional(),
  changeNote,
});

export const AgreementTerms = z.object({
  ...recordMeta,
  slug: Slug,
  name: fields.name,
  direction: fields.direction,
  authorizationType: fields.authorizationType,
  noticeDays: fields.noticeDays,
  allowedRegions: fields.allowedRegions,
  documentUrl: fields.documentUrl.nullable(),
});

export type AgreementTermsInput = z.infer<typeof AgreementTermsInput>;
export type AgreementTerms = z.infer<typeof AgreementTerms>;
