import { z } from 'zod';

import {
  ACTIVITY_STATUSES,
  CLIENT_COVERAGES,
  ENGAGEMENT_ROLES,
  LAWFUL_BASES,
  SCOPE_MODES,
  SPECIAL_CONDITIONS,
  TRANSFER_MECHANISMS,
  type ClientCoverage,
  type EngagementRole,
  type ScopeMode,
} from '../enums.js';
import { fieldErrorsFromZod, type FieldError } from '../errors.js';
import {
  Code,
  CountryCode,
  Identifier,
  IsoDate,
  IsoDuration,
  Name,
  Ref,
  Text,
  Uuid,
} from '../primitives.js';
import {
  CONTROLLER_ENGAGEMENT_ROLES,
  NOT_YET_SUPPORTED_MESSAGE,
  PROCESSOR_ENGAGEMENT_ROLES,
  engagementClientScopeMessage,
  engagementRoleMessage,
  forbiddenMessage,
  type RoleField,
  type SupportedActivityRole,
} from './activity-role-rules.js';
import { changeNote, recordMeta } from './common.js';

/**
 * DM §3.1–§3.4 and §3.8. The activity is a discriminated union on `role`
 * (API §3.1), so each role has only its own fields, in the types and in the
 * OpenAPI document (`oneOf` with a discriminator).
 *
 * The input checks structure and **forbidden** by role, which hold for drafts
 * too. **Required** by role waits for activation (API §1.5): those fields are
 * optional here and checked by `canActivate`.
 */

// --- building blocks ---

/**
 * A field the role forbids. The check sits on the field itself, not in a
 * refinement of the whole activity: Zod skips an object's refinements while
 * any of its fields is invalid, so a form would only see this error after
 * fixing every other one.
 *
 * Absent is the only allowed value. An empty list or a null is still an answer
 * to a question this role doesn't ask.
 */
function forbiddenField(message: string) {
  return (
    z
      .unknown()
      // Reached only when a value was sent: `.optional()` lets absence through.
      .refine(() => false, { message, params: { code: 'forbidden_for_role' } })
      // Types the field as `undefined`, so it can't be read as data.
      .pipe(z.undefined())
      .optional()
      .meta({ not: {} })
  );
}

function forbidden(role: SupportedActivityRole, field: RoleField) {
  return forbiddenField(forbiddenMessage(role, field));
}

/**
 * An engagement role the activity role allows. Every known role parses first,
 * so one that exists but is not allowed here gets our code and message rather
 * than Zod's list of options. The OpenAPI document shows only the allowed ones.
 */
function engagementRole<const T extends readonly [EngagementRole, ...EngagementRole[]]>(
  role: SupportedActivityRole,
  allowed: T,
) {
  const permitted: readonly EngagementRole[] = allowed;
  return z
    .enum(ENGAGEMENT_ROLES)
    .superRefine((value, ctx) => {
      if (permitted.includes(value)) return;
      if (value === 'joint_controller') {
        ctx.addIssue({
          code: 'custom',
          message: 'Joint controller engagements are not yet supported',
          params: { code: 'not_yet_supported' },
        });
        return;
      }
      ctx.addIssue({
        code: 'custom',
        message: engagementRoleMessage(role),
        params: { code: 'role_not_allowed' },
      });
    })
    .pipe(z.enum(allowed))
    .meta({ enum: [...allowed] });
}

/** Nested rows keep their identity across a `PUT` (API §1.4). */
const nestedId = Uuid.optional().describe(
  'Send it back to update this row; leave it out to add one. Rows left out are deleted.',
);

/** References to other records, by any identifier. Left out means none. */
function refs(description: string) {
  return z.array(Identifier).default([]).describe(description);
}

/** ISO dates compare correctly as strings. */
function endsAfterStart(
  value: { readonly startedAt?: string | undefined; readonly endedAt?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.startedAt !== undefined && value.endedAt !== undefined) {
    if (value.endedAt < value.startedAt) {
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'Must not be before startedAt' });
    }
  }
}

const SCOPE_MODE_FOR: Readonly<Record<ClientCoverage, ScopeMode>> = {
  opt_in: 'include',
  all_enrolled: 'exclude',
};

