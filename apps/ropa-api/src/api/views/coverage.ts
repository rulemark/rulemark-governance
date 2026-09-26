import { CoverageResponse, FINDING_SEVERITY, type Finding, type Ref } from '@rulemark/ropa-schemas';
import { eq, inArray } from 'drizzle-orm';

import { agreementTerms, processingActivity, system } from '../../db/schema/index.js';
import { loadActivitySnapshots } from '../../domain/activity/load.js';
import { partyAggregate, systemAggregate } from '../../domain/aggregates.js';
import { clientAgreementsFor, isoDate } from '../../domain/agreements.js';
import { loadRefs, requireRef } from '../../domain/refs.js';
import type { Transaction } from '../../domain/transaction.js';
import { coverage, type CoverageFinding } from '../../domain/views/coverage.js';

/**
 * `GET /coverage` (`ropa-api.md` §5.5). SQL loads the live activities, every
 * system, and the client agreements and terms in play; `coverage` decides what
 * is a finding (DB §6.3). Opening review items for them is a caller's job.
 */
export async function buildCoverage(tx: Transaction, now: Date): Promise<CoverageResponse> {
  const rows = await tx
    .select()
    .from(processingActivity)
    .where(eq(processingActivity.status, 'active'));
  const activities = await loadActivitySnapshots(tx, rows);
  const systems = await tx.select().from(system);

  const agreements = await clientAgreementsFor(
    tx,
    activities.flatMap((activity) =>
      activity.role === 'processor' && activity.offeringId !== null ? [activity.offeringId] : [],
    ),
    now,
  );
  const termsIds = [...new Set(agreements.map((row) => row.termsId))];
  const termsRows =
    termsIds.length === 0
      ? []
      : await tx.select().from(agreementTerms).where(inArray(agreementTerms.id, termsIds));

  const findings = coverage({
    activities,
    systems: systems.map((row) => ({
      id: row.id,
      kind: row.kind,
      hostingPartyId: row.hostingPartyId,
    })),
    agreements,
    terms: new Map(termsRows.map((row) => [row.id, row])),
    day: isoDate(now),
  });

  // Everything a finding names, loaded once for the whole list.
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const engagementsById = new Map(
    activities.flatMap((activity) => activity.engagements.map((row) => [row.id, row] as const)),
  );
  const parties = await loadRefs(
    tx,
    partyAggregate,
    findings.flatMap((finding) =>
      'partyId' in finding
        ? [finding.partyId, ...('clientId' in finding ? [finding.clientId] : [])]
        : [],
    ),
  );
  const systemRefs = new Map(systems.map((row) => [row.id, systemAggregate.toRef(row)]));
  const terms = new Map(
    termsRows.map((row) => [row.id, { id: row.id, slug: row.slug, name: row.name }]),
  );

  const activityRef = (id: string): Ref => {
    const activity = byId.get(id);
    if (activity === undefined) throw new Error(`Dangling reference: activity ${id}`);
    return { id: activity.id, code: activity.code, name: activity.name };
  };
  const engagementRef = (id: string) => {
    const row = engagementsById.get(id);
    if (row === undefined) throw new Error(`Dangling reference: engagement ${id}`);
    return { id: row.id, serviceDescription: row.serviceDescription };
  };
  const systemRef = (id: string) => requireRef(systemRefs, id, 'system');
  const party = (id: string) => requireRef(parties, id, 'party');

  function toOutput(finding: CoverageFinding): Finding {
    // Severity is spelled per case, so each variant keeps its literal type.
    const common = { key: finding.key };
    switch (finding.type) {
      case 'unmapped_system': {
        const row = systems.find((candidate) => candidate.id === finding.systemId)!;
        return {
          ...common,
          type: finding.type,
          severity: FINDING_SEVERITY.unmapped_system,
          targetType: 'system',
          target: systemRef(finding.systemId),
          details: { kind: row.kind, renderResourceId: row.renderResourceId },
        };
      }
      case 'transfer_missing':
        return {
          ...common,
          type: finding.type,
          severity: FINDING_SEVERITY.transfer_missing,
          targetType: 'activity',
          target: activityRef(finding.activityId),
          details: {
            engagement: engagementRef(finding.engagementId),
            party: party(finding.partyId),
            country: finding.country,
          },
        };
      case 'external_saas_mismatch':
        return {
          ...common,
          type: finding.type,
          severity: FINDING_SEVERITY.external_saas_mismatch,
          targetType: 'activity',
          target: activityRef(finding.activityId),
          details: {
            direction: finding.direction,
            party: party(finding.partyId),
            systems: finding.systemIds.map(systemRef),
            engagement: finding.engagementId === null ? null : engagementRef(finding.engagementId),
          },
        };
      case 'region_violation':
        return {
          ...common,
          type: finding.type,
          severity: FINDING_SEVERITY.region_violation,
          targetType: 'activity',
          target: activityRef(finding.activityId),
          details: {
            engagement: engagementRef(finding.engagementId),
            party: party(finding.partyId),
            client: party(finding.clientId),
            terms: requireRef(terms as Map<string, Ref>, finding.termsId, 'terms'),
            allowedRegions: [...finding.allowedRegions],
            country: finding.country,
            via: finding.via,
            onwardVia: finding.onwardVia,
          },
        };
      case 'review_overdue':
        return {
          ...common,
          type: finding.type,
          severity: FINDING_SEVERITY.review_overdue,
          targetType: 'activity',
          target: activityRef(finding.activityId),
          details: { reviewDueAt: finding.reviewDueAt },
        };
    }
  }

  return CoverageResponse.parse({
    generatedAt: now.toISOString(),
    findings: findings.map(toOutput),
  });
}
