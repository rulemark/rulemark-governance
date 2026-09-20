import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { DATA_CATEGORY_SPECIALS } from '@rulemark/ropa-schemas/enums';

import { inList, slugCheck } from './checks.js';
import { id, rootColumns } from './columns.js';

/**
 * DM §3.10, DDL §4.3. The shared vocabularies. The DSAR tracker and the
 * Subprocessor Monitor reference these by slug, so the slug matters more here
 * than anywhere else.
 */

export const subjectCategory = pgTable(
  'subject_category',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    ...rootColumns(),
  },
  (t) => [check('subject_category_slug', slugCheck(t.slug))],
);

export const dataCategory = pgTable(
  'data_category',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    /** `art9`: a special category. `art10`: criminal convictions. */
    special: text({ enum: DATA_CATEGORY_SPECIALS }).notNull().default('none'),
    ...rootColumns(),
  },
  (t) => [
    check('data_category_slug', slugCheck(t.slug)),
    check('data_category_special', inList(t.special, DATA_CATEGORY_SPECIALS)),
  ],
);

export const securityMeasure = pgTable(
  'security_measure',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    ...rootColumns(),
  },
  (t) => [check('security_measure_slug', slugCheck(t.slug))],
);