// --- nested inputs ---

const TransferInput = z.object({
  id: nestedId,
  destinationCountry: CountryCode,
  mechanism: z.enum(TRANSFER_MECHANISMS),
  onwardVia: Name.optional().describe(
    'An onward transfer through the vendor’s own subprocessor: "Helpdesk Partners Pvt Ltd".',
  ),
  documentRef: Name.optional().describe('The SCCs or DPA reference.'),
});

const RetentionRuleInput = z.object({
  id: nestedId,
  dataCategory: Identifier.optional().describe('Leave out for the activity’s default rule.'),
  retentionPeriod: IsoDuration,
  triggerEvent: Name.describe('What starts the clock: "after contract end".'),
  legalRef: Name.optional().describe(
    'Why the data may be kept despite an erasure request: "Dutch tax law".',
  ),
});

const ActivityClientScopeInput = z
  .object({
    mode: z.enum(SCOPE_MODES),
    clients: z
      .array(
        z
          .object({
            id: nestedId,
            client: Identifier.describe('A party of kind client.'),
            reason: Text.optional().describe('Strongly recommended for an opt-out.'),
            agreement: Identifier.optional().describe('The agreement that requires it, if any.'),
            startedAt: IsoDate.describe('When the opt-in or opt-out took effect.'),
            endedAt: IsoDate.optional(),
          })
          .superRefine(endsAfterStart),
      )
      .min(1),
  })
  .describe(
    'Per-client exceptions to clientCoverage: include clients when opt_in, exclude clients when all_enrolled. Null for none.',
  );

const EngagementClientScopeInput = z
  .object({
    mode: z.enum(SCOPE_MODES),
    clients: z
      .array(
        z.object({
          id: nestedId,
          client: Identifier.describe('A party of kind client.'),
          reason: Text.describe('"EU-only processing (Aurelia DPA §7)".'),
          agreement: Identifier.optional().describe('The agreement that requires it, if any.'),
        }),
      )
      .min(1),
  })
  .describe(
    'Which clients’ data the engagement is used for. Null: every client the activity covers.',
  );

const engagementInputFields = {
  id: nestedId,
  party: Identifier.describe('A party of kind vendor or other.'),
  serviceDescription: Name.describe(
    'Tells engagements with the same party apart: "Candidate notifications (EU region)".',
  ),
  processingCountries: z
    .array(CountryCode)
    .min(1)
    .describe('Where the data is processed or accessed, which is not the vendor’s HQ.'),
  dataCategories: refs('A subset of the activity’s data categories.'),
  transfers: z.array(TransferInput).default([]),
  startedAt: IsoDate.optional(),
  endedAt: IsoDate.optional(),
};

const ControllerEngagementInput = z.object({
  ...engagementInputFields,
  role: engagementRole('controller', CONTROLLER_ENGAGEMENT_ROLES),
  clientScope: forbiddenField(engagementClientScopeMessage('controller')),
});

const ProcessorEngagementInput = z.object({
  ...engagementInputFields,
  role: engagementRole('processor', PROCESSOR_ENGAGEMENT_ROLES),
  clientScope: EngagementClientScopeInput.nullish(),
});

// --- the activity, going in ---

const activityInputFields = {
  name: Name,
  description: Text.optional(),
  roleRationale: Text.optional().describe(
    'Why this role. Strongly recommended where the role is arguable.',
  ),
  owner: Name.describe('The business contact accountable for the activity.'),
  supersedes: Identifier.optional().describe(
    'The retired activity this one replaces, e.g. after a role change.',
  ),
  subjectCategories: refs('Whose data: "candidates".'),
  dataCategories: refs('What data: "identity", "cv".'),
  systems: refs('Where it is processed: "hireloop-app".'),
  securityMeasures: refs('How it is protected: "encryption-at-rest".'),
  startedAt: IsoDate.optional().describe(
    'When the processing began. Set on activation if left out.',
  ),
  endedAt: IsoDate.optional(),
  reviewDueAt: IsoDate.optional().describe('The next periodic review.'),
  changeNote,
};

