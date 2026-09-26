import { z } from 'zod';

import {
  CLIENT_COVERAGES,
  DATA_CATEGORY_SPECIALS,
  ENGAGEMENT_ROLES,
  LAWFUL_BASES,
  SPECIAL_CONDITIONS,
  TRANSFER_MECHANISMS,
} from '../enums.js';
import {
  AsOf,
  Code,
  CountryCode,
  Email,
  Identifier,
  IsoDate,
  IsoDateTime,
  IsoDuration,
  Name,
  Ref,
  Text,
  Uuid,
} from '../primitives.js';
import { SubprocessorsResponse, TermsRef } from './subprocessors.js';

/**
 * `GET /report` (`ropa-api.md` §5.1): the Art. 30 record itself. JSON is the
 * structure; Markdown (`format=markdown`) is rendered from it, so the two
 * cannot disagree.
 */

export const REPORT_VIEWS = ['controller', 'processor', 'all'] as const;
export const REPORT_FORMATS = ['json', 'markdown', 'csv'] as const;

/**
 * `offering` and `client` scope the processor record to what one audience is
 * owed, so they imply the processor view; asking for Hireloop's own
 * controller records in the same breath is refused rather than mixed in.
 */
export const ReportQuery = z
  .object({
    view: z.enum(REPORT_VIEWS).optional().describe('Default all; processor when scoped.'),
    offering: Identifier.optional().describe(
      'The processor record under this offering’s standard terms.',
    ),
    client: Identifier.optional().describe('The processor record as it applies to this client.'),
    asOf: AsOf.optional(),
    format: z.enum(REPORT_FORMATS).default('json'),
  })
  .superRefine((query, ctx) => {
    if (query.offering !== undefined && query.client !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Scope by offering or by client, not both',
        params: { code: 'offering_or_client' },
      });
    }
    const scoped = query.offering !== undefined || query.client !== undefined;
    if (scoped && query.view !== undefined && query.view !== 'processor') {
      ctx.addIssue({
        code: 'custom',
        path: ['view'],
        message: 'A report scoped to an offering or a client is a processor report',
        params: { code: 'scope_needs_processor_view' },
      });
    }
  });

const DataCategoryRef = Ref.extend({ special: z.enum(DATA_CATEGORY_SPECIALS) });

const ReportTransfer = z.object({
  destinationCountry: CountryCode,
  mechanism: z.enum(TRANSFER_MECHANISMS),
  onwardVia: Name.nullable(),
});

/** A third party on an activity: a recipient or processor, or a subprocessor. */
export const ReportEngagement = z.object({
  party: Ref,
  role: z.enum(ENGAGEMENT_ROLES),
  service: Name,
  processingCountries: z.array(CountryCode),
  transfers: z.array(ReportTransfer),
  dataCategories: z.array(Ref),
});

const activityFields = {
  id: Uuid,
  code: Code,
  name: Name,
  description: Text.nullable(),
  owner: Name,
  startedAt: IsoDate.nullable(),
  reviewDueAt: IsoDate.nullable(),
  subjectCategories: z.array(Ref),
  dataCategories: z.array(DataCategoryRef),
  securityMeasures: z.array(Ref),
};

/** Art. 30(1). */
export const ReportControllerActivity = z.object({
  ...activityFields,
  purposes: z.array(Text),
  lawfulBases: z.array(z.enum(LAWFUL_BASES)),
  specialConditions: z.array(z.enum(SPECIAL_CONDITIONS)),
  recipients: z.array(ReportEngagement),
  retentionRules: z.array(
    z.object({
      dataCategory: Ref.nullable(),
      retentionPeriod: IsoDuration,
      triggerEvent: Name,
      legalRef: Name.nullable(),
    }),
  ),
  dpiaRequired: z.boolean(),
  dpiaRef: Name.nullable(),
});

/**
 * Whom a processor activity is performed for (Art. 30(2)(a)): one client, the
 * offering's clients on its standard terms (never named, because a prospect
 * reads this), or every client it covers today (the full internal record).
 */
export const ControllersServed = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('client'), client: Ref }),
  z.object({ kind: z.literal('standard'), terms: TermsRef }),
  z.object({ kind: z.literal('covered'), clients: z.array(Ref) }),
]);

/** Art. 30(2). */
export const ReportProcessorActivity = z.object({
  ...activityFields,
  offering: Ref,
  clientCoverage: z.enum(CLIENT_COVERAGES),
  /** An opt-in module: part of the offering only for clients who enable it. */
  optionalModule: z.boolean(),
  controllers: ControllersServed,
  processingCategories: z.array(Name),
  subprocessors: z.array(ReportEngagement),
  dpiaSupportRef: Name.nullable(),
});

/** Art. 30(1)(a): who keeps the record, and the DPO. */
export const Organisation = z.object({
  party: Ref,
  legalName: Name,
  country: CountryCode,
  contactName: Name.nullable(),
  contactEmail: Email.nullable(),
  dpoName: Name.nullable(),
  dpoEmail: Email.nullable(),
});

export const ReportResponse = z.object({
  generatedAt: IsoDateTime,
  asOf: IsoDate.nullable(),
  scope: z.object({
    view: z.enum(REPORT_VIEWS),
    offering: Ref.nullable(),
    client: Ref.nullable(),
    terms: TermsRef.nullable(),
  }),
  /** Null until the self party is recorded. */
  organisation: Organisation.nullable(),
  controllerActivities: z.array(ReportControllerActivity),
  processorActivities: z.array(ReportProcessorActivity),
  /** For a scoped report: exactly what `GET /subprocessors` answers for the same scope. */
  subprocessors: SubprocessorsResponse.nullable(),
});

export type ReportQuery = z.infer<typeof ReportQuery>;
export type ReportEngagement = z.infer<typeof ReportEngagement>;
export type ReportControllerActivity = z.infer<typeof ReportControllerActivity>;
export type ReportProcessorActivity = z.infer<typeof ReportProcessorActivity>;
export type ControllersServed = z.infer<typeof ControllersServed>;
export type Organisation = z.infer<typeof Organisation>;
export type ReportResponse = z.infer<typeof ReportResponse>;
