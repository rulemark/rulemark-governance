/**
 * Every value list in the data model, defined once.
 *
 * Zod reads these (`z.enum(PARTY_KINDS)`) and so do the database's check
 * constraints (`ropa-database.md` §1), which is what keeps the API and Postgres
 * from disagreeing about what a valid value is. Adding a value is a code change
 * plus a generated migration.
 *
 * They are frozen because a shared mutable array exported from a package is an
 * accident waiting to happen.
 */

function list<const T extends readonly string[]>(...values: T): T {
  return Object.freeze(values) as unknown as T;
}

// --- activities (built in step 2; the vocabulary is defined here now) ---

/** `joint_controller` is modeled but rejected as not yet supported (DM §10, Q5). */
export const ACTIVITY_ROLES = list('controller', 'processor', 'joint_controller');
export const ACTIVITY_STATUSES = list('draft', 'active', 'retired');

/** Which clients a processor activity applies to by default (DM §3.1). */
export const CLIENT_COVERAGES = list('all_enrolled', 'opt_in');

/** Art. 6(1)(a)–(f). */
export const LAWFUL_BASES = list('6(1)(a)', '6(1)(b)', '6(1)(c)', '6(1)(d)', '6(1)(e)', '6(1)(f)');

/** Art. 9(2)(a)–(j), plus Art. 10 for criminal convictions. */
export const SPECIAL_CONDITIONS = list(
  '9(2)(a)',
  '9(2)(b)',
  '9(2)(c)',
  '9(2)(d)',
  '9(2)(e)',
  '9(2)(f)',
  '9(2)(g)',
  '9(2)(h)',
  '9(2)(i)',
  '9(2)(j)',
  'art10',
);

export const ENGAGEMENT_ROLES = list('processor', 'subprocessor', 'recipient', 'joint_controller');

/** Art. 44–49 transfer safeguards. */
export const TRANSFER_MECHANISMS = list('adequacy', 'dpf', 'sccs', 'bcr', 'derogation_49');

/** Client scoping at activity and engagement level (DM §3.8). */
export const SCOPE_MODES = list('include', 'exclude');

// --- foundation records ---

export const PARTY_KINDS = list('self', 'client', 'vendor', 'other');

/** Outbound: we are the processor for a client. Inbound: a vendor processes for us. */
export const AGREEMENT_DIRECTIONS = list('outbound', 'inbound');

/** Art. 28(2). */
export const AUTHORIZATION_TYPES = list('general', 'specific');

export const SYSTEM_KINDS = list(
  'render_web_service',
  'render_private_service',
  'render_worker',
  'render_cron',
  'render_static_site',
  'render_postgres',
  'render_key_value',
  'external_saas',
);

/**
 * The Render-hosted kinds, which are the ones that must carry a region.
 * Derived rather than repeated, so a new Render kind is covered automatically.
 */
export const RENDER_SYSTEM_KINDS = Object.freeze(
  SYSTEM_KINDS.filter((kind): kind is RenderSystemKind => kind.startsWith('render_')),
);

export const DATA_CATEGORY_SPECIALS = list('none', 'art9', 'art10');

/** The `{type}` segment of `/taxonomy/{type}` (API §2). */
export const TAXONOMY_TYPES = list('subject-categories', 'data-categories', 'security-measures');

// --- authentication and authorization (API §1.9) ---

/**
 * Each route declares the one permission it needs. Two splits are deliberate:
 * editing is not approving (`record:write` against `activity:approve`), and
 * services get their own narrow roles rather than borrowing a person's.
 */
export const PERMISSIONS = list(
  'record:read',
  'record:write',
  'record:delete',
  'taxonomy:write',
  'system:write',
  'activity:approve',
  'review:read',
  'review:create',
  'review:resolve',
  'view:report',
  'view:subprocessors',
  'view:impact',
  'view:datamap',
  'view:coverage',
  'history:read',
);

export const ROLES = list(
  'viewer',
  'editor',
  'approver',
  'admin',
  'service:monitor',
  'service:snapshot',
  'service:dsar',
);

// --- workflow, history and events ---

export const REVIEW_SOURCES = list('monitor', 'snapshot', 'manual', 'schedule');
export const REVIEW_REASONS = list(
  'vendor_subprocessor_added',
  'vendor_subprocessor_removed',
  'unmapped_system',
  'transfer_missing',
  'region_violation',
  'review_overdue',
);
export const REVIEW_STATUSES = list('open', 'resolved', 'dismissed');

/** Which aggregate a revision belongs to (DM §3.12). */
export const REVISION_ENTITY_TYPES = list(
  'activity',
  'party',
  'agreement',
  'agreement_terms',
  'offering',
  'system',
  'subject_category',
  'data_category',
  'security_measure',
);

export const CHANGE_TYPES = list('created', 'updated', 'activated', 'retired', 'deleted');
export const EVENT_TYPES = list('record.changed', 'subprocessors.changed');

// --- types ---

export type ActivityRole = (typeof ACTIVITY_ROLES)[number];
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export type ClientCoverage = (typeof CLIENT_COVERAGES)[number];
export type LawfulBasis = (typeof LAWFUL_BASES)[number];
export type SpecialCondition = (typeof SPECIAL_CONDITIONS)[number];
export type EngagementRole = (typeof ENGAGEMENT_ROLES)[number];
export type TransferMechanism = (typeof TRANSFER_MECHANISMS)[number];
export type ScopeMode = (typeof SCOPE_MODES)[number];
export type PartyKind = (typeof PARTY_KINDS)[number];
export type AgreementDirection = (typeof AGREEMENT_DIRECTIONS)[number];
export type AuthorizationType = (typeof AUTHORIZATION_TYPES)[number];
export type SystemKind = (typeof SYSTEM_KINDS)[number];
export type RenderSystemKind = Extract<SystemKind, `render_${string}`>;
export type DataCategorySpecial = (typeof DATA_CATEGORY_SPECIALS)[number];
export type TaxonomyType = (typeof TAXONOMY_TYPES)[number];
// `Permission` and `Role` types come from `resources/auth.ts`, which owns the
// Zod schemas built on these lists, so the name means one thing.
export type ReviewSource = (typeof REVIEW_SOURCES)[number];
export type ReviewReason = (typeof REVIEW_REASONS)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type RevisionEntityType = (typeof REVISION_ENTITY_TYPES)[number];
export type ChangeType = (typeof CHANGE_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
