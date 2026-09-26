import type {
  ControllerActivityInput,
  FieldError,
  ProcessorActivityInput,
} from '@rulemark/ropa-schemas';
import { inArray, or, type SQL } from 'drizzle-orm';

import { validationFailed } from '../../shared/problems.js';
import {
  agreementAggregate,
  dataCategoryAggregate,
  offeringAggregate,
  partyAggregate,
  securityMeasureAggregate,
  subjectCategoryAggregate,
  systemAggregate,
} from '../aggregates.js';
import { identifierKind, type Identifiable } from '../identifiers.js';
import type { Transaction } from '../transaction.js';
import type { ActivitySnapshot } from '../snapshots.js';
import { activityAggregate, type ActivityRow } from './load.js';

/**
 * An activity input with every reference resolved to an id (`ropa-api.md`
 * §1.2): what the save writes. Lists keep the input's order and length, so an
 * index here is the index in the request, and a rule can point at
 * `/engagements/1/dataCategories/0`. Duplicates are removed when the links are
 * written, not here, for the same reason.
 *
 * `id` is present when the caller sent one: that row is updated rather than
 * inserted (API §1.4).
 */
export type ActivitySaveInput = ControllerActivityInput | ProcessorActivityInput;

export type ActivityRootValues = Omit<
  ActivityRow,
  'id' | 'code' | 'status' | 'version' | 'createdAt' | 'updatedAt'
>;

export interface ResolvedTransfer {
  readonly id: string | undefined;
  readonly destinationCountry: string;
  readonly mechanism: ResolvedTransferMechanism;
  readonly onwardVia: string | null;
  readonly documentRef: string | null;
}
type ResolvedTransferMechanism =
  ActivitySaveInput['engagements'][number]['transfers'][number]['mechanism'];

export interface ResolvedEngagementScope {
  readonly id: string | undefined;
  readonly clientPartyId: string;
  readonly mode: 'include' | 'exclude';
  readonly reason: string;
  readonly agreementId: string | null;
}

export interface ResolvedEngagement {
  readonly id: string | undefined;
  readonly partyId: string;
  readonly role: ActivitySaveInput['engagements'][number]['role'];
  readonly serviceDescription: string;
  readonly processingCountries: readonly string[];
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly dataCategoryIds: readonly string[];
  readonly transfers: readonly ResolvedTransfer[];
  readonly clientScope: readonly ResolvedEngagementScope[];
}

export interface ResolvedRetentionRule {
  readonly id: string | undefined;
  readonly dataCategoryId: string | null;
  readonly retentionPeriod: string;
  readonly triggerEvent: string;
  readonly legalRef: string | null;
}

