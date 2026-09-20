import { z } from 'zod';

import { Identifier, Ref, Slug } from '../primitives.js';
import { changeNote, optionalSlug, recordMeta } from './common.js';

/**
 * DM §3.7. What clients enrol in. `defaultTerms` must reference outbound terms,
 * which needs the other record and so is checked by the server, not here.
 */
export const OfferingInput = z.object({
  slug: optionalSlug,
  name: z.string().min(1),
  defaultTerms: Identifier.describe('The outbound terms clients sign by default.'),
  changeNote,
});

export const Offering = z.object({
  ...recordMeta,
  slug: Slug,
  name: z.string().min(1),
  defaultTerms: Ref,
});

export type OfferingInput = z.infer<typeof OfferingInput>;
export type Offering = z.infer<typeof Offering>;
