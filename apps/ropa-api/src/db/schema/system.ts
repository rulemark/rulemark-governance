import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { SYSTEM_KINDS } from '@rulemark/ropa-schemas/enums';

import { party } from './party.js';
import { inList, slugCheck } from './checks.js';
import { id, rootColumns } from './columns.js';

/** DM §3.9, DDL §4.2. Where processing runs. */
export const system = pgTable(
  'system',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    kind: text({ enum: SYSTEM_KINDS }).notNull(),
    /** The join key to Architecture Snapshot: `srv-…`, `dpg-…`. */
    renderResourceId: text().unique('system_render_resource_id'),
    region: text(),
    hostingPartyId: uuid()
      .notNull()
      .references(() => party.id, { onDelete: 'restrict' }),
    ...rootColumns(),
  },
  (t) => [
    check('system_slug', slugCheck(t.slug)),
    check('system_kind', inList(t.kind, SYSTEM_KINDS)),
    // Anything Render hosts sits in a region, and the region is what makes the
    // transfer question answerable.
    check('system_render_region', sql`${t.kind} = 'external_saas' OR ${t.region} IS NOT NULL`),
    index('system_hosting_party').on(t.hostingPartyId),
  ],
);
