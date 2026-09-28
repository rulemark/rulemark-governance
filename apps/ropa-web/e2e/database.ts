import pg from 'pg';

/**
 * The smoke test's own database: E2E_DATABASE_URL, or the development
 * database's name with `_e2e`, beside the API tests' `_test`. It's reset and
 * seeded with the story on every run, so it's never one anybody keeps data in.
 */
export function e2eDatabaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  if (env['E2E_DATABASE_URL']) return env['E2E_DATABASE_URL'];
  const development = env['DATABASE_URL'];
  if (!development) throw new Error('Set DATABASE_URL (or E2E_DATABASE_URL) for the smoke test');
  const url = new URL(development);
  url.pathname = `${url.pathname.replace(/^\//, '')}_e2e`;
  return url.toString();
}

/** Creates the database if it doesn't exist, from the server's `postgres` database. */
export async function ensureDatabase(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  const maintenance = new URL(databaseUrl);
  maintenance.pathname = '/postgres';

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }
}
