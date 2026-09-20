import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated from the Drizzle schema, reviewed, and committed
 * (`ropa-database.md` §8.1). CI regenerates and fails if a new file appears,
 * which catches a schema change that was never migrated.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  // TypeScript is camelCase, Postgres is snake_case; Drizzle maps between them
  // so no column has to spell its own name twice (§3).
  casing: 'snake_case',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
