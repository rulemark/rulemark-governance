import {
  Agreement,
  AgreementInput,
  AgreementTerms,
  AgreementTermsInput,
  DataCategory,
  DataCategoryInput,
  Offering,
  OfferingInput,
  Party,
  PartyInput,
  SecurityMeasure,
  SecurityMeasureInput,
  SubjectCategory,
  SubjectCategoryInput,
  System,
  SystemInput,
  type Ref,
} from '@rulemark/ropa-schemas';
import { eq, type SQL } from 'drizzle-orm';

import { agreement, agreementTerms, offering, party, system } from '../../db/schema/index.js';
import {
  agreementAggregate,
  agreementTermsAggregate,
  dataCategoryAggregate,
  offeringAggregate,
  partyAggregate,
  securityMeasureAggregate,
  subjectCategoryAggregate,
  systemAggregate,
} from '../../domain/aggregates.js';
import { findByIdentifier, type Identifiable } from '../../domain/identifiers.js';
import { loadRefs, requireRef } from '../../domain/refs.js';
import { slugify } from '../../domain/slug.js';
import type { Transaction } from '../../domain/transaction.js';
import { conflict, validationFailed } from '../../shared/problems.js';
import type { ResourceContext, ResourceDefinition } from './resource-router.js';

/**
 * What is true about each record type, and nothing else: its schemas, the
 * references it carries, the rules that need a second table, and the filters it
 * offers. Everything about paging, ETags and problem shapes lives in
 * `resource-router.ts`.
 */

/** A body reference is any identifier (§1.2); an unknown one is a field error. */
async function resolveReference(
  tx: Transaction,
  spec: Identifiable,
  identifier: string,
  field: string,
  label: string,
): Promise<{ id: string } & Record<string, unknown>> {
  const row = await findByIdentifier<{ id: string } & Record<string, unknown>>(
    tx,
    spec,
    identifier,
  );
  if (row === undefined) {
    throw validationFailed('This record refers to something that does not exist', [
      {
        path: `/${field}`,
        code: 'unknown_reference',
        message: `No ${label} matching "${identifier}"`,
      },
    ]);
  }
  return row;
}

/**
 * A slug is chosen on create or derived from the name, and cannot be changed
 * afterwards (§1.2): changing one after it has been shared breaks URLs and
 * seeds. On a replace the stored slug simply wins.
 */
function slugFor(
  input: { slug?: string | undefined },
  name: string,
  existing?: { slug: string },
): string {
  if (existing !== undefined) return existing.slug;
  if (input.slug !== undefined) return input.slug;

  const derived = slugify(name);
  if (derived === undefined) {
    throw validationFailed('This record needs a slug', [
      {
        path: '/slug',
        code: 'slug_not_derivable',
        message: 'No slug could be derived from the name. Supply one explicitly.',
      },
    ]);
  }
  return derived;
}

