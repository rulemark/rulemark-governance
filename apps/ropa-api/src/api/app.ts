import { API_VERSION } from '@rulemark/ropa-schemas';
import express, { type Express, type Router } from 'express';
import { pinoHttp } from 'pino-http';

import type { Config } from '../shared/config.js';
import { createLogger, type Logger } from '../shared/logger.js';
import { authenticate } from './middleware/authenticate.js';
import { notFoundHandler, problemHandler } from './middleware/errors.js';
import { requestId } from './middleware/request-id.js';
import { authRouter } from './routes/auth.js';
import { docsRouter } from './routes/docs.js';
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

  /**
   * Two proxies sit in front of this service, not one: Render's own edge, and
   * Cloudflare in front of that. A real request arrives with
   * `x-forwarded-for: <caller>, <cloudflare>` and a `remoteAddress` of Render's
   * internal proxy.
   *
   * The number matters because the token rate limiter keys on `req.ip`. Too
   * few hops and that is an edge node's address, so every caller behind that
   * edge shares one bucket. Too many — `true` especially — and a caller picks
   * their own address by sending the header themselves.
   *
   * It is pinned by `trust-proxy.test.ts`, including that a prepended address
   * is still ignored. It does encode Render's current topology, so if they put
   * something else in front, that test is what should fail.
   */
  app.set('trust proxy', 2);
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
      //
      // `client` is here because `trust proxy` is a setting whose mistakes are
      // invisible: the rate limiter keys on `req.ip`, and if the hop count is
      // wrong that is an edge node's address rather than the caller's, with
      // nothing in the logs to say so. `ips` is the chain it derived it from.
      customProps: (rawRequest, res) => {
        const req = rawRequest as express.Request;
        const { problem } = (res as express.Response).locals;
        return {
          client: { ip: req.ip, ips: req.ips },
          ...(problem === undefined ? {} : { problem }),
        };
      },
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  // Outside /v1 and outside auth: Render polls the health check before
  // anything is ready, and documentation you must authenticate for is
  // documentation nobody reads (§1.9).
  app.use(healthzRouter);
  app.use(docsRouter());

  // Every route below knows who is calling; what they may do is each route's
  // own declaration, through `requires()` (§1.9).
  app.use(authenticate(config));
  app.use(`/${API_VERSION}`, authRouter(config));
  if (router !== undefined) app.use(router);

  app.use(notFoundHandler);
  // Express 5 forwards a rejected promise from an async handler here too.
  // Only development NODE_ENV includes detailed error information: `test`
  // asserts the production shape, so a leak fails a test.
  app.use(problemHandler({ includeDetail: config.nodeEnv === 'development' }));

  return app;
}
