import {
  API_VERSION,
  ActivateInput,
  Activity,
  ActivityInput,
  Agreement,
  AgreementInput,
  AgreementTerms,
  AgreementTermsInput,
  DataCategory,
  CoverageResponse,
  DataCategoryInput,
  DataMapResponse,
  ImpactResponse,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MeResponse,
  Offering,
  OfferingInput,
  Party,
  PartyInput,
  ProblemDetails,
  Ref,
  ReportResponse,
  RetireInput,
  CloseReviewItemInput,
  REVIEW_REASONS,
  REVIEW_SOURCES,
  REVIEW_STATUSES,
  REVIEW_TARGET_TYPES,
  ReviewItem,
  ReviewItemInput,
  SecurityMeasure,
  SecurityMeasureInput,
  SubjectCategory,
  SubjectCategoryInput,
  SubprocessorsResponse,
  System,
  SystemInput,
  TokenRequest,
  TokenResponse,
} from '@rulemark/ropa-schemas';
import { z } from 'zod';

import { RESOURCES } from '../resources/index.js';
import type { ResourceDefinition } from '../resources/resource-router.js';

/**
 * The OpenAPI 3.1 document, generated rather than written (`ropa-api.md` §1.9,
 * `ropa-packages.md` §5.4).
 *
 * Two things make it trustworthy. The schemas come from `@rulemark/ropa-schemas`
 * through Zod 4's own `toJSONSchema`, which emits draft 2020-12 — the dialect
 * OpenAPI 3.1 uses — so the document describes exactly what the server
 * validates. And the paths are derived from the same `ResourceDefinition`
 * objects the router is built from, so an endpoint cannot exist without being
 * documented, or be documented with the wrong permission.
 */

type JsonObject = Record<string, unknown>;

/** `io` matters: a field with a default is optional going in, present coming out. */
function schemasFor(entries: readonly [string, z.ZodType][], io: 'input' | 'output'): JsonObject {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of entries) registry.add(schema, { id });

  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io,
    uri: (id) => `#/components/schemas/${id}`,
  });

  // `$schema` and `$id` are meaningful in a standalone JSON Schema document and
  // just noise inside `components.schemas`.
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => {
      const { $schema: _schema, $id: _id, ...rest } = schema as JsonObject;
      return [id, rest];
    }),
  );
}

const INPUT_SCHEMAS: readonly [string, z.ZodType][] = [
  ['PartyInput', PartyInput],
  ['AgreementTermsInput', AgreementTermsInput],
  ['OfferingInput', OfferingInput],
  ['AgreementInput', AgreementInput],
  ['SystemInput', SystemInput],
  ['SubjectCategoryInput', SubjectCategoryInput],
  ['DataCategoryInput', DataCategoryInput],
  ['SecurityMeasureInput', SecurityMeasureInput],
  ['ActivityInput', ActivityInput],
  ['ActivateInput', ActivateInput],
  ['RetireInput', RetireInput],
  ['ReviewItemInput', ReviewItemInput],
  ['CloseReviewItemInput', CloseReviewItemInput],
  ['TokenRequest', TokenRequest],
];

const OUTPUT_SCHEMAS: readonly [string, z.ZodType][] = [
  ['Ref', Ref],
  ['Party', Party],
  ['AgreementTerms', AgreementTerms],
  ['Offering', Offering],
  ['Agreement', Agreement],
  ['System', System],
  ['SubjectCategory', SubjectCategory],
  ['DataCategory', DataCategory],
  ['SecurityMeasure', SecurityMeasure],
  ['Activity', Activity],
  ['ReviewItem', ReviewItem],
  ['SubprocessorsResponse', SubprocessorsResponse],
  ['ImpactResponse', ImpactResponse],
  ['DataMapResponse', DataMapResponse],
  ['CoverageResponse', CoverageResponse],
  ['ReportResponse', ReportResponse],
  ['TokenResponse', TokenResponse],
  ['MeResponse', MeResponse],
  ['ProblemDetails', ProblemDetails],
];

const problem = (description: string): JsonObject => ({
  description,
  content: {
    'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
  },
});

