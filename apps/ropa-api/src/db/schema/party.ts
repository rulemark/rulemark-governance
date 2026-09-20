import { sql } from 'drizzle-orm';
import { check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { PARTY_KINDS } from '@rulemark/ropa-schemas/enums';

import { countryCheck, inList, slugCheck } from './checks.js';
import { id, rootColumns } from './columns.js';

/** DM §3.5, DDL §4.2. Us, our clients, our vendors, and everyone else. */
export const party = pgTable(
  'party',
  {
    id: id(),
    slug: text().notNull().unique(),
    kind: text({ enum: PARTY_KINDS }).notNull(),
    legalName: text().notNull(),
    country: text().notNull(),
    contactName: text(),
    contactEmail: text(),
    dpoName: text(),
    dpoEmail: text(),
    trustUrl: text(),
    dpaUrl: text(),
    subprocessorListUrl: text(),
    ...rootColumns(),
  },
  (t) => [
    check('party_kind', inList(t.kind, PARTY_KINDS)),
    check('party_slug', slugCheck(t.slug)),
    check('party_country', countryCheck(t.country)),
    // Art. 30(1)(a): the record must carry the controller's DPO details.
    check(
      'party_self_dpo',
      sql`${t.kind} <> 'self' OR (${t.dpoName} IS NOT NULL AND ${t.dpoEmail} IS NOT NULL)`,
    ),
    // Exactly one `self` party (DM §5). A partial unique index makes it
    // race-proof: two concurrent creates cannot both succeed.
    uniqueIndex('party_one_self')
      .on(t.kind)
      .where(sql`${t.kind} = 'self'`),
  ],
);
