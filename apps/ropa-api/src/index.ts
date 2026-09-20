import { createApp } from './api/app.js';
import { recordsRouter } from './api/resources/index.js';
import { createDb, createPool } from './db/client.js';
import { createLogger } from './shared/logger.js';
import { loadConfigOrExit } from './shared/startup.js';

const config = loadConfigOrExit();
const logger = createLogger(config);

const pool = createPool(config.databaseUrl);
const app = createApp({ config, logger, router: recordsRouter(createDb(pool)) });

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
    // Close the pool after the server, so in-flight requests keep their
    // connections until they have finished answering.
    void pool.end().finally(() => {
      if (error) {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      }
      logger.info('shutdown complete');
      process.exit(0);
    });
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