const json = (ref: string, description: string): JsonObject => ({
  description,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});

/** Errors every guarded route can produce (§1.7). */
const COMMON_ERRORS: JsonObject = {
  '401': problem('No token, or the token is not valid'),
  '403': problem('Valid token without the required permission'),
  '422': problem('The request failed validation'),
};

const ETAG_HEADER: JsonObject = {
  ETag: {
    description: 'The record version. Send it back as If-Match on a write (§1.8).',
    schema: { type: 'string', example: '"3"' },
  },
};

const LOCATION_HEADER: JsonObject = {
  Location: {
    description: 'Where the new record lives, by its code or slug (§1.2).',
    schema: { type: 'string', example: '/v1/activities/P1' },
  },
};

const IF_MATCH: JsonObject = {
  name: 'If-Match',
  in: 'header',
  required: true,
  description: 'The version this write is based on, from the record’s ETag (§1.8).',
  schema: { type: 'string', example: '"3"' },
};

const REF_PARAM = (label: string): JsonObject => ({
  name: 'ref',
  in: 'path',
  required: true,
  description: `The ${label}: an id, code or slug (§1.2).`,
  schema: { type: 'string' },
});

function listResponseSchema(ref: string): JsonObject {
  return {
    type: 'object',
    required: ['data', 'nextCursor'],
    properties: {
      data: { type: 'array', items: { $ref: `#/components/schemas/${ref}` } },
      nextCursor: {
        type: ['string', 'null'],
        description: 'Pass as ?cursor= for the next page. Null on the last page.',
      },
    },
  };
}

/** Each operation records the permission it needs, in prose and as an extension. */
function guarded(operation: JsonObject, permission: string): JsonObject {
  const description = operation['description'];
  return {
    ...operation,
    description: `${typeof description === 'string' ? `${description}\n\n` : ''}Requires the \`${permission}\` permission.`,
    'x-required-permission': permission,
  };
}

