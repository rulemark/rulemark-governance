import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

import {
  ConfigError,
  loadConfig,
  loadDatabaseConfig,
  type Config,
  type DatabaseConfig,
} from './config.js';

/**
 * What every entry point does before it can do anything else. The service and
 * the migrator are separate processes with separate `main`s, and both need the
 * same environment, so this lives in one place rather than in each of them.
 */

/**
 * Local development reads the repository-root `.env`; on Render every variable
 * comes from the service's environment (workspace-skeleton.md §3.4). The path
 * is relative to this file because npm runs workspace scripts from the
 * workspace directory, and `src/` and `dist/` sit at the same depth.
 */
function loadEnvFile(): void {
  if (process.env['NODE_ENV'] === 'production') return;
  loadDotenv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
}

/**
 * Configuration problems stop the process with the message and nothing else: a
 * stack trace through Zod tells an operator nothing about which variable to
 * fix, and the logger cannot start because its level is part of what failed.
 */
export function loadConfigOrExit(): Config {
  loadEnvFile();
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

/** For tools that only touch the database: see `loadDatabaseConfig`. */
export function loadDatabaseConfigOrExit(): DatabaseConfig {
  loadEnvFile();
  try {
    return loadDatabaseConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
