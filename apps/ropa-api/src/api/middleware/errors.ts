import type { ErrorRequestHandler, RequestHandler } from 'express';

import { notFound, toProblemDetails, type ProblemDetails } from '../problems.js';

declare module 'express-serve-static-core' {
  interface Locals {
    /** The problem this request ended in, picked up by the request log. */
    problem?: ProblemDetails;
  }
}

/** Last route: anything unmatched is a 404 in the same problem+json shape. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No route for ${req.method} ${req.path}`));
};

export interface ProblemHandlerOptions {
  /** Development only: return the message of an unexpected error (§1.7). */
  readonly includeDetail: boolean;
}

export function problemHandler(options: ProblemHandlerOptions): ErrorRequestHandler {
  return (error, req, res, next) => {
    // Something already started writing; Express's default handler must finish.
    if (res.headersSent) {
      next(error);
      return;
    }

    const details = toProblemDetails(error, {
      instance: req.originalUrl,
      requestId: req.requestId,
      includeDetail: options.includeDetail,
    });

    // Left for the request log rather than logged here, so a failed request
    // still produces exactly one line. A 5xx is our bug and gets the stack; a
    // 4xx is the caller's and does not.
    res.locals.problem = details;
    if (details.status >= 500) {
      // pino-http logs `res.err` on a 5xx; without it, it invents a bare
      // "failed with status code 500" and the real stack never reaches the log.
      (res as { err?: unknown }).err = error;
    }

    res.status(details.status).type('application/problem+json').json(details);
  };
}