function pathsForResource(resource: ResourceDefinition<never, never, never>): JsonObject {
  const base = `/${API_VERSION}/${resource.path}`;
  const { label, schemaNames, permissions } = resource;
  const tag = resource.path.split('/').at(-1) ?? resource.path;

  const filterParams = (resource.filters ?? []).map((filter) => ({
    name: filter.name,
    in: 'query',
    required: false,
    description: filter.description,
    schema: { type: 'string' },
  }));

  return {
    [base]: {
      get: guarded(
        {
          tags: [tag],
          summary: `List ${label} records`,
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: `Page size (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}).`,
              schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            },
            {
              name: 'cursor',
              in: 'query',
              description: 'From a previous page.',
              schema: { type: 'string' },
            },
            ...filterParams,
          ],
          responses: {
            '200': {
              description: 'A page of records',
              content: { 'application/json': { schema: listResponseSchema(schemaNames.output) } },
            },
            '400': problem('The limit or cursor is not valid'),
            ...COMMON_ERRORS,
          },
        },
        permissions.read,
      ),
      post: guarded(
        {
          tags: [tag],
          summary: `Create a ${label}`,
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${schemaNames.input}` } },
            },
          },
          responses: {
            '201': {
              ...json(schemaNames.output, 'Created'),
              headers: { ...ETAG_HEADER, ...LOCATION_HEADER },
            },
            '409': problem('An identifier is already taken'),
            ...COMMON_ERRORS,
          },
        },
        permissions.write,
      ),
    },

    [`${base}/{ref}`]: {
      get: guarded(
        {
          tags: [tag],
          summary: `Read a ${label}`,
          parameters: [REF_PARAM(label)],
          responses: {
            '200': { ...json(schemaNames.output, 'The record'), headers: ETAG_HEADER },
            '404': problem('No record matching that identifier'),
            ...COMMON_ERRORS,
          },
        },
        permissions.read,
      ),
      put: guarded(
        {
          tags: [tag],
          summary: `Replace a ${label}`,
          description:
            'A full replacement, not a patch: each revision stays a clean snapshot (§1.4).',
          parameters: [REF_PARAM(label), IF_MATCH],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${schemaNames.input}` } },
            },
          },
          responses: {
            '200': { ...json(schemaNames.output, 'The saved record'), headers: ETAG_HEADER },
            '404': problem('No record matching that identifier'),
            '412': problem('Someone else has saved since you read this record'),
            '428': problem('If-Match is required on a write'),
            ...COMMON_ERRORS,
          },
        },
        permissions.write,
      ),
      delete: guarded(
        {
          tags: [tag],
          summary: `Delete a ${label}`,
          parameters: [REF_PARAM(label), IF_MATCH],
          responses: {
            '204': { description: 'Deleted. Its history remains.' },
            '404': problem('No record matching that identifier'),
            '409': problem('Something still references this record'),
            '412': problem('Someone else has saved since you read this record'),
            '428': problem('If-Match is required on a write'),
            ...COMMON_ERRORS,
          },
        },
        permissions.delete,
      ),
    },

    [`${base}/{ref}/revisions`]: {
      get: guarded(
        {
          tags: [tag],
          summary: `List the revisions of a ${label}`,
          parameters: [REF_PARAM(label)],
          responses: {
            '200': {
              description: 'Every version, oldest first',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'nextCursor'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/RevisionSummary' },
                      },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
            '404': problem('No record matching that identifier'),
            ...COMMON_ERRORS,
          },
        },
        'history:read',
      ),
    },

    [`${base}/{ref}/revisions/{version}`]: {
      get: guarded(
        {
          tags: [tag],
          summary: `Read one version of a ${label}`,
          description: 'The full snapshot of the record as it stood at that version (DB §6.2).',
          parameters: [
            REF_PARAM(label),
            {
              name: 'version',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 },
            },
          ],
          responses: {
            '200': json('Revision', 'The revision and its snapshot'),
            '404': problem('No such record, or no such version'),
            ...COMMON_ERRORS,
          },
        },
        'history:read',
      ),
    },

    // Lifecycle actions (§3.4), from the same declarations the router mounts.
    ...Object.fromEntries(
      (resource.actions ?? []).map((action) => [
        `${base}/{ref}/${action.name}`,
        {
          post: guarded(
            {
              tags: [tag],
              summary: action.summary,
              description: action.description,
              parameters: [REF_PARAM(label), IF_MATCH],
              requestBody: {
                required: false,
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${action.schemaName}` },
                  },
                },
              },
              responses: {
                '200': {
                  ...json(schemaNames.output, 'The record after the transition'),
                  headers: ETAG_HEADER,
                },
                '404': problem('No record matching that identifier'),
                '409': problem('Not a transition the record’s current status allows'),
                '412': problem('Someone else has saved since you read this record'),
                '428': problem('If-Match is required'),
                ...COMMON_ERRORS,
              },
            },
            action.permission,
          ),
        },
      ]),
    ),
  };
}

/** Hand-written: these two are not resources, and have no Zod route schema. */
/** `?asOf=` on every view that takes it (§5, DB §6.3). */
const AS_OF =
  'The record as it stood then (Ch8): a date means the end of that day in UTC, a timestamp that instant. A moment after now answers 422 in_the_future. Names are the names of the time.';

const HISTORY_SCHEMAS: JsonObject = {
  RevisionSummary: {
    type: 'object',
    required: ['version', 'changeType', 'validFrom', 'actor', 'changeNote'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      changeType: {
        type: 'string',
        enum: ['created', 'updated', 'activated', 'retired', 'deleted'],
      },
      validFrom: { type: 'string', format: 'date-time' },
      actor: { type: 'string', description: 'The token subject that made the change (§1.6).' },
      changeNote: { type: ['string', 'null'] },
    },
  },
  Revision: {
    type: 'object',
    required: ['version', 'changeType', 'validFrom', 'actor', 'changeNote', 'snapshot'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      changeType: { type: 'string' },
      validFrom: { type: 'string', format: 'date-time' },
      actor: { type: 'string' },
      changeNote: { type: ['string', 'null'] },
      snapshot: { type: 'object', description: 'The aggregate as saved, with a schemaVersion.' },
    },
  },
};

export function buildOpenApiDocument(): JsonObject {
  const paths: JsonObject = {
    '/healthz': {
      get: {
        tags: ['service'],
        summary: 'Health check',
        description: 'Render’s health check. Needs no token.',
        security: [],
        responses: {
          '200': {
            description: 'The service is serving',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'uptime'],
                  properties: { status: { type: 'string' }, uptime: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },

    [`/${API_VERSION}/tokens`]: {
      post: {
        tags: ['auth'],
        summary: 'Mint a token',
        description:
          'Exchange a known subject and the mint secret for a bearer token, valid for eight hours. Needs no token of its own, and is rate limited.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/TokenRequest' } },
          },
        },
        responses: {
          '200': json('TokenResponse', 'The token, with the roles and permissions it carries'),
          '401': problem('Unknown subject, or the secret is wrong'),
          '422': problem('The request body is not valid'),
          '429': problem('Too many token requests'),
        },
      },
    },

    [`/${API_VERSION}/me`]: {
      get: {
        tags: ['auth'],
        summary: 'Describe the caller',
        description:
          'The caller’s subject, roles and effective permissions, so a UI can hide the actions it is not allowed to take. An anonymous caller is reported as a viewer.',
        security: [{}, { bearerAuth: [] }],
        responses: { '200': json('MeResponse', 'Who is calling') },
      },
    },
  };

  for (const resource of RESOURCES) {
    Object.assign(paths, pathsForResource(resource as ResourceDefinition<never, never, never>));
  }

  const queryParam = (
    name: string,
    description: string,
    schema: JsonObject = { type: 'string' },
  ) => ({
    name,
    in: 'query',
    required: false,
    description,
    schema,
  });

  const reviewItems = `/${API_VERSION}/review-items`;
  const enumParam = (name: string, description: string, values: readonly string[]) =>
    queryParam(name, description, { type: 'string', enum: [...values] });

  paths[reviewItems] = {
    get: guarded(
      {
        tags: ['review-items'],
        summary: 'List review items',
        description:
          'Findings carried to a person (§2 workflow): opened by the Monitor, the Snapshot, a schedule or by hand, and closed by resolving or dismissing them.',
        parameters: [
          queryParam('limit', `Page size, 1–${MAX_PAGE_SIZE}. Default ${DEFAULT_PAGE_SIZE}.`, {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PAGE_SIZE,
          }),
          queryParam('cursor', 'From the previous page’s nextCursor.'),
          enumParam('status', 'open, resolved or dismissed', REVIEW_STATUSES),
          enumParam('source', 'Who opened it', REVIEW_SOURCES),
          enumParam('reason', 'Why it was opened', REVIEW_REASONS),
          enumParam(
            'targetType',
            'Items about this kind of record. Required with target.',
            REVIEW_TARGET_TYPES,
          ),
          queryParam(
            'target',
            'Items about this record, by id, code or slug. Needs targetType: a slug alone could be a party’s or a system’s.',
          ),
          queryParam('dueBefore', 'Items due before this date (YYYY-MM-DD).', {
            type: 'string',
            format: 'date',
          }),
        ],
        responses: {
          '200': {
            description: 'A page of review items',
            content: { 'application/json': { schema: listResponseSchema('ReviewItem') } },
          },
          ...COMMON_ERRORS,
        },
      },
      'review:read',
    ),
    post: guarded(
      {
        tags: ['review-items'],
        summary: 'Open a review item',
        description:
          'Gets an `RI-n` code. `targetType` says how to read `target`. Who opened it comes from the token, never from the body (§1.6).',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ReviewItemInput' } },
          },
        },
        responses: {
          '201': {
            ...json('ReviewItem', 'The new item'),
            headers: {
              Location: {
                description: 'Where the new item lives, by its code.',
                schema: { type: 'string', example: '/v1/review-items/RI-7' },
              },
            },
          },
          ...COMMON_ERRORS,
        },
      },
      'review:create',
    ),
  };

  paths[`${reviewItems}/{ref}`] = {
    get: guarded(
      {
        tags: ['review-items'],
        summary: 'Read a review item',
        parameters: [REF_PARAM('review item: its id or code (RI-7)')],
        responses: {
          '200': json('ReviewItem', 'The item'),
          '404': problem('No such review item'),
          ...COMMON_ERRORS,
        },
      },
      'review:read',
    ),
  };

  for (const [action, outcome] of [
    ['resolve', 'Resolve a review item: the finding was acted on'],
    ['dismiss', 'Dismiss a review item: the finding needs no action'],
  ] as const) {
    paths[`${reviewItems}/{ref}/${action}`] = {
      post: guarded(
        {
          tags: ['review-items'],
          summary: outcome,
          description:
            'Closes an open item with a required `resolutionNote`, recording who closed it and when. Review items are not versioned, so there is no If-Match: only an open item can be closed, and closing one that is not answers 409 (§1.8).',
          parameters: [REF_PARAM('review item: its id or code (RI-7)')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CloseReviewItemInput' },
              },
            },
          },
          responses: {
            '200': json('ReviewItem', 'The closed item'),
            '404': problem('No such review item'),
            '409': problem('The item is not open'),
            ...COMMON_ERRORS,
          },
        },
        'review:resolve',
      ),
    };
  }

  paths[`/${API_VERSION}/report`] = {
    get: guarded(
      {
        tags: ['views'],
        summary: 'The Art. 30 record',
        description:
          'The record of processing activities (§5.1): the organisation and its DPO, controller activities (Art. 30(1)) and processor activities (Art. 30(2)), active ones only. `offering` or `client` scopes it to what one audience is owed, implies the processor view, and closes the report with the same list `GET /subprocessors` gives. `format=markdown` renders it for the architecture document, with a stable anchor per activity built from its code (`#p3`).',
        parameters: [
          queryParam('view', 'controller, processor or all. Default all; processor when scoped.', {
            type: 'string',
            enum: ['controller', 'processor', 'all'],
          }),
          queryParam('offering', 'An offering, by id or slug: its standard terms.'),
          queryParam('client', 'A client, by id or slug: the record as it applies to them.'),
          queryParam('asOf', AS_OF),
          queryParam('format', 'json (default) or markdown. csv is not supported yet.', {
            type: 'string',
            enum: ['json', 'markdown', 'csv'],
          }),
        ],
        responses: {
          '200': {
            description: 'The record, as JSON or Markdown',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ReportResponse' } },
              'text/markdown': { schema: { type: 'string' } },
            },
          },
          ...COMMON_ERRORS,
        },
      },
      'view:report',
    ),
  };

  paths[`/${API_VERSION}/subprocessors`] = {
    get: guarded(
      {
        tags: ['views'],
        summary: 'The subprocessor list, for an offering or a client',
        description:
          'Derived from the record (§5.2). By `offering`: the standard terms, which is also the public subprocessor page; opt-in modules are listed separately. By `client`: the effective engagements of every activity that covers that client, under the terms they signed. Exactly one of the two.',
        parameters: [
          {
            name: 'offering',
            in: 'query',
            required: false,
            description: 'An offering, by id or slug: its standard terms.',
            schema: { type: 'string' },
          },
          {
            name: 'client',
            in: 'query',
            required: false,
            description: 'A client, by id or slug: what that client actually gets.',
            schema: { type: 'string' },
          },
          {
            name: 'asOf',
            in: 'query',
            required: false,
            description: AS_OF,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': json('SubprocessorsResponse', 'The list'),
          ...COMMON_ERRORS,
        },
      },
      'view:subprocessors',
    ),
  };

  paths[`/${API_VERSION}/parties/{ref}/impact`] = {
    get: guarded(
      {
        tags: ['views'],
        summary: 'What depends on a vendor, and who must be told',
        description:
          'For the Monitor, when a vendor changes its subprocessors (§5.3). One entry per engagement with the party, in live activities. For a processor activity, the clients that engagement is used for, grouped by the terms they signed: `requiresApproval` when the terms need specific authorization, `noticeConflict` when the vendor gives less notice than the clients are owed (null when the vendor has no DPA in force), and `allowedRegions` when the terms restrict them. Groups of 10 or fewer list their clients.',
        parameters: [
          REF_PARAM('party: its id or slug'),
          queryParam(
            'expandClients',
            'true: list the clients of every group, not only small ones.',
            {
              type: 'string',
              enum: ['true', 'false'],
            },
          ),
          queryParam('asOf', AS_OF),
        ],
        responses: {
          '200': json('ImpactResponse', 'The impact'),
          '404': problem('No such party'),
          ...COMMON_ERRORS,
        },
      },
      'view:impact',
    ),
  };

  paths[`/${API_VERSION}/data-map`] = {
    get: guarded(
      {
        tags: ['views'],
        summary: 'Where a subject category’s data lives, and who acts on a request',
        description:
          'For the DSAR tracker (§5.4). One entry per live activity about the subject category, in code order: `act` where Hireloop is the controller, with its retention rules; `forward` where it is the processor, and the client decides. `client` scopes processor activities to what is done for that client; controller activities are always included. Vendor data categories are what each vendor receives for the activity, as recorded: an upper bound.',
        parameters: [
          {
            name: 'subjectCategory',
            in: 'query',
            required: true,
            description: 'Whose data, by id or slug: "candidates", "employees".',
            schema: { type: 'string' },
          },
          queryParam('client', 'A client, by id or slug: what is done for them.'),
          queryParam('asOf', AS_OF),
        ],
        responses: {
          '200': json('DataMapResponse', 'The data map'),
          ...COMMON_ERRORS,
        },
      },
      'view:datamap',
    ),
  };

  paths[`/${API_VERSION}/coverage`] = {
    get: guarded(
      {
        tags: ['views'],
        summary: 'Gaps between the record and the architecture',
        description:
          'Advisory findings, never blocking (§5.5): `unmapped_system`, `transfer_missing`, `external_saas_mismatch`, `region_violation` and `review_overdue`, most severe first. Severity is fixed per type. Each finding has a stable `key` (the same cause gives the same key on every run) and the `targetType` and `target` a review item for it would point at; a caller that opens review items stores the key in the item’s `details`. The record as it is today: `asOf` is refused.',
        responses: {
          '200': json('CoverageResponse', 'The findings'),
          ...COMMON_ERRORS,
        },
      },
      'view:coverage',
    ),
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'RoPA API',
      version: '0.1.0',
      description:
        'Record of Processing Activities (GDPR Article 30).\n\n' +
        'Reads are public by default and an anonymous caller is treated as a viewer; every write needs a token. ' +
        'Mint one at `POST /v1/tokens`, then use **Authorize** above.\n\n' +
        'Demo project. All data is synthetic; no real personal data is used.',
    },
    servers: [{ url: '/', description: 'This service' }],
    tags: [
      { name: 'auth', description: 'Minting tokens and inspecting the caller' },
      { name: 'parties', description: 'Us, our clients, our vendors' },
      { name: 'agreement-terms', description: 'Terms documents, outbound and inbound' },
      { name: 'offerings', description: 'What clients enrol in' },
      { name: 'agreements', description: 'Signed agreements' },
      { name: 'systems', description: 'Where processing runs' },
      { name: 'subject-categories', description: 'Shared vocabulary: whose data' },
      { name: 'data-categories', description: 'Shared vocabulary: what data' },
      { name: 'security-measures', description: 'Shared vocabulary: how it is protected' },
      { name: 'activities', description: 'The record itself: processing activities' },
      {
        name: 'review-items',
        description: 'Findings carried to a person, until resolved or dismissed',
      },
      { name: 'views', description: 'Read models derived from the record' },
      { name: 'service', description: 'Health and documentation' },
    ],
    // Applies to every operation unless it says otherwise, which is what gives
    // Swagger UI its Authorize button.
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'A token from POST /v1/tokens. Paste the token itself, without "Bearer".',
        },
      },
      schemas: {
        ...schemasFor(OUTPUT_SCHEMAS, 'output'),
        ...schemasFor(INPUT_SCHEMAS, 'input'),
        ...HISTORY_SCHEMAS,
      },
    },
    paths,
  };
}
