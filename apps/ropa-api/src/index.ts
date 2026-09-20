import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

import { createApp } from './api/app.js';
import { ConfigError, loadConfig } from './shared/config.js';
import { createLogger } from './shared/logger.js';

/**
 * Local development reads the repository-root `.env`; on Render every variable
 * comes from the service's environment (workspace-skeleton.md §3.4). The path
 * is relative to this file because npm runs workspace scripts from the
 * workspace directory, and `src/` and `dist/` sit at the same depth.
 */
if (process.env['NODE_ENV'] !== 'production') {
  loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
}

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    // Before the logger exists, and the level it would use is what failed.
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger(config);
const app = createApp({ config, logger });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'ropa-api listening');
});

/**
 * Render sends SIGTERM and waits before SIGKILL, so in-flight requests get to
 * finish. Anything still open after the grace period is closed by hand: a
 * keep-alive connection sitting idle would otherwise hold the process open.
 */
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceClose = setTimeout(() => {
    logger.warn({ graceMs: SHUTDOWN_GRACE_MS }, 'grace period elapsed, closing connections');
    server.closeAllConnections();
  }, SHUTDOWN_GRACE_MS);
  forceClose.unref();

  server.close((error) => {
    clearTimeout(forceClose);
    if (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
    logger.info('shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// A process in an unknown state should not keep serving; Render restarts it.
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);
});