/** Reads `?name=value`, treating an absent or repeated parameter as absent. */
function queryValue(context: ResourceContext, name: string): string | undefined {
  const value = context.request.query[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// --- parties ---------------------------------------------------------------

export const partiesResource: ResourceDefinition<
  typeof party.$inferSelect,
  never,
  typeof PartyInput._output
> = {
  path: 'parties',
  label: 'party',
  aggregate: partyAggregate as never,
  input: PartyInput,
  permissions: { read: 'record:read', write: 'record:write', delete: 'record:delete' },

  toValues: async (_context, input, existing) => ({
    slug: slugFor(input, input.legalName, existing),
    kind: input.kind,
    legalName: input.legalName,
    country: input.country,
    contactName: input.contactName ?? null,
    contactEmail: input.contactEmail ?? null,
    dpoName: input.dpoName ?? null,
    dpoEmail: input.dpoEmail ?? null,
    trustUrl: input.trustUrl ?? null,
    dpaUrl: input.dpaUrl ?? null,
    subprocessorListUrl: input.subprocessorListUrl ?? null,
  }),

  toOutput: async (_context, rows) =>
    rows.map((row) =>
      Party.parse({
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        // A party's name mirrors its legal name (§4).
        name: row.legalName,
        legalName: row.legalName,
        country: row.country,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        dpoName: row.dpoName,
        dpoEmail: row.dpoEmail,
        trustUrl: row.trustUrl,
        dpaUrl: row.dpaUrl,
        subprocessorListUrl: row.subprocessorListUrl,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    ),

  filters: async (context) => {
    const conditions: SQL[] = [];
    const kind = queryValue(context, 'kind');
    const country = queryValue(context, 'country');
    if (kind !== undefined) conditions.push(eq(party.kind, kind as typeof party.kind._.data));
    if (country !== undefined) conditions.push(eq(party.country, country));
    return conditions;
  },

  guardDelete: async (_context, row) => {
    // The record owner is the one party the record cannot be without (§4).
    if (row.kind === 'self') {
      throw conflict('The self party cannot be deleted: it is who the record belongs to');
    }
  },
};

// --- agreement terms -------------------------------------------------------

export const agreementTermsResource: ResourceDefinition<
  typeof agreementTerms.$inferSelect,
  never,
  typeof AgreementTermsInput._output
> = {
  path: 'agreement-terms',
  label: 'agreement terms',
  aggregate: agreementTermsAggregate as never,
  input: AgreementTermsInput,
  permissions: { read: 'record:read', write: 'record:write', delete: 'record:delete' },

  toValues: async (_context, input, existing) => ({
    slug: slugFor(input, input.name, existing),
    name: input.name,
    direction: input.direction,
    authorizationType: input.authorizationType,
    noticeDays: input.noticeDays,
    allowedRegions: input.allowedRegions,
    documentUrl: input.documentUrl ?? null,
  }),

  toOutput: async (_context, rows) =>
    rows.map((row) =>
      AgreementTerms.parse({
        id: row.id,
        slug: row.slug,
        name: row.name,
        direction: row.direction,
        authorizationType: row.authorizationType,
        noticeDays: row.noticeDays,
        allowedRegions: row.allowedRegions,
        documentUrl: row.documentUrl,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    ),

  filters: async (context) => {
    const conditions: SQL[] = [];
    const direction = queryValue(context, 'direction');
    const authorizationType = queryValue(context, 'authorizationType');
    if (direction !== undefined) {
      conditions.push(eq(agreementTerms.direction, direction as 'outbound'));
    }
    if (authorizationType !== undefined) {
      conditions.push(eq(agreementTerms.authorizationType, authorizationType as 'general'));
    }
    return conditions;
  },
};

// --- offerings -------------------------------------------------------------

export const offeringsResource: ResourceDefinition<
  typeof offering.$inferSelect,
  never,
  typeof OfferingInput._output
> = {
  path: 'offerings',
  label: 'offering',
  aggregate: offeringAggregate as never,
  input: OfferingInput,

  permissions: { read: 'record:read', write: 'record:write', delete: 'record:delete' },

  toValues: async (context, input, existing) => {
    const terms = await resolveReference(
      context.tx,
      agreementTermsAggregate,
      input.defaultTerms,
      'defaultTerms',
      'agreement terms',
    );

    // Clients enrol in an offering by signing its default terms, so inbound
    // terms — the ones a vendor signs for us — cannot be that default (§4).
    if (terms['direction'] !== 'outbound') {
      throw validationFailed('An offering needs outbound default terms', [
        {
          path: '/defaultTerms',
          code: 'direction_not_allowed',
          message: `"${input.defaultTerms}" is inbound; an offering's default terms are what clients sign`,
        },
      ]);
    }

    return {
      slug: slugFor(input, input.name, existing),
      name: input.name,
      defaultTermsId: terms.id,
    };
  },

  toOutput: async (context, rows) => {
    const refs = await loadRefs(
      context.tx,
      agreementTermsAggregate as never,
      rows.map((row) => row.defaultTermsId),
    );
    return rows.map((row) =>
      Offering.parse({
        id: row.id,
        slug: row.slug,
        name: row.name,
        defaultTerms: requireRef(refs, row.defaultTermsId, 'defaultTerms'),
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  },
};

// --- agreements ------------------------------------------------------------

export const agreementsResource: ResourceDefinition<
  typeof agreement.$inferSelect,
  never,
  typeof AgreementInput._output
> = {
  path: 'agreements',
  label: 'agreement',
  aggregate: agreementAggregate as never,
  input: AgreementInput,
  permissions: { read: 'record:read', write: 'record:write', delete: 'record:delete' },

  toValues: async (context, input) => {
    const partyRow = await resolveReference(
      context.tx,
      partyAggregate,
      input.party,
      'party',
      'party',
    );
    const termsRow = await resolveReference(
      context.tx,
      agreementTermsAggregate,
      input.terms,
      'terms',
      'agreement terms',
    );

    const offeringRow =
      input.offering === undefined
        ? undefined
        : await resolveReference(
            context.tx,
            offeringAggregate,
            input.offering,
            'offering',
            'offering',
          );

    // Outbound terms mean we are the processor for a client, and a client is
    // enrolled in something: which offering is the whole point of the row (§4).
    if (termsRow['direction'] === 'outbound' && offeringRow === undefined) {
      throw validationFailed('This agreement needs an offering', [
        {
          path: '/offering',
          code: 'required_for_outbound',
          message:
            'An agreement on outbound terms records which offering the client is enrolled in',
        },
      ]);
    }

    return {
      partyId: partyRow.id,
      termsId: termsRow.id,
      offeringId: offeringRow?.id ?? null,
      signedAt: input.signedAt,
      endedAt: input.endedAt ?? null,
    };
  },

  toOutput: async (context, rows) => {
    const [parties, terms, offerings] = await Promise.all([
      loadRefs(
        context.tx,
        partyAggregate as never,
        rows.map((row) => row.partyId),
      ),
      loadRefs(
        context.tx,
        agreementTermsAggregate as never,
        rows.map((row) => row.termsId),
      ),
      loadRefs(
        context.tx,
        offeringAggregate as never,
        rows.flatMap((row) => (row.offeringId === null ? [] : [row.offeringId])),
      ),
    ]);

    return rows.map((row) =>
      Agreement.parse({
        id: row.id,
        party: requireRef(parties, row.partyId, 'party'),
        terms: requireRef(terms, row.termsId, 'terms'),
        offering:
          row.offeringId === null ? null : requireRef(offerings, row.offeringId, 'offering'),
        signedAt: row.signedAt,
        endedAt: row.endedAt,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  },

  filters: async (context) => {
    const conditions: SQL[] = [];

    for (const [name, spec, column] of [
      ['party', partyAggregate, agreement.partyId],
      ['terms', agreementTermsAggregate, agreement.termsId],
      ['offering', offeringAggregate, agreement.offeringId],
    ] as const) {
      const value = queryValue(context, name);
      if (value === undefined) continue;
      const row = await resolveReference(context.tx, spec, value, name, name);
      conditions.push(eq(column, row.id));
    }

    return conditions;
  },
};

// --- systems ---------------------------------------------------------------

export const systemsResource: ResourceDefinition<
  typeof system.$inferSelect,
  never,
  typeof SystemInput._output
> = {
  path: 'systems',
  label: 'system',
  aggregate: systemAggregate as never,
  input: SystemInput,
  permissions: { read: 'record:read', write: 'system:write', delete: 'record:delete' },

  toValues: async (context, input, existing) => {
    const hosting = await resolveReference(
      context.tx,
      partyAggregate,
      input.hostingParty,
      'hostingParty',
      'party',
    );
    return {
      slug: slugFor(input, input.name, existing),
      name: input.name,
      kind: input.kind,
      renderResourceId: input.renderResourceId ?? null,
      region: input.region ?? null,
      hostingPartyId: hosting.id,
    };
  },

  toOutput: async (context, rows) => {
    const parties = await loadRefs(
      context.tx,
      partyAggregate as never,
      rows.map((row) => row.hostingPartyId),
    );
    return rows.map((row) =>
      System.parse({
        id: row.id,
        slug: row.slug,
        name: row.name,
        kind: row.kind,
        renderResourceId: row.renderResourceId,
        region: row.region,
        hostingParty: requireRef(parties, row.hostingPartyId, 'hostingParty'),
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  },

  filters: async (context) => {
    const conditions: SQL[] = [];
    const kind = queryValue(context, 'kind');
    const renderResourceId = queryValue(context, 'renderResourceId');
    const hostingParty = queryValue(context, 'hostingParty');

    if (kind !== undefined) conditions.push(eq(system.kind, kind as 'external_saas'));
    // How the Architecture Snapshot finds a system it already knows about (§4).
    if (renderResourceId !== undefined) {
      conditions.push(eq(system.renderResourceId, renderResourceId));
    }
    if (hostingParty !== undefined) {
      const row = await resolveReference(
        context.tx,
        partyAggregate,
        hostingParty,
        'hostingParty',
        'party',
      );
      conditions.push(eq(system.hostingPartyId, row.id));
    }
    return conditions;
  },
};

// --- taxonomies ------------------------------------------------------------

function taxonomyResource<TRow extends { id: string; slug: string; name: string }>(
  path: string,
  label: string,
  aggregate: unknown,
  input: unknown,
  output: unknown,
  extra?: (row: TRow) => Record<string, unknown>,
): ResourceDefinition<never, never, never> {
  return {
    path: `taxonomy/${path}`,
    label,
    aggregate: aggregate as never,
    input: input as never,
    permissions: { read: 'record:read', write: 'taxonomy:write', delete: 'record:delete' },

    toValues: (async (
      _context: ResourceContext,
      value: Record<string, unknown>,
      existing?: { slug: string },
    ) => ({
      slug: slugFor(value as { slug?: string }, value['name'] as string, existing),
      name: value['name'],
      description: value['description'] ?? null,
      ...(value['special'] === undefined ? {} : { special: value['special'] }),
    })) as never,

    toOutput: (async (
      _context: ResourceContext,
      rows: readonly (TRow & Record<string, unknown>)[],
    ) =>
      rows.map((row) =>
        (output as { parse: (value: unknown) => unknown }).parse({
          id: row.id,
          slug: row.slug,
          name: row.name,
          description: row['description'],
          version: row['version'],
          createdAt: (row['createdAt'] as Date).toISOString(),
          updatedAt: (row['updatedAt'] as Date).toISOString(),
          ...(extra?.(row) ?? {}),
        }),
      )) as never,
  };
}

export const subjectCategoriesResource = taxonomyResource(
  'subject-categories',
  'subject category',
  subjectCategoryAggregate,
  SubjectCategoryInput,
  SubjectCategory,
);

export const dataCategoriesResource = taxonomyResource(
  'data-categories',
  'data category',
  dataCategoryAggregate,
  DataCategoryInput,
  DataCategory,
  (row) => ({ special: (row as unknown as { special: string }).special }),
);

export const securityMeasuresResource = taxonomyResource(
  'security-measures',
  'security measure',
  securityMeasureAggregate,
  SecurityMeasureInput,
  SecurityMeasure,
);

export type { Ref };
