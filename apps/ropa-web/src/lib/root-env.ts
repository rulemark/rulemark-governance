import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Locally, the repository-root `.env`, as the API reads it
 * (`apps/ropa-api/src/shared/startup.ts`), for `next dev` and also for a local
 * `next build` or `next typegen`, which run as production and compile the
 * API's address into the rewrite. The file is never deployed (.env is
 * gitignored), so on Render and in CI there's nothing to read. A variable
 * already set is never overridden.
 *
 * Not `@next/env`'s `loadEnvConfig(root)`: Next has already loaded the app
 * directory's files by the time next.config.ts runs, and `loadEnvConfig`
 * returns that cached result instead of reading another directory.
 */
export function loadRootEnvFile(
  file: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!existsSync(file)) return;
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (env[name] === undefined) env[name] = value;
  }
}
