import type { ActivityRole, EngagementRole } from '../enums.js';
import type { FieldError } from '../errors.js';

/**
 * DM §5, rules by role, as data. The activity schemas read their forbidden
 * fields and messages from here, `canActivate` reads the required ones, and a
 * form reads all of it through `describeRoleRules` (`ropa-packages.md` §4.3).
 *
 * Only rules that need nothing but the record itself live here. Anything that
 * needs another record — Art. 9 conditions for special categories, a client's
 * agreement, data-category subsets — is the server's, inside the save
 * transaction (`ropa-database.md` §2).
 */

/** The fields whose rule depends on the activity's role. */
export const ROLE_FIELDS = Object.freeze([
  'purposes',
  'lawfulBases',
  'specialConditions',
  'retentionRules',
  'dpiaRequired',
  'dpiaRef',
  'offering',
  'clientCoverage',
  'processingCategories',
  'clientScope',
  'dpiaSupportRef',
] as const);

export type RoleField = (typeof ROLE_FIELDS)[number];

/**
 * The engagement roles each activity role allows. Named constants rather than
 * table entries, because the schemas need their literal types.
 */
export const CONTROLLER_ENGAGEMENT_ROLES = Object.freeze(['processor', 'recipient'] as const);
export const PROCESSOR_ENGAGEMENT_ROLES = Object.freeze(['subprocessor'] as const);

/** `joint_controller` has no rules yet (DM §10, Q5), so it has no entry here. */
export type SupportedActivityRole = Exclude<ActivityRole, 'joint_controller'>;

/**
 * `required` means required **to activate**: a draft may leave it out
 * (API §1.5). `forbidden` holds for drafts too.
 */
export interface FieldRule {
  readonly rule: 'required' | 'optional' | 'forbidden';
  readonly note?: string;
}

export interface RoleRules {
  readonly role: SupportedActivityRole;
  readonly fields: Readonly<Record<RoleField, FieldRule>>;
  readonly engagementRoles: readonly EngagementRole[];
  readonly engagementClientScope: 'optional' | 'forbidden';
}

function fieldRule(rule: FieldRule['rule']) {
  return (note?: string): FieldRule => (note === undefined ? { rule } : { rule, note });
}
const required = fieldRule('required');
const optional = fieldRule('optional');
const forbidden = fieldRule('forbidden');

const ROLE_RULES: Readonly<Record<SupportedActivityRole, RoleRules>> = {
  controller: {
    role: 'controller',
    fields: {
      purposes: required('Art. 30(1)(b)'),
      lawfulBases: required('Art. 6(1)'),
      specialConditions: optional(
        'Required when any data category is special (Art. 9, Art. 10); the server checks it',
      ),
      retentionRules: required('at least one; Art. 30(1)(f)'),
      dpiaRequired: optional('Defaults to false'),
      dpiaRef: optional(),
      offering: forbidden(),
      clientCoverage: forbidden(),
      processingCategories: forbidden(),
      clientScope: forbidden(),
      dpiaSupportRef: forbidden(),
    },
    engagementRoles: CONTROLLER_ENGAGEMENT_ROLES,
    engagementClientScope: 'forbidden',
  },
  processor: {
    role: 'processor',
    fields: {
      purposes: forbidden('Art. 30(2)'),
      lawfulBases: forbidden('Art. 30(2)'),
      specialConditions: forbidden('the client establishes them'),
      retentionRules: forbidden(),
      dpiaRequired: forbidden('use dpiaSupportRef'),
      dpiaRef: forbidden('use dpiaSupportRef'),
      offering: required(),
      clientCoverage: required(),
      processingCategories: required('Art. 30(2)(b)'),
      clientScope: optional('include clients when opt_in, exclude clients when all_enrolled'),
      dpiaSupportRef: optional('Art. 28(3)(f)'),
    },
    engagementRoles: PROCESSOR_ENGAGEMENT_ROLES,
    engagementClientScope: 'optional',
  },
};

export function describeRoleRules(role: SupportedActivityRole): RoleRules {
  return ROLE_RULES[role];
}

/** How each field reads in a sentence. */
const LABELS: Readonly<Record<RoleField, string>> = {
  purposes: 'purposes',
  lawfulBases: 'lawful bases',
  specialConditions: 'special-category conditions',
  retentionRules: 'retention rules',
  dpiaRequired: 'a DPIA flag',
  dpiaRef: 'a DPIA reference',
  offering: 'an offering',
  clientCoverage: 'client coverage',
  processingCategories: 'processing categories',
  clientScope: 'a client scope',
  dpiaSupportRef: 'a DPIA support reference',
};

const ROLE_NAMES: Readonly<Record<SupportedActivityRole, string>> = {
  controller: 'Controller',
  processor: 'Processor',
};

function withNote(sentence: string, note: string | undefined): string {
  return note === undefined ? sentence : `${sentence} (${note})`;
}

export const NOT_YET_SUPPORTED_MESSAGE = 'Joint controller activities are not yet supported';

export function forbiddenMessage(role: SupportedActivityRole, field: RoleField): string {
  const { note } = ROLE_RULES[role].fields[field];
  return withNote(`${ROLE_NAMES[role]} activities cannot have ${LABELS[field]}`, note);
}

export function engagementRoleMessage(role: SupportedActivityRole): string {
  const allowed = ROLE_RULES[role].engagementRoles.join(' or ');
  return `${ROLE_NAMES[role]} activities only allow ${allowed} engagements`;
}

export function engagementClientScopeMessage(role: SupportedActivityRole): string {
  return `${ROLE_NAMES[role]} activities cannot scope an engagement to clients`;
}

function requiredMessage(role: SupportedActivityRole, field: RoleField): string {
  const { note } = ROLE_RULES[role].fields[field];
  return withNote(
    `${ROLE_NAMES[role]} activities need ${LABELS[field]} before they can be activated`,
    note,
  );
}

/** Drafts leave a field out; a stored activity spells it null; a list can be empty. */
function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

/** Anything that carries a role and the role-dependent fields: an input or a stored activity. */
export type ActivationCandidate = { readonly role: ActivityRole } & {
  readonly [F in RoleField]?: unknown;
};

/**
 * The required-by-role checks that run on activate (API §3.4). An empty list
 * means the activity can be activated, as far as the record itself can tell;
 * the server adds the rules that need other records.
 */
export function canActivate(activity: ActivationCandidate): FieldError[] {
  if (activity.role === 'joint_controller') {
    return [{ path: '/role', code: 'not_yet_supported', message: NOT_YET_SUPPORTED_MESSAGE }];
  }
  const { role } = activity;
  return ROLE_FIELDS.filter(
    (field) => ROLE_RULES[role].fields[field].rule === 'required' && isMissing(activity[field]),
  ).map((field) => ({
    path: `/${field}`,
    code: 'required_for_role',
    message: requiredMessage(role, field),
  }));
}
