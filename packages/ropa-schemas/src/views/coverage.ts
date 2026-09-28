import { z } from 'zod';

import { SYSTEM_KINDS, type FindingSeverity, type FindingType } from '../enums.ts';
import {
  CountryCode,
  IsoDate,
  IsoDateTime,
  MAX_TEXT,
  Name,
  Ref,
  RegionCode,
  Uuid,
} from '../primitives.ts';

/**
 * `GET /coverage` (`ropa-api.md` §5.5): where the record and the
 * architecture disagree, or the record contradicts itself. Advisory, never
 * blocking (§1.5). Current state only: coverage is a question about today.
 */

/**
 * Fixed per type, not judged per finding (step 3, open question 3): a broken
 * client contract is high; processing the record can't account for is
 * medium; a record that contradicts itself, or is merely due a look, is low.
 */
export const FINDING_SEVERITY = {
  region_violation: 'high',
  transfer_missing: 'medium',
  unmapped_system: 'medium',
  external_saas_mismatch: 'low',
  review_overdue: 'low',
} as const satisfies Record<FindingType, FindingSeverity>;

const EngagementRef = z.object({ id: Uuid, serviceDescription: Name });

/**
 * What every finding carries. `key` is stable across runs: the same cause
 * gives the same key, so a caller that opens review items stores it in the
 * item's `details` and opens one only for a key it hasn't seen (Q4).
 * `targetType` and `target` are what a review item for it would point at.
 */
function finding<T extends FindingType, D extends z.ZodType>(
  type: T,
  targetType: 'activity' | 'system',
  details: D,
) {
  return z.object({
    key: z.string().min(1).max(MAX_TEXT),
    type: z.literal(type),
    severity: z.literal(FINDING_SEVERITY[type]),
    targetType: z.literal(targetType),
    target: Ref,
    details,
  });
}

export const Finding = z.discriminatedUnion('type', [
  finding(
    'unmapped_system',
    'system',
    z.object({ kind: z.enum(SYSTEM_KINDS), renderResourceId: Name.nullable() }),
  ),
  finding(
    'transfer_missing',
    'activity',
    z.object({ engagement: EngagementRef, party: Ref, country: CountryCode }),
  ),
  finding(
    'external_saas_mismatch',
    'activity',
    z.object({
      /**
       * `system_without_engagement`: the activity lists a SaaS system but has
       * no engagement with its host. `engagement_without_system`: it engages
       * a SaaS host but lists none of the host's systems.
       */
      direction: z.enum(['system_without_engagement', 'engagement_without_system']),
      party: Ref,
      systems: z.array(Ref),
      engagement: EngagementRef.nullable(),
    }),
  ),
  finding(
    'region_violation',
    'activity',
    z.object({
      engagement: EngagementRef,
      party: Ref,
      client: Ref,
      terms: Ref,
      allowedRegions: z.array(RegionCode),
      country: CountryCode,
      /** Processed there, or transferred there (onward transfers included). */
      via: z.enum(['processing', 'transfer']),
      onwardVia: Name.nullable(),
    }),
  ),
  finding('review_overdue', 'activity', z.object({ reviewDueAt: IsoDate })),
]);

export const CoverageResponse = z.object({
  generatedAt: IsoDateTime,
  findings: z.array(Finding),
});

export type Finding = z.infer<typeof Finding>;
export type CoverageResponse = z.infer<typeof CoverageResponse>;
