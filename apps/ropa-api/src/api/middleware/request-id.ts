import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlates a response with its log lines. Always set (see below). */
    requestId?: string;
  }
}

/**
 * A caller's or proxy's id is kept so a trace survives the hop, but only if it
 * is short and unremarkable: an id goes into every log line for the request,
 * and an attacker-chosen one should not be able to forge or flood them.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const supplied = req.get('x-request-id');
  const id = supplied !== undefined && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};
