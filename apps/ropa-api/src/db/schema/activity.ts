import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  ACTIVITY_ROLES,
  ACTIVITY_STATUSES,
  CLIENT_COVERAGES,
  ENGAGEMENT_ROLES,
  LAWFUL_BASES,
  SCOPE_MODES,
  SPECIAL_CONDITIONS,
  TRANSFER_MECHANISMS,
} from '@rulemark/ropa-schemas/enums';

import { agreement, offering } from './agreement.js';
import { arrayInList, countryCheck, inList } from './checks.js';
import { createdAt, id, rootColumns, updatedAt } from './columns.js';
import { party } from './party.js';
import { system } from './system.js';
import { dataCategory, securityMeasure, subjectCategory } from './taxonomy.js';

/**
 * DM §3.1–§3.4 and §3.8, DDL §4.4: the activity aggregate. One root, saved and
 * versioned as a whole, so every nested row and link cascades from it, while
 * references to other aggregates RESTRICT (§3).
 *
 * Postgres enforces what holds whatever the status (§2): **forbidden** by role,
 * for drafts too, and **required** by role once a record is active, as a
 * second net under the domain. Rules that span tables — engagement roles by
 * activity role, at least one retention rule, Art. 9 conditions, scope mode
 * against coverage — are the domain's, inside the save transaction.
 */

/** An empty array, which is how "none" is spelled (§3). */
const empty = sql`'{}'`;