/** Art. 30(1): the record we keep as a controller. */
export const ControllerActivityInput = z
  .object({
    role: z.literal('controller'),
    ...activityInputFields,
    purposes: z.array(Text).default([]),
    lawfulBases: z.array(z.enum(LAWFUL_BASES)).default([]),
    specialConditions: z
      .array(z.enum(SPECIAL_CONDITIONS))
      .default([])
      .describe('Required when any data category is special (Art. 9, Art. 10).'),
    retentionRules: z.array(RetentionRuleInput).default([]),
    dpiaRequired: z.boolean().default(false),
    dpiaRef: Name.optional().describe('Our own DPIA.'),
    offering: forbidden('controller', 'offering'),
    clientCoverage: forbidden('controller', 'clientCoverage'),
    processingCategories: forbidden('controller', 'processingCategories'),
    clientScope: forbidden('controller', 'clientScope'),
    dpiaSupportRef: forbidden('controller', 'dpiaSupportRef'),
    engagements: z.array(ControllerEngagementInput).default([]),
  })
  .superRefine(endsAfterStart);

/** Art. 30(2): the record we keep as a processor for our clients. */
export const ProcessorActivityInput = z
  .object({
    role: z.literal('processor'),
    ...activityInputFields,
    purposes: forbidden('processor', 'purposes'),
    lawfulBases: forbidden('processor', 'lawfulBases'),
    specialConditions: forbidden('processor', 'specialConditions'),
    retentionRules: forbidden('processor', 'retentionRules'),
    dpiaRequired: forbidden('processor', 'dpiaRequired'),
    dpiaRef: forbidden('processor', 'dpiaRef'),
    offering: Identifier.optional().describe('The offering this processing is part of.'),
    clientCoverage: z
      .enum(CLIENT_COVERAGES)
      .optional()
      .describe('Which clients it applies to by default.'),
    processingCategories: z
      .array(Name)
      .default([])
      .describe('Art. 30(2)(b): "hosting", "storage".'),
    clientScope: ActivityClientScopeInput.nullish(),
    dpiaSupportRef: Name.optional().describe('The DPIA support pack for clients (Art. 28(3)(f)).'),
    engagements: z.array(ProcessorEngagementInput).default([]),
  })
  .superRefine((activity, ctx) => {
    endsAfterStart(activity, ctx);

    // activity_client_scope mode matches client_coverage (DM §3.8). Without a
    // coverage there is nothing to match yet; activation requires one.
    const { clientScope, clientCoverage } = activity;
    if (clientScope && clientCoverage !== undefined) {
      const expected = SCOPE_MODE_FOR[clientCoverage];
      if (clientScope.mode !== expected) {
        ctx.addIssue({
          code: 'custom',
          path: ['clientScope', 'mode'],
          message: `Must be "${expected}" when clientCoverage is "${clientCoverage}"`,
        });
      }
    }
  });

/**
 * In the type so a caller can name it, and always refused (DM §10, Q5). The
 * check sits on `role`, so the refusal is never hidden behind other errors.
 */
export const JointControllerActivityInput = z
  .object({
    role: z.literal('joint_controller').refine(() => false, {
      message: NOT_YET_SUPPORTED_MESSAGE,
      params: { code: 'not_yet_supported' },
    }),
  })
  .describe('Modeled but not yet supported: always rejected.');

export const ActivityInput = z
  .discriminatedUnion('role', [
    ControllerActivityInput,
    ProcessorActivityInput,
    JointControllerActivityInput,
  ])
  .meta({ discriminator: { propertyName: 'role' } });

/**
 * Structure and forbidden-by-role, the checks every write runs
 * (`ropa-packages.md` §4.3). An empty list means the shape is valid.
 */
export function validateActivityShape(input: unknown): FieldError[] {
  const result = ActivityInput.safeParse(input);
  return result.success ? [] : fieldErrorsFromZod(result.error);
}

// --- the lifecycle (API §3.4) ---

/** `POST /activities/{ref}/activate`. The version comes from `If-Match`. */
export const ActivateInput = z.object({ changeNote });

/** `POST /activities/{ref}/retire`. */
export const RetireInput = z.object({
  endedAt: IsoDate.optional().describe('When the processing stopped. Defaults to today.'),
  changeNote,
});

