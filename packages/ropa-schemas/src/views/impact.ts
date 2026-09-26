import { z } from 'zod';

import { ACTIVITY_ROLES, AUTHORIZATION_TYPES, ENGAGEMENT_ROLES } from '../enums.js';
import {
  AsOf,
  CountryCode,
  IsoDate,
  IsoDateTime,
  Name,
  Ref,
  RegionCode,
  Uuid,
} from '../primitives.js';
import { ActivityRef, TermsRef } from './subprocessors.js';

/**
 * `GET /parties/{ref}/impact` (`ropa-api.md` §5.3): what depends on a vendor,
 * for the Monitor (Ch6). One entry per engagement, not per activity, because
 * two engagements with one vendor can reach different clients (P1's US and EU
 * regions). For a processor activity, the clients it reaches are grouped by
 * the terms they signed, because 399 of them share one.
 */

export const ImpactQuery = z.object({
  expandClients: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .describe('true: list every client in every group, not only in small ones.'),
  asOf: AsOf.optional().describe('The impact as it stood then.'),
});

/** Clients reached through one engagement, under one set of terms. */
export const ImpactClientGroup = z.object({
  terms: Ref,
  authorizationType: z.enum(AUTHORIZATION_TYPES),
  noticeDays: z.number().int().min(0),
  /** Present when the terms restrict where data may go (DM §3.6). */
  allowedRegions: z.array(RegionCode).optional(),
  clientCount: z.number().int().min(1),
  /** Listed for a small group, or for every group with `expandClients=true`. */
  clients: z.array(Ref).optional(),
  /** Specific authorization (Art. 28(2)): a notice isn't enough. */
  requiresApproval: z.boolean(),
  /**
   * The vendor gives less notice than these clients are owed, judged on the
   * vendor's shortest notice. Null when the vendor has no DPA in force, so
   * there is nothing to compare: "can't tell", not "no conflict".
   */
  noticeConflict: z.boolean().nullable(),
});

export const ImpactEngagement = z.object({
  activity: ActivityRef,
  engagement: z.object({ id: Uuid, serviceDescription: Name }),
  activityRole: z.enum(ACTIVITY_ROLES),
  engagementRole: z.enum(ENGAGEMENT_ROLES),
  /** Whose data: the activity's subject categories. */
  subjectCategories: z.array(Ref),
  /** What the vendor receives: the engagement's own data categories. */
  dataCategories: z.array(Ref),
  specialCategories: z.boolean(),
  processingCountries: z.array(CountryCode),
  /** Empty for a controller activity: Hireloop decides, and no client is told. */
  clientGroups: z.array(ImpactClientGroup),
});

export const ImpactResponse = z.object({
  generatedAt: IsoDateTime,
  asOf: IsoDate.nullable(),
  party: Ref,
  /** Every inbound agreement in force with the vendor (step 3, open question 5). */
  vendorTerms: z.array(TermsRef),
  engagements: z.array(ImpactEngagement),
  summary: z.object({
    engagements: z.number().int().min(0),
    activities: z.number().int().min(0),
    processorActivities: z.number().int().min(0),
    /** Distinct clients across every group. */
    affectedClients: z.number().int().min(0),
    clientsRequiringApproval: z.number().int().min(0),
    /** Distinct clients owed more notice than the vendor gives. */
    noticeConflicts: z.number().int().min(0),
  }),
});

export type ImpactQuery = z.infer<typeof ImpactQuery>;
export type ImpactClientGroup = z.infer<typeof ImpactClientGroup>;
export type ImpactEngagement = z.infer<typeof ImpactEngagement>;
export type ImpactResponse = z.infer<typeof ImpactResponse>;
