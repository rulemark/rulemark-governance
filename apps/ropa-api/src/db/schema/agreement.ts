import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { AGREEMENT_DIRECTIONS, AUTHORIZATION_TYPES } from '@rulemark/ropa-schemas/enums';

import { party } from './party.js';
import { inList, slugCheck } from './checks.js';
import { id, rootColumns } from './columns.js';

/**
 * DM §3.6, DDL §4.2. The terms document, separate from the signed agreement,
 * because 400 clients sign one standard DPA while Aurelia signs its own.
 */
export const agreementTerms = pgTable(
  'agreement_terms',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    direction: text({ enum: AGREEMENT_DIRECTIONS }).notNull(),
    authorizationType: text({ enum: AUTHORIZATION_TYPES }).notNull(),
    noticeDays: integer().notNull(),
    // Empty means no restriction, never NULL (§3).
    allowedRegions: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    documentUrl: text(),
    ...rootColumns(),
  },
  (t) => [
    check('agreement_terms_slug', slugCheck(t.slug)),
    check('agreement_terms_direction', inList(t.direction, AGREEMENT_DIRECTIONS)),
    check('agreement_terms_authorization', inList(t.authorizationType, AUTHORIZATION_TYPES)),
    check('agreement_terms_notice_days', sql`${t.noticeDays} >= 0`),
  ],
);

/** DM §3.7, DDL §4.2. What clients enrol in. */
export const offering = pgTable(
  'offering',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    // RESTRICT between aggregates is what makes the API's 409 "still
    // referenced" possible rather than a silent cascade (§3).
    defaultTermsId: uuid()
      .notNull()
      .references(() => agreementTerms.id, { onDelete: 'restrict' }),
    ...rootColumns(),
  },
  (t) => [check('offering_slug', slugCheck(t.slug))],
);

/** DM §3.6, DDL §4.2. A signed agreement with one party. Identified by id only. */
export const agreement = pgTable(
  'agreement',
  {
    id: id(),
    partyId: uuid()
      .notNull()
      .references(() => party.id, { onDelete: 'restrict' }),
    termsId: uuid()
      .notNull()
      .references(() => agreementTerms.id, { onDelete: 'restrict' }),
    // Required when the terms are outbound, which needs the other row and so is
    // checked in the domain layer (§2).
    offeringId: uuid().references(() => offering.id, { onDelete: 'restrict' }),
    signedAt: date().notNull(),
    endedAt: date(),
    ...rootColumns(),
  },
  (t) => [
    check('agreement_dates', sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.signedAt}`),
    // Covers "the clients enrolled in this offering", the busiest lookup there is.
    index('agreement_offering_party').on(t.offeringId, t.partyId, t.endedAt),
    index('agreement_party').on(t.partyId),
  ],
);