// --- the activity, coming out ---

const Transfer = z.object({
  id: Uuid,
  destinationCountry: CountryCode,
  mechanism: z.enum(TRANSFER_MECHANISMS),
  onwardVia: Name.nullable(),
  documentRef: Name.nullable(),
});

const RetentionRule = z.object({
  id: Uuid,
  dataCategory: Ref.nullable().describe('Null for the activity’s default rule.'),
  retentionPeriod: IsoDuration,
  triggerEvent: Name,
  legalRef: Name.nullable(),
});

const ActivityClientScope = z.object({
  mode: z.enum(SCOPE_MODES),
  clients: z.array(
    z.object({
      id: Uuid,
      client: Ref,
      reason: Text.nullable(),
      agreement: Ref.nullable(),
      startedAt: IsoDate,
      endedAt: IsoDate.nullable(),
    }),
  ),
});

const EngagementClientScope = z.object({
  mode: z.enum(SCOPE_MODES),
  clients: z.array(
    z.object({
      id: Uuid,
      client: Ref,
      reason: Text,
      agreement: Ref.nullable(),
    }),
  ),
});

const engagementFields = {
  id: Uuid,
  party: Ref,
  serviceDescription: Name,
  processingCountries: z.array(CountryCode),
  dataCategories: z.array(Ref),
  transfers: z.array(Transfer),
  startedAt: IsoDate.nullable(),
  endedAt: IsoDate.nullable(),
};

const ControllerEngagement = z.object({
  ...engagementFields,
  role: z.enum(CONTROLLER_ENGAGEMENT_ROLES),
});

const ProcessorEngagement = z.object({
  ...engagementFields,
  role: z.enum(PROCESSOR_ENGAGEMENT_ROLES),
  clientScope: EngagementClientScope.nullable(),
});

const activityFields = {
  ...recordMeta,
  code: Code,
  name: Name,
  description: Text.nullable(),
  roleRationale: Text.nullable(),
  status: z.enum(ACTIVITY_STATUSES),
  owner: Name,
  supersedes: Ref.nullable(),
  subjectCategories: z.array(Ref),
  dataCategories: z.array(Ref),
  systems: z.array(Ref),
  securityMeasures: z.array(Ref),
  startedAt: IsoDate.nullable(),
  endedAt: IsoDate.nullable(),
  reviewDueAt: IsoDate.nullable(),
};

export const ControllerActivity = z.object({
  role: z.literal('controller'),
  ...activityFields,
  purposes: z.array(Text),
  lawfulBases: z.array(z.enum(LAWFUL_BASES)),
  specialConditions: z.array(z.enum(SPECIAL_CONDITIONS)),
  retentionRules: z.array(RetentionRule),
  dpiaRequired: z.boolean(),
  dpiaRef: Name.nullable(),
  engagements: z.array(ControllerEngagement),
});

export const ProcessorActivity = z.object({
  role: z.literal('processor'),
  ...activityFields,
  offering: Ref.nullable(),
  clientCoverage: z.enum(CLIENT_COVERAGES).nullable(),
  processingCategories: z.array(Name),
  clientScope: ActivityClientScope.nullable(),
  dpiaSupportRef: Name.nullable(),
  engagements: z.array(ProcessorEngagement),
});

/** No `joint_controller` branch: one can never be saved. */
export const Activity = z
  .discriminatedUnion('role', [ControllerActivity, ProcessorActivity])
  .meta({ discriminator: { propertyName: 'role' } });

export type ControllerActivityInput = z.infer<typeof ControllerActivityInput>;
export type ProcessorActivityInput = z.infer<typeof ProcessorActivityInput>;
export type JointControllerActivityInput = z.infer<typeof JointControllerActivityInput>;
export type ActivityInput = z.infer<typeof ActivityInput>;
export type ControllerActivity = z.infer<typeof ControllerActivity>;
export type ProcessorActivity = z.infer<typeof ProcessorActivity>;
export type Activity = z.infer<typeof Activity>;
export type ActivateInput = z.infer<typeof ActivateInput>;
export type RetireInput = z.infer<typeof RetireInput>;
