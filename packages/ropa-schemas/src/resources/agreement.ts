import { z } from 'zod';

import { Identifier, IsoDate, Ref } from '../primitives.js';
import { changeNote, recordMeta } from './common.js';

/**
 * DM §3.6. A signed agreement between one party and one set of terms.
 * Identified by `id` only: it has no slug and no code (§4).
 *
 * `offering` is required when the terms are outbound, which needs the terms
 * record and so is checked by the server.
 */
export const AgreementInput = z
  .object({
    party: Identifier,
    terms: Identifier,
    offering: Identifier.optional().describe('Required when the terms are outbound.'),
    signedAt: IsoDate,
    endedAt: IsoDate.optional().describe('Set through a PUT to end the agreement.'),
    changeNote,
  })
  .superRefine((agreement, ctx) => {
    // agreement_dates: an agreement cannot end before it was signed. ISO dates
    // compare correctly as strings.
    if (agreement.endedAt !== undefined && agreement.endedAt < agreement.signedAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'Must not be before signedAt',
      });
    }
  });

export const Agreement = z.object({
  ...recordMeta,
  party: Ref,
  terms: Ref,
  offering: Ref.nullable(),
  signedAt: IsoDate,
  endedAt: IsoDate.nullable(),
});

export type AgreementInput = z.infer<typeof AgreementInput>;
export type Agreement = z.infer<typeof Agreement>;
