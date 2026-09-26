import {
  FINDING_SEVERITIES,
  FINDING_SEVERITY,
  FINDING_TYPES,
  RENDER_SYSTEM_KINDS,
  expandRegions,
  EEA_COUNTRIES,
  type SystemKind,
} from '@rulemark/ropa-schemas';

import type { ActivitySnapshot } from '../snapshots.js';
import type { ClientAgreement } from './impact.js';
import { byCode, coversClient, inForce, isEffectiveFor } from './subprocessors.js';

/**
 * Where the record and the architecture disagree, or the record contradicts
 * itself (DM §5, §7; API §5.5), as a function over aggregates (DB §6.3).
 * Advisory: nothing here blocks a save. Only live activities and engagements
 * in force count — a draft processes nothing yet.
 *
 * Every finding has a `key` built from its cause, so the same cause gives the
 * same key on every run (step 3, open question 4).
 */

type Engagement = ActivitySnapshot['engagements'][number];

export interface CoverageSystem {
  readonly id: string;
  readonly kind: SystemKind;
  readonly hostingPartyId: string;
}

export interface CoverageInput {
  readonly activities: readonly ActivitySnapshot[];
  readonly systems: readonly CoverageSystem[];
  /** Outbound agreements in force for the processor activities' offerings. */
  readonly agreements: readonly ClientAgreement[];
  readonly terms: ReadonlyMap<
    string,
    { readonly id: string; readonly allowedRegions: readonly string[] }
  >;
  readonly day: string;
}

export type CoverageFinding =
  | { readonly type: 'unmapped_system'; readonly key: string; readonly systemId: string }
  | {
      readonly type: 'transfer_missing';
      readonly key: string;
      readonly activityId: string;
      readonly engagementId: string;
      readonly partyId: string;
      readonly country: string;
    }
  | {
      readonly type: 'external_saas_mismatch';
      readonly key: string;
      readonly activityId: string;
      readonly direction: 'system_without_engagement' | 'engagement_without_system';
      readonly partyId: string;
      readonly systemIds: string[];
      readonly engagementId: string | null;
    }
  | {
      readonly type: 'region_violation';
      readonly key: string;
      readonly activityId: string;
      readonly engagementId: string;
      readonly partyId: string;
      readonly clientId: string;
      readonly termsId: string;
      readonly allowedRegions: readonly string[];
      readonly country: string;
      readonly via: 'processing' | 'transfer';
      readonly onwardVia: string | null;
    }
  | {
      readonly type: 'review_overdue';
      readonly key: string;
      readonly activityId: string;
      readonly reviewDueAt: string;
    };

const EEA = new Set(EEA_COUNTRIES);
const RENDER_KINDS: ReadonlySet<string> = new Set(RENDER_SYSTEM_KINDS);

/** A Render system no live activity uses (Ch5: `cv-parser`). An activity with none is fine (C1). */
function unmappedSystems(
  live: readonly ActivitySnapshot[],
  input: CoverageInput,
): CoverageFinding[] {
  const used = new Set(live.flatMap((activity) => activity.systemIds));
  return input.systems
    .filter((system) => RENDER_KINDS.has(system.kind) && !used.has(system.id))
    .map((system) => ({
      type: 'unmapped_system',
      key: `unmapped_system:${system.id}`,
      systemId: system.id,
    }));
}

/**
 * A processing country outside the EEA with no transfer to it on the same
 * engagement. An adequacy country is no exception: its transfer is recorded
 * with `mechanism: adequacy` (step 3, open question 2).
 */
function missingTransfers(activity: ActivitySnapshot, engagements: readonly Engagement[]) {
  return engagements.flatMap((engagement) =>
    engagement.processingCountries
      .filter(
        (country) =>
          !EEA.has(country) &&
          !engagement.transfers.some((transfer) => transfer.destinationCountry === country),
      )
      .map((country): CoverageFinding => ({
        type: 'transfer_missing',
        key: `transfer_missing:${engagement.id}:${country}`,
        activityId: activity.id,
        engagementId: engagement.id,
        partyId: engagement.partyId,
        country,
      })),
  );
}

/**
 * DM §5: a SaaS system on an activity needs an engagement with its host, and
 * an engagement with a SaaS host needs one of the host's systems listed. The
 * second is read as "any of them": a host with two tools, one used, is fine.
 */