export const processingActivity = pgTable(
  'processing_activity',
  {
    id: id(),
    code: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    // Set when this activity replaces a retired one, e.g. after a role change.
    supersedesId: uuid().references((): AnyPgColumn => processingActivity.id, {
      onDelete: 'restrict',
    }),
    // Immutable once saved: `forbid_immutable_change` (§4.6).
    role: text({ enum: ACTIVITY_ROLES }).notNull(),
    roleRationale: text(),
    status: text({ enum: ACTIVITY_STATUSES }).notNull().default('draft'),
    owner: text().notNull(),
    offeringId: uuid().references(() => offering.id, { onDelete: 'restrict' }),
    clientCoverage: text({ enum: CLIENT_COVERAGES }),
    purposes: text().array().notNull().default(empty),
    lawfulBases: text({ enum: LAWFUL_BASES }).array().notNull().default(empty),
    specialConditions: text({ enum: SPECIAL_CONDITIONS }).array().notNull().default(empty),
    processingCategories: text().array().notNull().default(empty),
    // Set (default false) by the domain for controllers; NULL for processors.
    dpiaRequired: boolean(),
    dpiaRef: text(),
    dpiaSupportRef: text(),
    reviewDueAt: date(),
    startedAt: date(),
    endedAt: date(),
    ...rootColumns(),
  },
  (t) => [
    check('processing_activity_code', sql`${t.code} ~ '^[CPJ][1-9][0-9]*$'`),
    check('processing_activity_role', inList(t.role, ACTIVITY_ROLES)),
    check('processing_activity_status', inList(t.status, ACTIVITY_STATUSES)),
    check('processing_activity_client_coverage', inList(t.clientCoverage, CLIENT_COVERAGES)),
    check('processing_activity_lawful_bases', arrayInList(t.lawfulBases, LAWFUL_BASES)),
    check(
      'processing_activity_special_conditions',
      arrayInList(t.specialConditions, SPECIAL_CONDITIONS),
    ),
    // The code's prefix always matches the role (DM §3.0).
    check(
      'processing_activity_code_prefix',
      sql`left(${t.code}, 1) = CASE ${t.role} WHEN 'controller' THEN 'C' WHEN 'processor' THEN 'P' ELSE 'J' END`,
    ),
    // Forbidden by role holds for drafts too (DM §5).
    check(
      'processing_activity_controller_fields',
      sql`${t.role} <> 'controller' OR (${t.offeringId} IS NULL AND ${t.clientCoverage} IS NULL AND ${t.processingCategories} = '{}' AND ${t.dpiaSupportRef} IS NULL)`,
    ),
    check(
      'processing_activity_processor_fields',
      sql`${t.role} <> 'processor' OR (${t.purposes} = '{}' AND ${t.lawfulBases} = '{}' AND ${t.specialConditions} = '{}' AND ${t.dpiaRequired} IS NULL AND ${t.dpiaRef} IS NULL)`,
    ),
    check(
      'processing_activity_dates',
      sql`${t.endedAt} IS NULL OR ${t.startedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
    // Required by role, as a second net: only once the record is live (§2).
    check(
      'processing_activity_active_controller',
      sql`${t.status} <> 'active' OR ${t.role} <> 'controller' OR (cardinality(${t.purposes}) > 0 AND cardinality(${t.lawfulBases}) > 0 AND ${t.dpiaRequired} IS NOT NULL)`,
    ),
    check(
      'processing_activity_active_processor',
      sql`${t.status} <> 'active' OR ${t.role} <> 'processor' OR (${t.offeringId} IS NOT NULL AND ${t.clientCoverage} IS NOT NULL AND cardinality(${t.processingCategories}) > 0)`,
    ),
    check(
      'processing_activity_active_started',
      sql`${t.status} = 'draft' OR ${t.startedAt} IS NOT NULL`,
    ),
    index('processing_activity_offering').on(t.offeringId),
    index('processing_activity_status').on(t.status),
  ],
);

const activityId = () =>
  uuid()
    .notNull()
    .references(() => processingActivity.id, { onDelete: 'cascade' });

// --- link tables: replaced wholesale on save, so never updated ---
// The composite primary key covers lookups by activity; the `_rev` index
// covers the reverse, and the RESTRICT check when a referenced record is
// deleted.

export const activitySubjectCategory = pgTable(
  'activity_subject_category',
  {
    activityId: activityId(),
    subjectCategoryId: uuid()
      .notNull()
      .references(() => subjectCategory.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'activity_subject_category_pkey',
      columns: [t.activityId, t.subjectCategoryId],
    }),
    // The data map starts from a subject category (API §5.4).
    index('activity_subject_category_rev').on(t.subjectCategoryId),
  ],
);

export const activityDataCategory = pgTable(
  'activity_data_category',
  {
    activityId: activityId(),
    dataCategoryId: uuid()
      .notNull()
      .references(() => dataCategory.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'activity_data_category_pkey', columns: [t.activityId, t.dataCategoryId] }),
    index('activity_data_category_rev').on(t.dataCategoryId),
  ],
);

export const activitySystem = pgTable(
  'activity_system',
  {
    activityId: activityId(),
    systemId: uuid()
      .notNull()
      .references(() => system.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'activity_system_pkey', columns: [t.activityId, t.systemId] }),
    // `/coverage` and the architecture document start from a system.
    index('activity_system_rev').on(t.systemId),
  ],
);

export const activitySecurityMeasure = pgTable(
  'activity_security_measure',
  {
    activityId: activityId(),
    securityMeasureId: uuid()
      .notNull()
      .references(() => securityMeasure.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'activity_security_measure_pkey',
      columns: [t.activityId, t.securityMeasureId],
    }),
    index('activity_security_measure_rev').on(t.securityMeasureId),
  ],
);

// --- nested rows: keep their identity across a PUT (API §1.4) ---

/** DM §3.4. Controller activities only, which the domain enforces. */
export const retentionRule = pgTable(
  'retention_rule',
  {
    id: id(),
    activityId: activityId(),
    // NULL: the default rule for the activity.
    dataCategoryId: uuid().references(() => dataCategory.id, { onDelete: 'restrict' }),
    // Not `period` or `trigger`: both are SQL keywords (§3).
    retentionPeriod: text().notNull(),
    triggerEvent: text().notNull(),
    legalRef: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Whole years, months, weeks and days: exactly what `IsoDuration` accepts,
    // and tested against the same values.
    check(
      'retention_rule_period',
      sql`${t.retentionPeriod} ~ '^P([0-9]+Y)?([0-9]+M)?([0-9]+W)?([0-9]+D)?$' AND ${t.retentionPeriod} <> 'P'`,
    ),
    // One rule per data category and at most one default rule, in one
    // constraint: NULLS NOT DISTINCT makes two default rules collide.
    unique('retention_rule_one_per_category').on(t.activityId, t.dataCategoryId).nullsNotDistinct(),
  ],
);

/** DM §3.8. Per-client exceptions to a processor activity's `client_coverage`. */
export const activityClientScope = pgTable(
  'activity_client_scope',
  {
    id: id(),
    activityId: activityId(),
    clientPartyId: uuid()
      .notNull()
      .references(() => party.id, { onDelete: 'restrict' }),
    mode: text({ enum: SCOPE_MODES }).notNull(),
    reason: text(),
    agreementId: uuid().references(() => agreement.id, { onDelete: 'restrict' }),
    startedAt: date().notNull(),
    endedAt: date(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('activity_client_scope_mode', inList(t.mode, SCOPE_MODES)),
    check(
      'activity_client_scope_dates',
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
    // One open row per client; ended rows stay beside it as history.
    uniqueIndex('activity_client_scope_one_active')
      .on(t.activityId, t.clientPartyId)
      .where(sql`${t.endedAt} IS NULL`),
    index('activity_client_scope_client').on(t.clientPartyId),
  ],
);

/** DM §3.2. An activity involves a party in a given role. */
export const engagement = pgTable(
  'engagement',
  {
    id: id(),
    activityId: activityId(),
    partyId: uuid()
      .notNull()
      .references(() => party.id, { onDelete: 'restrict' }),
    role: text({ enum: ENGAGEMENT_ROLES }).notNull(),
    serviceDescription: text().notNull(),
    // Where the data is processed or accessed, not the vendor's HQ. Elements
    // are validated by Zod; Postgres checks the list is not empty (§4.1).
    processingCountries: text().array().notNull(),
    startedAt: date(),
    endedAt: date(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('engagement_role', inList(t.role, ENGAGEMENT_ROLES)),
    check('engagement_processing_countries', sql`cardinality(${t.processingCountries}) >= 1`),
    index('engagement_activity').on(t.activityId),
    // Vendor impact starts from a party (API §5.3).
    index('engagement_party').on(t.partyId),
  ],
);

export const engagementDataCategory = pgTable(
  'engagement_data_category',
  {
    engagementId: uuid()
      .notNull()
      .references(() => engagement.id, { onDelete: 'cascade' }),
    dataCategoryId: uuid()
      .notNull()
      .references(() => dataCategory.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'engagement_data_category_pkey',
      columns: [t.engagementId, t.dataCategoryId],
    }),
  ],
);

/** DM §3.3. Third-country transfer safeguards (Art. 44–49). */
export const transfer = pgTable(
  'transfer',
  {
    id: id(),
    engagementId: uuid()
      .notNull()
      .references(() => engagement.id, { onDelete: 'cascade' }),
    destinationCountry: text().notNull(),
    mechanism: text({ enum: TRANSFER_MECHANISMS }).notNull(),
    onwardVia: text(),
    documentRef: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('transfer_destination_country', countryCheck(t.destinationCountry)),
    check('transfer_mechanism', inList(t.mechanism, TRANSFER_MECHANISMS)),
    index('transfer_engagement').on(t.engagementId),
  ],
);

/** DM §3.8. Which clients' data an engagement is used for. */
export const engagementClientScope = pgTable(
  'engagement_client_scope',
  {
    id: id(),
    engagementId: uuid()
      .notNull()
      .references(() => engagement.id, { onDelete: 'cascade' }),
    clientPartyId: uuid()
      .notNull()
      .references(() => party.id, { onDelete: 'restrict' }),
    mode: text({ enum: SCOPE_MODES }).notNull(),
    reason: text().notNull(),
    agreementId: uuid().references(() => agreement.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('engagement_client_scope_mode', inList(t.mode, SCOPE_MODES)),
    unique('engagement_client_scope_once').on(t.engagementId, t.clientPartyId),
    index('engagement_client_scope_client').on(t.clientPartyId),
  ],
);
