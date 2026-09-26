import { z } from 'zod';

import { ENGAGEMENT_ROLES } from '../enums.js';
import { AsOf, Identifier, IsoDate, IsoDateTime, Ref } from '../primitives.js';
import { RetentionRule } from '../resources/activity.js';
import { ActivityRef } from './subprocessors.js';

/**
 * `GET /data-map` (`ropa-api.md` §5.4): where a subject category's data
 * lives, and whether Hireloop acts on a request about it or forwards it, for
 * the DSAR tracker (Ch7).
 */

export const DataMapQuery = z.object({
  subjectCategory: Identifier.describe('Whose data: "candidates", "employees".'),
  client: Identifier.optional().describe(
    'Scopes processor activities to what is done for this client.',
  ),
  asOf: AsOf.optional().describe('The map as it stood then.'),
});

export const DataMapEntry = z.object({
  activity: ActivityRef,
  role: z.enum(['controller', 'processor']),
  /**
   * `act`: Hireloop is the controller and decides. `forward`: Hireloop is
   * the processor; it passes the request to the client and assists.
   */
  action: z.enum(['act', 'forward']),
  systems: z.array(Ref),
  vendors: z.array(
    z.object({
      party: Ref,
      role: z.enum(ENGAGEMENT_ROLES),
      /**
       * What the vendor receives for the activity, as recorded: an upper
       * bound, since data categories aren't tied to subject categories
       * (step 3, open question 6).
       */
      dataCategories: z.array(Ref),
    }),
  ),
  /** The controller's own rules; null for a processor, where the client decides. */
  retention: z.array(RetentionRule).nullable(),
});

export const DataMapResponse = z.object({
  generatedAt: IsoDateTime,
  asOf: IsoDate.nullable(),
  subjectCategory: Ref,
  client: Ref.nullable(),
  entries: z.array(DataMapEntry),
});

export type DataMapQuery = z.infer<typeof DataMapQuery>;
export type DataMapEntry = z.infer<typeof DataMapEntry>;
export type DataMapResponse = z.infer<typeof DataMapResponse>;