function saasMismatches(
  activity: ActivitySnapshot,
  engagements: readonly Engagement[],
  input: CoverageInput,
): CoverageFinding[] {
  const saas = input.systems.filter((system) => system.kind === 'external_saas');
  const engaged = new Set(engagements.map((engagement) => engagement.partyId));
  const findings: CoverageFinding[] = [];

  for (const system of saas.filter((candidate) => activity.systemIds.includes(candidate.id))) {
    if (engaged.has(system.hostingPartyId)) continue;
    findings.push({
      type: 'external_saas_mismatch',
      key: `external_saas_mismatch:system:${activity.id}:${system.id}`,
      activityId: activity.id,
      direction: 'system_without_engagement',
      partyId: system.hostingPartyId,
      systemIds: [system.id],
      engagementId: null,
    });
  }

  for (const engagement of engagements) {
    const hosted = saas.filter((system) => system.hostingPartyId === engagement.partyId);
    if (hosted.length === 0 || hosted.some((system) => activity.systemIds.includes(system.id))) {
      continue;
    }
    findings.push({
      type: 'external_saas_mismatch',
      key: `external_saas_mismatch:engagement:${engagement.id}`,
      activityId: activity.id,
      direction: 'engagement_without_system',
      partyId: engagement.partyId,
      systemIds: hosted.map((system) => system.id),
      engagementId: engagement.id,
    });
  }

  return findings;
}

/**
 * An engagement used for a client whose terms restrict regions, processing or
 * transferring outside them (Ch6). Data stored in Ireland but opened from
 * India is outside the EEA, so onward transfers count. A country is reported
 * once per engagement and client, as processing if it is both.
 */
function regionViolations(
  activity: ActivitySnapshot,
  engagements: readonly Engagement[],
  input: CoverageInput,
): CoverageFinding[] {
  if (activity.role !== 'processor') return [];
  const findings: CoverageFinding[] = [];

  for (const agreement of input.agreements) {
    if (agreement.offeringId !== activity.offeringId) continue;
    const terms = input.terms.get(agreement.termsId);
    if (terms === undefined || terms.allowedRegions.length === 0) continue;
    if (!coversClient(activity, agreement.clientId, input.day)) continue;
    const allowed = expandRegions(terms.allowedRegions);

    for (const engagement of engagements) {
      if (!isEffectiveFor(engagement, agreement.clientId)) continue;
      const reached = [
        ...engagement.processingCountries.map((country) => ({
          country,
          via: 'processing' as const,
          onwardVia: null,
        })),
        ...engagement.transfers.map((transfer) => ({
          country: transfer.destinationCountry,
          via: 'transfer' as const,
          onwardVia: transfer.onwardVia,
        })),
      ];
      const reported = new Set<string>();
      for (const { country, via, onwardVia } of reached) {
        if (allowed.has(country) || reported.has(country)) continue;
        reported.add(country);
        findings.push({
          type: 'region_violation',
          key: `region_violation:${engagement.id}:${agreement.clientId}:${country}`,
          activityId: activity.id,
          engagementId: engagement.id,
          partyId: engagement.partyId,
          clientId: agreement.clientId,
          termsId: terms.id,
          allowedRegions: terms.allowedRegions,
          country,
          via,
          onwardVia,
        });
      }
    }
  }

  return findings;
}

/** Most severe first, then in the order of `FINDING_TYPES`; stable within a type. */
function rank(finding: CoverageFinding): number {
  return (
    FINDING_SEVERITIES.indexOf(FINDING_SEVERITY[finding.type]) * FINDING_TYPES.length +
    FINDING_TYPES.indexOf(finding.type)
  );
}

export function coverage(input: CoverageInput): CoverageFinding[] {
  const live = [...input.activities]
    .filter((activity) => activity.status === 'active')
    .sort(byCode);

  const findings: CoverageFinding[] = [...unmappedSystems(live, input)];
  for (const activity of live) {
    const engagements = activity.engagements.filter((engagement) => inForce(engagement, input.day));
    findings.push(
      ...missingTransfers(activity, engagements),
      ...saasMismatches(activity, engagements, input),
      ...regionViolations(activity, engagements, input),
    );
    // Passed means before today: due today is not yet overdue.
    if (activity.reviewDueAt !== null && activity.reviewDueAt < input.day) {
      findings.push({
        type: 'review_overdue',
        key: `review_overdue:${activity.id}`,
        activityId: activity.id,
        reviewDueAt: activity.reviewDueAt,
      });
    }
  }

  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => rank(a.finding) - rank(b.finding) || a.index - b.index)
    .map(({ finding }) => finding);
}
