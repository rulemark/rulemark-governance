import { sql } from 'drizzle-orm';
import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The columns §3 puts on every table, so no table forgets one and they are all
 * declared identically.
 */

/** UUIDv7 is time-ordered, which keeps indexes compact. Built into Postgres 18. */
export const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Maintained by the `set_updated_at` trigger, not by the application (§4.6). */
export const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Every aggregate root carries one; nested rows are versioned through their root. */
export const version = () => integer().notNull().default(1);

/** The three columns every versioned aggregate root shares. */
export const rootColumns = () => ({
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