export interface ResolvedActivityScope {
  readonly id: string | undefined;
  readonly clientPartyId: string;
  readonly mode: 'include' | 'exclude';
  readonly reason: string | null;
  readonly agreementId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface ResolvedActivity {
  readonly root: ActivityRootValues;
  readonly subjectCategoryIds: readonly string[];
  readonly dataCategoryIds: readonly string[];
  readonly systemIds: readonly string[];
  readonly securityMeasureIds: readonly string[];
  readonly retentionRules: readonly ResolvedRetentionRule[];
  readonly clientScope: readonly ResolvedActivityScope[];
  readonly engagements: readonly ResolvedEngagement[];
}

// --- what a reference can point at ---

const TARGETS = {
  activity: { spec: activityAggregate, label: 'activity' },
  offering: { spec: offeringAggregate, label: 'offering' },
  party: { spec: partyAggregate, label: 'party' },
  agreement: { spec: agreementAggregate, label: 'agreement' },
  subjectCategory: { spec: subjectCategoryAggregate, label: 'subject category' },
  dataCategory: { spec: dataCategoryAggregate, label: 'data category' },
  system: { spec: systemAggregate, label: 'system' },
  securityMeasure: { spec: securityMeasureAggregate, label: 'security measure' },
} satisfies Record<string, { spec: Identifiable; label: string }>;

type Target = keyof typeof TARGETS;

/** Resolves one reference to an id, or returns undefined having noted why. */
type Lookup = (target: Target, identifier: string, path: string) => string | undefined;

/**
 * The input with every reference looked up. Written once and run twice: first
 * with a lookup that only collects identifiers, then with one that answers from
 * a batch query per record type. A request with thirty references costs eight
 * queries, not thirty.
 */
function resolveWith(input: ActivitySaveInput, lookup: Lookup): ResolvedActivity {
  // A miss has already been recorded as a field error by the lookup, and the
  // save stops before anything is written, so the placeholder is never stored.
  const ref = (target: Target, identifier: string, path: string) =>
    lookup(target, identifier, path) ?? '';
  const optionalRef = (target: Target, identifier: string | undefined, path: string) =>
    identifier === undefined ? null : ref(target, identifier, path);
  const refs = (target: Target, identifiers: readonly string[], path: string) =>
    identifiers.map((identifier, index) => ref(target, identifier, `${path}/${index}`));

  const common = {
    name: input.name,
    description: input.description ?? null,
    supersedesId: optionalRef('activity', input.supersedes, '/supersedes'),
    role: input.role,
    roleRationale: input.roleRationale ?? null,
    owner: input.owner,
    reviewDueAt: input.reviewDueAt ?? null,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
  };

  // Each role writes its own columns and leaves the other role's empty, which
  // is exactly what `processing_activity_*_fields` require (DDL §4.4).
  const root: ActivityRootValues =
    input.role === 'controller'
      ? {
          ...common,
          offeringId: null,
          clientCoverage: null,
          purposes: input.purposes,
          lawfulBases: input.lawfulBases,
          specialConditions: input.specialConditions,
          processingCategories: [],
          dpiaRequired: input.dpiaRequired,
          dpiaRef: input.dpiaRef ?? null,
          dpiaSupportRef: null,
        }
      : {
          ...common,
          offeringId: optionalRef('offering', input.offering, '/offering'),
          clientCoverage: input.clientCoverage ?? null,
          purposes: [],
          lawfulBases: [],
          specialConditions: [],
          processingCategories: input.processingCategories,
          dpiaRequired: null,
          dpiaRef: null,
          dpiaSupportRef: input.dpiaSupportRef ?? null,
        };

  // In document order, so field errors come back in the order a reader meets
  // the fields.
  const subjectCategoryIds = refs('subjectCategory', input.subjectCategories, '/subjectCategories');
  const dataCategoryIds = refs('dataCategory', input.dataCategories, '/dataCategories');
  const systemIds = refs('system', input.systems, '/systems');
  const securityMeasureIds = refs('securityMeasure', input.securityMeasures, '/securityMeasures');

  const retentionRules =
    input.role === 'controller'
      ? input.retentionRules.map((rule, index) => ({
          id: rule.id,
          dataCategoryId: optionalRef(
            'dataCategory',
            rule.dataCategory,
            `/retentionRules/${index}/dataCategory`,
          ),
          retentionPeriod: rule.retentionPeriod,
          triggerEvent: rule.triggerEvent,
          legalRef: rule.legalRef ?? null,
        }))
      : [];

  const clientScope =
    input.role === 'processor' && input.clientScope
      ? input.clientScope.clients.map((entry, index) => {
          const path = `/clientScope/clients/${index}`;
          return {
            id: entry.id,
            clientPartyId: ref('party', entry.client, `${path}/client`),
            mode: input.clientScope!.mode,
            reason: entry.reason ?? null,
            agreementId: optionalRef('agreement', entry.agreement, `${path}/agreement`),
            startedAt: entry.startedAt,
            endedAt: entry.endedAt ?? null,
          };
        })
      : [];

  const engagements = input.engagements.map((engagement, index): ResolvedEngagement => {
    const path = `/engagements/${index}`;
    const scope = 'clientScope' in engagement ? engagement.clientScope : undefined;
    return {
      id: engagement.id,
      partyId: ref('party', engagement.party, `${path}/party`),
      role: engagement.role,
      serviceDescription: engagement.serviceDescription,
      processingCountries: engagement.processingCountries,
      startedAt: engagement.startedAt ?? null,
      endedAt: engagement.endedAt ?? null,
      dataCategoryIds: refs('dataCategory', engagement.dataCategories, `${path}/dataCategories`),
      transfers: engagement.transfers.map((transfer) => ({
        id: transfer.id,
        destinationCountry: transfer.destinationCountry,
        mechanism: transfer.mechanism,
        onwardVia: transfer.onwardVia ?? null,
        documentRef: transfer.documentRef ?? null,
      })),
      clientScope: scope
        ? scope.clients.map((entry, entryIndex) => {
            const entryPath = `${path}/clientScope/clients/${entryIndex}`;
            return {
              id: entry.id,
              clientPartyId: ref('party', entry.client, `${entryPath}/client`),
              mode: scope.mode,
              reason: entry.reason,
              agreementId: optionalRef('agreement', entry.agreement, `${entryPath}/agreement`),
            };
          })
        : [],
    };
  });

  return {
    root,
    subjectCategoryIds,
    dataCategoryIds,
    systemIds,
    securityMeasureIds,
    retentionRules,
    clientScope,
    engagements,
  };
}

/** Every identifier each target was asked for, mapped to the id it names. */
async function loadIdentifiers(
  tx: Transaction,
  target: Target,
  identifiers: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const spec: Identifiable = TARGETS[target].spec;
  const byKind = { id: [] as string[], code: [] as string[], slug: [] as string[] };
  for (const identifier of identifiers) byKind[identifierKind(identifier)].push(identifier);

  const conditions: SQL[] = [];
  if (byKind.id.length > 0) conditions.push(inArray(spec.table.id, byKind.id));
  if (byKind.slug.length > 0 && spec.slugColumn !== undefined) {
    conditions.push(inArray(spec.slugColumn, byKind.slug));
  }
  if (byKind.code.length > 0 && spec.codeColumn !== undefined) {
    conditions.push(inArray(spec.codeColumn, byKind.code));
  }
  if (conditions.length === 0) return new Map();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (await (
    tx.select({
      id: spec.table.id,
      ...(spec.slugColumn === undefined ? {} : { slug: spec.slugColumn }),
      ...(spec.codeColumn === undefined ? {} : { code: spec.codeColumn }),
    }) as any
  )
    .from(spec.table)
    .where(or(...conditions))) as { id: string; slug?: string; code?: string }[];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const found = new Map<string, string>();
  for (const row of rows) {
    found.set(row.id, row.id);
    if (row.slug !== undefined) found.set(row.slug, row.id);
    if (row.code !== undefined) found.set(row.code, row.id);
  }
  return found;
}

/**
 * Resolves every reference in the input, or throws one 422 naming each that
 * does not exist, at its own path.
 */
export async function resolveActivity(
  tx: Transaction,
  input: ActivitySaveInput,
): Promise<ResolvedActivity> {
  const wanted = new Map<Target, Set<string>>();
  resolveWith(input, (target, identifier) => {
    const set = wanted.get(target) ?? new Set<string>();
    set.add(identifier);
    wanted.set(target, set);
    return undefined;
  });

  const found = new Map<Target, Map<string, string>>();
  for (const [target, identifiers] of wanted) {
    found.set(target, await loadIdentifiers(tx, target, identifiers));
  }

  const errors: FieldError[] = [];
  const resolved = resolveWith(input, (target, identifier, path) => {
    const id = found.get(target)?.get(identifier);
    if (id === undefined) {
      errors.push({
        path,
        code: 'unknown_reference',
        message: `No ${TARGETS[target].label} matching "${identifier}"`,
      });
    }
    return id;
  });

  if (errors.length > 0) {
    throw validationFailed('This activity refers to records that do not exist', errors);
  }
  return resolved;
}

/**
 * A stored aggregate in the form the rules take, so activation judges exactly
 * what a save would. Paths then point at the stored lists, which are in id
 * order: the order the record is read back in.
 */
export function resolvedFromSnapshot(snapshot: ActivitySnapshot): ResolvedActivity {
  return {
    root: {
      name: snapshot.name,
      description: snapshot.description,
      supersedesId: snapshot.supersedesId,
      role: snapshot.role,
      roleRationale: snapshot.roleRationale,
      owner: snapshot.owner,
      offeringId: snapshot.offeringId,
      clientCoverage: snapshot.clientCoverage,
      purposes: snapshot.purposes,
      lawfulBases: snapshot.lawfulBases,
      specialConditions: snapshot.specialConditions,
      processingCategories: snapshot.processingCategories,
      dpiaRequired: snapshot.dpiaRequired,
      dpiaRef: snapshot.dpiaRef,
      dpiaSupportRef: snapshot.dpiaSupportRef,
      reviewDueAt: snapshot.reviewDueAt,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt,
    },
    subjectCategoryIds: snapshot.subjectCategoryIds,
    dataCategoryIds: snapshot.dataCategoryIds,
    systemIds: snapshot.systemIds,
    securityMeasureIds: snapshot.securityMeasureIds,
    retentionRules: snapshot.retentionRules,
    clientScope: snapshot.clientScope,
    engagements: snapshot.engagements.map((engagement) => ({
      ...engagement,
      // Engagement roles were checked against the activity role on save.
      role: engagement.role as ResolvedEngagement['role'],
    })),
  };
}
