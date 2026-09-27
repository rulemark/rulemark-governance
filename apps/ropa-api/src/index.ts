import { createApp } from './api/app.js';
import { recordsRouter } from './api/resources/index.js';
import { createDb, createPool } from './db/client.js';
import { cleanupDelivered, dispatchOnce } from './delivery/dispatcher.js';
import { startRunner, type Runner } from './delivery/runner.js';
import { createLogger } from './shared/logger.js';
import { loadConfigOrExit } from './shared/startup.js';

const config = loadConfigOrExit();
const logger = createLogger(config);

const pool = createPool(config.databaseUrl);
const db = createDb(pool);
const app = createApp({ config, logger, router: recordsRouter(db) });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'ropa-api listening');
});

/**
 * The outbox dispatcher runs here, for the demo (step 4, open question 2).
 * With no destination configured there is nothing to deliver: every event
 * waits in the outbox until one is.
 */
const destinations = config.eventDestinations;
const dispatcher: Runner | undefined =
  Object.keys(destinations).length === 0
    ? undefined
    : startRunner({
        dispatch: () => dispatchOnce(db, { destinations, logger }),
        cleanup: () => cleanupDelivered(db, { now: new Date() }),
        logger,
      });
logger.info({ destinations: Object.keys(destinations) }, 'event delivery configured');

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

  const serverClosed = new Promise<Error | undefined>((resolve) => {
    server.close((error) => resolve(error));
  });
  // The dispatcher stops claiming and finishes the batch in flight, which a
  // consumer's timeout bounds well inside the grace period.
  const dispatcherStopped = dispatcher?.stop() ?? Promise.resolve();

  void Promise.all([serverClosed, dispatcherStopped]).then(([error]) => {
    clearTimeout(forceClose);
    // Close the pool after both, so in-flight requests and deliveries keep
    // their connections until they have finished.
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
