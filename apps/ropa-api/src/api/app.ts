import express, { type Express, type Router } from 'express';
import { pinoHttp } from 'pino-http';

import type { Config } from '../shared/config.js';
import { createLogger, type Logger } from '../shared/logger.js';
import { notFoundHandler, problemHandler } from './middleware/errors.js';
import { requestId } from './middleware/request-id.js';
import { healthzRouter } from './routes/healthz.js';

export interface AppOptions {
  readonly config: Config;
  readonly logger?: Logger;
  /** The `/v1` router, mounted from Phase 5 onwards. */
  readonly router?: Router;
}

/**
 * Builds the Express application without listening, so tests can drive it
 * in-process and the bootstrap (`index.ts`) owns the socket.
 */
export function createApp({ config, logger = createLogger(config), router }: AppOptions): Express {
  const app = express();

  // Render terminates TLS and proxies; without this, req.ip and req.protocol lie.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  // First, so every later log line and every problem response carries the id.
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId ?? '',
      customLogLevel: (req, res, error) => {
        if (error !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        // Render polls the health check constantly, and a passing one says
        // nothing. A failing one still reaches the lines above.
        return req.url === '/healthz' ? 'debug' : 'info';
      },
      // The problem left by the error handler, so one line tells the whole
      // story. The error itself travels separately, as `res.err`.
      customProps: (_req, res) => {
        const { problem } = (res as express.Response).locals;
        return problem === undefined ? {} : { problem };
      },
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  app.use(healthzRouter);
  if (router !== undefined) app.use(router);

  app.use(notFoundHandler);
  // Express 5 forwards a rejected promise from an async handler here too.
  // Only development NODE_ENV includes detailed error information: `test`
  // asserts the production shape, so a leak fails a test.
  app.use(problemHandler({ includeDetail: config.nodeEnv === 'development' }));

  return app;
}
