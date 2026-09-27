import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Local development reads the repository-root `.env`, as the API does
 * (`apps/ropa-api/src/shared/startup.ts`); on Render every variable comes from
 * the service's environment, so production reads nothing. A variable already
 * set is never overridden.
 *
 * Not `@next/env`'s `loadEnvConfig(root)`: Next has already loaded the app
 * directory's files by the time next.config.ts runs, and `loadEnvConfig`
 * returns that cached result instead of reading another directory.
 */
export function loadRootEnvFile(
  file: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (env['NODE_ENV'] === 'production' || !existsSync(file)) return;
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (env[name] === undefined) env[name] = value;
  }
}
