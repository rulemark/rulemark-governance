import { ConfigError, loadConfig } from './config';

/**
 * Stops the process with the configuration's problems and nothing else, as
 * the API's startup does: a stack trace through Zod tells an operator nothing
 * about which variable to fix.
 */
export function checkConfiguration(): void {
  try {
    loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
